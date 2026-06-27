/** Retail verticals: super shop (grocery), pharmacy, apparel/clothing. */

const BUSINESS_PROFILES = new Set(["MIXED", "SUPERMARKET", "PHARMACY", "APPAREL", "RESTAURANT", "MANUFACTURING"]);

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
  TOBACCO: "GROCERY",
  ALCOHOL: "GROCERY",
  CIGARETTES: "GROCERY",
  BEER_WINE: "GROCERY",
  LIQUOR: "GROCERY",
  SPIRITS: "GROCERY",
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
const GROCERY_CATEGORIES = new Set([
  "GROCERY",
  "DAIRY",
  "BEVERAGES",
  "SNACKS",
  "HOUSEHOLD",
  "FROZEN",
  "PERSONAL_CARE",
  "STATIONERY",
]);

const RETAIL_CATEGORY_SEEDS = [
  { name: "GROCERY", department: "GROCERY", attributeSet: ["brand", "pack_size", "origin"], minMarginPct: 8 },
  { name: "DAIRY", department: "GROCERY", attributeSet: ["brand", "pack_size", "fat_content"], minMarginPct: 8 },
  { name: "BEVERAGES", department: "GROCERY", attributeSet: ["brand", "volume_ml", "origin"], minMarginPct: 10 },
  { name: "SNACKS", department: "GROCERY", attributeSet: ["brand", "pack_size", "flavor"], minMarginPct: 12 },
  { name: "HOUSEHOLD", department: "GROCERY", attributeSet: ["brand", "pack_size", "scent"], minMarginPct: 10 },
  { name: "FROZEN", department: "GROCERY", attributeSet: ["brand", "weight_g", "storage"], minMarginPct: 10 },
  { name: "PERSONAL_CARE", department: "GROCERY", attributeSet: ["brand", "size", "skin_type"], minMarginPct: 12 },
  { name: "TOBACCO", department: "GROCERY", attributeSet: ["brand", "pack_size"], minMarginPct: 12 },
  { name: "ALCOHOL", department: "GROCERY", attributeSet: ["brand", "volume_ml", "abv"], minMarginPct: 15 },
  {
    name: "PHARMACY",
    department: "PHARMACY",
    attributeSet: ["generic_name", "strength", "manufacturer", "dosage_form"],
    minMarginPct: 12,
    suggestBatchTracked: true,
  },
  {
    name: "MEDICINE",
    department: "PHARMACY",
    attributeSet: ["generic_name", "strength", "manufacturer", "schedule"],
    minMarginPct: 12,
    suggestBatchTracked: true,
  },
  {
    name: "OTC",
    department: "PHARMACY",
    attributeSet: ["generic_name", "strength", "manufacturer"],
    minMarginPct: 15,
    suggestBatchTracked: true,
  },
  {
    name: "VITAMINS",
    department: "PHARMACY",
    attributeSet: ["brand", "strength", "form", "count"],
    minMarginPct: 18,
    suggestBatchTracked: true,
  },
  {
    name: "APPAREL",
    department: "APPAREL",
    attributeSet: ["size", "color", "material", "fit"],
    minMarginPct: 15,
    suggestHasVariants: true,
  },
  {
    name: "FOOTWEAR",
    department: "APPAREL",
    attributeSet: ["size", "color", "gender", "material"],
    minMarginPct: 18,
    suggestHasVariants: true,
  },
  {
    name: "ACCESSORIES",
    department: "APPAREL",
    attributeSet: ["color", "material", "brand"],
    minMarginPct: 20,
    suggestHasVariants: true,
  },
  {
    name: "RAW_MATERIAL",
    department: "MANUFACTURING",
    attributeSet: ["brand", "pack_size", "origin"],
    minMarginPct: 5,
  },
  {
    name: "SEMI_FINISHED",
    department: "MANUFACTURING",
    attributeSet: ["batch_size", "shelf_life"],
    minMarginPct: 8,
  },
  {
    name: "FINISHED_GOODS",
    department: "MANUFACTURING",
    attributeSet: ["brand", "pack_size"],
    minMarginPct: 15,
  },
];

function normalizeBusinessProfile(value) {
  const key = String(value || "MIXED")
    .trim()
    .toUpperCase();
  return BUSINESS_PROFILES.has(key) ? key : "MIXED";
}

function resolveCategoryDepartment(categoryName, categoryRow) {
  if (categoryRow?.department) {
    const d = String(categoryRow.department).trim().toUpperCase();
    if (d === "GROCERY" || d === "PHARMACY" || d === "APPAREL" || d === "MANUFACTURING" || d === "GENERAL") return d;
  }
  const key = String(categoryName || "")
    .trim()
    .toUpperCase();
  return CATEGORY_DEPARTMENT_MAP[key] || "GENERAL";
}

function getDepartmentsForProfile(profile) {
  const normalized = normalizeBusinessProfile(profile);
  return PROFILE_DEPARTMENTS[normalized] || PROFILE_DEPARTMENTS.MIXED;
}

function isPharmacyCategory(categoryName) {
  return PHARMACY_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

function isApparelCategory(categoryName) {
  return APPAREL_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

function isGroceryCategory(categoryName) {
  return GROCERY_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

const AGE_RESTRICTED_CATEGORIES = new Set([
  "TOBACCO",
  "ALCOHOL",
  "CIGARETTES",
  "BEER_WINE",
  "LIQUOR",
  "SPIRITS",
]);

function isAgeRestrictedCategory(categoryName) {
  return AGE_RESTRICTED_CATEGORIES.has(String(categoryName || "").trim().toUpperCase());
}

module.exports = {
  BUSINESS_PROFILES,
  PROFILE_DEPARTMENTS,
  CATEGORY_DEPARTMENT_MAP,
  RETAIL_CATEGORY_SEEDS,
  PHARMACY_CATEGORIES,
  APPAREL_CATEGORIES,
  GROCERY_CATEGORIES,
  normalizeBusinessProfile,
  resolveCategoryDepartment,
  getDepartmentsForProfile,
  isPharmacyCategory,
  isApparelCategory,
  isGroceryCategory,
  AGE_RESTRICTED_CATEGORIES,
  isAgeRestrictedCategory,
};
