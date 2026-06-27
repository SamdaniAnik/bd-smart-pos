/**
 * Bangladesh mobile operators (flexiload/recharge) and utility billers used by
 * the Top-up & Bills service. Shared with the frontend twin in
 * frontend/src/constants/billers.js. Default commission rates are indicative
 * distributor margins; the actual commission can be overridden per transaction.
 */

const MOBILE_OPERATORS = [
  { code: "GP", name: "Grameenphone", nameBn: "গ্রামীণফোন", prefixes: ["013", "017"], commissionPct: 2.75 },
  { code: "ROBI", name: "Robi", nameBn: "রবি", prefixes: ["016", "018"], commissionPct: 2.75 },
  { code: "BANGLALINK", name: "Banglalink", nameBn: "বাংলালিংক", prefixes: ["014", "019"], commissionPct: 2.85 },
  { code: "AIRTEL", name: "Airtel", nameBn: "এয়ারটেল", prefixes: ["016"], commissionPct: 2.85 },
  { code: "TELETALK", name: "Teletalk", nameBn: "টেলিটক", prefixes: ["015"], commissionPct: 3.0 },
  { code: "SKITTO", name: "Skitto", nameBn: "স্কিটো", prefixes: ["013", "017"], commissionPct: 2.5 },
];

const UTILITY_BILLERS = [
  { code: "DESCO", name: "DESCO (Prepaid)", nameBn: "ডেসকো (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "DPDC", name: "DPDC (Prepaid)", nameBn: "ডিপিডিসি (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "NESCO", name: "NESCO (Prepaid)", nameBn: "নেসকো (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "BPDB", name: "Palli Bidyut / BPDB", nameBn: "পল্লী বিদ্যুৎ / বিপিডিবি", category: "ELECTRICITY_POSTPAID", commissionFlat: 8 },
  { code: "WASA", name: "WASA Water", nameBn: "ওয়াসা পানি", category: "WATER", commissionFlat: 8 },
  { code: "TITAS", name: "Titas Gas", nameBn: "তিতাস গ্যাস", category: "GAS", commissionFlat: 8 },
  { code: "KARNAPHULI", name: "Karnaphuli Gas", nameBn: "কর্ণফুলী গ্যাস", category: "GAS", commissionFlat: 8 },
  { code: "INTERNET", name: "Internet / ISP", nameBn: "ইন্টারনেট / আইএসপি", category: "INTERNET", commissionPct: 2.0 },
];

const RECHARGE_TYPES = ["PREPAID", "POSTPAID", "SKITTO", "DRIVE"];

const MOBILE_OPERATOR_CODES = new Set(MOBILE_OPERATORS.map((o) => o.code));
const UTILITY_BILLER_CODES = new Set(UTILITY_BILLERS.map((b) => b.code));

function findOperator(code) {
  const key = String(code || "").trim().toUpperCase();
  return MOBILE_OPERATORS.find((o) => o.code === key) || null;
}

function findBiller(code) {
  const key = String(code || "").trim().toUpperCase();
  return UTILITY_BILLERS.find((b) => b.code === key) || null;
}

/** Suggest a default commission (BDT) for a recharge of `faceAmount`. */
function suggestRechargeCommission(operatorCode, faceAmount) {
  const operator = findOperator(operatorCode);
  const amount = Math.max(0, Number(faceAmount) || 0);
  const pct = operator ? Number(operator.commissionPct) || 0 : 0;
  return Math.round(((amount * pct) / 100) * 100) / 100;
}

/** Suggest a default commission (BDT) for a utility bill payment. */
function suggestBillCommission(billerCode, faceAmount) {
  const biller = findBiller(billerCode);
  const amount = Math.max(0, Number(faceAmount) || 0);
  if (!biller) return 0;
  if (Number.isFinite(Number(biller.commissionFlat))) return Number(biller.commissionFlat);
  const pct = Number(biller.commissionPct) || 0;
  return Math.round(((amount * pct) / 100) * 100) / 100;
}

module.exports = {
  MOBILE_OPERATORS,
  UTILITY_BILLERS,
  RECHARGE_TYPES,
  MOBILE_OPERATOR_CODES,
  UTILITY_BILLER_CODES,
  findOperator,
  findBiller,
  suggestRechargeCommission,
  suggestBillCommission,
};
