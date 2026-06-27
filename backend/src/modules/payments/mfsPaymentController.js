const crypto = require("crypto");
const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const config = require("../../utils/config");
const {
  initiatePayment,
  verifyPayment,
  refundPayment,
  queryPayment,
  processProviderCallback,
  getPaymentSession,
  getProviderName,
} = require("./mfsPaymentService");

exports.initiateMfsPayment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const method = req.body?.method;
    const amount = Number(req.body?.amount);
    const invoiceRef = String(req.body?.invoiceRef || "").trim() || `POS-${Date.now()}`;
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

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
        ? "MFS payment session created (simulated verification until MFS_PROVIDER is configured)"
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

exports.queryMfsPayment = async (req, res) => {
  try {
    const result = await queryPayment({ paymentId: req.params.id, branchId: req.branchId });
    if (!result) return res.status(404).json({ error: "Payment session not found" });
    const { session, providerStatus } = result;
    res.json({
      paymentId: session.paymentId,
      method: session.method,
      amount: session.amount,
      status: session.status,
      trxId: session.trxId || null,
      provider: session.provider,
      providerStatus: providerStatus || null,
      refundedAmount: session.refundedAmount || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.refundMfsPayment = async (req, res) => {
  try {
    const amount = req.body?.amount != null ? Number(req.body.amount) : undefined;
    const reason = String(req.body?.reason || "").trim() || null;
    const { session, manual, simulated } = await refundPayment({
      paymentId: req.params.id,
      amount,
      reason,
      branchId: req.branchId,
    });
    res.json({
      message: manual
        ? "Refund recorded as manual reversal (provider has no automated refund API)"
        : simulated
        ? "Refund recorded (simulated)"
        : "Refund processed",
      paymentId: session.paymentId,
      status: session.status,
      refundTrxId: session.refundTrxId,
      refundedAmount: session.refundedAmount,
      manual: Boolean(manual),
      simulated: Boolean(simulated),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Constant-time comparison that won't throw on length mismatch.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Public provider callback (bKash/Nagad/aggregator redirect or server-to-server).
// No auth: providers cannot present a JWT. Identity is the providerPaymentId.
// When MFS_CALLBACK_SECRET is configured, callers must present a matching
// x-callback-secret header (or ?secret= for redirect flows) as defense in depth.
exports.mfsCallback = async (req, res) => {
  try {
    const expectedSecret = config.security.mfsCallbackSecret;
    if (expectedSecret) {
      const provided =
        req.headers["x-callback-secret"] || req.query?.secret || req.body?.secret || "";
      if (!safeEqual(provided, expectedSecret)) {
        logger.warn(
          { provider: req.params.provider, ip: req.ip },
          "Rejected MFS callback with invalid/missing secret"
        );
        return res.status(401).json({ ok: false, error: "Unauthorized callback" });
      }
    }
    const provider = String(req.params.provider || "").toLowerCase();
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const providerPaymentId =
      src.paymentID || src.paymentId || src.payment_ref_id || src.paymentRefId || src.providerPaymentId || null;
    const trxId = src.trxID || src.trxId || src.issuerPaymentRefNo || src.transactionId || null;
    const status = src.status || src.transactionStatus || src.Status || null;

    const result = await processProviderCallback({ providerPaymentId, trxId, status });
    logger.info({ provider, providerPaymentId, ok: result.ok, reason: result.reason }, "MFS provider callback");

    // If the provider sent a browser redirect, bounce the user to a status page.
    const redirectBase = process.env.MFS_CALLBACK_REDIRECT_URL || "";
    if (redirectBase && (req.method === "GET" || src.redirect)) {
      const outcome = result.ok ? "success" : "failed";
      const sep = redirectBase.includes("?") ? "&" : "?";
      return res.redirect(`${redirectBase}${sep}status=${outcome}&paymentId=${encodeURIComponent(result.session?.paymentId || "")}`);
    }
    if (!result.ok) return res.status(400).json({ ok: false, reason: result.reason });
    res.json({ ok: true, paymentId: result.session?.paymentId, status: result.session?.status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
