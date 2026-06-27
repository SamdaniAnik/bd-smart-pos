/**
 * Phonetic (Banglish) search support: lets a cashier type "chini" or "dudh"
 * in Latin letters and match Bangla product names (চিনি, দুধ).
 *
 * Strategy: romanize the Bangla text deterministically, then compare against
 * the query. Because Banglish spelling varies wildly, a vowel-stripped
 * comparison is used as a fallback (e.g. "chal" -> "chl" matches চাল -> "chal" -> "chl").
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

export function romanizeBangla(text) {
  const chars = [...String(text || "")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONSONANTS[ch]) {
      out += CONSONANTS[ch];
      const next = chars[i + 1];
      // Inherent vowel between consonant clusters ("চল" -> "chol"), suppressed
      // by an explicit vowel sign, hasanta (conjunct), or end of word.
      if (next && CONSONANTS[next]) out += "o";
    } else if (VOWEL_SIGNS[ch] != null) {
      out += VOWEL_SIGNS[ch];
    } else if (VOWELS[ch]) {
      out += VOWELS[ch];
    } else if (MODIFIERS[ch] != null) {
      out += MODIFIERS[ch];
    } else if (BANGLA_DIGITS[ch] != null) {
      out += BANGLA_DIGITS[ch];
    } else if (ch !== HASANTA) {
      out += ch;
    }
  }
  return out.toLowerCase();
}

/** Normalize Banglish spelling variants so "fanta"/"vai"/"zol" align with romanization output. */
function normalizeBanglish(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/v/g, "bh")
    .replace(/z/g, "j")
    .replace(/f/g, "ph")
    .replace(/w/g, "o")
    .replace(/(.)\1+/g, "$1"); // collapse doubled letters: "dudhh" -> "dudh"
}

const stripVowels = (text) => String(text || "").replace(/[aeiou]/g, "");

/**
 * True when a Latin-letter query phonetically matches a Bangla string.
 * Short queries (<3 chars) only use exact romanized matching to avoid noise.
 */
export function matchesBanglish(query, banglaText) {
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
