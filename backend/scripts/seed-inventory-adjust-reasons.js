#!/usr/bin/env node
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DEFAULT_REASONS = [
  { code: "DAMAGE", label: "Damage / Breakage", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
  { code: "EXPIRED", label: "Expired / Spoilage", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
  { code: "COUNT_GAIN", label: "Stock Count Gain", direction: "IN", accountingImpact: "GAIN", accountCode: "4100" },
  { code: "COUNT_LOSS", label: "Stock Count Loss", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
  { code: "MANUAL", label: "Manual Adjustment", direction: "BOTH", accountingImpact: "NONE", accountCode: null },
];

async function main() {
  const branches = await prisma.branch.findMany({ select: { id: true } });
  let count = 0;
  for (const b of branches) {
    for (const reason of DEFAULT_REASONS) {
      await prisma.inventoryAdjustReason.upsert({
        where: { branchId_code: { branchId: b.id, code: reason.code } },
        update: {},
        create: { branchId: b.id, ...reason, isActive: true },
      });
      count += 1;
    }
  }
  console.log(`Inventory adjustment reasons ensured: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
