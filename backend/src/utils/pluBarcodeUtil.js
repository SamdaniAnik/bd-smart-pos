/**
 * Variable-weight (scale) barcode parser for supershop POS.
 * Common 13-digit format: 2 + PLU(5) + weight in grams(5) + check digit(1).
 */

function normalizePluDigits(value) {
  const n = Number(value ?? process.env.PLU_BARCODE_PLU_DIGITS ?? 5);
  return Number.isFinite(n) && n >= 4 && n <= 7 ? Math.floor(n) : 5;
}

function pluDigitCount(branchPluDigits) {
  return normalizePluDigits(branchPluDigits);
}

function parseScaleBarcode(raw, branchPluDigits) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 12 || !digits.startsWith("2")) {
    return null;
  }

  const pluLen = pluDigitCount(branchPluDigits);
  const weightLen = 5;

  if (digits.length === 13) {
    const pluBlock = digits.slice(1, 1 + pluLen);
    const weightBlock = digits.slice(1 + pluLen, 1 + pluLen + weightLen);
    const weightGrams = Number(weightBlock);
    if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
    const weightKg = weightGrams / 1000;
    const pluTrimmed = pluBlock.replace(/^0+/, "") || pluBlock;
    return {
      plu: pluTrimmed,
      pluBlock,
      weightKg: Math.round(weightKg * 10000) / 10000,
      weightGrams,
      originalDigits: digits,
    };
  }

  if (digits.length === 12) {
    const pluBlock = digits.slice(1, 1 + pluLen);
    const weightBlock = digits.slice(1 + pluLen, 1 + pluLen + weightLen);
    const weightGrams = Number(weightBlock);
    if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
    const weightKg = weightGrams / 1000;
    const pluTrimmed = pluBlock.replace(/^0+/, "") || pluBlock;
    return {
      plu: pluTrimmed,
      pluBlock,
      weightKg: Math.round(weightKg * 10000) / 10000,
      weightGrams,
      originalDigits: digits,
    };
  }

  return null;
}

/** Candidate lookup codes for a parsed PLU (padded variants). */
function pluLookupCandidates(plu, pluBlock) {
  const set = new Set();
  const add = (v) => {
    const s = String(v || "").trim();
    if (s) set.add(s);
  };
  add(plu);
  add(pluBlock);
  add(String(plu).padStart(5, "0"));
  add(String(plu).padStart(6, "0"));
  add(String(pluBlock).padStart(5, "0"));
  add(String(pluBlock).padStart(6, "0"));
  return [...set];
}

module.exports = {
  parseScaleBarcode,
  pluLookupCandidates,
  pluDigitCount,
  normalizePluDigits,
};
