/**
 * Canonical Bangladeshi mobile-number normalization. Single source of truth so
 * the SMS gateway (8801XXXXXXXXX) and integration adapters (01XXXXXXXXX) never
 * drift apart. Dependency-free so it is safe to import anywhere.
 */

/** Normalize any common BD phone format to international 8801XXXXXXXXX. Returns null when invalid. */
function normalizeBdPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/[^\d]/g, "");
  let msisdn = digits;
  if (msisdn.startsWith("00880")) msisdn = msisdn.slice(2);
  if (msisdn.startsWith("880")) {
    // already country-prefixed
  } else if (msisdn.startsWith("01")) {
    msisdn = `88${msisdn}`;
  } else if (msisdn.startsWith("1") && msisdn.length === 10) {
    msisdn = `880${msisdn}`;
  }
  return /^8801[3-9]\d{8}$/.test(msisdn) ? msisdn : null;
}

/** Local 11-digit BD format (01XXXXXXXXX), built on the canonical normalizer. Returns null when invalid. */
function toLocalBdPhone(rawPhone) {
  // intl is 8801XXXXXXXXX (880 country code + 10-digit subscriber). Drop the
  // "880" prefix and restore the leading national "0".
  const intl = normalizeBdPhone(rawPhone);
  return intl ? `0${intl.slice(3)}` : null;
}

module.exports = { normalizeBdPhone, toLocalBdPhone };
