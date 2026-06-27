const {
  loadBranchLoyaltyBonusMap,
  getCategoryMultiplier,
  pointsFromLineRevenue,
} = require("./loyaltyAisleBonus");

function parseRedeemedPointsFromNotes(notes) {
  if (!notes) return 0;
  try {
    const payload = JSON.parse(notes);
    return Number(payload?.loyalty?.redeemedPoints || 0);
  } catch {
    return 0;
  }
}

function getDefaultPointsExpiryDays() {
  const raw = Number(process.env.LOYALTY_POINTS_EXPIRY_DAYS ?? 365);
  if (!Number.isFinite(raw) || raw < 0) return 365;
  return Math.floor(raw);
}

function getExpiringSoonDays() {
  return Math.max(7, Number(process.env.LOYALTY_POINTS_EXPIRING_SOON_DAYS || 30));
}

function getPointsPer100() {
  return Number(process.env.LOYALTY_POINTS_PER_100 || 1);
}

async function loadBranchPointsExpiryDays(prisma, branchId) {
  const id = Number(branchId);
  if (!id || !prisma?.$queryRaw) return getDefaultPointsExpiryDays();
  try {
    const rows = await prisma.$queryRaw`
      SELECT loyaltyPointsExpiryDays FROM Branch WHERE id = ${id} LIMIT 1
    `;
    const val = rows?.[0]?.loyaltyPointsExpiryDays;
    if (val != null && Number.isFinite(Number(val))) {
      const days = Math.floor(Number(val));
      return days >= 0 ? days : getDefaultPointsExpiryDays();
    }
  } catch {
    /* column may be missing */
  }
  return getDefaultPointsExpiryDays();
}

async function saveBranchPointsExpiryDays(prisma, branchId, daysRaw) {
  const id = Number(branchId);
  if (!id || !prisma?.$executeRaw) return;
  let days = null;
  if (daysRaw != null && String(daysRaw).trim() !== "") {
    const n = Math.floor(Number(daysRaw));
    if (Number.isFinite(n) && n >= 0) days = n;
  }
  await prisma.$executeRaw`
    UPDATE Branch SET loyaltyPointsExpiryDays = ${days} WHERE id = ${id}
  `;
}

function saleLineBill(item) {
  return Number(item.weightKg || 0) > 1e-9 ? Number(item.weightKg || 0) : Number(item.qty || 0);
}

function pointsForSaleItems(items, bonusMap) {
  const pointsPer100 = getPointsPer100();
  let points = 0;
  for (const item of items || []) {
    const bill = saleLineBill(item);
    const revenue = bill * Number(item.price || 0);
    const mult = getCategoryMultiplier(bonusMap, item.product?.category);
    points += pointsFromLineRevenue(revenue, pointsPer100, mult);
  }
  return Math.floor(points);
}

function allocateLoyaltyBalance(buckets, redeemedPoints, expiryDays, expiringSoonDays = getExpiringSoonDays()) {
  const sorted = [...(buckets || [])].sort(
    (a, b) => new Date(a.earnedAt).getTime() - new Date(b.earnedAt).getTime()
  );
  let redeemLeft = Math.max(0, Number(redeemedPoints || 0));
  const ledger = sorted.map((b) => ({
    ...b,
    remaining: Math.max(0, Math.floor(Number(b.points || 0))),
  }));

  for (const row of ledger) {
    if (redeemLeft <= 0) break;
    const take = Math.min(row.remaining, redeemLeft);
    row.remaining -= take;
    redeemLeft -= take;
  }

  const now = Date.now();
  const expiryMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : null;
  const soonMs = expiringSoonDays * 24 * 60 * 60 * 1000;

  let availablePoints = 0;
  let expiredPoints = 0;
  let expiringSoonPoints = 0;
  let earnedPoints = 0;

  for (const row of ledger) {
    earnedPoints += Math.floor(Number(row.points || 0));
    if (row.remaining <= 0) continue;
    const earnedMs = new Date(row.earnedAt).getTime();
    if (expiryMs && earnedMs + expiryMs < now) {
      expiredPoints += row.remaining;
      continue;
    }
    availablePoints += row.remaining;
    if (expiryMs && earnedMs + expiryMs <= now + soonMs) {
      expiringSoonPoints += row.remaining;
    }
  }

  return {
    earnedPoints,
    redeemedPoints: Math.max(0, Number(redeemedPoints || 0)),
    availablePoints: Math.max(0, availablePoints),
    expiredPoints: Math.max(0, expiredPoints),
    expiringSoonPoints: Math.max(0, expiringSoonPoints),
    pointsExpiryDays: expiryDays,
    expiringSoonDays,
    expiryEnabled: expiryDays > 0,
  };
}

async function buildCustomerPointBuckets(prisma, branchId, customerId, bonusMap) {
  const sales = await prisma.sale.findMany({
    where: { branchId, customerId },
    select: { id: true, createdAt: true, notes: true },
    orderBy: { createdAt: "asc" },
  });
  if (!sales.length) {
    return { buckets: [], redeemedPoints: 0, totalSpent: 0, orders: 0 };
  }

  const saleIds = sales.map((s) => s.id);
  const items = await prisma.saleItem.findMany({
    where: { saleId: { in: saleIds } },
    select: {
      saleId: true,
      qty: true,
      weightKg: true,
      price: true,
      product: { select: { category: true } },
    },
  });
  const itemsBySale = new Map();
  for (const item of items) {
    if (!itemsBySale.has(item.saleId)) itemsBySale.set(item.saleId, []);
    itemsBySale.get(item.saleId).push(item);
  }

  const buckets = [];
  let redeemedPoints = 0;
  for (const sale of sales) {
    redeemedPoints += parseRedeemedPointsFromNotes(sale.notes);
    const pts = pointsForSaleItems(itemsBySale.get(sale.id) || [], bonusMap);
    if (pts > 0) {
      buckets.push({ earnedAt: sale.createdAt, points: pts, saleId: sale.id });
    }
  }

  const totals = await prisma.sale.aggregate({
    where: { branchId, customerId },
    _sum: { total: true },
    _count: { id: true },
  });

  return {
    buckets,
    redeemedPoints,
    totalSpent: Number(totals._sum.total || 0),
    orders: Number(totals._count.id || 0),
  };
}

async function buildCustomerLoyaltyBalance(prisma, branchId, customerId) {
  const bonusMap = await loadBranchLoyaltyBonusMap(prisma, branchId);
  const expiryDays = await loadBranchPointsExpiryDays(prisma, branchId);
  const { buckets, redeemedPoints, totalSpent, orders } = await buildCustomerPointBuckets(
    prisma,
    branchId,
    customerId,
    bonusMap
  );
  const balance = allocateLoyaltyBalance(buckets, redeemedPoints, expiryDays);
  return {
    ...balance,
    totalSpent,
    orders,
    aisleBonusActive: Object.keys(bonusMap).length > 0,
  };
}

async function buildBranchCustomerLoyaltyMap(prisma, branchId) {
  const bonusMap = await loadBranchLoyaltyBonusMap(prisma, branchId);
  const expiryDays = await loadBranchPointsExpiryDays(prisma, branchId);

  const sales = await prisma.sale.findMany({
    where: { branchId, customerId: { not: null } },
    select: { id: true, customerId: true, createdAt: true, notes: true },
    orderBy: { createdAt: "asc" },
  });
  if (!sales.length) return new Map();

  const saleIds = sales.map((s) => s.id);
  const items = await prisma.saleItem.findMany({
    where: { saleId: { in: saleIds } },
    select: {
      saleId: true,
      qty: true,
      weightKg: true,
      price: true,
      product: { select: { category: true } },
    },
  });
  const itemsBySale = new Map();
  for (const item of items) {
    if (!itemsBySale.has(item.saleId)) itemsBySale.set(item.saleId, []);
    itemsBySale.get(item.saleId).push(item);
  }

  const byCustomer = new Map();
  for (const sale of sales) {
    const cid = Number(sale.customerId);
    if (!cid) continue;
    if (!byCustomer.has(cid)) {
      byCustomer.set(cid, { buckets: [], redeemedPoints: 0 });
    }
    const entry = byCustomer.get(cid);
    entry.redeemedPoints += parseRedeemedPointsFromNotes(sale.notes);
    const pts = pointsForSaleItems(itemsBySale.get(sale.id) || [], bonusMap);
    if (pts > 0) {
      entry.buckets.push({ earnedAt: sale.createdAt, points: pts });
    }
  }

  const result = new Map();
  for (const [cid, entry] of byCustomer) {
    result.set(cid, allocateLoyaltyBalance(entry.buckets, entry.redeemedPoints, expiryDays));
  }
  return result;
}

module.exports = {
  parseRedeemedPointsFromNotes,
  getDefaultPointsExpiryDays,
  getExpiringSoonDays,
  loadBranchPointsExpiryDays,
  saveBranchPointsExpiryDays,
  allocateLoyaltyBalance,
  buildCustomerLoyaltyBalance,
  buildBranchCustomerLoyaltyMap,
};
