const prisma = require("./prisma");
const { sendSms, renderSmsTemplate } = require("./smsGateway");

const DIGEST_TEMPLATE =
  "{store}: আজ বিক্রি ৳{sales} | আদায় ৳{col} | বকেয়া ৳{due} | লো স্টক {lowStock} | ক্রয় ৳{purchase}";

async function buildDigestMetrics(branchId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [branch, sales, purchases, products, dueAgg] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }),
    prisma.sale.findMany({
      where: { branchId, createdAt: { gte: start } },
      select: { total: true, paidAmount: true, dueAmount: true },
    }),
    prisma.purchase.findMany({
      where: { branchId, createdAt: { gte: start } },
      select: { total: true },
    }),
    prisma.product.findMany({
      where: { branchId },
      select: { stock: true, reorderLevel: true },
    }),
    prisma.customer.aggregate({
      where: { branchId, balance: { gt: 0 } },
      _sum: { balance: true },
    }),
  ]);
  const salesTotal = sales.reduce((s, x) => s + Number(x.total || 0), 0);
  const collections = sales.reduce((s, x) => s + Number(x.paidAmount || 0), 0);
  const lowStock = products.filter((p) => Number(p.stock || 0) <= Number(p.reorderLevel || 0)).length;
  const purchaseTotal = purchases.reduce((s, x) => s + Number(x.total || 0), 0);
  return {
    store: branch?.name || "দোকান",
    sales: salesTotal.toFixed(2),
    col: collections.toFixed(2),
    due: Number(dueAgg._sum.balance || 0).toFixed(2),
    lowStock: String(lowStock),
    purchase: purchaseTotal.toFixed(2),
  };
}

async function sendOwnerDigestForBranch(branchId) {
  const branch = await prisma.branch.findUnique({
    where: { id: Number(branchId) },
    select: { id: true, name: true, ownerPhone: true, digestEnabled: true },
  });
  if (!branch) throw new Error("Branch not found");
  const phone = String(branch.ownerPhone || "").trim();
  if (!phone) throw new Error("Owner phone not configured");
  const metrics = await buildDigestMetrics(branch.id);
  const message = renderSmsTemplate(DIGEST_TEMPLATE, metrics);
  const result = await sendSms({ to: phone, message });
  return { branchId: branch.id, metrics, result };
}

async function runOwnerDigestCron({ branchId = null, hour = null } = {}) {
  const now = new Date();
  const currentHour = hour != null ? Number(hour) : now.getHours();
  const where = {
    digestEnabled: true,
    ownerPhone: { not: null },
    ...(branchId ? { id: Number(branchId) } : {}),
  };
  const branches = await prisma.branch.findMany({
    where,
    select: { id: true, digestHour: true, ownerPhone: true },
  });
  const eligible = branches.filter((b) => Number(b.digestHour ?? 21) === currentHour);
  const results = [];
  for (const b of eligible) {
    try {
      const sent = await sendOwnerDigestForBranch(b.id);
      results.push({ branchId: b.id, status: sent.result?.status || "sent" });
    } catch (err) {
      results.push({ branchId: b.id, status: "failed", error: err.message });
    }
  }
  return { hour: currentHour, eligible: eligible.length, results };
}

module.exports = {
  buildDigestMetrics,
  sendOwnerDigestForBranch,
  runOwnerDigestCron,
  DIGEST_TEMPLATE,
};
