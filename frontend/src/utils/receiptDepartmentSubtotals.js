import { resolveProductDepartment, RETAIL_DEPARTMENTS } from "../constants/retailDepartments";
import { getBillingUnitsForSaleLine } from "./formatSaleLineQty";

function departmentLabel(deptId, tt) {
  const row = RETAIL_DEPARTMENTS.find((d) => d.id === deptId);
  if (row && tt) return tt(row.labelKey);
  if (deptId === "GROCERY") return "Grocery";
  if (deptId === "PHARMACY") return "Pharmacy";
  if (deptId === "APPAREL") return "Apparel";
  return deptId || "General";
}

/**
 * Group sale/cart lines by retail department for receipt subtotals.
 * @param {Array} lines - cart or sale items with nested product
 * @param {Array} productCategories
 * @param {{ unitPriceForLine: (line) => number, tt?: Function }} opts
 */
export function groupLinesByDepartment(lines, productCategories, { unitPriceForLine, tt }) {
  const map = new Map();
  for (const line of lines || []) {
    const prod = line.product || line;
    const dept = resolveProductDepartment(prod, productCategories);
    const key = dept || "GENERAL";
    const bill = getBillingUnitsForSaleLine({
      ...line,
      product: prod,
      sellByWeight: Boolean(line.sellByWeight ?? prod?.sellByWeight),
    });
    const unitPrice = Number(unitPriceForLine(line) || 0);
    const amount = bill * unitPrice;
    if (!map.has(key)) {
      map.set(key, {
        department: key,
        label: departmentLabel(key, tt),
        qty: 0,
        amount: 0,
      });
    }
    const row = map.get(key);
    row.qty += bill;
    row.amount += amount;
  }
  return [...map.values()]
    .filter((r) => r.amount > 0.001)
    .sort((a, b) => b.amount - a.amount);
}

export function buildDepartmentSubtotalHtmlRows(groups, formatMoney) {
  if (!groups || groups.length <= 1) return "";
  return groups
    .map(
      (g) =>
        `<tr><td colspan="2" style="font-size:11px;">${g.label}</td><td class="right" colspan="2" style="font-size:11px;">${formatMoney(g.amount)}</td></tr>`
    )
    .join("");
}
