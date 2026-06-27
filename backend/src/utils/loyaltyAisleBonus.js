function parseLoyaltyAisleBonusJson(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      const cat = String(key || "")
        .trim()
        .toUpperCase();
      if (!cat) continue;
      const mult = Number(value);
      if (Number.isFinite(mult) && mult > 0) out[cat] = mult;
    }
    return out;
  } catch {
    return {};
  }
}

function getEnvLoyaltyAisleBonus() {
  return parseLoyaltyAisleBonusJson(process.env.LOYALTY_AISLE_BONUS_JSON || "");
}

function resolveLoyaltyAisleBonus(branchJson) {
  const fromBranch = parseLoyaltyAisleBonusJson(branchJson);
  if (Object.keys(fromBranch).length) return fromBranch;
  return getEnvLoyaltyAisleBonus();
}

function getCategoryMultiplier(bonusMap, categoryName) {
  const cat = String(categoryName || "")
    .trim()
    .toUpperCase();
  const mult = Number(bonusMap[cat] || 1);
  return Number.isFinite(mult) && mult > 0 ? mult : 1;
}

function pointsFromLineRevenue(revenue, pointsPer100, multiplier) {
  const mult = Number(multiplier || 1);
  if (!(mult > 0)) return 0;
  return Math.floor(Number(revenue || 0) / 100) * Number(pointsPer100 || 1) * mult;
}

/** Read branch aisle bonus when generated client lags behind migrations. */
async function loadBranchLoyaltyBonusMap(prisma, branchId) {
  const id = Number(branchId);
  if (!id || !prisma?.$queryRaw) return getEnvLoyaltyAisleBonus();
  try {
    const rows = await prisma.$queryRaw`
      SELECT loyaltyAisleBonusJson FROM Branch WHERE id = ${id} LIMIT 1
    `;
    const raw = rows?.[0]?.loyaltyAisleBonusJson ?? null;
    return resolveLoyaltyAisleBonus(raw);
  } catch {
    return getEnvLoyaltyAisleBonus();
  }
}

async function saveBranchLoyaltyBonusJson(prisma, branchId, rawBonus) {
  const id = Number(branchId);
  if (!id || !prisma?.$executeRaw) return;
  const map = parseLoyaltyAisleBonusJson(rawBonus);
  const json = Object.keys(map).length ? JSON.stringify(map) : null;
  await prisma.$executeRaw`
    UPDATE Branch SET loyaltyAisleBonusJson = ${json} WHERE id = ${id}
  `;
}

module.exports = {
  parseLoyaltyAisleBonusJson,
  resolveLoyaltyAisleBonus,
  getEnvLoyaltyAisleBonus,
  getCategoryMultiplier,
  pointsFromLineRevenue,
  loadBranchLoyaltyBonusMap,
  saveBranchLoyaltyBonusJson,
};
