const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const { buildBanglaQrPayload } = require("../../utils/banglaQr");
const {
  nagadCreatePayment,
  nagadVerifyPayment,
} = require("../../integrations/nagad/nagadClient");
const rocketClient = require("../../integrations/mfs/rocketClient");
const upayClient = require("../../integrations/mfs/upayClient");

// Dedicated, signing-capable adapters for Rocket/Upay. Preferred over the inline
// generic adapter; both fall back to the Bangla-QR payload when unconfigured.
function dedicatedWalletAdapter(methodUpper) {
  if (methodUpper === "ROCKET") return rocketClient;
  if (methodUpper === "UPAY") return upayClient;
  return null;
}

const SESSION_TTL_MS = 15 * 60 * 1000;

const MFS_METHODS = new Set(["BKASH", "NAGAD", "ROCKET", "UPAY"]);

function normalizeMethod(method) {
  const key = String(method || "").trim().toUpperCase();
  if (key === "BKASH") return "bKash";
  if (key === "NAGAD") return "Nagad";
  if (key === "ROCKET") return "Rocket";
  if (key === "UPAY") return "Upay";
  return null;
}

function getProviderName(method) {
  const envKey = `MFS_${String(method || "").toUpperCase()}_PROVIDER`;
  return String(process.env[envKey] || process.env.MFS_PROVIDER || "log").trim().toLowerCase();
}

function merchantNumberFor(method) {
  const m = String(method || "").toLowerCase();
  if (m === "nagad") return process.env.NAGAD_MERCHANT_NUMBER || process.env.NAGAD_MERCHANT_ID || "";
  if (m === "rocket") return process.env.ROCKET_MERCHANT_NUMBER || "";
  if (m === "upay") return process.env.UPAY_MERCHANT_NUMBER || "";
  return process.env.BKASH_MERCHANT_NUMBER || process.env.BKASH_CHECKOUT_NUMBER || "";
}

function trxIdLooksValid(method, trxId) {
  const id = String(trxId || "").trim();
  if (id.length < 6 || id.length > 40) return false;
  const m = String(method || "").toLowerCase();
  if (m === "bkash") return /^[A-Za-z0-9]{8,20}$/.test(id);
  if (m === "nagad") return /^[A-Za-z0-9]{6,30}$/.test(id);
  return /^[A-Za-z0-9_-]{6,40}$/.test(id);
}

// ---------------------------------------------------------------------------
// bKash Tokenized Checkout adapter
// ---------------------------------------------------------------------------
function bkashBaseUrl() {
  return String(process.env.BKASH_BASE_URL || "https://tokenized.pay.bka.sh/v1.2.0-beta").replace(/\/$/, "");
}

async function bkashGrantToken() {
  const appKey = process.env.BKASH_APP_KEY;
  const appSecret = process.env.BKASH_APP_SECRET;
  const username = process.env.BKASH_USERNAME;
  const password = process.env.BKASH_PASSWORD;
  if (!appKey || !appSecret || !username || !password) {
    throw new Error("bKash credentials missing (BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD)");
  }
  const res = await fetch(`${bkashBaseUrl()}/tokenized/checkout/token/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    throw new Error(`bKash token grant failed: ${body.statusMessage || res.status}`);
  }
  return { token: body.id_token, appKey };
}

async function bkashCreatePayment({ amount, invoiceRef }) {
  const { token, appKey } = await bkashGrantToken();
  const createRes = await fetch(`${bkashBaseUrl()}/tokenized/checkout/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: token,
      "X-APP-Key": appKey,
    },
    body: JSON.stringify({
      mode: "0011",
      payerReference: invoiceRef,
      callbackURL: process.env.BKASH_CALLBACK_URL || `${process.env.PUBLIC_BASE_URL || ""}/api/payments/mfs/callback/bkash`,
      amount: Number(amount).toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: invoiceRef,
    }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createBody.paymentID) {
    throw new Error(`bKash create payment failed: ${createBody.statusMessage || createRes.status}`);
  }
  return {
    providerPaymentId: createBody.paymentID,
    paymentUrl: createBody.bkashURL || null,
    qrPayload: createBody.bkashURL || null,
  };
}

async function bkashVerifyPayment(providerPaymentId, trxId) {
  const { token, appKey } = await bkashGrantToken();
  const execRes = await fetch(`${bkashBaseUrl()}/tokenized/checkout/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "X-APP-Key": appKey },
    body: JSON.stringify({ paymentID: providerPaymentId }),
  });
  const execBody = await execRes.json().catch(() => ({}));
  let status = String(execBody.transactionStatus || "").toUpperCase();
  let trx = execBody.trxID;
  let amount = Number(execBody.amount || 0);

  // If execute was already called (e.g. via callback), query status instead.
  if (!status || status === "INITIATED") {
    const q = await bkashQueryPayment(providerPaymentId, { token, appKey });
    status = String(q.status || "").toUpperCase();
    trx = trx || q.trxId;
    amount = amount || Number(q.amount || 0);
  }

  if (status !== "COMPLETED") throw new Error(execBody.statusMessage || "bKash payment not completed");
  trx = trx || trxId;
  if (trxId && trx && String(trx).toUpperCase() !== String(trxId).toUpperCase()) {
    throw new Error("bKash TrxID does not match executed payment");
  }
  return { verified: true, trxId: trx, amount };
}

async function bkashQueryPayment(providerPaymentId, creds) {
  const { token, appKey } = creds || (await bkashGrantToken());
  const res = await fetch(`${bkashBaseUrl()}/tokenized/checkout/payment/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "X-APP-Key": appKey },
    body: JSON.stringify({ paymentID: providerPaymentId }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: body.transactionStatus || body.statusMessage || null,
    trxId: body.trxID || null,
    amount: Number(body.amount || 0),
  };
}

async function bkashRefundPayment({ providerPaymentId, trxId, amount, reason }) {
  const { token, appKey } = await bkashGrantToken();
  const res = await fetch(`${bkashBaseUrl()}/tokenized/checkout/payment/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "X-APP-Key": appKey },
    body: JSON.stringify({
      paymentID: providerPaymentId,
      trxID: trxId,
      amount: Number(amount).toFixed(2),
      sku: "POS-REFUND",
      reason: String(reason || "POS refund").slice(0, 255),
    }),
  });
  const body = await res.json().catch(() => ({}));
  const ok = String(body.transactionStatus || body.refundTransactionStatus || "").toUpperCase() === "COMPLETED";
  if (!res.ok || !ok) throw new Error(body.statusMessage || "bKash refund failed");
  return { refundTrxId: body.refundTrxID || body.originalTrxID || trxId, amount: Number(body.amount || amount) };
}

// ---------------------------------------------------------------------------
// Generic configurable adapter (Rocket / Upay / other aggregators)
// Activated when {METHOD}_BASE_URL + {METHOD}_API_KEY are set.
// Endpoints follow a simple JSON contract: POST create/verify/refund.
// ---------------------------------------------------------------------------
function genericConfig(methodUpper) {
  const baseUrl = String(process.env[`${methodUpper}_BASE_URL`] || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env[`${methodUpper}_API_KEY`] || "").trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    createPath: process.env[`${methodUpper}_CREATE_PATH`] || "/payment/create",
    verifyPath: process.env[`${methodUpper}_VERIFY_PATH`] || "/payment/verify",
    refundPath: process.env[`${methodUpper}_REFUND_PATH`] || "/payment/refund",
    merchantId: process.env[`${methodUpper}_MERCHANT_ID`] || merchantNumberFor(methodUpper),
  };
}

async function genericPost(cfg, path, payload) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `Gateway error (${res.status})`);
  return body;
}

async function genericCreate(methodUpper, { amount, invoiceRef }) {
  const cfg = genericConfig(methodUpper);
  if (!cfg) return null;
  const body = await genericPost(cfg, cfg.createPath, {
    merchantId: cfg.merchantId,
    amount: Number(amount).toFixed(2),
    currency: "BDT",
    invoiceRef,
    callbackUrl:
      process.env[`${methodUpper}_CALLBACK_URL`] ||
      `${process.env.PUBLIC_BASE_URL || ""}/api/payments/mfs/callback/${methodUpper.toLowerCase()}`,
  });
  return {
    providerPaymentId: body.paymentId || body.paymentReferenceId || body.transactionId || null,
    paymentUrl: body.paymentUrl || body.redirectUrl || null,
    qrPayload: body.qrPayload || body.paymentUrl || null,
  };
}

async function genericVerify(methodUpper, { providerPaymentId, trxId, amount }) {
  const cfg = genericConfig(methodUpper);
  if (!cfg) return null;
  const body = await genericPost(cfg, cfg.verifyPath, {
    merchantId: cfg.merchantId,
    paymentId: providerPaymentId,
    trxId,
  });
  const status = String(body.status || body.transactionStatus || "").toUpperCase();
  const ok = status === "COMPLETED" || status === "SUCCESS" || body.verified === true;
  if (!ok) throw new Error(body.message || `${methodUpper} payment not completed`);
  const resolvedTrx = body.trxId || body.transactionId || trxId;
  if (trxId && resolvedTrx && String(resolvedTrx).toUpperCase() !== String(trxId).toUpperCase()) {
    throw new Error(`${methodUpper} TrxID does not match verified payment`);
  }
  return { verified: true, trxId: resolvedTrx, amount: Number(body.amount || amount || 0) };
}

async function genericRefund(methodUpper, { providerPaymentId, trxId, amount, reason }) {
  const cfg = genericConfig(methodUpper);
  if (!cfg) return null;
  const body = await genericPost(cfg, cfg.refundPath, {
    merchantId: cfg.merchantId,
    paymentId: providerPaymentId,
    trxId,
    amount: Number(amount).toFixed(2),
    reason: String(reason || "POS refund").slice(0, 255),
  });
  const status = String(body.status || body.refundStatus || "").toUpperCase();
  const ok = status === "COMPLETED" || status === "SUCCESS" || body.refunded === true;
  if (!ok) throw new Error(body.message || `${methodUpper} refund failed`);
  return { refundTrxId: body.refundTrxId || body.refundId || trxId, amount: Number(body.amount || amount) };
}

async function nagadVerifySimulated(trxId, amount) {
  if (!trxIdLooksValid("Nagad", trxId)) throw new Error("Invalid Nagad transaction reference format");
  return { verified: true, trxId, amount, simulated: true };
}

// ---------------------------------------------------------------------------
// Session lifecycle (DB-backed)
// ---------------------------------------------------------------------------
async function initiatePayment({ branchId, method, amount, invoiceRef, merchantName }) {
  const normalized = normalizeMethod(method);
  if (!normalized) throw new Error("Unsupported MFS method");
  if (!(Number(amount) > 0)) throw new Error("Amount must be greater than zero");

  const provider = getProviderName(normalized);
  const methodUpper = normalized.toUpperCase();
  const paymentId = `MFS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const merchantNumber = merchantNumberFor(normalized);
  const amountValue = Number(Number(amount).toFixed(2));
  const ref = invoiceRef || paymentId;
  let qrPayload = buildBanglaQrPayload({
    amount: amountValue,
    merchantName,
    city: "Dhaka",
    invoiceRef: ref,
    method: normalized,
    merchantNumber,
  });
  let paymentUrl = null;
  let providerPaymentId = null;

  if (provider === "bkash") {
    const live = await bkashCreatePayment({ amount: amountValue, invoiceRef: ref });
    providerPaymentId = live.providerPaymentId;
    paymentUrl = live.paymentUrl;
    qrPayload = live.qrPayload || qrPayload;
  } else if (provider === "nagad") {
    const live = await nagadCreatePayment({
      amount: amountValue,
      invoiceRef: ref,
      callbackUrl: process.env.NAGAD_CALLBACK_URL,
    });
    providerPaymentId = live.providerPaymentId;
    paymentUrl = live.paymentUrl;
    qrPayload = live.qrPayload || qrPayload;
  } else if (provider !== "log") {
    // Rocket / Upay (dedicated signing-capable adapters), else generic aggregator.
    const dedicated = dedicatedWalletAdapter(methodUpper);
    let live = null;
    if (dedicated && dedicated.isConfigured()) {
      live = await dedicated.create({
        amount: amountValue,
        invoiceRef: ref,
        callbackUrl:
          process.env[`${methodUpper}_CALLBACK_URL`] ||
          `${process.env.PUBLIC_BASE_URL || ""}/api/payments/mfs/callback/${methodUpper.toLowerCase()}`,
      });
    }
    if (!live) {
      live = await genericCreate(methodUpper, { amount: amountValue, invoiceRef: ref });
    }
    if (live) {
      providerPaymentId = live.providerPaymentId;
      paymentUrl = live.paymentUrl;
      qrPayload = live.qrPayload || qrPayload;
    } else {
      logger.info(
        { provider, method: normalized },
        "MFS provider configured but no gateway credentials found; using Bangla QR payload"
      );
    }
  }

  const row = await prisma.mfsPaymentSession.create({
    data: {
      paymentId,
      branchId: Number(branchId),
      method: normalized,
      provider,
      amount: amountValue,
      invoiceRef: ref,
      status: "PENDING",
      merchantNumber: merchantNumber || null,
      qrPayload,
      paymentUrl,
      providerPaymentId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return row;
}

async function loadSession(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) return null;
  return prisma.mfsPaymentSession.findUnique({ where: { paymentId: id } });
}

async function verifyPayment({ paymentId, trxId }) {
  const session = await loadSession(paymentId);
  if (!session) throw new Error("Payment session not found or expired");
  if (session.status === "VERIFIED") {
    return { ...session, alreadyVerified: true };
  }
  if (session.status === "REFUNDED") throw new Error("Payment session already refunded");
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    await prisma.mfsPaymentSession
      .update({ where: { id: session.id }, data: { status: "EXPIRED" } })
      .catch(() => {});
    throw new Error("Payment session expired");
  }
  const trx = String(trxId || "").trim();
  const methodUpper = String(session.method || "").toUpperCase();
  // Live providers can self-resolve the transaction (execute/status query), so a
  // client-supplied TrxID is optional for them (e.g. on async callbacks).
  const dedicated = dedicatedWalletAdapter(methodUpper);
  const dedicatedConfigured = Boolean(dedicated && dedicated.isConfigured());
  const selfResolving =
    Boolean(session.providerPaymentId) &&
    (session.provider === "bkash" ||
      session.provider === "nagad" ||
      (session.provider !== "log" && (dedicatedConfigured || genericConfig(methodUpper))));
  if (!trx && !selfResolving) throw new Error("Transaction reference (TrxID) is required");

  let result;
  if (session.provider === "bkash" && session.providerPaymentId) {
    result = await bkashVerifyPayment(session.providerPaymentId, trx);
  } else if (session.provider === "nagad" && session.providerPaymentId) {
    result = await nagadVerifyPayment(session.providerPaymentId, trx);
  } else if (session.provider === "nagad") {
    result = await nagadVerifySimulated(trx, session.amount);
  } else if (session.provider !== "log" && dedicatedConfigured) {
    result = await dedicated.verify({
      providerPaymentId: session.providerPaymentId,
      trxId: trx,
      amount: session.amount,
    });
  } else if (session.provider !== "log" && genericConfig(methodUpper)) {
    result = await genericVerify(methodUpper, {
      providerPaymentId: session.providerPaymentId,
      trxId: trx,
      amount: session.amount,
    });
  } else {
    if (!trxIdLooksValid(session.method, trx)) {
      throw new Error(`Invalid ${session.method} transaction reference format`);
    }
    result = { verified: true, trxId: trx, amount: session.amount, simulated: session.provider === "log" };
  }

  if (Math.abs(Number(result.amount || session.amount) - session.amount) > 0.02) {
    throw new Error("Verified amount does not match requested payment amount");
  }

  const updated = await prisma.mfsPaymentSession.update({
    where: { id: session.id },
    data: {
      status: "VERIFIED",
      trxId: result.trxId || trx,
      verifiedAt: new Date(),
      simulated: Boolean(result.simulated),
    },
  });
  return updated;
}

async function refundPayment({ paymentId, amount, reason, branchId }) {
  const session = await loadSession(paymentId);
  if (!session) throw new Error("Payment session not found");
  if (branchId != null && Number(session.branchId) !== Number(branchId)) {
    throw new Error("Payment session not found");
  }
  if (session.status === "REFUNDED") throw new Error("Payment already refunded");
  if (session.status !== "VERIFIED") throw new Error("Only verified payments can be refunded");

  const refundAmount = Number(amount) > 0 ? Number(Number(amount).toFixed(2)) : session.amount;
  if (refundAmount > session.amount + 0.02) throw new Error("Refund amount exceeds paid amount");

  const methodUpper = String(session.method || "").toUpperCase();
  const dedicated = dedicatedWalletAdapter(methodUpper);
  let result = null;
  if (session.provider === "bkash" && session.providerPaymentId) {
    result = await bkashRefundPayment({
      providerPaymentId: session.providerPaymentId,
      trxId: session.trxId,
      amount: refundAmount,
      reason,
    });
  } else if (session.provider !== "log" && dedicated && dedicated.isConfigured()) {
    result = await dedicated.refund({
      providerPaymentId: session.providerPaymentId,
      trxId: session.trxId,
      amount: refundAmount,
      reason,
    });
  } else if (session.provider !== "log" && genericConfig(methodUpper)) {
    result = await genericRefund(methodUpper, {
      providerPaymentId: session.providerPaymentId,
      trxId: session.trxId,
      amount: refundAmount,
      reason,
    });
  } else if (session.provider === "nagad") {
    // Nagad has no public merchant-side refund API; record as a manual reversal.
    result = { refundTrxId: `MANUAL-${Date.now()}`, amount: refundAmount, manual: true };
  } else {
    // Simulated / log provider.
    result = { refundTrxId: `SIM-${Date.now()}`, amount: refundAmount, simulated: true };
  }

  const updated = await prisma.mfsPaymentSession.update({
    where: { id: session.id },
    data: {
      status: "REFUNDED",
      refundTrxId: result.refundTrxId || null,
      refundedAmount: result.amount || refundAmount,
      refundedAt: new Date(),
      refundReason: reason ? String(reason).slice(0, 500) : null,
    },
  });
  return { session: updated, manual: Boolean(result.manual), simulated: Boolean(result.simulated) };
}

async function queryPayment({ paymentId, branchId }) {
  const session = await loadSession(paymentId);
  if (!session) return null;
  if (branchId != null && Number(session.branchId) !== Number(branchId)) return null;
  let providerStatus = null;
  try {
    if (session.provider === "bkash" && session.providerPaymentId) {
      providerStatus = await bkashQueryPayment(session.providerPaymentId);
    }
  } catch (err) {
    providerStatus = { error: err.message };
  }
  return { session, providerStatus };
}

async function findSessionByProviderPaymentId(providerPaymentId) {
  const id = String(providerPaymentId || "").trim();
  if (!id) return null;
  return prisma.mfsPaymentSession.findFirst({
    where: { providerPaymentId: id },
    orderBy: { id: "desc" },
  });
}

/**
 * Handle an async provider callback (bKash/Nagad/aggregator redirect or S2S).
 * Resolves the session by providerPaymentId and verifies it.
 */
async function processProviderCallback({ providerPaymentId, paymentId, trxId, status }) {
  let session = null;
  if (paymentId) session = await loadSession(paymentId);
  if (!session && providerPaymentId) session = await findSessionByProviderPaymentId(providerPaymentId);
  if (!session) return { ok: false, reason: "session_not_found" };
  if (session.status === "VERIFIED") return { ok: true, session, alreadyVerified: true };

  const statusUpper = String(status || "").toUpperCase();
  if (["CANCEL", "CANCELLED", "FAILURE", "FAILED", "DENIED"].includes(statusUpper)) {
    return { ok: false, reason: statusUpper.toLowerCase(), session };
  }

  try {
    const verified = await verifyPayment({ paymentId: session.paymentId, trxId: trxId || "" });
    return { ok: true, session: verified };
  } catch (err) {
    logger.warn({ paymentId: session.paymentId, err: err.message }, "MFS callback verification failed");
    return { ok: false, reason: err.message, session };
  }
}

async function getPaymentSession(paymentId) {
  const session = await loadSession(paymentId);
  if (!session) return null;
  if (session.status === "PENDING" && Date.now() > new Date(session.expiresAt).getTime()) {
    await prisma.mfsPaymentSession
      .update({ where: { id: session.id }, data: { status: "EXPIRED" } })
      .catch(() => {});
    return null;
  }
  return session;
}

function isMfsMethod(method) {
  return MFS_METHODS.has(String(method || "").trim().toUpperCase());
}

module.exports = {
  initiatePayment,
  verifyPayment,
  refundPayment,
  queryPayment,
  processProviderCallback,
  getPaymentSession,
  isMfsMethod,
  normalizeMethod,
  getProviderName,
};
