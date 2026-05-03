import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";

function Dashboard() {
  const [data, setData] = useState({ sales: 0, collections: 0, purchase: 0, stockAlerts: 0 });
  const [trends, setTrends] = useState({
    sales: { diff: 0, pct: 0 },
    collections: { diff: 0, pct: 0 },
    purchase: { diff: 0, pct: 0 },
    lowStock: { diff: 0, pct: 0 },
  });
  const [quoteReminders, setQuoteReminders] = useState({ overdue: 0, today: 0, tomorrow: 0, upcoming: 0 });
  const [settlement, setSettlement] = useState({ billCount: 0, totalPaid: 0, totalDue: 0, methods: [] });
  const [aging, setAging] = useState({ customers: [], suppliers: [] });
  const [stockValuation, setStockValuation] = useState({ totalValue: 0, rows: [] });
  const [lowStock, setLowStock] = useState({ rows: [], summary: { totalTracked: 0, outOfStock: 0, lowStock: 0 } });
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        dashboardRes,
        trendRes,
        quoteRemindersRes,
        settlementRes,
        agingRes,
        stockRes,
        lowStockRes,
        recentSalesRes,
      ] = await Promise.all([
        api.get("/reports/dashboard"),
        api.get("/reports/dashboard/trends"),
        api.get("/sales/quotes/reminders/summary"),
        api.get("/sales/summary/settlement-today"),
        api.get("/reports/aging"),
        api.get("/reports/stock-valuation"),
        api.get("/inventory/alerts/low-stock?onlyCritical=true"),
        api.get("/sales/recent"),
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
      setSettlement(settlementRes.data || { billCount: 0, totalPaid: 0, totalDue: 0, methods: [] });
      setAging(agingRes.data || { customers: [], suppliers: [] });
      setStockValuation(stockRes.data || { totalValue: 0, rows: [] });
      setLowStock(
        lowStockRes.data || { rows: [], summary: { totalTracked: 0, outOfStock: 0, lowStock: 0 } }
      );
      setRecentSales((recentSalesRes.data || []).slice(0, 8));
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

  const fmt = (n) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
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
    const color = isFlat ? "#64748b" : isGood ? "#15803d" : "#b91c1c";
    const deltaLabel = isCurrency
      ? `${diff >= 0 ? "+" : "-"}${fmt(Math.abs(diff))}`
      : `${diff >= 0 ? "+" : "-"}${Math.abs(diff).toFixed(0)}`;
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color }} title={`Delta: ${deltaLabel}`}>
        {arrow} {Math.abs(pct).toFixed(1)}% vs yesterday
      </span>
    );
  };
  const topMethods = useMemo(
    () => [...(settlement.methods || [])].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 3),
    [settlement.methods]
  );
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
        name: nameByProduct.get(row.productId) || `Product #${row.productId}`,
      }));
  }, [recentSales, stockValuation.rows]);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Branch Dashboard</div>
          <div className="page-subtitle">Step-by-step business overview</div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-icon">💵</div>
          <div className="metric-label">Sales Today</div>
          <div className="metric-value">{fmt(data.sales)}</div>
          {renderTrend(trends.sales, { isCurrency: true })}
        </div>
        <div className="metric success">
          <div className="metric-icon">📥</div>
          <div className="metric-label">Collections</div>
          <div className="metric-value">{fmt(data.collections)}</div>
          {renderTrend(trends.collections, { isCurrency: true })}
        </div>
        <div className="metric">
          <div className="metric-icon">🧾</div>
          <div className="metric-label">Purchases</div>
          <div className="metric-value">{fmt(data.purchase)}</div>
          {renderTrend(trends.purchase, { invert: true, isCurrency: true })}
        </div>
        <div className="metric warning">
          <div className="metric-icon">⚠️</div>
          <div className="metric-label">Low Stock Items</div>
          <div className="metric-value">{lowStock.summary?.lowStock || data.stockAlerts || 0}</div>
          {renderTrend(trends.lowStock, { invert: true, isCurrency: false })}
        </div>
      </div>

      <div className="quick-stats" style={{ marginBottom: 12 }}>
        <div className="stat">Bills Today: {Number(settlement.billCount || 0)}</div>
        <div className="stat">Avg Bill: {fmt(avgBill)}</div>
        <div className="stat">Collection Rate: {collectionRate.toFixed(1)}%</div>
      </div>

      <div className="form-grid">
        <div className="page-card">
          <h4 style={{ marginBottom: 8 }}>Today’s Follow-ups</h4>
          <p><strong>Total follow-ups:</strong> {quoteTotalFollowUps}</p>
          <p><strong>Overdue:</strong> {Number(quoteReminders.overdue || 0)}</p>
          <p><strong>Today:</strong> {Number(quoteReminders.today || 0)}</p>
          <p><strong>Tomorrow:</strong> {Number(quoteReminders.tomorrow || 0)}</p>
          <div className="pos-action-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("OVERDUE")}>
              Open Overdue
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TODAY")}>
              Open Today
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TOMORROW")}>
              Open Tomorrow
            </button>
          </div>
        </div>

        <div className="page-card">
          <h4 style={{ marginBottom: 8 }}>Cashflow Snapshot</h4>
          <p><strong>Today Paid:</strong> {fmt(settlement.totalPaid || 0)}</p>
          <p><strong>Today Due:</strong> {fmt(settlement.totalDue || 0)}</p>
          <p><strong>Customer Receivable:</strong> {fmt(customerReceivable)}</p>
          <p><strong>Supplier Payable:</strong> {fmt(supplierPayable)}</p>
          <p><strong>Outstanding Gap:</strong> {fmt(customerReceivable - supplierPayable)}</p>
        </div>

        <div className="page-card">
          <h4 style={{ marginBottom: 8 }}>Business Health</h4>
          <p><strong>Stock Value:</strong> {fmt(stockValuation.totalValue || 0)}</p>
          <p><strong>Gross Margin (approx):</strong> {fmt(grossMarginApprox)}</p>
          <p><strong>Recent Sales Loaded:</strong> {recentSales.length}</p>
        </div>
      </div>

      <details className="page-card" style={{ padding: 0 }}>
        <summary style={{ padding: 14, cursor: "pointer", fontWeight: 600 }}>
          Operational Details (expand)
        </summary>
        <div className="form-grid" style={{ margin: 0, border: "none", boxShadow: "none", background: "transparent" }}>
          <div className="page-card">
            <h4 style={{ marginBottom: 8 }}>Top Payment Methods</h4>
            {topMethods.length ? (
              topMethods.map((m) => (
                <p key={m.method}>
                  <strong>{m.method}:</strong> {fmt(m.amount || 0)}
                </p>
              ))
            ) : (
              <p className="text-muted">No method data yet.</p>
            )}
          </div>
          <div className="page-card">
            <h4 style={{ marginBottom: 8 }}>Top Products (Recent)</h4>
            {topSellingProducts.length ? (
              topSellingProducts.map((x) => (
                <p key={x.productId}>
                  <strong>{x.name}</strong> · Qty {Number(x.qty || 0)} · {fmt(x.amount || 0)}
                </p>
              ))
            ) : (
              <p className="text-muted">No recent product activity.</p>
            )}
          </div>
          <div className="page-card">
            <h4 style={{ marginBottom: 8 }}>Low Stock Priorities</h4>
            {(lowStock.rows || []).slice(0, 8).map((x) => (
              <p key={String(x.id)}>
                <strong>{x.name}</strong>
                {x.kind === "VARIANT" ? <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b" }}>[variant]</span> : null}
                {x.kind === "WEIGHT" ? <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b" }}>[kg]</span> : null}
                {" "}
                · Stock {x.stockDisplay != null ? x.stockDisplay : x.stock} / Reorder {x.reorderLevel} · Short{" "}
                {Number(x.shortageQty || 0).toFixed(x.kind === "WEIGHT" ? 3 : 0)}
              </p>
            ))}
            {!lowStock.rows?.length ? <p className="text-muted">No critical stock alerts.</p> : null}
          </div>
          <div className="page-card">
            <h4 style={{ marginBottom: 8 }}>Recent Sales</h4>
            {recentSales.slice(0, 6).map((sale) => (
              <p key={sale.id}>
                <strong>{sale.invoiceNo || `Sale-${sale.id}`}</strong> · {fmt(sale.total)} · Due {fmt(sale.dueAmount)}
              </p>
            ))}
            {!recentSales.length ? <p className="text-muted">No recent sales yet.</p> : null}
          </div>
        </div>
      </details>

      {loading ? <p className="text-muted" style={{ marginTop: 10 }}>Refreshing dashboard...</p> : null}
    </div>
  );
}

export default Dashboard;
