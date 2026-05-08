import POS from "./pages/POS";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Warehouses from "./pages/Warehouses";
import Purchases from "./pages/Purchases";
import Expenses from "./pages/Expenses";
import DueCollection from "./pages/DueCollection";
import Accounting from "./pages/Accounting";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Suppliers from "./pages/Suppliers";
import Customers from "./pages/Customers";
import SalesReturns from "./pages/SalesReturns";
import RoleManagement from "./pages/RoleManagement";
import Products from "./pages/Products";
import Shifts from "./pages/Shifts";
import LoyaltyDashboard from "./pages/LoyaltyDashboard";
import ApprovalQueue from "./pages/ApprovalQueue";
import StockCount from "./pages/StockCount";
import Quotations from "./pages/Quotations";
import Promotions from "./pages/Promotions";
import GiftCards from "./pages/GiftCards";
import FinanceSettlements from "./pages/FinanceSettlements";
import FinanceDigitalCashout from "./pages/FinanceDigitalCashout";
import FinanceBankImports from "./pages/FinanceBankImports";
import Cheques from "./pages/Cheques";
import FiscalPeriods from "./pages/FiscalPeriods";
import Assets from "./pages/Assets";
import CostCenters from "./pages/CostCenters";
import PettyCash from "./pages/PettyCash";
import IntegrationWebhooks from "./pages/IntegrationWebhooks";
import SalesLookup from "./pages/SalesLookup";
import CustomerDisplay from "./pages/CustomerDisplay";
import { isCustomerDisplayRoute } from "./services/customerDisplay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "./services/api";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import ToastHost from "./components/ToastHost";
import { t } from "./i18n";
import { getStoredPermissions, hasPermission } from "./utils/permissions";
import SubmitButton from "./components/SubmitButton";
import { notifyError } from "./utils/notify";

const readNavPins = () => {
  try {
    const raw = localStorage.getItem("bd_pos_nav_pins");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

function useHashRoute() {
  const read = () =>
    typeof window === "undefined" ? "" : String(window.location.hash || "");
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const onChange = () => setHash(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function MainApp() {
  const [view, setView] = useState(localStorage.getItem("bd_pos_last_view") || "dashboard");
  const [menuQuery, setMenuQuery] = useState("");
  const [lang, setLang] = useState(localStorage.getItem("bd_pos_lang") || "en");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const token = localStorage.getItem("bd_pos_token");
  const permissions = getStoredPermissions();
  const userJson = localStorage.getItem("bd_pos_user");
  const user = userJson ? JSON.parse(userJson) : null;
  const branchId = localStorage.getItem("bd_pos_branch_id") || "1";
  const menuSearchRef = useRef(null);
  const [navPins, setNavPins] = useState(readNavPins);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sectionsByPerm = useMemo(() => {
    const canSeePos = hasPermission("sale.create", permissions) || hasPermission("sale.view", permissions);
    const baseSections = [
      {
        title: t(lang, "navGroupDaily"),
        items: [
          { key: "dashboard", label: t(lang, "dashboard"), hint: t(lang, "hintDashboard"), icon: "📊", perm: "report.view" },
          { key: "pos", label: t(lang, "pos"), hint: t(lang, "hintPos"), icon: "🛒", perm: canSeePos },
          { key: "returns", label: t(lang, "salesReturns"), hint: t(lang, "hintReturns"), icon: "↩️", perm: "sale.return" },
          { key: "quotations", label: t(lang, "quotations"), hint: t(lang, "hintQuotations"), icon: "📄", perm: canSeePos },
          { key: "shifts", label: t(lang, "shifts"), hint: t(lang, "hintShifts"), icon: "🧮", perm: canSeePos },
        ],
      },
      {
        title: t(lang, "navGroupInventory"),
        items: [
          { key: "products", label: t(lang, "products"), hint: t(lang, "hintProducts"), icon: "🧷", perm: "product.view" },
          { key: "inventory", label: t(lang, "inventory"), hint: t(lang, "hintInventory"), icon: "📦", perm: "inventory.view" },
          { key: "stockCount", label: t(lang, "stockCount"), hint: t(lang, "hintStockCount"), icon: "🧾", perm: "inventory.adjust" },
          { key: "warehouses", label: t(lang, "warehouses"), hint: t(lang, "hintWarehouses"), icon: "🏬", perm: "inventory.view" },
          { key: "purchases", label: t(lang, "purchases"), hint: t(lang, "hintPurchases"), icon: "🧾", perm: "purchase.view" },
          { key: "promotions", label: t(lang, "promotions"), hint: t(lang, "hintPromotions"), icon: "🏷️", perm: "product.create" },
          { key: "suppliers", label: t(lang, "suppliers"), hint: t(lang, "hintSuppliers"), icon: "🚚", perm: "supplier.view" },
          { key: "customers", label: t(lang, "customers"), hint: t(lang, "hintCustomers"), icon: "👥", perm: "customer.view" },
          { key: "giftCards", label: t(lang, "giftCards"), hint: t(lang, "hintGiftCards"), icon: "🎫", perm: "customer.view" },
        ],
      },
      {
        title: t(lang, "navGroupFinance"),
        items: [
          { key: "expenses", label: t(lang, "expenses"), hint: t(lang, "hintExpenses"), icon: "💸", perm: "expense.view" },
          { key: "dueCollection", label: t(lang, "dueCollection"), hint: t(lang, "hintDueCollection"), icon: "💳", perm: "report.view" },
          { key: "salesLookup", label: t(lang, "salesLookup"), hint: t(lang, "hintSalesLookup"), icon: "🔎", perm: "sale.view" },
          { key: "loyalty", label: t(lang, "loyalty"), hint: t(lang, "hintLoyalty"), icon: "🎁", perm: "customer.view" },
          { key: "approvals", label: t(lang, "approvals"), hint: t(lang, "hintApprovals"), icon: "✅", perm: "report.view" },
          { key: "accounting", label: t(lang, "accounting"), hint: t(lang, "hintAccounting"), icon: "💰", perm: "accounting.view" },
          { key: "financeSettlements", label: t(lang, "settlements"), hint: t(lang, "hintSettlements"), icon: "🏦", perm: "accounting.report" },
          { key: "financeDigitalCashout", label: t(lang, "digitalTransfer"), hint: t(lang, "hintDigitalTransfer"), icon: "💵", perm: "accounting.report" },
          { key: "financeBankCsv", label: t(lang, "bankImport"), hint: t(lang, "hintBankImport"), icon: "📥", perm: "accounting.report" },
          { key: "fiscalPeriods", label: t(lang, "fiscalPeriods"), hint: t(lang, "hintFiscalPeriods"), icon: "🗓️", perm: "accounting.report" },
          { key: "costCenters", label: t(lang, "costCenters"), hint: t(lang, "hintCostCenters"), icon: "🏷️", perm: "costcenter.view" },
          { key: "pettyCash", label: t(lang, "pettyCash"), hint: t(lang, "hintPettyCash"), icon: "👛", perm: "pettycash.view" },
          { key: "assets", label: t(lang, "assets"), hint: t(lang, "hintAssets"), icon: "🏢", perm: "asset.view" },
          { key: "cheques", label: t(lang, "cheques"), hint: t(lang, "hintCheques"), icon: "🧾", perm: "cheque.view" },
          { key: "reports", label: t(lang, "reports"), hint: t(lang, "hintReports"), icon: "📈", perm: "report.view" },
        ],
      },
      {
        title: t(lang, "navGroupAdmin"),
        items: [
          { key: "roles", label: t(lang, "roleManagement"), hint: t(lang, "hintRoles"), icon: "🛡️", perm: "rbac.manage" },
          { key: "integrationWebhooks", label: t(lang, "webhooks"), hint: t(lang, "hintWebhooks"), icon: "🔗", perm: "rbac.manage" },
          { key: "settings", label: t(lang, "settings"), hint: t(lang, "hintSettings"), icon: "⚙️", perm: "branch.manage" },
        ],
      },
    ];

    return baseSections.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.perm === true || (typeof item.perm === "string" && hasPermission(item.perm, permissions))
      ),
    }));
  }, [lang, permissions]);

  const allMenuItemsByPerm = useMemo(
    () => sectionsByPerm.flatMap((section) => section.items),
    [sectionsByPerm]
  );

  const sections = useMemo(() => {
    const pinSet = new Set(navPins);
    const q = menuQuery.trim().toLowerCase();
    const matchesSearch = (item) => {
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        String(item.hint || "").toLowerCase().includes(q)
      );
    };

    const pinnedItems = navPins
      .map((key) => allMenuItemsByPerm.find((item) => item.key === key))
      .filter(Boolean)
      .filter(matchesSearch);

    const restSections = sectionsByPerm
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !pinSet.has(item.key)).filter(matchesSearch),
      }))
      .filter((section) => section.items.length > 0);

    const pinnedBlock =
      pinnedItems.length > 0 ? [{ title: t(lang, "pinned"), items: pinnedItems }] : [];

    return [...pinnedBlock, ...restSections];
  }, [sectionsByPerm, allMenuItemsByPerm, navPins, menuQuery, lang]);

  const allMenuItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const toggleNavPin = (key) => {
    setNavPins((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem("bd_pos_nav_pins", JSON.stringify(next));
      return next;
    });
  };
  const currentItem = allMenuItems.find((i) => i.key === view);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loginSubmitting) return;
    setLoginSubmitting(true);
    try {
      const res = await api.post("/auth/login", loginForm);
      localStorage.setItem("bd_pos_token", res.data.token);
      localStorage.setItem("bd_pos_branch_id", String(res.data.user.branchId));
      localStorage.setItem("bd_pos_permissions", JSON.stringify(res.data.permissions || []));
      localStorage.setItem(
        "bd_pos_user",
        JSON.stringify({
          id: res.data.user.id,
          name: res.data.user.name,
          email: res.data.user.email,
          roleName: res.data.user.role?.name,
        })
      );
      window.location.reload();
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        t(lang, "loginFailed");
      notifyError(String(msg));
      setLoginSubmitting(false);
    }
  };

  const changeLang = (nextLang) => {
    const v = nextLang === "bn" ? "bn" : "en";
    setLang(v);
    localStorage.setItem("bd_pos_lang", v);
    window.dispatchEvent(new CustomEvent("bd_pos_lang_changed", { detail: { lang: v } }));
  };

  useEffect(() => {
    const sync = () => {
      const next = localStorage.getItem("bd_pos_lang") === "bn" ? "bn" : "en";
      setLang((prev) => (prev !== next ? next : prev));
    };
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const openView = useCallback((nextView) => {
    setView(nextView);
    localStorage.setItem("bd_pos_last_view", nextView);
  }, []);

  useEffect(() => {
    const onNavigate = (event) => {
      const detail = event?.detail || {};
      const prefill = detail.salesLookupPrefill;
      if (prefill && typeof prefill === "object") {
        try {
          sessionStorage.setItem("bd_pos_sales_lookup_prefill", JSON.stringify(prefill));
        } catch {
          /* ignore */
        }
      }
      const next = detail.view;
      if (!next || typeof next !== "string") return;
      setView(next);
      localStorage.setItem("bd_pos_last_view", next);
    };
    window.addEventListener("bd_pos_navigate", onNavigate);
    return () => window.removeEventListener("bd_pos_navigate", onNavigate);
  }, []);

  useEffect(() => {
    const handleGlobalMenuShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        menuSearchRef.current?.focus();
      }
      if (event.key === "Enter" && document.activeElement === menuSearchRef.current) {
        const firstMatch = allMenuItems[0];
        if (firstMatch) {
          event.preventDefault();
          openView(firstMatch.key);
          setMenuQuery("");
        }
      }
    };
    window.addEventListener("keydown", handleGlobalMenuShortcut);
    return () => window.removeEventListener("keydown", handleGlobalMenuShortcut);
  }, [allMenuItems, openView]);

  useEffect(() => {
    const onShortcutsToggle = (event) => {
      if (event.key !== "?") return;
      const el = event.target;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setShortcutsOpen((open) => !open);
    };
    window.addEventListener("keydown", onShortcutsToggle);
    return () => window.removeEventListener("keydown", onShortcutsToggle);
  }, []);

  if (!token) {
    return (
      <>
      <div className="login-shell">
        <div className="login-card login-card-elevated">
          <div className="login-brand-row">
            <div className="logo-mark login-logo-mark">BD</div>
            <div>
              <h2 className="login-title">{t(lang, "appTitle")}</h2>
              <p className="login-tagline">{t(lang, "loginTagline")}</p>
            </div>
          </div>
          <p className="login-sub">{t(lang, "loginSub")}</p>
          <form className="login-form" onSubmit={handleLogin}>
            <div className="login-field">
              <label>{t(lang, "email")}</label>
              <input
                placeholder={t(lang, "loginEmailPlaceholder")}
                autoComplete="username"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                required
              />
            </div>
            <div className="login-field">
              <label>{t(lang, "password")}</label>
              <input
                type="password"
                autoComplete="current-password"
                placeholder={t(lang, "loginPasswordPlaceholder")}
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <SubmitButton loading={loginSubmitting} loadingLabel={t(lang, "signingIn")} className="login-submit-btn">
              {t(lang, "signIn")}
            </SubmitButton>
          </form>
          <div className="login-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => changeLang(lang === "en" ? "bn" : "en")}
            >
              {lang === "en" ? "বাংলা" : "English"}
            </button>
            <span className="text-muted" style={{ fontSize: 12 }}>v1.0</span>
          </div>
          <div className="login-tip">
            {t(lang, "defaultCredentialsHint")} <strong>admin@bdpos.local</strong> / <strong>123456</strong>
          </div>
        </div>
      </div>
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        lang={lang}
      />
      <ToastHost />
      </>
    );
  }

  const renderPage = () => {
    const allowedKeys = new Set(allMenuItems.map((i) => i.key));
    if (!allowedKeys.has(view)) return <Dashboard />;
    switch (view) {
      case "dashboard":
        return <Dashboard />;
      case "pos":
        return <POS />;
      case "products":
        return <Products />;
      case "inventory":
        return <Inventory />;
      case "stockCount":
        return <StockCount />;
      case "warehouses":
        return <Warehouses />;
      case "purchases":
        return <Purchases />;
      case "promotions":
        return <Promotions />;
      case "accounting":
        return <Accounting />;
      case "financeSettlements":
        return <FinanceSettlements />;
      case "financeDigitalCashout":
        return <FinanceDigitalCashout />;
      case "financeBankCsv":
        return <FinanceBankImports />;
      case "fiscalPeriods":
        return <FiscalPeriods />;
      case "costCenters":
        return <CostCenters />;
      case "assets":
        return <Assets />;
      case "pettyCash":
        return <PettyCash />;
      case "cheques":
        return <Cheques />;
      case "expenses":
        return <Expenses />;
      case "dueCollection":
        return <DueCollection />;
      case "salesLookup":
        return <SalesLookup />;
      case "reports":
        return <Reports />;
      case "loyalty":
        return <LoyaltyDashboard />;
      case "approvals":
        return <ApprovalQueue />;
      case "suppliers":
        return <Suppliers />;
      case "customers":
        return <Customers />;
      case "giftCards":
        return <GiftCards />;
      case "returns":
        return <SalesReturns />;
      case "quotations":
        return <Quotations />;
      case "settings":
        return <Settings />;
      case "shifts":
        return <Shifts />;
      case "roles":
        return <RoleManagement />;
      case "integrationWebhooks":
        return <IntegrationWebhooks />;
      default:
        return <Dashboard />;
    }
  };

  const initials = (user?.name || user?.email || "U")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="logo-mark">BD</span>
          <span>{t(lang, "appTitle")}</span>
        </div>
        <div className="app-nav">
          <div style={{ padding: "6px 10px 10px" }}>
            <input
              ref={menuSearchRef}
              className="nav-menu-search"
              placeholder={t(lang, "searchMenu")}
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
            />
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>
              {t(lang, "navSidebarKeyHints")}
            </div>
          </div>
          {sections.map((section) => (
            <div key={section.title}>
              <div className="nav-section">{section.title}</div>
              {section.items.map((item) => (
                <div key={item.key} className="app-nav-row">
                  <button
                    type="button"
                    className={`nav-route-btn ${view === item.key ? "active" : ""}`}
                    onClick={() => openView(item.key)}
                    title={item.hint}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        lineHeight: 1.2,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ fontSize: 11, opacity: 0.7 }}>{item.hint}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`nav-pin-btn ${navPins.includes(item.key) ? "pinned" : ""}`}
                    title={
                      navPins.includes(item.key)
                        ? t(lang, "pinUnpin")
                        : t(lang, "pinToTop")
                    }
                    aria-label={
                      navPins.includes(item.key)
                        ? t(lang, "pinUnpin")
                        : t(lang, "pinToTop")
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      toggleNavPin(item.key);
                    }}
                  >
                    {navPins.includes(item.key) ? "★" : "☆"}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="app-sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name || user?.email || "User"}</div>
              <div className="user-role">{user?.roleName || t(lang, "member")}</div>
            </div>
          </div>
          <button
            className="btn-ghost"
            style={{ color: "#cbd5e1", justifyContent: "center" }}
            onClick={() => {
              localStorage.removeItem("bd_pos_token");
              localStorage.removeItem("bd_pos_permissions");
              localStorage.removeItem("bd_pos_user");
              window.location.reload();
            }}
          >
            {t(lang, "logout")}
          </button>
        </div>
      </aside>
      <main className="app-main">
        <div className="app-topbar">
          <div className="topbar-title">
            {currentItem ? (
              <span>
                <span style={{ marginRight: 8 }}>{currentItem.icon}</span>
                {currentItem.label}
              </span>
            ) : (
              t(lang, "dashboard")
            )}
          </div>
          <div className="topbar-actions">
            <span className="branch-pill">{t(lang, "branchPill", { n: branchId })}</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setShortcutsOpen(true)}
            >
              {t(lang, "shortcuts")}
            </button>
            <button className="btn-secondary btn-sm" onClick={() => changeLang(lang === "en" ? "bn" : "en")}>
              {lang === "en" ? "বাংলা" : "English"}
            </button>
          </div>
        </div>
        <div className="app-content view-root">{renderPage()}</div>
      </main>
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        lang={lang}
      />
      <ToastHost />
    </div>
  );
}

function App() {
  const hash = useHashRoute();
  if (isCustomerDisplayRoute(hash)) {
    return <CustomerDisplay />;
  }
  return <MainApp />;
}

export default App;
