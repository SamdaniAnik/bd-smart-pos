/**
 * Business-type "modes" (device-scoped). Selecting a type tailors the
 * navigation menu, the default landing page, and a few POS/menu terms.
 * Persisted in localStorage only — no backend change required.
 */

export const BUSINESS_TYPE_STORAGE_KEY = "bd_pos_business_type";

/**
 * @typedef {Object} BusinessTypeDef
 * @property {string} id
 * @property {string} labelKey   i18n key for the display name
 * @property {string} descKey    i18n key for the short description
 * @property {string} icon
 * @property {string} defaultView landing page key after selecting
 * @property {string[]} hidden   page keys hidden for this business type
 * @property {{en: Record<string,string>, bn: Record<string,string>}} terms
 *   term overrides keyed by i18n key (relabels menu items + POS terms)
 */

/** @type {BusinessTypeDef[]} */
export const BUSINESS_TYPES = [
  {
    id: "retail",
    labelKey: "bizRetail",
    descKey: "bizRetailDesc",
    icon: "🏪",
    defaultView: "pos",
    hidden: ["prescriptions", "restaurant"],
    terms: {
      en: { pos: "Retail POS", hintPos: "Sell at the retail counter" },
      bn: { pos: "রিটেইল POS", hintPos: "রিটেইল কাউন্টারে বিক্রি করুন" },
    },
  },
  {
    id: "pharmacy",
    labelKey: "bizPharmacy",
    descKey: "bizPharmacyDesc",
    icon: "💊",
    defaultView: "pos",
    hidden: ["restaurant", "imeiRegistry", "manufacturing", "topup", "fcommerce", "orderInbox"],
    terms: {
      en: {
        pos: "Pharmacy POS",
        hintPos: "Dispense medicines & bill",
        products: "Medicines",
        hintProducts: "Medicine catalogue & pricing",
        customers: "Patients",
        hintCustomers: "Patient profiles & history",
        suppliers: "Distributors",
      },
      bn: {
        pos: "ফার্মেসি POS",
        hintPos: "ওষুধ ডিসপেন্স ও বিল",
        products: "ওষুধ",
        hintProducts: "ওষুধের ক্যাটালগ ও মূল্য",
        customers: "রোগী",
        hintCustomers: "রোগীর প্রোফাইল ও ইতিহাস",
        suppliers: "ডিস্ট্রিবিউটর",
      },
    },
  },
  {
    id: "grocery",
    labelKey: "bizGrocery",
    descKey: "bizGroceryDesc",
    icon: "🛒",
    defaultView: "pos",
    hidden: [
      "prescriptions",
      "imeiRegistry",
      "restaurant",
      "warranty",
      "manufacturing",
      "topup",
      "fcommerce",
      "orderInbox",
    ],
    terms: {
      en: { pos: "Grocery POS", hintPos: "Quick grocery checkout", products: "Grocery items" },
      bn: { pos: "গ্রোসারি POS", hintPos: "দ্রুত গ্রোসারি চেকআউট", products: "মুদি পণ্য" },
    },
  },
  {
    id: "ecommerce",
    labelKey: "bizEcommerce",
    descKey: "bizEcommerceDesc",
    icon: "🌐",
    defaultView: "orderInbox",
    hidden: ["restaurant", "prescriptions", "shifts", "topup", "imeiRegistry"],
    terms: {
      en: {
        pos: "Counter sale",
        hintPos: "Manual / counter order",
        customers: "Buyers",
        orderInbox: "Online orders",
        hintOrderInbox: "Website & marketplace orders",
      },
      bn: {
        pos: "কাউন্টার বিক্রি",
        hintPos: "ম্যানুয়াল / কাউন্টার অর্ডার",
        customers: "ক্রেতা",
        orderInbox: "অনলাইন অর্ডার",
        hintOrderInbox: "ওয়েবসাইট ও মার্কেটপ্লেস অর্ডার",
      },
    },
  },
  {
    id: "restaurant",
    labelKey: "bizRestaurant",
    descKey: "bizRestaurantDesc",
    icon: "🍽️",
    defaultView: "restaurant",
    hidden: ["prescriptions", "imeiRegistry", "warranty", "topup", "expiryMarkdown"],
    terms: {
      en: {
        restaurant: "Tables & orders",
        hintRestaurant: "Dine-in, takeaway & KOT",
        pos: "Quick bill",
        hintPos: "Fast counter billing",
        products: "Menu items",
        hintProducts: "Dishes, combos & recipes",
        customers: "Guests",
        hintCustomers: "Guest profiles & history",
      },
      bn: {
        restaurant: "টেবিল ও অর্ডার",
        hintRestaurant: "ডাইন-ইন, টেকঅ্যাওয়ে ও KOT",
        pos: "দ্রুত বিল",
        hintPos: "দ্রুত কাউন্টার বিলিং",
        products: "মেনু আইটেম",
        hintProducts: "ডিশ, কম্বো ও রেসিপি",
        customers: "অতিথি",
        hintCustomers: "অতিথির প্রোফাইল ও ইতিহাস",
      },
    },
  },
];

const BIZ_BY_ID = new Map(BUSINESS_TYPES.map((b) => [b.id, b]));

export function getBusinessTypeDef(id) {
  return BIZ_BY_ID.get(String(id || "")) || null;
}

export function readBusinessType() {
  try {
    const raw = localStorage.getItem(BUSINESS_TYPE_STORAGE_KEY);
    return raw && BIZ_BY_ID.has(raw) ? raw : "";
  } catch {
    return "";
  }
}

/** A page is visible unless the active business type explicitly hides it. */
export function isPageVisibleForBusiness(pageKey, businessId) {
  const def = getBusinessTypeDef(businessId);
  if (!def) return true;
  return !def.hidden.includes(String(pageKey || ""));
}

/** Build a `{ en: {...}, bn: {...} }` override map for the active type. */
export function buildTermOverrides(businessId) {
  const def = getBusinessTypeDef(businessId);
  if (!def) return {};
  return {
    en: { ...(def.terms?.en || {}) },
    bn: { ...(def.terms?.bn || {}) },
  };
}

export function getDefaultViewForBusiness(businessId, fallback = "dashboard") {
  const def = getBusinessTypeDef(businessId);
  return def?.defaultView || fallback;
}

/**
 * Map a device-scoped business type to the existing branch `businessProfile`
 * engine (drives POS departments, restaurant tables/KOT, grocery categories,
 * scale PLU, pharmacy prescription flow). Returns null to keep the branch's
 * own configured profile (e.g. ecommerce, or no type selected).
 */
export function mapBusinessTypeToProfile(businessId) {
  switch (String(businessId || "")) {
    case "pharmacy":
      return "PHARMACY";
    case "grocery":
      return "SUPERMARKET";
    case "restaurant":
      return "RESTAURANT";
    case "retail":
      return "MIXED";
    default:
      return null;
  }
}
