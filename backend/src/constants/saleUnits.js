/** Retail sale units by department (pharmacy / apparel / grocery). */

const PHARMACY_UNITS = ["TABLET", "PACK", "STRIP"];
const APPAREL_UNITS = ["PCS", "SET"];
const GROCERY_UNITS = ["GM", "HALF_KG", "KG"];

const WEIGHT_UNITS = new Set(["GM", "HALF_KG", "KG"]);

const DEPARTMENT_UNITS = {
  PHARMACY: PHARMACY_UNITS,
  APPAREL: APPAREL_UNITS,
  GROCERY: GROCERY_UNITS,
  GENERAL: ["PCS", "KG"],
};

const DEFAULT_UNIT = {
  PHARMACY: "TABLET",
  APPAREL: "PCS",
  GROCERY: "KG",
  GENERAL: "PCS",
};

function normalizeDept(dept) {
  const d = String(dept || "").trim().toUpperCase();
  if (d === "GROCERY" || d === "PHARMACY" || d === "APPAREL") return d;
  return "GENERAL";
}

function normalizeSaleUnit(code) {
  const u = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (u === "HALFKG" || u === "0.5KG" || u === "500G") return "HALF_KG";
  if (u === "HALF_KG" || u === "500GM") return "HALF_KG";
  if (u === "PIECE" || u === "PC") return "PCS";
  return u;
}

function isWeightSaleUnit(code) {
  return WEIGHT_UNITS.has(normalizeSaleUnit(code));
}

function getAllowedSaleUnitsForDepartment(dept) {
  return DEPARTMENT_UNITS[normalizeDept(dept)] || DEPARTMENT_UNITS.GENERAL;
}

function getDefaultSaleUnitForDepartment(dept) {
  return DEFAULT_UNIT[normalizeDept(dept)] || "PCS";
}

function resolveAllowedSaleUnits(product, department) {
  const raw = product?.allowedSaleUnits;
  if (Array.isArray(raw) && raw.length) {
    const dept = normalizeDept(department);
    const pool = new Set(getAllowedSaleUnitsForDepartment(dept));
    const filtered = raw
      .map((x) => normalizeSaleUnit(x))
      .filter((x) => pool.has(x));
    if (filtered.length) return [...new Set(filtered)];
  }
  return getAllowedSaleUnitsForDepartment(department);
}

function resolveProductSaleUnit(product, department) {
  const allowed = resolveAllowedSaleUnits(product, department);
  const candidate = normalizeSaleUnit(product?.saleUnit || product?.unitOfMeasure || "");
  if (candidate && allowed.includes(candidate)) return candidate;
  return allowed[0] || getDefaultSaleUnitForDepartment(department);
}

/** Default weight in kg when adding a weight-based line. */
function defaultWeightKgForUnit(unitCode) {
  const u = normalizeSaleUnit(unitCode);
  if (u === "HALF_KG") return 0.5;
  if (u === "KG") return 1;
  if (u === "GM") return 0.25;
  return 0.001;
}

/** Step for weight input (kg). */
function weightStepKgForUnit(unitCode) {
  const u = normalizeSaleUnit(unitCode);
  if (u === "GM") return 0.001;
  if (u === "HALF_KG") return 0.5;
  return 0.001;
}

function validateSaleUnitForDepartment(unitCode, department) {
  const u = normalizeSaleUnit(unitCode);
  const allowed = getAllowedSaleUnitsForDepartment(department);
  return allowed.includes(u);
}

function syncSellByWeightFromSaleUnit(saleUnit, existingSellByWeight) {
  if (isWeightSaleUnit(saleUnit)) return true;
  if (saleUnit) return false;
  return Boolean(existingSellByWeight);
}

module.exports = {
  PHARMACY_UNITS,
  APPAREL_UNITS,
  GROCERY_UNITS,
  WEIGHT_UNITS,
  normalizeSaleUnit,
  isWeightSaleUnit,
  getAllowedSaleUnitsForDepartment,
  getDefaultSaleUnitForDepartment,
  resolveAllowedSaleUnits,
  resolveProductSaleUnit,
  defaultWeightKgForUnit,
  weightStepKgForUnit,
  validateSaleUnitForDepartment,
  syncSellByWeightFromSaleUnit,
};
