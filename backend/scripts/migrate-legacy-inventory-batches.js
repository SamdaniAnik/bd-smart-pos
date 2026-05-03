#!/usr/bin/env node
/**
 * One-shot: copy legacy AuditLog rows (action INVENTORY_BATCH, entity InventoryBatch)
 * into the InventoryBatch table. Does not change Product.stock (already counted in legacy flow).
 *
 * Usage:
 *   node scripts/migrate-legacy-inventory-batches.js [--dry-run] [--skip-existing] [--enable-batch-tracking]
 *
 * --dry-run                Log actions only (no writes)
 * --skip-existing          Skip keys that already have an InventoryBatch row
 * --enable-batch-tracking   Set Product.batchTracked = true for every product migrated
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseExpiry(payload) {
  if (!payload?.expiryDate) return null;
  const d = new Date(payload.expiryDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickLatestLog(rows) {
  return rows.reduce((best, cur) => {
    const bestUp = best.payload?.updatedAt ? new Date(best.payload.updatedAt).getTime() : 0;
    const curUp = cur.payload?.updatedAt ? new Date(cur.payload.updatedAt).getTime() : 0;
    if (curUp !== bestUp) return curUp >= bestUp ? cur : best;
    return new Date(cur.createdAt).getTime() >= new Date(best.createdAt).getTime() ? cur : best;
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const skipExisting = process.argv.includes("--skip-existing");
  const enableBatchTracking = process.argv.includes("--enable-batch-tracking");

  const logs = await prisma.auditLog.findMany({
    where: { action: "INVENTORY_BATCH", entity: "InventoryBatch" },
    orderBy: { id: "asc" },
  });

  const byKey = new Map();
  for (const log of logs) {
    const payload = log.payload || {};
    const branchId = Number(payload.branchId || 0);
    const productId = Number(payload.productId || 0);
    const batchCode = String(payload.batchCode || "").trim();
    if (!branchId || !productId || !batchCode) continue;

    const key = `${branchId}|${productId}|${batchCode}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(log);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const productIdsTouched = new Set();

  for (const [, group] of byKey) {
    const log = pickLatestLog(group);
    const payload = log.payload || {};
    const branchId = Number(payload.branchId || 0);
    const productId = Number(payload.productId || 0);
    const batchCode = String(payload.batchCode || "").trim();
    const qtyOnHand = Math.max(0, Math.floor(Number(payload.qtyOnHand || 0)));
    const unitCost = Math.max(0, Number(payload.unitCost || 0));
    const note = payload.note ? String(payload.note).slice(0, 500) : null;
    const expiryDate = parseExpiry(payload);
    const legacyAuditLogId = log.id;

    const product = await prisma.product.findFirst({ where: { id: productId, branchId }, select: { id: true } });
    if (!product) {
      skipped += 1;
      console.warn(`Skip missing product branch=${branchId} productId=${productId} batch=${batchCode}`);
      continue;
    }

    try {
      const existing = await prisma.inventoryBatch.findUnique({
        where: {
          branchId_productId_batchCode: { branchId, productId, batchCode },
        },
      });

      if (dryRun) {
        if (existing && skipExisting) skipped += 1;
        else if (existing) updated += 1;
        else created += 1;
        productIdsTouched.add(productId);
        continue;
      }

      if (existing && skipExisting) {
        skipped += 1;
        continue;
      }

      if (existing) {
        await prisma.inventoryBatch.update({
          where: { id: existing.id },
          data: {
            qtyOnHand,
            expiryDate,
            unitCost,
            legacyAuditLogId,
            note,
          },
        });
        updated += 1;
      } else {
        await prisma.inventoryBatch.create({
          data: {
            branchId,
            productId,
            batchCode,
            qtyOnHand,
            expiryDate,
            unitCost,
            legacyAuditLogId,
            note,
          },
        });
        created += 1;
      }
      productIdsTouched.add(productId);
    } catch (e) {
      errors += 1;
      console.error(`Error ${branchId}/${productId}/${batchCode}:`, e.message || e);
    }
  }

  if (enableBatchTracking && productIdsTouched.size > 0) {
    const ids = [...productIdsTouched];
    if (dryRun) {
      console.log(`[dry-run] Would enable batchTracked on ${ids.length} product(s)`);
    } else {
      const result = await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { batchTracked: true },
      });
      console.log(`Enabled batchTracked on ${result.count} product row(s)`);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        skipExisting,
        legacyAuditLogsScanned: logs.length,
        uniqueBatchKeys: byKey.size,
        created,
        updated,
        skipped,
        errors,
        productsAffected: productIdsTouched.size,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
