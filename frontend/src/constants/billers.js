/**
 * Frontend twin of backend/src/constants/billers.js.
 * Mobile operators (flexiload/recharge) and utility billers for the
 * Top-up & Bills page. Keep in sync with the backend list.
 */

export const MOBILE_OPERATORS = [
  { code: "GP", name: "Grameenphone", nameBn: "গ্রামীণফোন", commissionPct: 2.75 },
  { code: "ROBI", name: "Robi", nameBn: "রবি", commissionPct: 2.75 },
  { code: "BANGLALINK", name: "Banglalink", nameBn: "বাংলালিংক", commissionPct: 2.85 },
  { code: "AIRTEL", name: "Airtel", nameBn: "এয়ারটেল", commissionPct: 2.85 },
  { code: "TELETALK", name: "Teletalk", nameBn: "টেলিটক", commissionPct: 3.0 },
  { code: "SKITTO", name: "Skitto", nameBn: "স্কিটো", commissionPct: 2.5 },
];

export const UTILITY_BILLERS = [
  { code: "DESCO", name: "DESCO (Prepaid)", nameBn: "ডেসকো (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "DPDC", name: "DPDC (Prepaid)", nameBn: "ডিপিডিসি (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "NESCO", name: "NESCO (Prepaid)", nameBn: "নেসকো (প্রিপেইড)", category: "ELECTRICITY_PREPAID", commissionFlat: 10 },
  { code: "BPDB", name: "Palli Bidyut / BPDB", nameBn: "পল্লী বিদ্যুৎ / বিপিডিবি", category: "ELECTRICITY_POSTPAID", commissionFlat: 8 },
  { code: "WASA", name: "WASA Water", nameBn: "ওয়াসা পানি", category: "WATER", commissionFlat: 8 },
  { code: "TITAS", name: "Titas Gas", nameBn: "তিতাস গ্যাস", category: "GAS", commissionFlat: 8 },
  { code: "KARNAPHULI", name: "Karnaphuli Gas", nameBn: "কর্ণফুলী গ্যাস", category: "GAS", commissionFlat: 8 },
  { code: "INTERNET", name: "Internet / ISP", nameBn: "ইন্টারনেট / আইএসপি", category: "INTERNET", commissionPct: 2.0 },
];

export const RECHARGE_TYPES = ["PREPAID", "POSTPAID", "SKITTO", "DRIVE"];

export const PAY_METHODS = ["Cash", "MFS", "Due"];
export const MFS_CHANNELS = ["bKash", "Nagad", "Rocket", "Upay"];

export function findOperator(code) {
  const key = String(code || "").trim().toUpperCase();
  return MOBILE_OPERATORS.find((o) => o.code === key) || null;
}

export function findBiller(code) {
  const key = String(code || "").trim().toUpperCase();
  return UTILITY_BILLERS.find((b) => b.code === key) || null;
}

export function suggestRechargeCommission(operatorCode, faceAmount) {
  const operator = findOperator(operatorCode);
  const amount = Math.max(0, Number(faceAmount) || 0);
  const pct = operator ? Number(operator.commissionPct) || 0 : 0;
  return Math.round(((amount * pct) / 100) * 100) / 100;
}

export function suggestBillCommission(billerCode, faceAmount) {
  const biller = findBiller(billerCode);
  const amount = Math.max(0, Number(faceAmount) || 0);
  if (!biller) return 0;
  if (Number.isFinite(Number(biller.commissionFlat))) return Number(biller.commissionFlat);
  const pct = Number(biller.commissionPct) || 0;
  return Math.round(((amount * pct) / 100) * 100) / 100;
}
