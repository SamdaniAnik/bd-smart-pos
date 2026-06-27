const prisma = require("./prisma");
const { buildBatchWhereForSaleLine } = require("./inventoryBatchUtil");
const { productUsesExpiryBatches } = require("../constants/perishable");

const COSTING_METHODS = {
  WEIGHTED_AVG: "WEIGHTED_AVG",
  LAST_LANDED: "LAST_LANDED",
};

function normalizeCostingMethod(value) {
  const v = String(value || COSTING_METHODS.WEIGHTED_AVG).toUpperCase();
  return v === COSTING_METHODS.LAST_LANDED ? COSTING_METHODS.LAST_LANDED : COSTING_METHODS.WEIGHTED_AVG;
}

async function getLatestLandedCostByProduct(branchId, client = prisma) {
  const logs = await client.auditLog.findMany({
    where: { action: "PURCHASE_CREATE", entity: "Purchase" },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const map = new Map();
  for (const log of logs) {
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) continue;
    const lines = Array.isArray(payload?.landedCostAllocation?.lines)
      ? payload.landedCostAllocation.lines
      : [];
    for (const line of lines) {
      const productId = Number(line?.productId || 0);
      if (!productId || map.has(productId)) continue;
      map.set(productId, {
        baseUnitCost: Number(line?.baseUnitCost || 0),
        landedUnitCost: Number(line?.landedUnitCost || 0),
      });
    }
  }
  return map;
}

async function getWeightedAverageUnitCost(tx, branchId, productId, { sellByWeight = false } = {}) {
  const rows = await tx.stockLedger.findMany({
    where: { branchId: Number(branchId), productId: Number(productId) },
    select: {
      inQty: true,
      outQty: true,
      inWeightKg: true,
      outWeightKg: true,
      unitCost: true,
    },
  });
  let balance = 0;
  let value = 0;
  for (const row of rows) {
    const uc = Number(row.unitCost || 0);
    if (sellByWeight) {
      const inW = Number(row.inWeightKg || 0);
      const outW = Number(row.outWeightKg || 0);
      balance += inW - outW;
      value += inW * uc - outW * uc;
    } else {
      const inQ = Number(row.inQty || 0);
      const outQ = Number(row.outQty || 0);
      balance += inQ - outQ;
      value += inQ * uc - outQ * uc;
    }
  }
  if (balance > 1e-9) return Math.max(0, value / balance);
  return null;
}

function landedUnitCostForProduct(landedByProduct, productId, product) {
  const info = landedByProduct?.get(Number(productId));
  if (info) {
    const landed = Number(info.landedUnitCost || 0);
    if (landed > 0) return landed;
    const base = Number(info.baseUnitCost || 0);
    if (base > 0) return base;
  }
  return Number(product?.unitPrice || 0);
}

function isBatchExpired(expiryDate, now = new Date()) {
  if (!expiryDate) return false;
  const exp = new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return false;
  // A batch is treated as expired once today's date is past the expiry date.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return exp.getTime() < today.getTime();
}

/**
 * Plan FEFO batch consumption without mutating stock (for unit cost + later execute).
 * Expired batches are skipped by default; pass `allowExpired: true` (manager
 * override at checkout) to permit dispensing already-expired stock.
 */
async function planFefoForSaleLine(tx, { branchId, product, saleQty, variantId, allowExpired = false, now = new Date() }) {
  const batchWhere = buildBatchWhereForSaleLine({
    branchId,
    productId: product.id,
    productVariantId: variantId,
    hasVariants: product.hasVariants,
  });
  if (!batchWhere) {
    throw new Error(`Cannot plan FEFO batches for ${product.name || product.id}`);
  }
  let qtyNeeded = Math.ceil(Math.max(0, Number(saleQty || 0)) - 1e-9);
  const batches = await tx.inventoryBatch.findMany({
    where: batchWhere,
    orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
  });
  const lines = [];
  let totalCost = 0;
  let totalQty = 0;
  let expiredSkippedQty = 0;
  let usedExpired = false;
  for (const b of batches) {
    if (qtyNeeded <= 0) break;
    const onHand = Number(b.qtyOnHand || 0);
    if (onHand <= 0) continue;
    const expired = isBatchExpired(b.expiryDate, now);
    if (expired && !allowExpired) {
      expiredSkippedQty += onHand;
      continue;
    }
    const consumeQty = Math.min(qtyNeeded, onHand);
    const unitCost = Number(b.unitCost || product.unitPrice || 0);
    lines.push({
      batchId: b.id,
      batchCode: b.batchCode,
      expiryDate: b.expiryDate,
      consumeQty,
      unitCost,
      expired,
    });
    if (expired) usedExpired = true;
    totalQty += consumeQty;
    totalCost += consumeQty * unitCost;
    qtyNeeded -= consumeQty;
  }
  if (qtyNeeded > 0) {
    if (expiredSkippedQty > 0 && !allowExpired) {
      throw new Error(
        `Cannot sell ${product.name || product.id}: ${expiredSkippedQty} available unit(s) are expired. A manager override is required to dispense expired stock.`
      );
    }
    throw new Error(
      `Batch stock mismatch for ${product.name || product.id}. FEFO allocation missing ${qtyNeeded}. Add batch stock or disable batch tracking.`
    );
  }
  const avgUnitCost = totalQty > 0 ? totalCost / totalQty : 0;
  return { lines, totalQty, totalCost, avgUnitCost, usedExpired };
}

async function executeFefoPlan(tx, plan, { saleItemId, productId, productName }) {
  const allocations = [];
  for (const line of plan.lines || []) {
    const onHandRow = await tx.inventoryBatch.findUnique({ where: { id: line.batchId } });
    const onHand = Number(onHandRow?.qtyOnHand || 0);
    const consumeQty = Number(line.consumeQty || 0);
    if (consumeQty > onHand + 1e-9) {
      throw new Error(
        `Batch ${line.batchCode || line.batchId} stock changed during checkout. Retry the sale.`
      );
    }
    await tx.inventoryBatch.update({
      where: { id: line.batchId },
      data: { qtyOnHand: onHand - consumeQty },
    });
    allocations.push({
      saleItemId,
      batchId: line.batchId,
      productId: Number(productId),
      productName: productName || `Product#${productId}`,
      batchCode: line.batchCode,
      expiryDate: line.expiryDate,
      consumeQty,
      unitCost: Number(line.unitCost || 0),
    });
  }
  return allocations;
}

async function resolveSaleLineUnitCost(
  tx,
  { branchId, product, cartItem, billingUnits, costingMethod, landedByProduct, allowExpired = false }
) {
  const method = normalizeCostingMethod(costingMethod);
  const bill = Math.max(0, Number(billingUnits || 0));
  const variantId = Number(cartItem?.variantId || 0) || null;
  const weightSale = Boolean(product.sellByWeight) || Number(cartItem?.weightKg ?? 0) > 1e-9;

  if (productUsesExpiryBatches(product) && !weightSale && bill > 0) {
    if (product.hasVariants && !variantId) {
      throw new Error(
        `Select size/pack variant for batch-tracked product: ${product.name || product.id}`
      );
    }
    const fefoPlan = await planFefoForSaleLine(tx, {
      branchId,
      product,
      saleQty: bill,
      variantId,
      allowExpired,
    });
    return {
      unitCost: fefoPlan.avgUnitCost,
      source: "FEFO_BATCH",
      fefoPlan,
    };
  }

  let unitCost = null;
  let source = method;

  if (method === COSTING_METHODS.LAST_LANDED) {
    const landed = landedUnitCostForProduct(landedByProduct, product.id, product);
    if (landed > 0) unitCost = landed;
  }

  if (unitCost == null || unitCost <= 0) {
    const avg = await getWeightedAverageUnitCost(tx, branchId, product.id, {
      sellByWeight: Boolean(product.sellByWeight),
    });
    if (avg != null && avg > 0) {
      unitCost = avg;
      source = COSTING_METHODS.WEIGHTED_AVG;
    }
  }

  if (unitCost == null || unitCost <= 0) {
    unitCost = landedUnitCostForProduct(landedByProduct, product.id, product);
    source = unitCost > 0 ? "LANDED_FALLBACK" : "ZERO";
  }

  return { unitCost: Math.max(0, Number(unitCost || 0)), source, fefoPlan: null };
}

module.exports = {
  COSTING_METHODS,
  normalizeCostingMethod,
  getLatestLandedCostByProduct,
  getWeightedAverageUnitCost,
  planFefoForSaleLine,
  executeFefoPlan,
  resolveSaleLineUnitCost,
  isBatchExpired,
};
