// Default Bangladesh withholding-tax rate table.
//
// Sources:
//   - Income Tax Ordinance 1984, sec. 52 / 52A / 52AA (AIT at source on
//     payments to contractors, suppliers, professional services, etc.)
//   - VAT and Supplementary Duty Act 2012, sec. 49 + VAT Rules 2016 (VDS on
//     specified services where the buyer is a VAT-registered withholding
//     entity).
//
// Rates change annually with the Finance Act. These are sensible defaults that
// match the FY 2024-25 / FY 2025-26 schedule and the most common SROs. Each
// branch can override per-payment from the UI, and individual suppliers can
// be flagged `withholdingExempt` (e.g. govt entities, BIDA-bonded sellers,
// EPZ companies with NBR exemption certificates).
//
// Categories are intentionally coarse — the cashier picks one when creating
// a supplier; finer rate tuning happens via per-payment override.

const TAX_CATEGORIES = [
  // === Goods (s.52, no VDS — VDS is service-only) ===
  {
    code: "GOODS_5_AIT",
    label: "Goods supply (5% AIT)",
    aitRate: 5,
    vdsRate: 0,
    note: "Section 52 — most goods supplied to companies/govt (exemption certificate may apply)",
  },
  {
    code: "GOODS_3_AIT",
    label: "Goods supply (3% AIT, ≤ BDT 50 lakh / FY)",
    aitRate: 3,
    vdsRate: 0,
    note: "Section 52 reduced rate for cumulative annual payments below the threshold",
  },
  {
    code: "DISTRIBUTOR_5_AIT",
    label: "Distributor / dealership (5% AIT)",
    aitRate: 5,
    vdsRate: 0,
    note: "Section 52(1) — dealership / distributorship arrangements",
  },

  // === Services with both AIT (s.52A/52AA) and VDS ===
  {
    code: "PROFESSIONAL_10_AIT_15_VDS",
    label: "Professional services (10% AIT + 15% VDS)",
    aitRate: 10,
    vdsRate: 15,
    note: "Audit/legal/consultancy/IT/management — full VAT services with VDS",
  },
  {
    code: "PROFESSIONAL_10_AIT_NO_VDS",
    label: "Professional services (10% AIT, no VDS)",
    aitRate: 10,
    vdsRate: 0,
    note: "Use when service is VAT-exempt or supplier is non-VAT-registered",
  },
  {
    code: "CONTRACT_7_AIT_7_5_VDS",
    label: "Contract / subcontract (7% AIT + 7.5% VDS)",
    aitRate: 7,
    vdsRate: 7.5,
    note: "Construction, civil works, supply contracts (s.52A)",
  },
  {
    code: "CATERING_10_AIT_10_VDS",
    label: "Catering / event management (10% AIT + 10% VDS)",
    aitRate: 10,
    vdsRate: 10,
    note: "Catering / event / decoration services",
  },
  {
    code: "TRANSPORT_5_AIT_4_5_VDS",
    label: "Transportation (5% AIT + 4.5% VDS)",
    aitRate: 5,
    vdsRate: 4.5,
    note: "Goods transport / car rental services",
  },
  {
    code: "RENT_5_AIT_15_VDS",
    label: "Office / shop rent (5% AIT + 15% VDS)",
    aitRate: 5,
    vdsRate: 15,
    note: "House / office / commercial rent (s.53A)",
  },
  {
    code: "SECURITY_10_AIT_10_VDS",
    label: "Security / cleaning (10% AIT + 10% VDS)",
    aitRate: 10,
    vdsRate: 10,
    note: "Security guard / janitorial / cleaning services",
  },

  // === Special / no withholding ===
  {
    code: "EXEMPT",
    label: "Exempt — no withholding",
    aitRate: 0,
    vdsRate: 0,
    note: "Govt entity, EPZ, BIDA exemption certificate, etc.",
  },
  {
    code: "CUSTOM",
    label: "Custom — manual rates",
    aitRate: 0,
    vdsRate: 0,
    note: "Operator enters AIT / VDS rates manually per payment",
  },
];

const TAX_CATEGORY_MAP = new Map(TAX_CATEGORIES.map((c) => [c.code, c]));

function getCategory(code) {
  if (!code) return null;
  return TAX_CATEGORY_MAP.get(String(code).toUpperCase()) || null;
}

module.exports = { TAX_CATEGORIES, getCategory };
