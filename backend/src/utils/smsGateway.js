/**
 * Pluggable SMS gateway for Bangladeshi providers.
 *
 * Provider is chosen via SMS_PROVIDER env:
 *   - "bulksmsbd"     -> bulksmsbd.net HTTPS API (SMS_API_KEY, SMS_SENDER_ID)
 *   - "ssl_wireless"  -> SSL Wireless smsplus v3 API (SMS_API_TOKEN, SMS_SID)
 *   - "log" (default) -> no real send; logs and reports SIMULATED. Lets the
 *                        rest of the app build on SMS without credentials.
 *
 * Every send is persisted to SmsDeliveryLog so async delivery reports (DLR) can
 * later resolve final delivery status via recordDeliveryReport().
 */
const logger = require("./logger");
const prisma = require("./prisma");
const { normalizeBdPhone, toLocalBdPhone } = require("./bdPhone");

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

function isGsm7(text) {
  for (const ch of String(text || "")) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch)) return false;
  }
  return true;
}

/**
 * Bangla (or any non-GSM7) text is sent as UCS-2: 70 chars per single SMS,
 * 67 per segment when concatenated. GSM-7: 160 single / 153 concatenated.
 */
function countSmsSegments(text) {
  const value = String(text || "");
  if (!value.length) return { encoding: "GSM-7", length: 0, segments: 0 };
  if (isGsm7(value)) {
    const segments = value.length <= 160 ? 1 : Math.ceil(value.length / 153);
    return { encoding: "GSM-7", length: value.length, segments };
  }
  const length = [...value].length;
  const segments = length <= 70 ? 1 : Math.ceil(length / 67);
  return { encoding: "UCS-2", length, segments };
}

function getProviderName() {
  return String(process.env.SMS_PROVIDER || "log").trim().toLowerCase();
}

function isSmsConfigured() {
  return getProviderName() !== "log";
}

async function sendViaBulkSmsBd(msisdn, message) {
  const apiKey = String(process.env.SMS_API_KEY || "").trim();
  const senderId = String(process.env.SMS_SENDER_ID || "").trim();
  if (!apiKey || !senderId) throw new Error("bulksmsbd requires SMS_API_KEY and SMS_SENDER_ID");
  const response = await fetch("https://bulksmsbd.net/api/smsapi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, senderid: senderId, number: msisdn, message }),
  });
  const body = await response.json().catch(() => ({}));
  // bulksmsbd reports success with response_code 202
  if (!response.ok || Number(body?.response_code) !== 202) {
    throw new Error(`bulksmsbd send failed: ${body?.error_message || body?.response_code || response.status}`);
  }
  return { providerMessageId: String(body?.message_id || "") };
}

async function sendViaSslWireless(msisdn, message) {
  const apiToken = String(process.env.SMS_API_TOKEN || "").trim();
  const sid = String(process.env.SMS_SID || "").trim();
  if (!apiToken || !sid) throw new Error("ssl_wireless requires SMS_API_TOKEN and SMS_SID");
  const csmsId = `POS${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
  const response = await fetch("https://smsplus.sslwireless.com/api/v3/send-sms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_token: apiToken, sid, msisdn, sms: message, csms_id: csmsId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || String(body?.status).toUpperCase() !== "SUCCESS") {
    throw new Error(`ssl_wireless send failed: ${body?.error_message || body?.status || response.status}`);
  }
  return { providerMessageId: csmsId };
}

async function recordSmsLog(row) {
  try {
    return await prisma.smsDeliveryLog.create({ data: row });
  } catch (error) {
    logger.warn({ err: error.message }, "Failed to persist SMS delivery log");
    return null;
  }
}

/**
 * Send a single SMS. Never throws — returns a result row so bulk callers can
 * aggregate partial failures. Persists an SmsDeliveryLog row (best-effort) so a
 * later DLR webhook can resolve the final delivery state.
 *
 * @param {object} opts
 * @param {string} opts.to        recipient phone (any common BD format)
 * @param {string} opts.message   message body
 * @param {number} [opts.branchId]
 * @param {number} [opts.customerId]
 * @param {string} [opts.purpose] e.g. "OTP", "DUE_REMINDER", "TOPUP"
 */
async function sendSms({ to, message, branchId = null, customerId = null, purpose = null }) {
  const provider = getProviderName();
  const msisdn = normalizeBdPhone(to);
  const meta = countSmsSegments(message);
  const base = { to: String(to || ""), msisdn, provider, ...meta };
  if (!msisdn) return { ...base, status: "FAILED", error: "Invalid Bangladeshi mobile number" };
  if (!String(message || "").trim()) return { ...base, status: "FAILED", error: "Empty message" };

  let status = "SIMULATED";
  let providerMessageId = null;
  let error = null;
  try {
    if (provider === "bulksmsbd") {
      const sent = await sendViaBulkSmsBd(msisdn, message);
      status = "SENT";
      providerMessageId = sent.providerMessageId || null;
    } else if (provider === "ssl_wireless") {
      const sent = await sendViaSslWireless(msisdn, message);
      status = "SENT";
      providerMessageId = sent.providerMessageId || null;
    } else {
      logger.info({ msisdn, segments: meta.segments, encoding: meta.encoding, message }, "SMS simulated (SMS_PROVIDER=log)");
      status = "SIMULATED";
    }
  } catch (err) {
    logger.error({ msisdn, provider, err: err.message }, "SMS send failed");
    status = "FAILED";
    error = err.message;
  }

  const log = await recordSmsLog({
    branchId: branchId != null ? Number(branchId) : null,
    customerId: customerId != null ? Number(customerId) : null,
    msisdn,
    provider,
    status,
    providerMessageId,
    segments: Number(meta.segments || 1),
    encoding: meta.encoding || null,
    purpose: purpose ? String(purpose).slice(0, 40) : null,
    errorMessage: error ? String(error).slice(0, 500) : null,
  });

  return { ...base, status, providerMessageId, logId: log?.id || null, ...(error ? { error } : {}) };
}

/**
 * Send to many recipients. BD bulk SMS APIs rate-limit, so we send in bounded
 * parallel batches (SMS_SEND_CONCURRENCY, default 5) rather than fully serial.
 * recipients: [{ to, message, ...extra }]
 */
async function sendBulkSms(recipients, { branchId = null, purpose = null } = {}) {
  const list = Array.isArray(recipients) ? recipients : [];
  const concurrency = Math.max(1, Math.min(20, Number(process.env.SMS_SEND_CONCURRENCY || 5)));
  const results = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const slice = list.slice(i, i + concurrency);
    const settled = await Promise.all(
      slice.map(async (recipient) => {
        const result = await sendSms({ branchId, purpose, ...recipient });
        return { ...recipient, ...result };
      })
    );
    results.push(...settled);
  }
  const summary = {
    total: results.length,
    sent: results.filter((x) => x.status === "SENT").length,
    simulated: results.filter((x) => x.status === "SIMULATED").length,
    failed: results.filter((x) => x.status === "FAILED").length,
    totalSegments: results.reduce((sum, x) => sum + Number(x.segments || 0), 0),
  };
  return { results, summary };
}

/** Fill {placeholders} in an SMS template from a values object. */
function renderSmsTemplate(template, values) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) =>
    values && values[key] != null ? String(values[key]) : match
  );
}

/**
 * Resolve a message body from a DB-managed template (SmsTemplate) by key,
 * falling back to a provided default when no active template exists.
 */
async function getSmsTemplateBody(branchId, key, fallback = "") {
  try {
    const row = await prisma.smsTemplate.findFirst({
      where: { branchId: Number(branchId), key: String(key), isActive: true },
      select: { body: true },
    });
    if (row && String(row.body || "").trim()) return row.body;
  } catch (error) {
    logger.warn({ err: error.message, key }, "SMS template lookup failed; using fallback");
  }
  return fallback;
}

/**
 * Apply an async provider delivery report (DLR) to a previously sent message.
 * Resolves the row by providerMessageId (preferred) or logId.
 */
async function recordDeliveryReport({ providerMessageId, logId, status, raw }) {
  const dlrStatus = String(status || "").trim().toUpperCase();
  const finalStatus =
    ["DELIVERED", "DELIVRD", "SUCCESS", "OK"].includes(dlrStatus)
      ? "DELIVERED"
      : ["FAILED", "UNDELIV", "REJECTD", "EXPIRED"].includes(dlrStatus)
        ? "FAILED"
        : null;

  const where = providerMessageId
    ? { providerMessageId: String(providerMessageId) }
    : logId
      ? { id: Number(logId) }
      : null;
  if (!where) return { ok: false, reason: "missing_identifier" };

  const existing = await prisma.smsDeliveryLog.findFirst({ where, orderBy: { id: "desc" } });
  if (!existing) return { ok: false, reason: "not_found" };

  const updated = await prisma.smsDeliveryLog.update({
    where: { id: existing.id },
    data: {
      dlrStatus: dlrStatus || null,
      dlrAt: new Date(),
      ...(finalStatus ? { status: finalStatus } : {}),
      ...(raw && finalStatus === "FAILED" ? { errorMessage: String(raw).slice(0, 500) } : {}),
    },
  });
  return { ok: true, log: updated };
}

module.exports = {
  countSmsSegments,
  normalizeBdPhone,
  toLocalBdPhone,
  isSmsConfigured,
  getProviderName,
  sendSms,
  sendBulkSms,
  renderSmsTemplate,
  getSmsTemplateBody,
  recordDeliveryReport,
};
