import {
  isWeightSaleUnit,
  normalizeSaleUnit,
  SALE_UNIT_LABEL_KEYS,
} from "../constants/saleUnits";

/** Billing quantity for pricing (kg or count). */
export function getBillingUnitsForSaleLine(line) {
  const unit = normalizeSaleUnit(
    line?.saleUnit || line?.product?.saleUnit || line?.product?.unitOfMeasure || ""
  );
  if (line?.sellByWeight || isWeightSaleUnit(unit) || Number(line?.weightKg) > 1e-9) {
    return Math.max(0, Number(line.weightKg || 0));
  }
  return Math.max(0, Number(line.qty || 0));
}

/** e.g. "10 tablet", "500 gram (gm)", "0.500 kg" */
export function formatSaleLineQtyDisplay(line, tt) {
  const unit = normalizeSaleUnit(
    line?.saleUnit || line?.product?.saleUnit || line?.product?.unitOfMeasure || "PCS"
  );
  const label = (code) => tt(SALE_UNIT_LABEL_KEYS[code] || code || "saleUnitPcs");

  if (line?.sellByWeight || isWeightSaleUnit(unit) || Number(line?.weightKg) > 1e-9) {
    const kg = Number(line.weightKg || 0);
    const u = isWeightSaleUnit(unit) ? unit : "KG";
    if (u === "GM") return `${Math.round(kg * 1000)} ${label("GM")}`;
    if (u === "HALF_KG") {
      const halves = kg / 0.5;
      const n = halves % 1 === 0 ? String(halves) : halves.toFixed(2);
      return `${n} ${label("HALF_KG")}`;
    }
    return `${kg.toFixed(3)} ${label("KG")}`;
  }

  const q = Number(line.qty || 0);
  return `${q} ${label(unit)}`;
}

export function formatProductStockDisplay(product, tt) {
  const unit = normalizeSaleUnit(product?.saleUnit || product?.unitOfMeasure || "PCS");
  const label = (code) => tt(SALE_UNIT_LABEL_KEYS[code] || code || "saleUnitPcs");

  if (product?.sellByWeight || isWeightSaleUnit(unit)) {
    const kg = Number(product.stockKg || 0);
    if (unit === "GM") return `${Math.round(kg * 1000)} ${label("GM")}`;
    if (unit === "HALF_KG") {
      const halves = kg / 0.5;
      const n = halves % 1 === 0 ? String(halves) : halves.toFixed(2);
      return `${n} ${label("HALF_KG")}`;
    }
    return `${kg.toFixed(3)} ${label("KG")}`;
  }
  return `${Number(product.stock || 0)} ${label(unit)}`;
}

export function formatSaleUnitBadge(product, tt) {
  const unit = normalizeSaleUnit(product?.saleUnit || product?.unitOfMeasure || "");
  if (!unit) return "";
  return tt(SALE_UNIT_LABEL_KEYS[unit] || unit);
}
