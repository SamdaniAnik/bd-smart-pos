/**
 * IMEI helpers. A GSM handset IMEI is 15 digits where the last digit is a Luhn
 * check digit over the first 14. (IMEISV is 16 digits and has no check digit.)
 */

function normalizeImei(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

/** Luhn checksum validation (used by IMEI's 15th check digit). */
function passesLuhn(digits) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Validate an IMEI. Accepts 15-digit IMEI (Luhn-checked) and 16-digit IMEISV
 * (no check digit). Returns { ok, normalized, reason }.
 */
function validateImei(value) {
  const normalized = normalizeImei(value);
  if (!normalized) return { ok: false, normalized, reason: "empty" };
  if (normalized.length === 16) {
    // IMEISV — no checksum to verify.
    return { ok: true, normalized, reason: null };
  }
  if (normalized.length !== 15) {
    return { ok: false, normalized, reason: "length" };
  }
  if (!passesLuhn(normalized)) {
    return { ok: false, normalized, reason: "checksum" };
  }
  return { ok: true, normalized, reason: null };
}

function isValidImei(value) {
  return validateImei(value).ok;
}

module.exports = { normalizeImei, validateImei, isValidImei, passesLuhn };
