import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import POS from "./pages/POS";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Warehouses from "./pages/Warehouses";
import Purchases from "./pages/Purchases";
import Expenses from "./pages/Expenses";
import DueCollection from "./pages/DueCollection";
import Installments from "./pages/Installments";
import ImeiRegistry from "./pages/ImeiRegistry";
import ExpiryMarkdown from "./pages/ExpiryMarkdown";
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
import Prescriptions from "./pages/Prescriptions";
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
import OrderInbox from "./pages/OrderInbox";
import Fcommerce from "./pages/Fcommerce";
import TopupBills from "./pages/TopupBills";
import Restaurant from "./pages/Restaurant";
import Manufacturing from "./pages/Manufacturing";
import CustomerDisplay from "./pages/CustomerDisplay";
import Storefront from "./pages/Storefront";
import LoyaltyCard from "./pages/LoyaltyCard";
import WarrantyClaims from "./pages/WarrantyClaims";
import { isCustomerDisplayRoute } from "./services/customerDisplay";
import { isStorefrontRoute } from "./services/storefront";
import { isLoyaltyRoute } from "./services/loyaltyPublic";
import useHashRoute from "./hooks/useHashRoute";
import useMediaQuery from "./hooks/useMediaQuery";
import api from "./services/api";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import ToastHost from "./components/ToastHost";
import { t, setTermOverrides } from "./i18n";
import { getStoredPermissions, setStoredPermissions, hasPermission } from "./utils/permissions";
import SubmitButton from "./components/SubmitButton";
import { notifyError } from "./utils/notify";
import PageAccessDenied from "./components/PageAccessDenied";
import {
  APP_PAGES,
  PAGE_GROUPS,
  canAccessPage,
  getPageDef,
  listAccessiblePages,
} from "./config/pagePermissions";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_STORAGE_KEY,
  buildTermOverrides,
  getDefaultViewForBusiness,
  isPageVisibleForBusiness,
  mapBusinessTypeToProfile,
  readBusinessType,
} from "./config/businessTypes";

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

function MainApp() {
  const [view, setView] = useState(localStorage.getItem("bd_pos_last_view") || "dashboard");
  const [menuQuery, setMenuQuery] = useState("");
  const [lang, setLang] = useState(localStorage.getItem("bd_pos_lang") || "en");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const token = localStorage.getItem("bd_pos_token");
  const [permissions, setPermissions] = useState(() => getStoredPermissions());
  const userJson = localStorage.getItem("bd_pos_user");
  const user = userJson ? JSON.parse(userJson) : null;
  const branchId = localStorage.getItem("bd_pos_branch_id") || "1";
  const menuSearchRef = useRef(null);
  const permissionsBootstrappedRef = useRef(false);
  const [navPins, setNavPins] = useState(readNavPins);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [navMobileOpen, setNavMobileOpen] = useState(false);
  const isMobileNav = useMediaQuery("(max-width: 1024px)");
  const [businessType, setBusinessType] = useState(readBusinessType);
  // Don't show the setup modal until we've checked the branch for a shared type.
  const [bizReady, setBizReady] = useState(() => Boolean(readBusinessType()));

  // Apply business-type term overrides during render so children (menu, POS,
  // page titles) read the relabeled strings on the same pass.
  useMemo(() => {
    setTermOverrides(buildTermOverrides(businessType));
    return null;
  }, [businessType]);

  const sectionsByPerm = useMemo(() => {
    return PAGE_GROUPS.map((group) => ({
      title: t(lang, group.titleKey),
      items: APP_PAGES.filter(
        (page) =>
          page.group === group.id &&
          canAccessPage(page, permissions, { isAuthenticated: true }) &&
          isPageVisibleForBusiness(page.key, businessType)
      ).map((page) => ({
        key: page.key,
        label: t(lang, page.labelKey),
        hint: t(lang, page.hintKey),
        icon: page.icon,
      })),
    })).filter((section) => section.items.length > 0);
  }, [lang, permissions, businessType]);

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

  useEffect(() => {
    const syncPerms = () => setPermissions(getStoredPermissions());
    window.addEventListener("bd_pos_permissions_changed", syncPerms);
    window.addEventListener("storage", syncPerms);
    return () => {
      window.removeEventListener("bd_pos_permissions_changed", syncPerms);
      window.removeEventListener("storage", syncPerms);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/auth/me");
        if (cancelled) return;
        const next = res.data?.permissions || [];
        setStoredPermissions(next);
        setPermissions(next);
      } catch {
        /* keep cached permissions */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || permissionsBootstrappedRef.current || !permissions.length) return;
    permissionsBootstrappedRef.current = true;
    const pageDef = getPageDef(view);
    if (canAccessPage(pageDef, permissions, { isAuthenticated: true })) return;
    const fallback = listAccessiblePages(permissions, { isAuthenticated: true })[0]?.key || "dashboard";
    if (fallback === view) return;
    setView(fallback);
    localStorage.setItem("bd_pos_last_view", fallback);
  }, [token, permissions, view]);

  const openView = useCallback((nextView) => {
    setView(nextView);
    localStorage.setItem("bd_pos_last_view", nextView);
    setNavMobileOpen(false);
  }, []);

  const applyBusinessType = useCallback(
    (nextType, { navigate = true } = {}) => {
      setBusinessType(nextType);
      try {
        if (nextType) localStorage.setItem(BUSINESS_TYPE_STORAGE_KEY, nextType);
        else localStorage.removeItem(BUSINESS_TYPE_STORAGE_KEY);
      } catch {
        /* ignore storage failures */
      }
      window.dispatchEvent(
        new CustomEvent("bd_pos_business_type_changed", { detail: { type: nextType } })
      );
      // Persist the choice branch-wide so every device on this branch follows
      // suit (best-effort; needs branch.manage permission). The business type
      // covers the UI tailoring; the mapped profile drives the POS engine.
      if (nextType && hasPermission("branch.manage")) {
        const mappedProfile = mapBusinessTypeToProfile(nextType);
        api
          .patch(`/branches/${branchId}/business-profile`, {
            businessType: nextType,
            ...(mappedProfile ? { businessProfile: mappedProfile } : {}),
          })
          .then(() => {
            if (mappedProfile) localStorage.setItem("bd_pos_business_profile", mappedProfile);
            window.dispatchEvent(new Event("bd_pos_branch_changed"));
          })
          .catch(() => {
            /* keep the local device override even if the write fails */
          });
      }
      if (!navigate || !nextType) return;
      const target = getDefaultViewForBusiness(nextType, "dashboard");
      const targetDef = getPageDef(target);
      const canOpenTarget =
        targetDef && canAccessPage(targetDef, permissions, { isAuthenticated: true });
      if (canOpenTarget) {
        setView(target);
        localStorage.setItem("bd_pos_last_view", target);
      } else if (!isPageVisibleForBusiness(view, nextType)) {
        // Current page got hidden and we can't reach the default — go home.
        setView("dashboard");
        localStorage.setItem("bd_pos_last_view", "dashboard");
      }
      setNavMobileOpen(false);
    },
    [permissions, view, branchId]
  );

  useEffect(() => {
    if (!isMobileNav) setNavMobileOpen(false);
  }, [isMobileNav]);

  // On a fresh device, adopt the business type saved on the branch (shared
  // branch-wide). A locally chosen type always wins to preserve offline picks.
  useEffect(() => {
    if (!token) return undefined;
    if (readBusinessType()) {
      setBizReady(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/branches");
        const id = Number(localStorage.getItem("bd_pos_branch_id") || 1);
        const branch = (Array.isArray(res.data) ? res.data : []).find(
          (b) => Number(b.id) === id
        );
        if (!cancelled && branch?.businessType) {
          applyBusinessType(branch.businessType, { navigate: false });
        }
      } catch {
        /* ignore — fall back to the setup modal */
      } finally {
        if (!cancelled) setBizReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, applyBusinessType]);

  // Apply the per-type accent theme via a root attribute (see index.css).
  useEffect(() => {
    const root = document.documentElement;
    if (businessType) root.setAttribute("data-business", businessType);
    else root.removeAttribute("data-business");
    return () => root.removeAttribute("data-business");
  }, [businessType]);

  useEffect(() => {
    if (!navMobileOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setNavMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [navMobileOpen]);

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
      if (detail.inventoryTab) {
        try {
          sessionStorage.setItem("bd_pos_inventory_tab", String(detail.inventoryTab));
        } catch {
          /* ignore */
        }
      }
      if (detail.batchExpiryFilter) {
        try {
          sessionStorage.setItem("bd_pos_inventory_batch_filter", String(detail.batchExpiryFilter));
        } catch {
          /* ignore */
        }
      }
      if (detail.productsTab) {
        try {
          sessionStorage.setItem("bd_pos_products_tab", String(detail.productsTab));
        } catch {
          /* ignore */
        }
      }
      if (detail.labelAisleFilter) {
        try {
          sessionStorage.setItem("bd_pos_label_aisle_filter", String(detail.labelAisleFilter));
        } catch {
          /* ignore */
        }
      }
      if (detail.labelQueue && typeof detail.labelQueue === "object") {
        try {
          sessionStorage.setItem("bd_pos_label_queue_pending", JSON.stringify(detail.labelQueue));
        } catch {
          /* ignore */
        }
      }
      if (detail.reportsTab) {
        try {
          sessionStorage.setItem("bd_pos_reports_tab", String(detail.reportsTab));
        } catch {
          /* ignore */
        }
      }
      if (detail.marginErosionOnly) {
        try {
          sessionStorage.setItem("bd_pos_margin_erosion_only", "1");
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
    const pageDef = getPageDef(view);
    if (!canAccessPage(pageDef, permissions, { isAuthenticated: true })) {
      const canSeeRoles = hasPermission("rbac.manage", permissions);
      return (
        <PageAccessDenied
          lang={lang}
          pageKey={view}
          pageDef={pageDef}
          onGoDashboard={() => openView("dashboard")}
          onGoRoles={canSeeRoles ? () => openView("roles") : undefined}
        />
      );
    }
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
      case "prescriptions":
        return <Prescriptions />;
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
      case "installments":
        return <Installments />;
      case "imeiRegistry":
        return <ImeiRegistry />;
      case "expiryMarkdown":
        return <ExpiryMarkdown />;
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
      case "warranty":
        return <WarrantyClaims />;
      case "giftCards":
        return <GiftCards />;
      case "returns":
        return <SalesReturns />;
      case "quotations":
        return <Quotations />;
      case "orderInbox":
        return <OrderInbox />;
      case "fcommerce":
        return <Fcommerce />;
      case "topup":
        return <TopupBills />;
      case "restaurant":
        return <Restaurant />;
      case "manufacturing":
        return <Manufacturing />;
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
    <div className={`app-shell ${navMobileOpen ? "nav-mobile-open" : ""}`}>
      {navMobileOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t(lang, "navCloseMenu")}
          onClick={() => setNavMobileOpen(false)}
        />
      ) : null}
      <aside className={`app-sidebar ${navMobileOpen ? "is-open" : ""}`} aria-hidden={isMobileNav && !navMobileOpen}>
        <div className="app-brand">
          <span className="logo-mark">BD</span>
          <span className="app-brand-text">{t(lang, "appTitle")}</span>
          {isMobileNav ? (
            <button
              type="button"
              className="sidebar-close-btn btn-icon"
              aria-label={t(lang, "navCloseMenu")}
              onClick={() => setNavMobileOpen(false)}
            >
              ✕
            </button>
          ) : null}
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
          {isMobileNav ? (
            <button
              type="button"
              className="nav-menu-toggle btn-icon"
              aria-label={t(lang, "navOpenMenu")}
              aria-expanded={navMobileOpen}
              onClick={() => setNavMobileOpen(true)}
            >
              ☰
            </button>
          ) : null}
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
            <label className="biz-type-select" title={t(lang, "bizSelectorLabel")}>
              <span className="biz-type-select-icon" aria-hidden="true">🏷️</span>
              <select
                aria-label={t(lang, "bizSelectorAria")}
                value={businessType}
                onChange={(e) => applyBusinessType(e.target.value)}
              >
                <option value="">{t(lang, "bizSelectorLabel")}</option>
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.icon} {t(lang, b.labelKey)}
                  </option>
                ))}
              </select>
            </label>
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
      {bizReady && !businessType ? (
        <div className="biz-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="biz-setup-title">
          <div className="biz-setup-modal">
            <h2 id="biz-setup-title" className="biz-setup-title">{t(lang, "bizSetupTitle")}</h2>
            <p className="biz-setup-subtitle">{t(lang, "bizSetupSubtitle")}</p>
            <div className="biz-setup-grid">
              {BUSINESS_TYPES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="biz-setup-card"
                  onClick={() => applyBusinessType(b.id)}
                >
                  <span className="biz-setup-card-icon" aria-hidden="true">{b.icon}</span>
                  <span className="biz-setup-card-name">{t(lang, b.labelKey)}</span>
                  <span className="biz-setup-card-desc">{t(lang, b.descKey)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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
  if (isStorefrontRoute(hash)) {
    return <Storefront />;
  }
  if (isLoyaltyRoute(hash)) {
    return <LoyaltyCard />;
  }
  return <MainApp />;
}

export default App;
