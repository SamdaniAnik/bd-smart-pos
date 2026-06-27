/**
 * Batch receipt and FEFO helpers (pharmacy + supershop perishables).
 */

const {
  autoBatchCodeForReceipt,
  computeExpiryFromShelfLife,
  productRequiresExpiryDateOnReceipt,
  productUsesExpiryBatches,
} = require("../constants/perishable");

async function findOrCreateBatch(tx, { branchId, productId, productVariantId, batchCode, expiryDate, unitCost, note }) {
  const variantId = productVariantId ? Number(productVariantId) : null;
  const code = String(batchCode || "").trim();
  if (!code) return null;

  const existing = await tx.inventoryBatch.findFirst({
    where: {
      branchId,
      productId: Number(productId),
      productVariantId: variantId,
      batchCode: code,
    },
  });

  if (existing) {
    return existing;
  }

  return tx.inventoryBatch.create({
    data: {
      branchId,
      productId: Number(productId),
      productVariantId: variantId,
      batchCode: code,
      expiryDate: expiryDate || null,
      qtyOnHand: 0,
      unitCost: Number(unitCost || 0),
      note: note || null,
    },
  });
}

/**
 * Post purchase line stock + optional batch receipt.
 */
async function postPurchaseLineStock(tx, {
  branchId,
  purchaseId,
  product,
  item,
  landedUnitCost,
}) {
  const productId = Number(item.productId);
  const qty = Math.max(0, Math.floor(Number(item.qty || 0)));
  const variantId = Number(item.productVariantId || 0) || null;
  const batchCode = String(item.batchCode || "").trim();
  const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;
  const unitCost = Number(landedUnitCost ?? item.cost ?? 0);

  if (qty <= 0) {
    throw new Error("Invalid purchase qty");
  }

  const useExpiryBatches = productUsesExpiryBatches(product);

  if (useExpiryBatches) {
    if (product.hasVariants && !variantId) {
      throw new Error(
        `Variant required when receiving batch stock for ${product.name || productId}`
      );
    }

    let resolvedExpiry = expiryDate;
    if (!resolvedExpiry && Number(product.shelfLifeDays || 0) > 0) {
      resolvedExpiry = computeExpiryFromShelfLife(product.shelfLifeDays);
    }
    if (productRequiresExpiryDateOnReceipt(product) && !resolvedExpiry && product.batchTracked) {
      throw new Error(
        `Expiry date required for batch-tracked product: ${product.name || productId}`
      );
    }

    const resolvedBatchCode = autoBatchCodeForReceipt({
      purchaseId,
      productId,
      expiryDate: resolvedExpiry,
      batchCode,
    });

    const batch = await findOrCreateBatch(tx, {
      branchId,
      productId,
      productVariantId: variantId,
      batchCode: resolvedBatchCode,
      expiryDate: resolvedExpiry,
      unitCost,
      note: `Purchase #${purchaseId}`,
    });
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { qtyOnHand: { increment: qty }, unitCost },
    });
  }

  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: { increment: qty } },
    });
  } else if (!product.sellByWeight) {
    await tx.product.update({
      where: { id: productId },
      data: {
        stock: { increment: qty },
        unitPrice: unitCost,
      },
    });
  }

  await tx.stockLedger.create({
    data: {
      branchId,
      productId,
      refType: "PURCHASE",
      refId: purchaseId,
      inQty: qty,
      unitCost,
    },
  });
}

function buildBatchWhereForSaleLine({ branchId, productId, productVariantId, hasVariants }) {
  const vid = productVariantId ? Number(productVariantId) : null;
  const where = {
    branchId,
    productId: Number(productId),
    qtyOnHand: { gt: 0 },
  };
  if (hasVariants) {
    if (!vid) return null;
    where.productVariantId = vid;
  } else {
    where.productVariantId = null;
  }
  return where;
}

module.exports = {
  findOrCreateBatch,
  postPurchaseLineStock,
  buildBatchWhereForSaleLine,
};
