/**
 * Backend twin of frontend/src/utils/banglishSearch.js for F-commerce order parsing.
 */
const CONSONANTS = {
  "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
  "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "n",
  "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
  "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
  "প": "p", "ফ": "ph", "ব": "b", "ভ": "bh", "ম": "m",
  "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh",
  "স": "s", "হ": "h", "ড়": "r", "ঢ়": "rh", "য়": "y", "ৎ": "t",
};

const VOWELS = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u",
  "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
};

const VOWEL_SIGNS = {
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
  "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
};

const MODIFIERS = { "ং": "ng", "ঃ": "", "ঁ": "" };
const BANGLA_DIGITS = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };
const HASANTA = "্";

function romanizeBangla(text) {
  const chars = [...String(text || "")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONSONANTS[ch]) {
      out += CONSONANTS[ch];
      const next = chars[i + 1];
      if (next && CONSONANTS[next]) out += "o";
    } else if (VOWEL_SIGNS[ch] != null) out += VOWEL_SIGNS[ch];
    else if (VOWELS[ch]) out += VOWELS[ch];
    else if (MODIFIERS[ch] != null) out += MODIFIERS[ch];
    else if (BANGLA_DIGITS[ch] != null) out += BANGLA_DIGITS[ch];
    else if (ch !== HASANTA) out += ch;
  }
  return out.toLowerCase();
}

function normalizeBanglish(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/v/g, "bh")
    .replace(/z/g, "j")
    .replace(/f/g, "ph")
    .replace(/w/g, "o")
    .replace(/(.)\1+/g, "$1");
}

const stripVowels = (text) => String(text || "").replace(/[aeiou]/g, "");

function matchesBanglish(query, banglaText) {
  const q = String(query || "").trim().toLowerCase();
  const source = String(banglaText || "").trim();
  if (!q || !source) return false;
  if (/[\u0980-\u09FF]/.test(q)) return source.includes(q);
  const roman = normalizeBanglish(romanizeBangla(source));
  const normQuery = normalizeBanglish(q);
  if (roman.includes(normQuery)) return true;
  if (normQuery.length < 3) return false;
  const strippedQuery = stripVowels(normQuery);
  return strippedQuery.length >= 2 && stripVowels(roman).includes(strippedQuery);
}

function matchesProductQuery(query, product) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  const name = String(product.name || "").toLowerCase();
  const nameBn = String(product.nameBn || "");
  const sku = String(product.sku || "").toLowerCase();
  const barcode = String(product.barcode || "").toLowerCase();
  if (name.includes(q) || sku === q || barcode === q) return true;
  if (nameBn && matchesBanglish(q, nameBn)) return true;
  if (nameBn && nameBn.includes(q)) return true;
  return matchesBanglish(q, product.name || "");
}

module.exports = { romanizeBangla, matchesBanglish, matchesProductQuery };
