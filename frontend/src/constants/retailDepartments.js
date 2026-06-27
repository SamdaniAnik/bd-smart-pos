/** Retail verticals: super shop (grocery), pharmacy, apparel/clothing. */

export const BUSINESS_PROFILE_OPTIONS = [
  { value: "MIXED", labelKey: "retailProfileMixed" },
  { value: "SUPERMARKET", labelKey: "retailProfileSupermarket" },
  { value: "PHARMACY", labelKey: "retailProfilePharmacy" },
  { value: "APPAREL", labelKey: "retailProfileApparel" },
  { value: "RESTAURANT", labelKey: "retailProfileRestaurant" },
  { value: "MANUFACTURING", labelKey: "retailProfileManufacturing" },
];

export const RETAIL_DEPARTMENTS = [
  { id: "GROCERY", labelKey: "retailDeptGrocery", icon: "🛒" },
  { id: "PHARMACY", labelKey: "retailDeptPharmacy", icon: "💊" },
  { id: "APPAREL", labelKey: "retailDeptApparel", icon: "👕" },
  { id: "MANUFACTURING", labelKey: "retailDeptManufacturing", icon: "🏭" },
];

/** Aisle/category quick filters for supershop POS (maps to product.category). */
/** Categories requiring manager PIN at POS (tobacco, alcohol). */
export const AGE_RESTRICTED_CATEGORIES = new Set([
  "TOBACCO",
  "ALCOHOL",
  "CIGARETTES",
  "BEER_WINE",
  "LIQUOR",
  "SPIRITS",
]);

export function isAgeRestrictedCategory(category) {
  return AGE_RESTRICTED_CATEGORIES.has(
    String(category || "")
      .trim()
      .toUpperCase()
  );
}

export const MANUFACTURING_CATEGORY_CHIPS = [
  { id: "RAW_MATERIAL", labelKey: "mfgCatRawMaterial", icon: "🌾" },
  { id: "SEMI_FINISHED", labelKey: "mfgCatSemiFinished", icon: "⚗️" },
  { id: "FINISHED_GOODS", labelKey: "mfgCatFinishedGoods", icon: "📦" },
];

export const GROCERY_CATEGORY_CHIPS = [
  { id: "DAIRY", labelKey: "groceryCatDairy", icon: "🥛" },
  { id: "BEVERAGES", labelKey: "groceryCatBeverages", icon: "🥤" },
  { id: "SNACKS", labelKey: "groceryCatSnacks", icon: "🍿" },
  { id: "FROZEN", labelKey: "groceryCatFrozen", icon: "🧊" },
  { id: "HOUSEHOLD", labelKey: "groceryCatHousehold", icon: "🧴" },
  { id: "PERSONAL_CARE", labelKey: "groceryCatPersonalCare", icon: "🧼" },
  { id: "GROCERY", labelKey: "groceryCatGrocery", icon: "🛒" },
];

const PROFILE_DEPARTMENTS = {
  MIXED: ["GROCERY", "PHARMACY", "APPAREL"],
  SUPERMARKET: ["GROCERY"],
  PHARMACY: ["PHARMACY"],
  APPAREL: ["APPAREL"],
  RESTAURANT: ["GROCERY"],
  MANUFACTURING: ["MANUFACTURING"],
};

const CATEGORY_DEPARTMENT_MAP = {
  GROCERY: "GROCERY",
  DAIRY: "GROCERY",
  BEVERAGES: "GROCERY",
  SNACKS: "GROCERY",
  HOUSEHOLD: "GROCERY",
  FROZEN: "GROCERY",
  PERSONAL_CARE: "GROCERY",
  STATIONERY: "GROCERY",
  PHARMACY: "PHARMACY",
  MEDICINE: "PHARMACY",
  OTC: "PHARMACY",
  VITAMINS: "PHARMACY",
  BABY_CARE: "PHARMACY",
  HEALTH: "PHARMACY",
  APPAREL: "APPAREL",
  FOOTWEAR: "APPAREL",
  ACCESSORIES: "APPAREL",
  CLOTHING: "APPAREL",
  MENS_WEAR: "APPAREL",
  WOMENS_WEAR: "APPAREL",
  KIDS_WEAR: "APPAREL",
  RAW_MATERIAL: "MANUFACTURING",
  SEMI_FINISHED: "MANUFACTURING",
  FINISHED_GOODS: "MANUFACTURING",
};

export const CATEGORY_ATTRIBUTE_PRESETS = {
  GROCERY: ["brand", "pack_size", "origin"],
  DAIRY: ["brand", "pack_size", "fat_content"],
  BEVERAGES: ["brand", "volume_ml", "origin"],
  SNACKS: ["brand", "pack_size", "flavor"],
  HOUSEHOLD: ["brand", "pack_size", "scent"],
  FROZEN: ["brand", "weight_g", "storage"],
  PERSONAL_CARE: ["brand", "size", "skin_type"],
  PHARMACY: ["generic_name", "strength", "manufacturer", "dosage_form"],
  MEDICINE: ["generic_name", "strength", "manufacturer", "schedule"],
  OTC: ["generic_name", "strength", "manufacturer"],
  VITAMINS: ["brand", "strength", "form", "count"],
  APPAREL: ["size", "color", "material", "fit"],
  ELECTRONICS: ["brand", "model", "specification", "warranty"],
  FOOTWEAR: ["size", "color", "gender", "material"],
  ACCESSORIES: ["color", "material", "brand"],
};

const PHARMACY_CATEGORIES = new Set(["PHARMACY", "MEDICINE", "OTC", "VITAMINS", "BABY_CARE", "HEALTH"]);
const APPAREL_CATEGORIES = new Set([
  "APPAREL",
  "FOOTWEAR",
  "ACCESSORIES",
  "CLOTHING",
  "MENS_WEAR",
  "WOMENS_WEAR",
  "KIDS_WEAR",
]);

export function normalizeBusinessProfile(value) {
  const key = String(value || "MIXED")
    .trim()
    .toUpperCase();
  const allowed = new Set(BUSINESS_PROFILE_OPTIONS.map((o) => o.value));
  return allowed.has(key) ? key : "MIXED";
}

export function getDepartmentsForProfile(profile) {
  const normalized = normalizeBusinessProfile(profile);
  return PROFILE_DEPARTMENTS[normalized] || PROFILE_DEPARTMENTS.MIXED;
}

export function resolveCategoryDepartment(categoryName, categoryRow) {
  if (categoryRow?.department) {
    const d = String(categoryRow.department).trim().toUpperCase();
    if (d === "GROCERY" || d === "PHARMACY" || d === "APPAREL" || d === "MANUFACTURING" || d === "GENERAL") return d;
  }
  const key = String(categoryName || "")
    .trim()
    .toUpperCase();
  return CATEGORY_DEPARTMENT_MAP[key] || "GENERAL";
}

export function resolveProductDepartment(product, productCategories = []) {
  const catName = String(product?.category || "").trim();
  const row =
    productCategories.find(
      (c) => String(c.name || "").trim().toUpperCase() === catName.toUpperCase()
    ) || null;
  return resolveCategoryDepartment(catName, row);
}

export function isPharmacyCategory(categoryName) {
  return PHARMACY_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

export function isApparelCategory(categoryName) {
  return APPAREL_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

const PERISHABLE_CATEGORIES = new Set(["DAIRY", "FROZEN", "SNACKS", "GROCERY"]);

export function isPerishableCategory(categoryName) {
  return PERISHABLE_CATEGORIES.has(
    String(categoryName || "")
      .trim()
      .toUpperCase()
  );
}

export function productNeedsExpiryOnPurchase(product) {
  if (!product) return false;
  if (product.batchTracked || product.trackExpiry) return true;
  if (Number(product.shelfLifeDays || 0) > 0) return true;
  return isPerishableCategory(product.category);
}

export function suggestExpiryDateFromShelfLife(product) {
  const days = Math.max(0, Math.floor(Number(product?.shelfLifeDays || 0)));
  if (!days) return "";
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const APPAREL_SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "XXL"];
