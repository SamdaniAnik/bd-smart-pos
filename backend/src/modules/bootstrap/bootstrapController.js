const prisma = require("../../utils/prisma");
const config = require("../../utils/config");
const bcrypt = require("bcrypt");
const { ensureDefaultOrganization } = require("../../utils/subscriptionUtil");

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
  "financial.lock.manage",
  "financial.lock.override",
  "financial.lock.maturity.view",
  "financial.lock.maturity.override",
  "pharmacy.view",
  "pharmacy.manage",
  "pharmacy.dispense",
  "topup.view",
  "topup.create",
  "topup.manage",
  "fcommerce.view",
  "fcommerce.manage",
];

const accountDefaults = [
  { code: "1100", name: "Cash In Hand", type: "Asset", isSystem: true },
  { code: "1110", name: "Cheques In Hand", type: "Asset", isSystem: true },
  { code: "1120", name: "Petty Cash", type: "Asset", isSystem: true },
  { code: "1130", name: "Bank Current Account", type: "Asset", isSystem: true },
  { code: "1200", name: "Accounts Receivable", type: "Asset", isSystem: true },
  { code: "1140", name: "Recharge/Bill Float", type: "Asset", isSystem: true },
  { code: "1150", name: "Mobile Wallet (MFS) Clearing", type: "Asset", isSystem: true },
  { code: "1300", name: "Inventory", type: "Asset", isSystem: true },
  { code: "1400", name: "Fixed Assets", type: "Asset", isSystem: true },
  { code: "1410", name: "Accumulated Depreciation", type: "Asset", isSystem: true },
  { code: "2100", name: "Accounts Payable", type: "Liability", isSystem: true },
  { code: "2110", name: "Cheques Issued", type: "Liability", isSystem: true },
  { code: "2120", name: "AIT Payable to NBR", type: "Liability", isSystem: true },
  { code: "2125", name: "VDS Payable to NBR", type: "Liability", isSystem: true },
  { code: "2320", name: "Bank Loans Payable", type: "Liability", isSystem: true },
  { code: "3100", name: "Owner Equity", type: "Equity", isSystem: true },
  { code: "4100", name: "Sales Revenue", type: "Revenue", isSystem: true },
  { code: "4150", name: "Recharge & Bill Commission Income", type: "Revenue", isSystem: true },
  { code: "5100", name: "Cost Of Goods Sold", type: "Expense", isSystem: true },
  { code: "5200", name: "Operating Expense", type: "Expense", isSystem: true },
];

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function getRequestSeedToken(req) {
  const headerToken = req.headers["x-bootstrap-token"];
  if (typeof headerToken === "string" && headerToken.length > 0) return headerToken;
  if (req.body && typeof req.body.seedToken === "string") return req.body.seedToken;
  return "";
}

exports.seedSystem = async (req, res) => {
  try {
    // Gate 1: optional shared-secret token. Mandatory in production.
    const expectedToken = config.bootstrap.seedToken || "";
    if (config.isProd && !expectedToken) {
      return res.status(503).json({
        error: "Bootstrap is disabled in production. Set BOOTSTRAP_SEED_TOKEN to enable.",
      });
    }
    if (expectedToken) {
      const got = getRequestSeedToken(req);
      if (!constantTimeEqual(expectedToken, got)) {
        return res.status(401).json({ error: "Invalid bootstrap token." });
      }
    }

    const {
      branchId,
      branchName = "Main Branch",
      adminEmail = "admin@bdpos.local",
      adminPassword = "123456",
    } = req.body || {};

    let bId = Number(branchId || 0);

    // Gate 2: if a branch is supplied and already bootstrapped, refuse.
    if (bId) {
      const existing = await prisma.branch.findUnique({ where: { id: bId } });
      if (!existing) {
        return res.status(404).json({ error: `Branch ${bId} not found.` });
      }
      if (existing.bootstrapped) {
        return res.status(409).json({
          error: `Branch ${bId} is already bootstrapped (at ${existing.bootstrappedAt?.toISOString() || "unknown"}).`,
        });
      }
    } else {
      // Gate 3: if no branchId is supplied AND any branch is already bootstrapped,
      // assume the system is set up and refuse to create another root.
      const anyBootstrapped = await prisma.branch.findFirst({
        where: { bootstrapped: true },
        select: { id: true, name: true, bootstrappedAt: true },
      });
      if (anyBootstrapped) {
        return res.status(409).json({
          error: `System already bootstrapped (branch "${anyBootstrapped.name}", id ${anyBootstrapped.id}). Pass an explicit branchId to seed an additional branch.`,
        });
      }

      const createdBranch = await prisma.branch.create({
        data: {
          code: `BR-${Date.now()}`,
          name: branchName,
          organizationId: (await ensureDefaultOrganization()).id,
        },
      });
      bId = createdBranch.id;
    }

    // --- Idempotent seed body (unchanged behaviour) ---

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
      // Refuse to seed the default insecure admin password in production.
      if (config.isProd && adminPassword === "123456") {
        return res.status(400).json({
          error: "Refusing to create admin with the default password in production. Pass a strong adminPassword.",
        });
      }
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

    const { RETAIL_CATEGORY_SEEDS } = require("../../constants/retailDepartments");
    for (const seed of RETAIL_CATEGORY_SEEDS) {
      const name = String(seed.name || "").trim();
      if (!name) continue;
      const existingCat = await prisma.productCategory.findFirst({
        where: { branchId: bId, name: { equals: name } },
        select: { id: true },
      });
      if (!existingCat) {
        await prisma.productCategory.create({
          data: {
            branchId: bId,
            name,
            department: seed.department ? String(seed.department).toUpperCase() : null,
            attributeSet: Array.isArray(seed.attributeSet) ? seed.attributeSet : [],
            minMarginPct:
              seed.minMarginPct != null && Number.isFinite(Number(seed.minMarginPct))
                ? Number(seed.minMarginPct)
                : null,
          },
        });
      }
    }

    // Mark branch as bootstrapped — this blocks future seed attempts on this branch.
    await prisma.branch.update({
      where: { id: bId },
      data: {
        bootstrapped: true,
        bootstrappedAt: new Date(),
        businessProfile: "MIXED",
      },
    });

    return res.json({
      message: "System seeded",
      branchId: bId,
      adminEmail,
      // Never echo the password back in production.
      adminPassword: config.isProd ? "***" : adminPassword,
      bootstrappedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
