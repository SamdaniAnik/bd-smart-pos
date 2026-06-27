/**
 * Pluggable gateway for mobile recharge (flexiload) and utility bill payment.
 *
 * Provider is chosen via TOPUP_PROVIDER env:
 *   - "log" (default) -> no real top-up; returns SUCCESS with a simulated
 *                        provider reference and (for prepaid electricity) a
 *                        20-digit token. Lets the rest of the app build on
 *                        recharge/bills without an aggregator account.
 *   - "aggregator"    -> generic HTTP aggregator (TOPUP_API_URL + TOPUP_API_KEY).
 *                        Stubbed adapter; wire your distributor/aggregator here.
 *
 * Mirrors the philosophy of smsGateway / efdService: works end-to-end in
 * simulation and becomes live only when credentials are configured.
 */
const logger = require("./logger");
const { normalizeBdPhone } = require("./smsGateway");

function getProviderName() {
  return String(process.env.TOPUP_PROVIDER || "log").trim().toLowerCase();
}

function isTopupConfigured() {
  return getProviderName() !== "log";
}

function generateProviderRef() {
  return `TX-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/** Simulated 20-digit prepaid electricity token, grouped 4-4-4-4-4 like a real STS token. */
function generatePrepaidToken() {
  let digits = "";
  for (let i = 0; i < 20; i++) digits += Math.floor(Math.random() * 10);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

const PREPAID_ELECTRICITY = "ELECTRICITY_PREPAID";

function aggregatorConfig() {
  const apiUrl = String(process.env.TOPUP_API_URL || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env.TOPUP_API_KEY || "").trim();
  if (!apiUrl || !apiKey) throw new Error("aggregator requires TOPUP_API_URL and TOPUP_API_KEY");
  return { apiUrl, apiKey };
}

async function aggregatorPost(path, payload) {
  const { apiUrl, apiKey } = aggregatorConfig();
  const url = path ? `${apiUrl}${path}` : apiUrl;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function sendViaAggregator(payload) {
  const path = process.env.TOPUP_PAY_PATH || "";
  const { ok, status, body } = await aggregatorPost(path, payload);
  if (!ok || String(body?.status || "").toUpperCase() !== "SUCCESS") {
    throw new Error(`aggregator failed: ${body?.message || body?.error || status}`);
  }
  return {
    status: "SUCCESS",
    providerRef: String(body?.transactionId || body?.providerRef || generateProviderRef()),
    token: body?.token ? String(body.token) : null,
  };
}

/**
 * Inquire/validate a utility bill before paying. Returns the amount due and any
 * customer details the biller exposes. For the "log" provider it simulates a
 * plausible response so the inquiry-then-pay flow works end to end.
 *
 * @returns {Promise<{ provider, valid, dueAmount, customerName?, billMonth?, raw? }>}
 */
async function inquireBill({ category, operatorOrBiller, accountOrMsisdn }) {
  const provider = getProviderName();
  const account = String(accountOrMsisdn || "").trim();
  if (!account) return { provider, valid: false, error: "Account/meter number is required" };

  if (provider === "aggregator") {
    const path = process.env.TOPUP_INQUIRY_PATH || "/inquiry";
    const { ok, body } = await aggregatorPost(path, {
      type: "INQUIRY",
      category,
      biller: operatorOrBiller,
      account,
    });
    if (!ok || (body?.valid === false)) {
      return { provider, valid: false, error: body?.message || body?.error || "Bill inquiry failed" };
    }
    return {
      provider,
      valid: true,
      dueAmount: Number(body?.dueAmount || body?.amount || 0),
      customerName: body?.customerName || body?.name || null,
      billMonth: body?.billMonth || body?.period || null,
      raw: body,
    };
  }

  // Simulated inquiry — deterministic pseudo-amount derived from the account so
  // the same meter returns the same due during a demo.
  const seed = [...account].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const dueAmount = 100 + (seed % 1900); // 100 - 1999 BDT
  logger.info({ provider, category, biller: operatorOrBiller, account }, "Bill inquiry simulated (TOPUP_PROVIDER=log)");
  return {
    provider,
    valid: true,
    dueAmount,
    customerName: null,
    billMonth: null,
    simulated: true,
  };
}

/**
 * Reverse/refund a previously successful top-up at the provider. For "log" it
 * always succeeds; for aggregator it calls the reversal endpoint.
 */
async function reverseTopup({ type, category, providerRef, amount }) {
  const provider = getProviderName();
  if (provider === "aggregator") {
    const path = process.env.TOPUP_REVERSE_PATH || "/reverse";
    const { ok, body } = await aggregatorPost(path, { type, category, providerRef, amount });
    const ok2 = ok && ["SUCCESS", "REVERSED"].includes(String(body?.status || "").toUpperCase());
    if (!ok2) {
      return { provider, status: "FAILED", error: body?.message || body?.error || "Reversal failed" };
    }
    return { provider, status: "REVERSED", reversalRef: String(body?.reversalRef || body?.transactionId || generateProviderRef()) };
  }
  logger.info({ provider, type, providerRef }, "Top-up reversal simulated (TOPUP_PROVIDER=log)");
  return { provider, status: "REVERSED", reversalRef: generateProviderRef(), simulated: true };
}

/**
 * Execute a recharge/bill request. Never throws — returns a result object so the
 * controller can persist FAILED transactions for the audit trail.
 *
 * @param {object} req
 * @param {"RECHARGE"|"BILL"} req.type
 * @param {string} req.category
 * @param {string} req.operatorOrBiller
 * @param {string} req.accountOrMsisdn
 * @param {number} req.faceAmount
 */
async function executeTopup(req) {
  const provider = getProviderName();
  const type = String(req?.type || "").toUpperCase();
  const category = String(req?.category || "").toUpperCase();
  const accountOrMsisdn = String(req?.accountOrMsisdn || "").trim();
  const faceAmount = Number(req?.faceAmount) || 0;

  // Recharge numbers must be valid Bangladeshi mobile numbers.
  if (type === "RECHARGE") {
    const msisdn = normalizeBdPhone(accountOrMsisdn);
    if (!msisdn) {
      return { provider, status: "FAILED", error: "Invalid Bangladeshi mobile number", providerRef: null, token: null };
    }
  } else if (!accountOrMsisdn) {
    return { provider, status: "FAILED", error: "Account/meter number is required", providerRef: null, token: null };
  }
  if (!(faceAmount > 0)) {
    return { provider, status: "FAILED", error: "Amount must be positive", providerRef: null, token: null };
  }

  try {
    if (provider === "aggregator") {
      const result = await sendViaAggregator({
        type,
        category,
        operator: req.operatorOrBiller,
        account: accountOrMsisdn,
        amount: faceAmount,
      });
      return { provider, ...result, error: null };
    }
    const token = category === PREPAID_ELECTRICITY ? generatePrepaidToken() : null;
    logger.info(
      { provider, type, category, account: accountOrMsisdn, amount: faceAmount },
      "Top-up simulated (TOPUP_PROVIDER=log)"
    );
    return { provider, status: "SUCCESS", providerRef: generateProviderRef(), token, error: null };
  } catch (error) {
    logger.error({ provider, type, category, err: error.message }, "Top-up failed");
    return { provider, status: "FAILED", providerRef: null, token: null, error: error.message };
  }
}

module.exports = {
  getProviderName,
  isTopupConfigured,
  executeTopup,
  inquireBill,
  reverseTopup,
  generateProviderRef,
  generatePrepaidToken,
};
