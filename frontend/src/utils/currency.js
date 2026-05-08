// Bangladesh-aware currency and number formatting.
//
// Conventions:
//   Lakh/crore grouping:  1,23,45,678.50  (groups of 2 after the rightmost 3)
//   Currency symbol:      ৳  (U+09F3, Bangladeshi Taka sign) — placed before the number.
//   Bangla numerals:      ০ ১ ২ ৩ ৪ ৫ ৬ ৭ ৮ ৯  (U+09E6 .. U+09EF)
//
// Reference: Bangladesh Bank "Bangladesh Standard Time, Numerical and Currency
// Representation" guideline; NBR Mushak/VAT forms also use lakh/crore grouping.

const BANGLA_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const ENGLISH_DIGIT_RE = /[0-9]/g;

export function toBanglaDigits(input) {
  if (input === null || input === undefined) return "";
  return String(input).replace(ENGLISH_DIGIT_RE, (d) => BANGLA_DIGITS[Number(d)]);
}

// Group an integer string in BD/Indian lakh-crore style:
//   "1234567"   -> "12,34,567"
//   "12345"     -> "12,345"
//   "123"       -> "123"
//   "12345678"  -> "1,23,45,678"
function groupBdInteger(intStr) {
  const negative = intStr.startsWith("-");
  const abs = negative ? intStr.slice(1) : intStr;
  if (abs.length <= 3) return (negative ? "-" : "") + abs;

  const last3 = abs.slice(-3);
  const rest = abs.slice(0, -3);
  // Insert a comma every 2 digits in `rest`, from the right.
  const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (negative ? "-" : "") + groupedRest + "," + last3;
}

/**
 * Format a number as Bangladeshi currency.
 *
 * @param {number|string|null|undefined} value
 * @param {object} [options]
 * @param {"en"|"bn"} [options.lang="en"]      Bangla numerals when "bn"
 * @param {boolean}  [options.withSymbol=true] Prepend "৳ "
 * @param {number}   [options.decimals=2]      Decimal places (0–4)
 * @param {string}   [options.fallback=""]     Returned for null/NaN/undefined values
 * @returns {string}
 */
export function formatBDT(value, options = {}) {
  const {
    lang = "en",
    withSymbol = true,
    decimals = 2,
    fallback = "",
  } = options;

  const num = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(num)) {
    return fallback;
  }

  const dp = Math.max(0, Math.min(4, Number.isInteger(decimals) ? decimals : 2));
  const rounded = num.toFixed(dp); // "1234567.50"
  const negative = rounded.startsWith("-");
  const [intPart, fracPart] = (negative ? rounded.slice(1) : rounded).split(".");

  const groupedInt = groupBdInteger(intPart);
  let formatted = dp === 0 ? groupedInt : `${groupedInt}.${fracPart}`;

  if (lang === "bn") formatted = toBanglaDigits(formatted);

  const body = withSymbol ? `৳ ${formatted}` : formatted;
  return negative ? `-${body}` : body;
}

/**
 * Format a non-currency number using BD lakh/crore grouping (e.g. quantities,
 * counts in the dashboard). Bangla numerals are applied when lang === "bn".
 */
export function formatBdNumber(value, options = {}) {
  const { lang = "en", decimals = 0, fallback = "" } = options;
  const num = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(num)) {
    return fallback;
  }
  const dp = Math.max(0, Math.min(6, Number.isInteger(decimals) ? decimals : 0));
  const rounded = num.toFixed(dp);
  const negative = rounded.startsWith("-");
  const [intPart, fracPart] = (negative ? rounded.slice(1) : rounded).split(".");
  const groupedInt = groupBdInteger(intPart);
  let formatted = dp === 0 ? groupedInt : `${groupedInt}.${fracPart}`;
  if (negative) formatted = "-" + formatted;
  if (lang === "bn") formatted = toBanglaDigits(formatted);
  return formatted;
}

export const TAKA_SYMBOL = "৳";
