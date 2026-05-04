const prisma = require("../../utils/prisma");
const bcrypt = require("bcrypt");

const permissionCodes = [
  "branch.manage",
  "product.view",
  "product.create",
  "sale.view",
  "sale.create",
  "sale.return",
  "rbac.manage",
  "inventory.view",
  "inventory.adjust",
  "inventory.transfer",
  "purchase.view",
  "purchase.create",
  "purchase.return",
  "accounting.view",
  "accounting.journal.create",
  "accounting.report",
  "report.view",
  "supplier.view",
  "supplier.create",
  "customer.view",
  "customer.create",
  "expense.view",
  "expense.create",
  "cheque.view",
  "cheque.manage",
  "cheque.clear",
  "asset.view",
  "asset.manage",
  "costcenter.view",
  "costcenter.manage",
  "pettycash.view",
  "pettycash.manage",
];

const accountDefaults = [
  { code: "1100", name: "Cash In Hand", type: "Asset", isSystem: true },
  { code: "1110", name: "Cheques In Hand", type: "Asset", isSystem: true },
  { code: "1120", name: "Petty Cash", type: "Asset", isSystem: true },
  { code: "1200", name: "Accounts Receivable", type: "Asset", isSystem: true },
  { code: "1300", name: "Inventory", type: "Asset", isSystem: true },
  { code: "1400", name: "Fixed Assets", type: "Asset", isSystem: true },
  { code: "1410", name: "Accumulated Depreciation", type: "Asset", isSystem: true },
  { code: "2100", name: "Accounts Payable", type: "Liability", isSystem: true },
  { code: "2110", name: "Cheques Issued", type: "Liability", isSystem: true },
  { code: "3100", name: "Owner Equity", type: "Equity", isSystem: true },
  { code: "4100", name: "Sales Revenue", type: "Revenue", isSystem: true },
  { code: "5100", name: "Cost Of Goods Sold", type: "Expense", isSystem: true },
  { code: "5200", name: "Operating Expense", type: "Expense", isSystem: true },
];

exports.seedSystem = async (req, res) => {
  try {
    const { branchId, branchName = "Main Branch", adminEmail = "admin@bdpos.local", adminPassword = "123456" } = req.body;
    let bId = Number(branchId || 0);
    if (!bId) {
      const createdBranch = await prisma.branch.create({
        data: {
          code: `BR-${Date.now()}`,
          name: branchName,
        },
      });
      bId = createdBranch.id;
    }

    for (const code of permissionCodes) {
      await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code },
      });
    }

    const adminRole = await prisma.role.upsert({
      where: { name: "Admin" },
      update: {},
      create: { name: "Admin" },
    });

    const permissions = await prisma.permission.findMany();
    for (const p of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: p.id },
      });
    }

    for (const account of accountDefaults) {
      await prisma.account.upsert({
        where: { branchId_code: { branchId: bId, code: account.code } },
        update: {},
        create: { branchId: bId, ...account },
      });
    }

    const defaultAdjustReasons = [
      { code: "DAMAGE", label: "Damage / Breakage", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
      { code: "EXPIRED", label: "Expired / Spoilage", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
      { code: "COUNT_GAIN", label: "Stock Count Gain", direction: "IN", accountingImpact: "GAIN", accountCode: "4100" },
      { code: "COUNT_LOSS", label: "Stock Count Loss", direction: "OUT", accountingImpact: "WRITE_OFF", accountCode: "5200" },
      { code: "MANUAL", label: "Manual Adjustment", direction: "BOTH", accountingImpact: "NONE", accountCode: null },
    ];
    for (const reason of defaultAdjustReasons) {
      await prisma.inventoryAdjustReason.upsert({
        where: { branchId_code: { branchId: bId, code: reason.code } },
        update: {},
        create: { branchId: bId, ...reason, isActive: true },
      });
    }

    const year = new Date().getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);
    const existingPeriod = await prisma.fiscalPeriod.findFirst({
      where: { branchId: bId, name: `${year} Fiscal Period` },
    });
    if (!existingPeriod) {
      await prisma.fiscalPeriod.create({
        data: {
          branchId: bId,
          name: `${year} Fiscal Period`,
          startDate,
          endDate,
          isClosed: false,
        },
      });
    }

    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          branchId: bId,
          roleId: adminRole.id,
          name: "System Admin",
          email: adminEmail,
          passwordHash,
        },
      });
    }

    res.json({ message: "System seeded", branchId: bId, adminEmail, adminPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
