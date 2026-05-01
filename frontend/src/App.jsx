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
import { useEffect, useMemo, useRef, useState } from "react";
import api from "./services/api";
import { t } from "./i18n";

function App() {
  const [view, setView] = useState(localStorage.getItem("bd_pos_last_view") || "dashboard");
  const [menuQuery, setMenuQuery] = useState("");
  const [lang, setLang] = useState(localStorage.getItem("bd_pos_lang") || "en");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const token = localStorage.getItem("bd_pos_token");
  const permissions = JSON.parse(localStorage.getItem("bd_pos_permissions") || "[]");
  const userJson = localStorage.getItem("bd_pos_user");
  const user = userJson ? JSON.parse(userJson) : null;
  const branchId = localStorage.getItem("bd_pos_branch_id") || "1";
  const menuSearchRef = useRef(null);
  const has = (code) => permissions.includes(code);

  const sections = useMemo(() => {
    const canSeePos = has("sale.create") || has("sale.view");
    const baseSections = [
      {
        title: "Daily Operations",
        items: [
          { key: "dashboard", label: t(lang, "dashboard"), hint: "Quick overview", icon: "📊", perm: "report.view" },
          { key: "pos", label: t(lang, "pos"), hint: "Sell products", icon: "🛒", perm: canSeePos },
          { key: "returns", label: t(lang, "salesReturns"), hint: "Handle returns", icon: "↩️", perm: "sale.return" },
          { key: "quotations", label: t(lang, "quotations"), hint: "Quotes & proforma", icon: "📄", perm: canSeePos },
          { key: "shifts", label: "Shifts", hint: "Open/close cash shift", icon: "🧮", perm: canSeePos },
        ],
      },
      {
        title: "Inventory & Master Data",
        items: [
          { key: "products", label: t(lang, "products"), hint: "Product master", icon: "🧷", perm: "product.view" },
          { key: "inventory", label: t(lang, "inventory"), hint: "Stock ledger", icon: "📦", perm: "inventory.view" },
          { key: "stockCount", label: t(lang, "stockCount"), hint: "Physical inventory count", icon: "🧾", perm: "inventory.adjust" },
          { key: "warehouses", label: t(lang, "warehouses"), hint: "Warehouse master", icon: "🏬", perm: "inventory.view" },
          { key: "purchases", label: t(lang, "purchases"), hint: "Purchase bills", icon: "🧾", perm: "purchase.view" },
          { key: "suppliers", label: t(lang, "suppliers"), hint: "Supplier master", icon: "🚚", perm: "supplier.view" },
          { key: "customers", label: t(lang, "customers"), hint: "Customer master", icon: "👥", perm: "customer.view" },
        ],
      },
      {
        title: "Finance",
        items: [
          { key: "expenses", label: t(lang, "expenses"), hint: "Operating expenses", icon: "💸", perm: "expense.view" },
          { key: "dueCollection", label: t(lang, "dueCollection"), hint: "Collect and settle dues", icon: "💳", perm: "report.view" },
          { key: "loyalty", label: t(lang, "loyalty"), hint: "Points, tiers, redemption", icon: "🎁", perm: "customer.view" },
          { key: "approvals", label: t(lang, "approvals"), hint: "Approval queue & exceptions", icon: "✅", perm: "report.view" },
          { key: "accounting", label: t(lang, "accounting"), hint: "COA & trial balance", icon: "💰", perm: "accounting.view" },
          { key: "reports", label: t(lang, "reports"), hint: "Aging & valuation", icon: "📈", perm: "report.view" },
        ],
      },
      {
        title: "Administration",
        items: [
          { key: "roles", label: t(lang, "roleManagement"), hint: "Roles & users", icon: "🛡️", perm: "rbac.manage" },
          { key: "settings", label: t(lang, "settings"), hint: "Branch settings", icon: "⚙️", perm: true },
        ],
      },
    ];

    return baseSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => item.perm === true || (typeof item.perm === "string" && has(item.perm))
        ),
      }))
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (!menuQuery.trim()) return true;
          const q = menuQuery.toLowerCase();
          return (
            item.label.toLowerCase().includes(q) ||
            String(item.hint || "").toLowerCase().includes(q)
          );
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [lang, permissions, menuQuery]);

  const allMenuItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const currentItem = allMenuItems.find((i) => i.key === view);

  const handleLogin = async (e) => {
    e.preventDefault();
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
  };

  const changeLang = (nextLang) => {
    setLang(nextLang);
    localStorage.setItem("bd_pos_lang", nextLang);
  };

  if (!token) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div className="logo-mark" style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>BD</div>
            <h2 style={{ margin: 0 }}>{t(lang, "appTitle")}</h2>
          </div>
          <p className="login-sub">Sign in to access your branch POS modules.</p>
          <form onSubmit={handleLogin}>
            <div>
              <label>Email</label>
              <input
                placeholder="you@example.com"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              />
            </div>
            <div>
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
            </div>
            <button type="submit" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}>
              Sign In
            </button>
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
            Default admin: <strong>admin@bdpos.local</strong> / <strong>123456</strong>
          </div>
        </div>
      </div>
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
      case "accounting":
        return <Accounting />;
      case "expenses":
        return <Expenses />;
      case "dueCollection":
        return <DueCollection />;
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
      default:
        return <Dashboard />;
    }
  };

  const openView = (nextView) => {
    setView(nextView);
    localStorage.setItem("bd_pos_last_view", nextView);
  };

  useEffect(() => {
    const onNavigate = (event) => {
      const next = event?.detail?.view;
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
  }, [allMenuItems]);

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
              placeholder={lang === "bn" ? "মেনু খুঁজুন..." : "Search menu..."}
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              style={{ background: "rgba(255,255,255,0.08)", color: "#e2e8f0", borderColor: "rgba(255,255,255,0.15)" }}
            />
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>
              Ctrl/Cmd + K
            </div>
          </div>
          {sections.map((section) => (
            <div key={section.title}>
              <div className="nav-section">{section.title}</div>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  className={view === item.key ? "active" : ""}
                  onClick={() => openView(item.key)}
                  title={item.hint}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                    <span>{item.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="app-sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name || user?.email || "User"}</div>
              <div className="user-role">{user?.roleName || "Member"}</div>
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
            Logout
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
            <span className="branch-pill">Branch #{branchId}</span>
            <button className="btn-secondary btn-sm" onClick={() => changeLang(lang === "en" ? "bn" : "en")}>
              {lang === "en" ? "বাংলা" : "English"}
            </button>
          </div>
        </div>
        <div className="app-content">{renderPage()}</div>
      </main>
    </div>
  );
}

export default App;
