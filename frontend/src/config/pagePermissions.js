/**
 * Role-based page access — single source of truth for nav + route guards.
 * A user may open a page when they hold ANY permission listed in `anyOf`.
 * Set `authenticatedOnly: true` for pages any logged-in user may view.
 */

export const PAGE_GROUPS = [
  { id: "daily", titleKey: "navGroupDaily" },
  { id: "inventory", titleKey: "navGroupInventory" },
  { id: "finance", titleKey: "navGroupFinance" },
  { id: "admin", titleKey: "navGroupAdmin" },
];

/** @typedef {{ key: string, group: string, labelKey: string, hintKey: string, icon: string, anyOf?: string[], authenticatedOnly?: boolean }} AppPageDef */

/** @type {AppPageDef[]} */
export const APP_PAGES = [
  {
    key: "dashboard",
    group: "daily",
    labelKey: "dashboard",
    hintKey: "hintDashboard",
    icon: "📊",
    authenticatedOnly: true,
  },
  { key: "pos", group: "daily", labelKey: "pos", hintKey: "hintPos", icon: "🛒", anyOf: ["sale.create", "sale.view"] },
  { key: "returns", group: "daily", labelKey: "salesReturns", hintKey: "hintReturns", icon: "↩️", anyOf: ["sale.return"] },
  { key: "quotations", group: "daily", labelKey: "quotations", hintKey: "hintQuotations", icon: "📄", anyOf: ["sale.create", "sale.view"] },
  { key: "orderInbox", group: "daily", labelKey: "orderInbox", hintKey: "hintOrderInbox", icon: "📲", anyOf: ["sale.create", "sale.view"] },
  { key: "fcommerce", group: "daily", labelKey: "fcommerce", hintKey: "hintFcommerce", icon: "💬", anyOf: ["fcommerce.view", "fcommerce.manage", "branch.manage"] },
  { key: "topup", group: "daily", labelKey: "topup", hintKey: "hintTopup", icon: "📱", anyOf: ["topup.create", "topup.view"] },
  { key: "restaurant", group: "daily", labelKey: "restaurant", hintKey: "hintRestaurant", icon: "🍽️", anyOf: ["sale.create", "sale.view"] },
  { key: "manufacturing", group: "inventory", labelKey: "manufacturing", hintKey: "hintManufacturing", icon: "🏭", anyOf: ["inventory.view", "inventory.adjust"] },
  { key: "shifts", group: "daily", labelKey: "shifts", hintKey: "hintShifts", icon: "🧮", anyOf: ["sale.create", "sale.view"] },

  { key: "products", group: "inventory", labelKey: "products", hintKey: "hintProducts", icon: "🧷", anyOf: ["product.view"] },
  { key: "inventory", group: "inventory", labelKey: "inventory", hintKey: "hintInventory", icon: "📦", anyOf: ["inventory.view"] },
  { key: "stockCount", group: "inventory", labelKey: "stockCount", hintKey: "hintStockCount", icon: "🧾", anyOf: ["inventory.view", "inventory.adjust"] },
  { key: "expiryMarkdown", group: "inventory", labelKey: "expiryMarkdown", hintKey: "hintExpiryMarkdown", icon: "⏳", anyOf: ["inventory.view"] },
  { key: "warehouses", group: "inventory", labelKey: "warehouses", hintKey: "hintWarehouses", icon: "🏬", anyOf: ["inventory.view"] },
  { key: "purchases", group: "inventory", labelKey: "purchases", hintKey: "hintPurchases", icon: "🧾", anyOf: ["purchase.view"] },
  { key: "prescriptions", group: "inventory", labelKey: "prescriptions", hintKey: "hintPrescriptions", icon: "💊", anyOf: ["pharmacy.view"] },
  { key: "promotions", group: "inventory", labelKey: "promotions", hintKey: "hintPromotions", icon: "🏷️", anyOf: ["product.view", "product.create"] },
  { key: "suppliers", group: "inventory", labelKey: "suppliers", hintKey: "hintSuppliers", icon: "🚚", anyOf: ["supplier.view"] },
  { key: "customers", group: "inventory", labelKey: "customers", hintKey: "hintCustomers", icon: "👥", anyOf: ["customer.view"] },
  { key: "warranty", group: "inventory", labelKey: "warranty", hintKey: "hintWarranty", icon: "🛠️", anyOf: ["customer.view"] },
  { key: "imeiRegistry", group: "inventory", labelKey: "imeiRegistry", hintKey: "hintImeiRegistry", icon: "📲", anyOf: ["product.view"] },
  { key: "giftCards", group: "inventory", labelKey: "giftCards", hintKey: "hintGiftCards", icon: "🎫", anyOf: ["customer.view"] },

  { key: "expenses", group: "finance", labelKey: "expenses", hintKey: "hintExpenses", icon: "💸", anyOf: ["expense.view"] },
  { key: "dueCollection", group: "finance", labelKey: "dueCollection", hintKey: "hintDueCollection", icon: "💳", anyOf: ["customer.view", "supplier.view"] },
  { key: "installments", group: "finance", labelKey: "installments", hintKey: "hintInstallments", icon: "📆", anyOf: ["customer.view"] },
  { key: "salesLookup", group: "finance", labelKey: "salesLookup", hintKey: "hintSalesLookup", icon: "🔎", anyOf: ["sale.view"] },
  { key: "loyalty", group: "finance", labelKey: "loyalty", hintKey: "hintLoyalty", icon: "🎁", anyOf: ["customer.view"] },
  { key: "approvals", group: "finance", labelKey: "approvals", hintKey: "hintApprovals", icon: "✅", anyOf: ["report.view"] },
  { key: "accounting", group: "finance", labelKey: "accounting", hintKey: "hintAccounting", icon: "💰", anyOf: ["accounting.view"] },
  { key: "financeSettlements", group: "finance", labelKey: "settlements", hintKey: "hintSettlements", icon: "🏦", anyOf: ["accounting.report"] },
  { key: "financeDigitalCashout", group: "finance", labelKey: "digitalTransfer", hintKey: "hintDigitalTransfer", icon: "💵", anyOf: ["accounting.report"] },
  { key: "financeBankCsv", group: "finance", labelKey: "bankImport", hintKey: "hintBankImport", icon: "📥", anyOf: ["accounting.report"] },
  { key: "fiscalPeriods", group: "finance", labelKey: "fiscalPeriods", hintKey: "hintFiscalPeriods", icon: "🗓️", anyOf: ["accounting.report"] },
  { key: "costCenters", group: "finance", labelKey: "costCenters", hintKey: "hintCostCenters", icon: "🏷️", anyOf: ["costcenter.view"] },
  { key: "pettyCash", group: "finance", labelKey: "pettyCash", hintKey: "hintPettyCash", icon: "👛", anyOf: ["pettycash.view"] },
  { key: "assets", group: "finance", labelKey: "assets", hintKey: "hintAssets", icon: "🏢", anyOf: ["asset.view"] },
  { key: "cheques", group: "finance", labelKey: "cheques", hintKey: "hintCheques", icon: "🧾", anyOf: ["cheque.view"] },
  { key: "reports", group: "finance", labelKey: "reports", hintKey: "hintReports", icon: "📈", anyOf: ["report.view"] },

  { key: "roles", group: "admin", labelKey: "roleManagement", hintKey: "hintRoles", icon: "🛡️", anyOf: ["rbac.manage"] },
  { key: "integrationWebhooks", group: "admin", labelKey: "webhooks", hintKey: "hintWebhooks", icon: "🔗", anyOf: ["rbac.manage"] },
  { key: "settings", group: "admin", labelKey: "settings", hintKey: "hintSettings", icon: "⚙️", anyOf: ["branch.manage"] },
];

const PAGE_BY_KEY = new Map(APP_PAGES.map((p) => [p.key, p]));

export function getPageDef(pageKey) {
  return PAGE_BY_KEY.get(String(pageKey || "")) || null;
}

export function getRequiredPermissionCodes(pageDef) {
  if (!pageDef) return [];
  if (pageDef.authenticatedOnly) return [];
  return Array.isArray(pageDef.anyOf) ? pageDef.anyOf : [];
}

export function listAccessiblePages(permissions, { isAuthenticated = true } = {}) {
  return APP_PAGES.filter((page) => canAccessPage(page, permissions, { isAuthenticated }));
}

export function canAccessPage(pageDef, permissions, { isAuthenticated = true } = {}) {
  if (!pageDef) return false;
  if (pageDef.authenticatedOnly && isAuthenticated) return true;
  const codes = pageDef.anyOf;
  if (!Array.isArray(codes) || !codes.length) return false;
  return codes.some((code) => permissions.includes(code));
}

export function canAccessPageKey(pageKey, permissions, options) {
  return canAccessPage(getPageDef(pageKey), permissions, options);
}

/** Effective page access for a role's permission code list */
export function buildPageAccessMap(permissionCodes) {
  const perms = Array.isArray(permissionCodes) ? permissionCodes : [];
  const map = {};
  for (const page of APP_PAGES) {
    map[page.key] = canAccessPage(page, perms, { isAuthenticated: true });
  }
  return map;
}
