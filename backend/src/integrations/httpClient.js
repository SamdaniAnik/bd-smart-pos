async function fetchJson(url, options = {}, { timeoutMs = 30000, retries = 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          body?.message || body?.error || body?.statusMessage || `HTTP ${res.status} for ${url}`;
        const err = new Error(message);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error.status >= 500 || error.name === "AbortError";
      if (attempt < retries && retryable) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

const { toLocalBdPhone } = require("../utils/bdPhone");

// Couriers expect the local 11-digit format (01XXXXXXXXX). Delegate to the
// canonical normalizer; fall back to a best-effort trim when the number can't
// be validated so we never drop a courier booking on a borderline input.
function normalizeBdPhone(phone) {
  const local = toLocalBdPhone(phone);
  if (local) return local;
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("880")) return `0${digits.slice(3)}`;
  return digits.slice(0, 11);
}

module.exports = { fetchJson, normalizeBdPhone };
