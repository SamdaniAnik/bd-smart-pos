/** Supershop perishable / expiry tracking (dairy, frozen, etc.). */

const PERISHABLE_CATEGORIES = new Set(["DAIRY", "FROZEN", "SNACKS", "GROCERY"]);

function normalizeCategoryKey(category) {
  return String(category || "")
    .trim()
    .toUpperCase();
}

function isPerishableCategory(category) {
  return PERISHABLE_CATEGORIES.has(normalizeCategoryKey(category));
}

function productUsesExpiryBatches(product) {
  if (!product) return false;
  if (product.batchTracked) return true;
  if (product.trackExpiry) return true;
  if (Number(product.shelfLifeDays || 0) > 0) return true;
  return isPerishableCategory(product.category);
}

function productRequiresExpiryDateOnReceipt(product) {
  if (!product) return false;
  if (product.batchTracked) return true;
  if (product.trackExpiry) return true;
  if (Number(product.shelfLifeDays || 0) > 0) return true;
  return isPerishableCategory(product.category);
}

function computeExpiryFromShelfLife(shelfLifeDays, baseDate = new Date()) {
  const days = Math.max(1, Math.floor(Number(shelfLifeDays || 0)));
  if (!days) return null;
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatBatchDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "OPEN";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function autoBatchCodeForReceipt({ purchaseId, productId, expiryDate, batchCode }) {
  const manual = String(batchCode || "").trim();
  if (manual) return manual.slice(0, 191);
  const tag = formatBatchDateKey(expiryDate || new Date());
  return `RCV-${purchaseId}-${productId}-${tag}`.slice(0, 191);
}

module.exports = {
  PERISHABLE_CATEGORIES,
  isPerishableCategory,
  productUsesExpiryBatches,
  productRequiresExpiryDateOnReceipt,
  computeExpiryFromShelfLife,
  autoBatchCodeForReceipt,
};
