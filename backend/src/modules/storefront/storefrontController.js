const prisma = require("../../utils/prisma");
const { createInboundOrder } = require("../orders/orderInboxController");
const {
  initiatePayment,
  verifyPayment,
  getPaymentSession,
  getProviderName,
  normalizeMethod,
} = require("../payments/mfsPaymentService");

function publicBranchInfo(branch) {
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address || "",
    phone: branch.phone || "",
    businessProfile: branch.businessProfile || "MIXED",
  };
}

function mapCatalogProduct(product, variants) {
  const inStock = product.sellByWeight
    ? Number(product.stockKg || 0) > 0
    : Number(product.stock || 0) > 0;
  return {
    id: product.id,
    name: product.name,
    nameBn: product.nameBn || "",
    description: product.shortDescription || product.description || "",
    price: Number(product.price || 0),
    category: product.category || product.categoryRef?.name || "General",
    imageUrl: product.imageUrl || null,
    inStock,
    sellByWeight: Boolean(product.sellByWeight),
    hasVariants: Boolean(product.hasVariants),
    variants: (variants || []).map((v) => ({
        id: v.id,
        name: v.label || v.name || "Variant",
        sku: v.sku || "",
        price: v.priceOverride != null ? Number(v.priceOverride) : Number(product.price || 0),
        inStock: Number(v.stock || product.stock || 0) > 0,
      })),
  };
}

exports.getStoreInfo = async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.branchId },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        businessProfile: true,
        isActive: true,
      },
    });
    if (!branch || !branch.isActive) return res.status(404).json({ error: "Store not found" });
    res.json(publicBranchInfo(branch));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCatalog = async (req, res) => {
  try {
    const branchId = req.branchId;
    const q = String(req.query.q || "").trim().toLowerCase();
    const category = String(req.query.category || "").trim();

    const products = await prisma.product.findMany({
      where: {
        branchId,
        isActive: true,
        ...(category ? { category: { equals: category } } : {}),
      },
      include: {
        categoryRef: { select: { name: true } },
        variants: { take: 50, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 500,
    });

    let rows = products.map((p) => mapCatalogProduct(p, p.variants));
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          String(p.nameBn || "").includes(q) ||
          p.category.toLowerCase().includes(q)
      );
    }

    const categories = [...new Set(rows.map((p) => p.category).filter(Boolean))].sort();

    res.json({ categories, products: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function buildOrderNotes({ notes, tableCode, mfsTrxId }) {
  const parts = [];
  const table = String(tableCode || "").trim();
  if (table) parts.push(`[Table ${table}]`);
  if (mfsTrxId) parts.push(`TrxID: ${String(mfsTrxId).trim()}`);
  const userNotes = String(notes || "").trim();
  if (userNotes) parts.push(userNotes);
  return parts.join(" ").trim() || null;
}

async function resolveTableCode(branchId, tableCodeRaw) {
  const code = String(tableCodeRaw || "").trim();
  if (!code) return null;
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { businessProfile: true },
  });
  if (String(branch?.businessProfile || "").toUpperCase() !== "RESTAURANT") {
    return code;
  }
  const table = await prisma.restaurantTable.findFirst({
    where: { branchId, code },
    select: { code: true },
  });
  if (!table) throw new Error(`Table "${code}" not found`);
  return table.code;
}

exports.getTables = async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.branchId },
      select: { businessProfile: true },
    });
    if (!branch || String(branch.businessProfile || "").toUpperCase() !== "RESTAURANT") {
      return res.json({ tables: [] });
    }
    const tables = await prisma.restaurantTable.findMany({
      where: { branchId: req.branchId },
      select: { id: true, code: true, name: true, capacity: true, status: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.initiateMfsPayment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const method = req.body?.method;
    const amount = Number(req.body?.amount);
    const invoiceRef = String(req.body?.invoiceRef || "").trim() || `WEB-${Date.now()}`;
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
    if (!normalizeMethod(method)) return res.status(400).json({ error: "Unsupported MFS method" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });

    const session = await initiatePayment({
      branchId,
      method,
      amount,
      invoiceRef,
      merchantName: branch?.name || "BD Smart POS",
    });

    res.status(201).json({
      message: getProviderName(session.method) === "log"
        ? "MFS payment session created (simulated until MFS_PROVIDER is configured)"
        : "MFS payment session created",
      paymentId: session.paymentId,
      method: session.method,
      amount: session.amount,
      merchantNumber: session.merchantNumber,
      qrPayload: session.qrPayload,
      paymentUrl: session.paymentUrl,
      provider: session.provider,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.verifyMfsPayment = async (req, res) => {
  try {
    const paymentId = String(req.body?.paymentId || "").trim();
    const trxId = String(req.body?.trxId || "").trim();
    if (!paymentId) return res.status(400).json({ error: "paymentId is required" });
    if (!trxId) return res.status(400).json({ error: "trxId is required" });

    const existing = await getPaymentSession(paymentId);
    if (!existing || Number(existing.branchId) !== Number(req.branchId)) {
      return res.status(404).json({ error: "Payment session not found or expired" });
    }

    const session = await verifyPayment({ paymentId, trxId });
    res.json({
      message: session.simulated ? "Payment verified (simulated)" : "Payment verified",
      paymentId: session.paymentId,
      method: session.method,
      amount: session.amount,
      trxId: session.trxId,
      status: session.status,
      provider: session.provider,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getMfsPaymentStatus = async (req, res) => {
  try {
    const session = await getPaymentSession(req.params.id);
    if (!session || Number(session.branchId) !== Number(req.branchId)) {
      return res.status(404).json({ error: "Payment session not found" });
    }
    res.json({
      paymentId: session.paymentId,
      method: session.method,
      amount: session.amount,
      status: session.status,
      trxId: session.trxId || null,
      qrPayload: session.qrPayload,
      paymentUrl: session.paymentUrl,
      provider: session.provider,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.placeOrder = async (req, res) => {
  try {
    const branchId = req.branchId;
    const {
      paymentMethod,
      mfsPaymentId: mfsPaymentIdRaw,
      mfsTrxId: mfsTrxIdRaw,
      tableCode: tableCodeRaw,
      notes,
      deliveryFee,
    } = req.body || {};

    let tableCode = null;
    try {
      tableCode = await resolveTableCode(branchId, tableCodeRaw);
    } catch (tableErr) {
      return res.status(400).json({ error: tableErr.message });
    }

    const mfsPaymentId = String(mfsPaymentIdRaw || "").trim();
    let verifiedTrxId = String(mfsTrxIdRaw || "").trim();
    const normalizedMethod = normalizeMethod(paymentMethod);
    const orderTotal = Math.max(0, Number(req.body?.orderTotal || 0));

    if (mfsPaymentId) {
      const mfsSession = await getPaymentSession(mfsPaymentId);
      if (!mfsSession || Number(mfsSession.branchId) !== Number(branchId)) {
        return res.status(400).json({ error: "MFS payment session not found or expired" });
      }
      if (mfsSession.status !== "VERIFIED") {
        if (!verifiedTrxId) {
          return res.status(400).json({ error: "Verify MFS payment before placing order (TrxID required)" });
        }
        try {
          await verifyPayment({ paymentId: mfsPaymentId, trxId: verifiedTrxId });
        } catch (mfsErr) {
          return res.status(400).json({ error: mfsErr.message || "MFS payment verification failed" });
        }
      } else if (
        verifiedTrxId &&
        mfsSession.trxId &&
        verifiedTrxId.toUpperCase() !== String(mfsSession.trxId).toUpperCase()
      ) {
        return res.status(400).json({ error: "TrxID does not match verified MFS payment session" });
      }
      const refreshed = await getPaymentSession(mfsPaymentId);
      verifiedTrxId = refreshed?.trxId || verifiedTrxId;
      if (normalizedMethod && refreshed?.method !== normalizedMethod) {
        return res.status(400).json({
          error: `MFS session method (${refreshed.method}) does not match payment method`,
        });
      }
      if (orderTotal > 0 && Math.abs(Number(refreshed.amount) - orderTotal) > 0.05) {
        return res.status(400).json({ error: "MFS verified amount does not match order total" });
      }
    }

    req.body = {
      ...req.body,
      source: "WEB_STORE",
      tableCode,
      notes: buildOrderNotes({ notes, tableCode, mfsTrxId: verifiedTrxId }),
    };
    return createInboundOrder(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
