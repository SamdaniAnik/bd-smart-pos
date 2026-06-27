const prisma = require("../../utils/prisma");
const { normalizeBusinessProfile } = require("../../constants/retailDepartments");
const { normalizeCostingMethod } = require("../../utils/costingUtil");
const { normalizePluDigits } = require("../../utils/pluBarcodeUtil");
const { saveBranchLoyaltyBonusJson } = require("../../utils/loyaltyAisleBonus");
const { saveBranchPointsExpiryDays, loadBranchPointsExpiryDays } = require("../../utils/loyaltyPointsExpiry");

async function attachLoyaltyBonusJson(branch, rawBonus, rawExpiryDays) {
  if (!branch?.id) return branch;
  if (rawBonus !== undefined) {
    await saveBranchLoyaltyBonusJson(prisma, branch.id, rawBonus);
  }
  if (rawExpiryDays !== undefined) {
    await saveBranchPointsExpiryDays(prisma, branch.id, rawExpiryDays);
  }
  try {
    const rows = await prisma.$queryRaw`
      SELECT loyaltyAisleBonusJson, loyaltyPointsExpiryDays FROM Branch WHERE id = ${Number(branch.id)} LIMIT 1
    `;
    const row = rows?.[0] || {};
    const expiryDays =
      row.loyaltyPointsExpiryDays != null
        ? Number(row.loyaltyPointsExpiryDays)
        : await loadBranchPointsExpiryDays(prisma, branch.id);
    return {
      ...branch,
      loyaltyAisleBonusJson: row.loyaltyAisleBonusJson ?? null,
      loyaltyPointsExpiryDays: expiryDays,
    };
  } catch {
    return branch;
  }
}

exports.createBranch = async (req, res) => {
  try {
    const {
      code,
      name,
      address,
      phone,
      sellerBin,
      tradeLicenseNo,
      vatRegistrationLabel,
      businessProfile,
      costingMethod,
      scalePluDigits,
      loyaltyAisleBonusJson,
      loyaltyPointsExpiryDays,
    } = req.body;
    const branch = await prisma.branch.create({
      data: {
        code,
        name,
        address,
        phone,
        businessProfile: normalizeBusinessProfile(businessProfile),
        costingMethod: normalizeCostingMethod(costingMethod),
        scalePluDigits: normalizePluDigits(scalePluDigits),
        sellerBin: sellerBin ? String(sellerBin).trim().slice(0, 64) : null,
        tradeLicenseNo: tradeLicenseNo ? String(tradeLicenseNo).trim().slice(0, 64) : null,
        vatRegistrationLabel: vatRegistrationLabel
          ? String(vatRegistrationLabel).trim().slice(0, 250)
          : null,
      },
    });
    const out = await attachLoyaltyBonusJson(branch, loyaltyAisleBonusJson, loyaltyPointsExpiryDays);
    res.status(201).json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBranches = async (_req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { id: "asc" },
    });
    try {
      const rows = await prisma.$queryRaw`
        SELECT id, loyaltyAisleBonusJson, loyaltyPointsExpiryDays FROM Branch
      `;
      const map = new Map(rows.map((r) => [Number(r.id), r]));
      res.json(
        branches.map((b) => {
          const row = map.get(Number(b.id)) || {};
          return {
            ...b,
            loyaltyAisleBonusJson: row.loyaltyAisleBonusJson ?? null,
            loyaltyPointsExpiryDays:
              row.loyaltyPointsExpiryDays != null ? Number(row.loyaltyPointsExpiryDays) : null,
          };
        })
      );
    } catch {
      res.json(branches);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBranchDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    try {
      const rows = await prisma.$queryRaw`
        SELECT loyaltyAisleBonusJson, loyaltyPointsExpiryDays FROM Branch WHERE id = ${id} LIMIT 1
      `;
      const row = rows?.[0] || {};
      const expiryDays =
        row.loyaltyPointsExpiryDays != null
          ? Number(row.loyaltyPointsExpiryDays)
          : await loadBranchPointsExpiryDays(prisma, id);
      res.json({
        ...branch,
        loyaltyAisleBonusJson: row.loyaltyAisleBonusJson ?? null,
        loyaltyPointsExpiryDays: expiryDays,
      });
    } catch {
      res.json(branch);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    const {
      code,
      name,
      address,
      phone,
      isActive,
      sellerBin,
      tradeLicenseNo,
      vatRegistrationLabel,
      businessProfile,
      costingMethod,
      scalePluDigits,
      loyaltyAisleBonusJson,
      loyaltyPointsExpiryDays,
      ownerPhone,
      digestEnabled,
      digestHour,
      courierProvider,
      courierApiKey,
      courierStoreId,
    } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: "Branch code and name are required" });
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        code: String(code).trim(),
        name: String(name).trim(),
        address: address || null,
        phone: phone || null,
        isActive: typeof isActive === "boolean" ? isActive : existing.isActive,
        businessProfile:
          businessProfile != null
            ? normalizeBusinessProfile(businessProfile)
            : existing.businessProfile || "MIXED",
        costingMethod:
          costingMethod != null
            ? normalizeCostingMethod(costingMethod)
            : existing.costingMethod || "WEIGHTED_AVG",
        scalePluDigits:
          scalePluDigits != null ? normalizePluDigits(scalePluDigits) : Number(existing.scalePluDigits || 5),
        sellerBin: sellerBin != null ? String(sellerBin).trim().slice(0, 64) || null : existing.sellerBin,
        tradeLicenseNo:
          tradeLicenseNo != null ? String(tradeLicenseNo).trim().slice(0, 64) || null : existing.tradeLicenseNo,
        vatRegistrationLabel:
          vatRegistrationLabel != null
            ? String(vatRegistrationLabel).trim().slice(0, 250) || null
            : existing.vatRegistrationLabel,
        ownerPhone: ownerPhone != null ? String(ownerPhone).trim().slice(0, 32) || null : existing.ownerPhone,
        digestEnabled: typeof digestEnabled === "boolean" ? digestEnabled : existing.digestEnabled,
        digestHour:
          digestHour != null
            ? Math.max(0, Math.min(23, Number(digestHour) || 21))
            : Number(existing.digestHour ?? 21),
        courierProvider:
          courierProvider != null ? String(courierProvider).trim().slice(0, 32) || null : existing.courierProvider,
        courierApiKey:
          courierApiKey != null ? String(courierApiKey).trim().slice(0, 500) || null : existing.courierApiKey,
        courierStoreId:
          courierStoreId != null ? String(courierStoreId).trim().slice(0, 64) || null : existing.courierStoreId,
      },
    });
    const out = await attachLoyaltyBonusJson(branch, loyaltyAisleBonusJson, loyaltyPointsExpiryDays);
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const ALLOWED_BUSINESS_TYPES = new Set([
  "retail",
  "pharmacy",
  "grocery",
  "ecommerce",
  "restaurant",
]);

function normalizeBusinessType(value) {
  if (value == null) return undefined; // not provided -> leave unchanged
  const key = String(value).trim().toLowerCase();
  if (!key) return null; // explicit clear
  return ALLOWED_BUSINESS_TYPES.has(key) ? key : undefined;
}

exports.updateBranchBusinessProfile = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    const data = {};
    if (req.body?.businessProfile != null) {
      data.businessProfile = normalizeBusinessProfile(req.body.businessProfile);
    }
    const nextType = normalizeBusinessType(req.body?.businessType);
    if (nextType !== undefined) {
      data.businessType = nextType;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const branch = await prisma.branch.update({ where: { id }, data });
    res.json({
      id: branch.id,
      businessProfile: branch.businessProfile,
      businessType: branch.businessType ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    await prisma.branch.delete({ where: { id } });
    res.json({ message: "Branch deleted" });
  } catch (error) {
    res.status(400).json({ error: "Branch cannot be deleted while linked data exists" });
  }
};
