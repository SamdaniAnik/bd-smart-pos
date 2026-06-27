/** Variable-weight scale barcode parser (matches backend pluBarcodeUtil). */

const PLU_DIGITS_STORAGE_KEY = "bd_pos_plu_barcode_digits";

export function normalizePluDigits(value) {
  const n = Number(value ?? import.meta.env.VITE_PLU_BARCODE_PLU_DIGITS ?? 5);
  return Number.isFinite(n) && n >= 4 && n <= 7 ? Math.floor(n) : 5;
}

export function setStoredPluDigits(digits) {
  const n = normalizePluDigits(digits);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PLU_DIGITS_STORAGE_KEY, String(n));
  }
  return n;
}

export function pluDigitCount() {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(PLU_DIGITS_STORAGE_KEY);
    if (stored != null && stored !== "") {
      return normalizePluDigits(stored);
    }
  }
  return normalizePluDigits();
}

export function parseScaleBarcode(raw, branchPluDigits) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 12 || !digits.startsWith("2")) {
    return null;
  }

  const pluLen =
    branchPluDigits != null && branchPluDigits !== ""
      ? normalizePluDigits(branchPluDigits)
      : pluDigitCount();
  const weightLen = 5;

  if (digits.length === 13 || digits.length === 12) {
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

export function isScaleBarcode(raw) {
  return parseScaleBarcode(raw) != null;
}
