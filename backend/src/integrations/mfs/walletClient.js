// Generic signed-HTTP wallet adapter for MFS providers that expose a merchant
// REST API but have no public SDK (Rocket / DBBL, Upay / UCB, and similar
// aggregators). Rocket and Upay are exposed as dedicated, named adapters
// (rocketClient.js / upayClient.js) built on this shared implementation.
//
// A provider is "configured" when {PREFIX}_BASE_URL and {PREFIX}_API_KEY are
// set. Requests are optionally HMAC-SHA256 signed ({PREFIX}_API_SECRET) — most
// BD wallet merchant gateways require a signature header, which the previous
// generic adapter could not produce.

const crypto = require("crypto");
const { fetchJson } = require("../httpClient");

function readConfig(prefix) {
  const baseUrl = String(process.env[`${prefix}_BASE_URL`] || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env[`${prefix}_API_KEY`] || "").trim();
  if (!baseUrl || !apiKey) return null;
  return {
    prefix,
    baseUrl,
    apiKey,
    apiSecret: String(process.env[`${prefix}_API_SECRET`] || "").trim() || null,
    merchantId:
      String(process.env[`${prefix}_MERCHANT_ID`] || process.env[`${prefix}_MERCHANT_NUMBER`] || "").trim() || null,
    createPath: process.env[`${prefix}_CREATE_PATH`] || "/payment/create",
    verifyPath: process.env[`${prefix}_VERIFY_PATH`] || "/payment/verify",
    refundPath: process.env[`${prefix}_REFUND_PATH`] || "/payment/refund",
  };
}

function signBody(cfg, bodyString) {
  if (!cfg.apiSecret) return null;
  return crypto.createHmac("sha256", cfg.apiSecret).update(bodyString).digest("hex");
}

async function post(cfg, path, payload) {
  const bodyString = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  const signature = signBody(cfg, bodyString);
  if (signature) headers["X-Signature"] = signature;
  return fetchJson(`${cfg.baseUrl}${path}`, { method: "POST", headers, body: bodyString }, { timeoutMs: 30000, retries: 1 });
}

function makeAdapter(prefix, displayName) {
  return {
    name: displayName,
    isConfigured() {
      return Boolean(readConfig(prefix));
    },
    async create({ amount, invoiceRef, callbackUrl }) {
      const cfg = readConfig(prefix);
      if (!cfg) return null;
      const body = await post(cfg, cfg.createPath, {
        merchantId: cfg.merchantId,
        amount: Number(amount).toFixed(2),
        currency: "BDT",
        invoiceRef,
        callbackUrl,
      });
      return {
        providerPaymentId: body.paymentId || body.paymentReferenceId || body.transactionId || null,
        paymentUrl: body.paymentUrl || body.redirectUrl || null,
        qrPayload: body.qrPayload || body.paymentUrl || null,
      };
    },
    async verify({ providerPaymentId, trxId, amount }) {
      const cfg = readConfig(prefix);
      if (!cfg) return null;
      const body = await post(cfg, cfg.verifyPath, {
        merchantId: cfg.merchantId,
        paymentId: providerPaymentId,
        trxId,
      });
      const status = String(body.status || body.transactionStatus || "").toUpperCase();
      const ok = status === "COMPLETED" || status === "SUCCESS" || body.verified === true;
      if (!ok) throw new Error(body.message || `${displayName} payment not completed`);
      const resolvedTrx = body.trxId || body.transactionId || trxId;
      if (trxId && resolvedTrx && String(resolvedTrx).toUpperCase() !== String(trxId).toUpperCase()) {
        throw new Error(`${displayName} TrxID does not match verified payment`);
      }
      return { verified: true, trxId: resolvedTrx, amount: Number(body.amount || amount || 0) };
    },
    async refund({ providerPaymentId, trxId, amount, reason }) {
      const cfg = readConfig(prefix);
      if (!cfg) return null;
      const body = await post(cfg, cfg.refundPath, {
        merchantId: cfg.merchantId,
        paymentId: providerPaymentId,
        trxId,
        amount: Number(amount).toFixed(2),
        reason: String(reason || "POS refund").slice(0, 255),
      });
      const status = String(body.status || body.refundStatus || "").toUpperCase();
      const ok = status === "COMPLETED" || status === "SUCCESS" || body.refunded === true;
      if (!ok) throw new Error(body.message || `${displayName} refund failed`);
      return { refundTrxId: body.refundTrxId || body.refundId || trxId, amount: Number(body.amount || amount) };
    },
  };
}

module.exports = { makeAdapter, readConfig };
