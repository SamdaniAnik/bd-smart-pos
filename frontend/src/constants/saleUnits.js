/** Retail sale units by department (pharmacy / apparel / grocery). */

export const PHARMACY_SALE_UNITS = ["TABLET", "PACK", "STRIP"];
export const APPAREL_SALE_UNITS = ["PCS", "SET"];
export const GROCERY_SALE_UNITS = ["GM", "HALF_KG", "KG"];

const WEIGHT_UNITS = new Set(["GM", "HALF_KG", "KG"]);

const DEPARTMENT_UNITS = {
  PHARMACY: PHARMACY_SALE_UNITS,
  APPAREL: APPAREL_SALE_UNITS,
  GROCERY: GROCERY_SALE_UNITS,
  GENERAL: ["PCS", "KG"],
};

const DEFAULT_UNIT = {
  PHARMACY: "TABLET",
  APPAREL: "PCS",
  GROCERY: "KG",
  GENERAL: "PCS",
};

export const SALE_UNIT_LABEL_KEYS = {
  TABLET: "saleUnitTablet",
  PACK: "saleUnitPack",
  STRIP: "saleUnitStrip",
  PCS: "saleUnitPcs",
  SET: "saleUnitSet",
  GM: "saleUnitGm",
  HALF_KG: "saleUnitHalfKg",
  KG: "saleUnitKg",
};

export function normalizeSaleUnit(code) {
  const u = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (u === "HALFKG" || u === "0.5KG" || u === "500G" || u === "500GM") return "HALF_KG";
  if (u === "PIECE" || u === "PC") return "PCS";
  return u;
}

export function isWeightSaleUnit(code) {
  return WEIGHT_UNITS.has(normalizeSaleUnit(code));
}

export function getAllowedSaleUnitsForDepartment(dept) {
  const d = String(dept || "").trim().toUpperCase();
  if (d === "GROCERY" || d === "PHARMACY" || d === "APPAREL") return DEPARTMENT_UNITS[d];
  return DEPARTMENT_UNITS.GENERAL;
}

export function getDefaultSaleUnitForDepartment(dept) {
  const d = String(dept || "").trim().toUpperCase();
  return DEFAULT_UNIT[d] || DEFAULT_UNIT.GENERAL;
}

export function resolveAllowedSaleUnits(product, department) {
  const raw = product?.allowedSaleUnits;
  if (Array.isArray(raw) && raw.length) {
    const pool = new Set(getAllowedSaleUnitsForDepartment(department));
    const filtered = raw.map((x) => normalizeSaleUnit(x)).filter((x) => pool.has(x));
    if (filtered.length) return [...new Set(filtered)];
  }
  return getAllowedSaleUnitsForDepartment(department);
}

export function resolveProductSaleUnit(product, department) {
  const allowed = resolveAllowedSaleUnits(product, department);
  const candidate = normalizeSaleUnit(product?.saleUnit || product?.unitOfMeasure || "");
  if (candidate && allowed.includes(candidate)) return candidate;
  return allowed[0] || getDefaultSaleUnitForDepartment(department);
}

export function defaultWeightKgForUnit(unitCode) {
  const u = normalizeSaleUnit(unitCode);
  if (u === "HALF_KG") return 0.5;
  if (u === "KG") return 1;
  if (u === "GM") return 0.25;
  return 0.001;
}

export function weightStepKgForUnit(unitCode) {
  const u = normalizeSaleUnit(unitCode);
  if (u === "HALF_KG") return 0.5;
  if (u === "GM") return 0.001;
  return 0.001;
}

/** Display quantity for cart (grams as integer when GM). */
export function saleUnitDisplayAmount(item) {
  if (!item) return "";
  const unit = normalizeSaleUnit(item.saleUnit);
  if (isWeightSaleUnit(unit)) {
    const kg = Number(item.weightKg || 0);
    if (unit === "GM") return Math.round(kg * 1000);
    if (unit === "HALF_KG") return kg / 0.5;
    return kg;
  }
  return Number(item.qty || 1);
}

export function formatWeightInputForUnit(unitCode, weightKg) {
  const u = normalizeSaleUnit(unitCode);
  const kg = Number(weightKg || 0);
  if (u === "GM") return kg > 0 ? String(Math.round(kg * 1000)) : "";
  return kg > 0 ? String(kg) : "";
}

export function parseWeightInputForUnit(unitCode, raw) {
  const u = normalizeSaleUnit(unitCode);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (u === "GM") return n / 1000;
  return n;
}
