const {
  normalizeSaleUnit,
  isWeightSaleUnit,
} = require("../constants/saleUnits");

const UNIT_LABELS = {
  TABLET: "tablet",
  PACK: "pack",
  STRIP: "strip",
  PCS: "pcs",
  SET: "set",
  GM: "gm",
  HALF_KG: "half kg",
  KG: "kg",
};

function unitLabel(code) {
  const u = normalizeSaleUnit(code);
  return UNIT_LABELS[u] || u || "pcs";
}

/** Billing quantity (kg for weight lines, else piece count). */
function getBillingUnitsForLine(line, product) {
  const unit = normalizeSaleUnit(
    line?.saleUnit || product?.saleUnit || product?.unitOfMeasure || ""
  );
  const sellByWt =
    Boolean(line?.sellByWeight) ||
    Boolean(product?.sellByWeight) ||
    isWeightSaleUnit(unit);
  if (sellByWt || Number(line?.weightKg ?? 0) > 1e-9) {
    return Math.max(0, Number(line?.weightKg ?? 0));
  }
  return Math.max(0, Number(line?.qty ?? 0));
}

/** Human-readable qty + unit, e.g. "10 tablet" or "500 gm". */
function formatSaleLineQty(line, product) {
  const unit = normalizeSaleUnit(
    line?.saleUnit || product?.saleUnit || product?.unitOfMeasure || "PCS"
  );
  const sellByWt =
    Boolean(line?.sellByWeight) ||
    Boolean(product?.sellByWeight) ||
    isWeightSaleUnit(unit);
  const kg = Number(line?.weightKg ?? 0);
  if (sellByWt || (Number.isFinite(kg) && kg > 1e-9)) {
    const u = isWeightSaleUnit(unit) ? unit : "KG";
    if (u === "GM") {
      return { qty: Math.round(kg * 1000), unit: "GM", display: `${Math.round(kg * 1000)} gm` };
    }
    if (u === "HALF_KG") {
      const halves = kg / 0.5;
      const n = halves % 1 === 0 ? String(halves) : halves.toFixed(2);
      return { qty: halves, unit: "HALF_KG", display: `${n} half kg` };
    }
    return { qty: kg, unit: "KG", display: `${kg.toFixed(3)} kg` };
  }
  const q = Number(line?.qty ?? 0);
  return { qty: q, unit, display: `${q} ${unitLabel(unit)}` };
}

function formatProductStock(product) {
  const unit = normalizeSaleUnit(product?.saleUnit || product?.unitOfMeasure || "PCS");
  const sellByWt = Boolean(product?.sellByWeight) || isWeightSaleUnit(unit);
  if (sellByWt) {
    const kg = Number(product?.stockKg || 0);
    if (unit === "GM") return `${Math.round(kg * 1000)} gm`;
    if (unit === "HALF_KG") return `${(kg / 0.5).toFixed(2)} half kg`;
    return `${kg.toFixed(3)} kg`;
  }
  return `${Number(product?.stock || 0)} ${unitLabel(unit)}`;
}

module.exports = {
  unitLabel,
  getBillingUnitsForLine,
  formatSaleLineQty,
  formatProductStock,
};
