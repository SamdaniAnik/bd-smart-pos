import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { getLang, t } from "../i18n";
import { formatBDT, formatBdNumber, toBanglaDigits } from "../utils/currency";
import { getStoredPermissions, hasAnyPermission, hasPermission } from "../utils/permissions";

function Dashboard() {
  const [data, setData] = useState({ sales: 0, collections: 0, purchase: 0, stockAlerts: 0 });
  const [trends, setTrends] = useState({
    sales: { diff: 0, pct: 0 },
    collections: { diff: 0, pct: 0 },
    purchase: { diff: 0, pct: 0 },
    lowStock: { diff: 0, pct: 0 },
  });
  const [quoteReminders, setQuoteReminders] = useState({ overdue: 0, today: 0, tomorrow: 0, upcoming: 0 });
  const [settlement, setSettlement] = useState({
    billCount: 0,
    totalPaid: 0,
    totalDue: 0,
    methods: [],
    walletFlow: { cashIn: 0, cashOut: 0, net: 0 },
  });
  const [aging, setAging] = useState({ customers: [], suppliers: [] });
  const [stockValuation, setStockValuation] = useState({ totalValue: 0, rows: [] });
  const [lowStock, setLowStock] = useState({ rows: [], summary: { totalTracked: 0, outOfStock: 0, lowStock: 0 } });
  const [recentSales, setRecentSales] = useState([]);
  const [hqBranchSummary, setHqBranchSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uiLang, setUiLang] = useState(() => getLang());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const canMultiBranch = hasAnyPermission(["rbac.manage", "branch.manage"], getStoredPermissions());
      const hqPromise = canMultiBranch
        ? api.get("/reports/hq-branch-summary").then((r) => r.data).catch(() => null)
        : Promise.resolve(null);

      const [
        dashboardRes,
        trendRes,
        quoteRemindersRes,
        settlementRes,
        agingRes,
        stockRes,
        lowStockRes,
        recentSalesRes,
        hqRes,
      ] = await Promise.all([
        api.get("/reports/dashboard"),
        api.get("/reports/dashboard/trends"),
        api.get("/sales/quotes/reminders/summary"),
        api.get("/sales/summary/settlement-today"),
        api.get("/reports/aging"),
        api.get("/reports/stock-valuation"),
        api.get("/inventory/alerts/low-stock?onlyCritical=true"),
        api.get("/sales/recent"),
        hqPromise,
      ]);
      setData(dashboardRes.data);
      setTrends(
        trendRes.data || {
          sales: { diff: 0, pct: 0 },
          collections: { diff: 0, pct: 0 },
          purchase: { diff: 0, pct: 0 },
          lowStock: { diff: 0, pct: 0 },
        }
      );
      setQuoteReminders(quoteRemindersRes.data || { overdue: 0, today: 0, tomorrow: 0, upcoming: 0 });
      setSettlement(
        settlementRes.data || {
          billCount: 0,
          totalPaid: 0,
          totalDue: 0,
          methods: [],
          walletFlow: { cashIn: 0, cashOut: 0, net: 0 },
        }
      );
      setAging(agingRes.data || { customers: [], suppliers: [] });
      setStockValuation(stockRes.data || { totalValue: 0, rows: [] });
      setLowStock(
        lowStockRes.data || { rows: [], summary: { totalTracked: 0, outOfStock: 0, lowStock: 0 } }
      );
      setRecentSales((recentSalesRes.data || []).slice(0, 8));
      setHqBranchSummary(hqRes && Array.isArray(hqRes.branches) ? hqRes : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const lang = uiLang;
  const branchId = typeof window !== "undefined" ? localStorage.getItem("bd_pos_branch_id") || "1" : "1";
  const fmt = (n) => formatBDT(n || 0, { lang });
  const fmtCount = (n) => formatBdNumber(n || 0, { lang });
  const localizeDigits = (s) => (lang === "bn" ? toBanglaDigits(s) : String(s));

  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return tt("dashMorning");
    if (h < 17) return tt("dashAfternoon");
    return tt("dashEvening");
  }, [tt]);

  const todayLabel = useMemo(() => {
    const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    return new Date().toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", opts);
  }, [lang]);

  const quickActions = useMemo(() => {
    const p = getStoredPermissions();
    const items = [
      {
        view: "pos",
        label: tt("pos"),
        hint: tt("dashQaSellHint"),
        icon: "🛒",
        ok: () => hasPermission("sale.create", p) || hasPermission("sale.view", p),
      },
      { view: "purchases", label: tt("purchases"), hint: tt("dashQaPurchasesHint"), icon: "🧾", ok: () => hasPermission("purchase.view", p) },
      { view: "dueCollection", label: tt("dashQaDues"), hint: tt("dashQaDuesHint"), icon: "💳", ok: () => hasPermission("report.view", p) },
      { view: "reports", label: tt("reports"), hint: tt("dashQaReportsHint"), icon: "📈", ok: () => hasPermission("report.view", p) },
      { view: "giftCards", label: tt("dashQaWallets"), hint: tt("dashQaGiftHint"), icon: "🎫", ok: () => hasPermission("customer.view", p) },
      { view: "inventory", label: tt("dashQaStock"), hint: tt("dashQaStockHint"), icon: "📦", ok: () => hasPermission("inventory.view", p) },
      { view: "expenses", label: tt("expenses"), hint: tt("dashQaExpensesHint"), icon: "💸", ok: () => hasPermission("expense.view", p) },
    ];
    return items.filter((x) => x.ok());
  }, [tt]);

  const navigate = (view) => {
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view } }));
  };

  const openQuoteReminders = (filter) => {
    localStorage.setItem("bd_pos_quote_reminder_filter", String(filter || "OVERDUE"));
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "quotations" } }));
  };

  const renderTrend = (value, options = {}) => {
    const { invert = false, isCurrency = true } = options;
    const diff = Number(value?.diff || 0);
    const pct = Number(value?.pct || 0);
    const isGood = invert ? diff < 0 : diff > 0;
    const isFlat = Math.abs(diff) < 0.0001;
    const arrow = isFlat ? "→" : diff > 0 ? "▲" : "▼";
    const tone = isFlat ? "flat" : isGood ? "up" : "down";
    const deltaLabel = isCurrency
      ? `${diff >= 0 ? "+" : "-"}${fmt(Math.abs(diff))}`
      : `${diff >= 0 ? "+" : "-"}${fmtCount(Math.abs(diff))}`;
    return (
      <span className={`dashboard-trend dashboard-trend--${tone}`} title={`${tt("dashTrendDelta")} ${deltaLabel}`}>
        <span className="dashboard-trend-arrow" aria-hidden>
          {arrow}
        </span>
        <span>{localizeDigits(Math.abs(pct).toFixed(1))}%</span>
        <span className="dashboard-trend-vs">{tt("dashVsYesterday")}</span>
      </span>
    );
  };

  const methodTotals = useMemo(() => {
    const canonical = [
      { key: "cash", labelKey: "dashMethodCash" },
      { key: "bkash", labelKey: "dashMethodBkash" },
      { key: "nagad", labelKey: "dashMethodNagad" },
      { key: "rocket", labelKey: "dashMethodRocket" },
      { key: "card", labelKey: "dashMethodCard" },
      { key: "wallet", labelKey: "dashMethodWallet" },
      { key: "gift", labelKey: "dashMethodGift" },
    ];
    const totalsByKey = new Map(canonical.map((x) => [x.key, 0]));
    let otherTotal = 0;

    for (const row of settlement.methods || []) {
      const rawMethod = String(row?.method || "").trim();
      const lower = rawMethod.toLowerCase();
      const amount = Number(row?.amount || 0);
      if (!rawMethod) continue;
      if (lower === "cash") totalsByKey.set("cash", totalsByKey.get("cash") + amount);
      else if (lower.includes("bkash")) totalsByKey.set("bkash", totalsByKey.get("bkash") + amount);
      else if (lower.includes("nagad")) totalsByKey.set("nagad", totalsByKey.get("nagad") + amount);
      else if (lower.includes("rocket")) totalsByKey.set("rocket", totalsByKey.get("rocket") + amount);
      else if (lower.includes("card")) totalsByKey.set("card", totalsByKey.get("card") + amount);
      else if (lower.includes("wallet")) totalsByKey.set("wallet", totalsByKey.get("wallet") + amount);
      else if (lower.includes("gift")) totalsByKey.set("gift", totalsByKey.get("gift") + amount);
      else otherTotal += amount;
    }

    const rows = canonical.map((x) => ({
      methodKey: x.key,
      label: t(uiLang, x.labelKey),
      amount: totalsByKey.get(x.key) || 0,
    }));
    if (Math.abs(otherTotal) > 0.0001) {
      rows.push({ methodKey: "other", label: t(uiLang, "dashMethodOther"), amount: otherTotal });
    }
    return rows;
  }, [settlement.methods, uiLang]);

  const paymentCardTheme = (methodKey) => {
    const key = String(methodKey || "").trim().toLowerCase();
    if (key === "cash") return { border: "#86efac", bg: "#f0fdf4", label: "#166534", value: "#166534", emoji: "💵" };
    if (key === "bkash" || key.includes("bkash")) return { border: "#f9a8d4", bg: "#fdf2f8", label: "#9d174d", value: "#9d174d", emoji: "📱" };
    if (key === "nagad" || key.includes("nagad")) return { border: "#fdba74", bg: "#fff7ed", label: "#9a3412", value: "#9a3412", emoji: "📲" };
    if (key === "rocket" || key.includes("rocket")) return { border: "#bfdbfe", bg: "#eff6ff", label: "#1d4ed8", value: "#1d4ed8", emoji: "🚀" };
    if (key === "card" || key.includes("card")) return { border: "#c7d2fe", bg: "#eef2ff", label: "#4338ca", value: "#4338ca", emoji: "💳" };
    if (key === "wallet" || key.includes("wallet")) return { border: "#ddd6fe", bg: "#f5f3ff", label: "#6d28d9", value: "#6d28d9", emoji: "👛" };
    if (key === "gift" || key.includes("gift")) return { border: "#fecaca", bg: "#fef2f2", label: "#991b1b", value: "#991b1b", emoji: "🎁" };
    return { border: "#cbd5e1", bg: "#f8fafc", label: "#334155", value: "#0f172a", emoji: "📊" };
  };

  const topSellingProducts = useMemo(() => {
    const productMap = new Map();
    for (const sale of recentSales) {
      for (const item of sale.items || []) {
        const key = Number(item.productId);
        if (!productMap.has(key)) {
          productMap.set(key, { productId: key, qty: 0, amount: 0 });
        }
        const row = productMap.get(key);
        row.qty += Number(item.qty || 0);
        row.amount += Number(item.qty || 0) * Number(item.price || 0);
      }
    }
    const nameByProduct = new Map(
      (stockValuation.rows || []).map((row) => [Number(row.productId || row.id), row.name])
    );
    return [...productMap.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
      .map((row) => ({
        ...row,
        name:
          nameByProduct.get(row.productId) ||
          t(uiLang, "dashProductLabel", { n: localizeDigits(String(row.productId)) }),
      }));
  }, [recentSales, stockValuation.rows, uiLang, lang]);

  const grossMarginApprox = Number(data.sales || 0) - Number(data.purchase || 0);
  const avgBill = settlement.billCount > 0 ? Number(settlement.totalPaid || 0) / settlement.billCount : 0;
  const collectionRate =
    Number(settlement.totalPaid || 0) + Number(settlement.totalDue || 0) > 0
      ? (Number(settlement.totalPaid || 0) /
          (Number(settlement.totalPaid || 0) + Number(settlement.totalDue || 0))) *
        100
      : 0;
  const quoteTotalFollowUps =
    Number(quoteReminders.overdue || 0) +
    Number(quoteReminders.today || 0) +
    Number(quoteReminders.tomorrow || 0) +
    Number(quoteReminders.upcoming || 0);
  const customerReceivable = (aging.customers || []).reduce((s, x) => s + Number(x.balance || 0), 0);
  const supplierPayable = (aging.suppliers || []).reduce((s, x) => s + Number(x.payableBalance || 0), 0);

  const hqAccent = (i) => {
    const accents = ["dashboard-hq-card--a0", "dashboard-hq-card--a1", "dashboard-hq-card--a2", "dashboard-hq-card--a3"];
    return accents[i % accents.length];
  };

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero-orbit" aria-hidden />
        <div className="dashboard-hero-inner">
          <div className="dashboard-hero-text">
            <p className="dashboard-hero-kicker">
              <span className="dashboard-hero-branch">{tt("branchPill", { n: localizeDigits(branchId) })}</span>
              {loading ? <span className="dashboard-hero-sync"> · {tt("dashUpdating")}</span> : null}
            </p>
            <h1 className="dashboard-hero-title">{greeting}</h1>
            <p className="dashboard-hero-date">{todayLabel}</p>
            <p className="dashboard-hero-tagline">{tt("dashHeroTagline")}</p>
          </div>
          <div className="dashboard-hero-side">
            <div className="dashboard-collection-ring-wrap" title={tt("dashCollectionRingTitle")}>
              <div
                className="dashboard-collection-ring"
                style={{ "--dash-collection-pct": `${Math.min(100, Math.max(0, collectionRate))}` }}
              />
              <div className="dashboard-collection-ring-label">
                <span className="dashboard-collection-ring-value">{localizeDigits(collectionRate.toFixed(0))}%</span>
                <span className="dashboard-collection-ring-caption">{tt("dashCollected")}</span>
              </div>
            </div>
            <button type="button" className="btn-secondary dashboard-hero-refresh" onClick={() => load()} disabled={loading}>
              {loading ? tt("dashRefreshing") : tt("dashRefresh")}
            </button>
          </div>
        </div>

        {quickActions.length ? (
          <div className="dashboard-quick-actions" role="navigation" aria-label={tt("dashNavQuick")}>
            {quickActions.map((a) => (
              <button key={a.view} type="button" className="dashboard-quick-action" onClick={() => navigate(a.view)}>
                <span className="dashboard-quick-action-icon" aria-hidden>
                  {a.icon}
                </span>
                <span className="dashboard-quick-action-text">
                  <span className="dashboard-quick-action-label">{a.label}</span>
                  <span className="dashboard-quick-action-hint">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {hqBranchSummary?.branches?.length ? (
        <div className="dashboard-hq">
          <div className="dashboard-section-head">
            <h2 className="dashboard-section-title">{tt("dashHqTitle")}</h2>
            <p className="dashboard-section-sub">{tt("dashHqSub")}</p>
          </div>
          <div className="dashboard-hq-grid">
            {hqBranchSummary.branches.map((b, i) => (
              <div key={b.branchId} className={`dashboard-hq-card ${hqAccent(i)}`}>
                <div className="dashboard-hq-card-head">
                  <span className="dashboard-hq-name">{b.name}</span>
                  <span className="dashboard-hq-code">
                    {b.code} · #{b.branchId}
                  </span>
                </div>
                <div className="dashboard-hq-stats">
                  <div>
                    <span className="dashboard-hq-stat-label">{tt("dashSalesShort")}</span>
                    <span className="dashboard-hq-stat-value">{fmt(b.salesToday)}</span>
                  </div>
                  <div>
                    <span className="dashboard-hq-stat-label">{tt("dashCollectionsShort")}</span>
                    <span className="dashboard-hq-stat-value">{fmt(b.collectionsToday)}</span>
                  </div>
                  <div>
                    <span className="dashboard-hq-stat-label">{tt("dashBillsShort")}</span>
                    <span className="dashboard-hq-stat-value">{fmtCount(b.saleCountToday)}</span>
                  </div>
                  <div>
                    <span className="dashboard-hq-stat-label">{tt("dashPurchShort")}</span>
                    <span className="dashboard-hq-stat-value">{fmt(b.purchasesToday)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dashboard-metrics">
        <article className="dashboard-metric dashboard-metric--sales">
          <div className="dashboard-metric-icon" aria-hidden>
            💵
          </div>
          <div className="dashboard-metric-body">
            <div className="dashboard-metric-label">{tt("dashMetricSales")}</div>
            <div className="dashboard-metric-value">{fmt(data.sales)}</div>
            {renderTrend(trends.sales, { isCurrency: true })}
          </div>
        </article>
        <article className="dashboard-metric dashboard-metric--collections">
          <div className="dashboard-metric-icon" aria-hidden>
            📥
          </div>
          <div className="dashboard-metric-body">
            <div className="dashboard-metric-label">{tt("dashMetricCollections")}</div>
            <div className="dashboard-metric-value">{fmt(data.collections)}</div>
            {renderTrend(trends.collections, { isCurrency: true })}
          </div>
        </article>
        <article className="dashboard-metric dashboard-metric--purchase">
          <div className="dashboard-metric-icon" aria-hidden>
            🧾
          </div>
          <div className="dashboard-metric-body">
            <div className="dashboard-metric-label">{tt("dashMetricPurchase")}</div>
            <div className="dashboard-metric-value">{fmt(data.purchase)}</div>
            {renderTrend(trends.purchase, { invert: true, isCurrency: true })}
          </div>
        </article>
        <article className="dashboard-metric dashboard-metric--stock">
          <div className="dashboard-metric-icon" aria-hidden>
            ⚠️
          </div>
          <div className="dashboard-metric-body">
            <div className="dashboard-metric-label">{tt("dashMetricLowStock")}</div>
            <div className="dashboard-metric-value">{lowStock.summary?.lowStock || data.stockAlerts || 0}</div>
            {renderTrend(trends.lowStock, { invert: true, isCurrency: false })}
          </div>
        </article>
      </div>

      <div className="dashboard-pills">
        <div className="dashboard-pill">
          <span className="dashboard-pill-label">{tt("dashPillBills")}</span>
          <span className="dashboard-pill-value">{fmtCount(settlement.billCount || 0)}</span>
        </div>
        <div className="dashboard-pill">
          <span className="dashboard-pill-label">{tt("dashPillAvgBill")}</span>
          <span className="dashboard-pill-value">{fmt(avgBill)}</span>
        </div>
        <div className="dashboard-pill dashboard-pill--accent">
          <span className="dashboard-pill-label">{tt("dashPillStockValue")}</span>
          <span className="dashboard-pill-value">{fmt(stockValuation.totalValue || 0)}</span>
        </div>
      </div>

      <div className="dashboard-insight-grid">
        <article className="dashboard-insight dashboard-insight--followups">
          <div className="dashboard-insight-head">
            <span className="dashboard-insight-emoji" aria-hidden>
              📋
            </span>
            <h3 className="dashboard-insight-title">{tt("dashFollowUps")}</h3>
          </div>
          <ul className="dashboard-insight-list">
            <li>
              <strong>{fmtCount(quoteTotalFollowUps)}</strong> {tt("dashTotal")}
            </li>
            <li>
              {tt("dashOverdue")} · <strong>{fmtCount(quoteReminders.overdue || 0)}</strong>
            </li>
            <li>
              {tt("dashToday")} · <strong>{fmtCount(quoteReminders.today || 0)}</strong>
            </li>
            <li>
              {tt("dashTomorrow")} · <strong>{fmtCount(quoteReminders.tomorrow || 0)}</strong>
            </li>
          </ul>
          <div className="dashboard-insight-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("OVERDUE")}>
              {tt("dashOverdue")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TODAY")}>
              {tt("dashToday")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TOMORROW")}>
              {tt("dashTomorrow")}
            </button>
          </div>
        </article>

        <article className="dashboard-insight dashboard-insight--cashflow">
          <div className="dashboard-insight-head">
            <span className="dashboard-insight-emoji" aria-hidden>
              💹
            </span>
            <h3 className="dashboard-insight-title">{tt("dashCashflow")}</h3>
          </div>
          <ul className="dashboard-insight-list dashboard-insight-list--compact">
            <li>
              <span>{tt("dashPaid")}</span> <strong>{fmt(settlement.totalPaid || 0)}</strong>
            </li>
            <li>
              <span>{tt("dashDue")}</span> <strong>{fmt(settlement.totalDue || 0)}</strong>
            </li>
            <li>
              <span>{tt("dashReceivable")}</span> <strong>{fmt(customerReceivable)}</strong>
            </li>
            <li>
              <span>{tt("dashPayable")}</span> <strong>{fmt(supplierPayable)}</strong>
            </li>
            <li className="dashboard-insight-highlight">
              <span>{tt("dashGap")}</span> <strong>{fmt(customerReceivable - supplierPayable)}</strong>
            </li>
          </ul>
        </article>

        <article className="dashboard-insight dashboard-insight--health">
          <div className="dashboard-insight-head">
            <span className="dashboard-insight-emoji" aria-hidden>
              📊
            </span>
            <h3 className="dashboard-insight-title">{tt("dashHealth")}</h3>
          </div>
          <ul className="dashboard-insight-list dashboard-insight-list--compact">
            <li>
              <span>{tt("dashGrossMarginApprox")}</span>
              <strong>{fmt(grossMarginApprox)}</strong>
            </li>
            <li>
              <span>{tt("dashRecentSalesLoaded")}</span>
              <strong>{fmtCount(recentSales.length)}</strong>
            </li>
          </ul>
        </article>
      </div>

      <section className="dashboard-pay-section">
        <div className="dashboard-section-head">
          <h2 className="dashboard-section-title">{tt("dashPaymentMethods")}</h2>
          <p className="dashboard-section-sub">{tt("dashPaymentMethodsSub")}</p>
        </div>
        {methodTotals.length ? (
          <div className="dashboard-pay-grid">
            {methodTotals.map((m) => {
              const cardTheme = paymentCardTheme(m.methodKey);
              return (
                <div
                  key={m.methodKey}
                  className="dashboard-pay-tile"
                  style={{
                    borderColor: cardTheme.border,
                    background: cardTheme.bg,
                  }}
                >
                  <span className="dashboard-pay-tile-emoji" aria-hidden>
                    {cardTheme.emoji}
                  </span>
                  <div className="dashboard-pay-tile-meta">
                    <span className="dashboard-pay-tile-label" style={{ color: cardTheme.label }}>
                      {m.label}
                    </span>
                    <span className="dashboard-pay-tile-value" style={{ color: cardTheme.value }}>
                      {fmt(m.amount || 0)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="dashboard-pay-tile dashboard-pay-tile--wallet" style={{ borderColor: "#fdba74", background: "#fff7ed" }}>
              <span className="dashboard-pay-tile-emoji" aria-hidden>
                ↘️
              </span>
              <div className="dashboard-pay-tile-meta">
                <span className="dashboard-pay-tile-label" style={{ color: "#9a3412" }}>{tt("dashWalletCashOut")}</span>
                <span className="dashboard-pay-tile-value" style={{ color: "#9a3412" }}>
                  {fmt(settlement.walletFlow?.cashOut || 0)}
                </span>
              </div>
            </div>
            <div className="dashboard-pay-tile dashboard-pay-tile--wallet" style={{ borderColor: "#86efac", background: "#f0fdf4" }}>
              <span className="dashboard-pay-tile-emoji" aria-hidden>
                ↗️
              </span>
              <div className="dashboard-pay-tile-meta">
                <span className="dashboard-pay-tile-label" style={{ color: "#166534" }}>{tt("dashWalletCashIn")}</span>
                <span className="dashboard-pay-tile-value" style={{ color: "#166534" }}>
                  {fmt(settlement.walletFlow?.cashIn || 0)}
                </span>
              </div>
            </div>
            <div className="dashboard-pay-tile dashboard-pay-tile--wallet" style={{ borderColor: "#c7d2fe", background: "#eef2ff" }}>
              <span className="dashboard-pay-tile-emoji" aria-hidden>
                ⚖️
              </span>
              <div className="dashboard-pay-tile-meta">
                <span className="dashboard-pay-tile-label" style={{ color: "#3730a3" }}>{tt("dashWalletNet")}</span>
                <span className="dashboard-pay-tile-value" style={{ color: "#3730a3" }}>
                  {fmt(settlement.walletFlow?.net || 0)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted">{tt("dashNoMethodData")}</p>
        )}
      </section>

      <details className="dashboard-details">
        <summary>{tt("dashMoreDetail")}</summary>
        <div className="dashboard-details-grid">
          <div className="dashboard-detail-card">
            <h4>{tt("dashTopProducts")}</h4>
            {topSellingProducts.length ? (
              <ul className="dashboard-detail-list">
                {topSellingProducts.map((x) => (
                  <li key={x.productId}>
                    <span className="dashboard-detail-name">{x.name}</span>
                    <span className="dashboard-detail-meta">
                      ×{Number(x.qty || 0)} · {fmt(x.amount || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{tt("dashNoRecentProduct")}</p>
            )}
          </div>
          <div className="dashboard-detail-card">
            <h4>{tt("dashLowStockCard")}</h4>
            {(lowStock.rows || []).slice(0, 8).length ? (
              <ul className="dashboard-detail-list">
                {(lowStock.rows || []).slice(0, 8).map((x) => (
                  <li key={String(x.id)}>
                    <span className="dashboard-detail-name">
                      {x.name}
                      {x.kind === "VARIANT" ? (
                        <small className="dashboard-detail-tag">{tt("dashVariantTag")}</small>
                      ) : null}
                      {x.kind === "WEIGHT" ? <small className="dashboard-detail-tag">{tt("dashKgTag")}</small> : null}
                    </span>
                    <span className="dashboard-detail-meta">
                      {x.stockDisplay != null ? x.stockDisplay : x.stock} / {x.reorderLevel} · {tt("dashShortQty")}{" "}
                      {Number(x.shortageQty || 0).toFixed(x.kind === "WEIGHT" ? 3 : 0)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{tt("dashNoAlerts")}</p>
            )}
          </div>
          <div className="dashboard-detail-card">
            <h4>{tt("dashRecentSales")}</h4>
            {recentSales.slice(0, 6).length ? (
              <ul className="dashboard-detail-list">
                {recentSales.slice(0, 6).map((sale) => (
                  <li key={sale.id}>
                    <span className="dashboard-detail-name">{sale.invoiceNo || tt("dashSaleNum", { n: localizeDigits(String(sale.id)) })}</span>
                    <span className="dashboard-detail-meta">
                      {fmt(sale.total)} · {tt("dashDueInline")} {fmt(sale.dueAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{tt("dashNoRecentSales")}</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

export default Dashboard;
