import { useEffect, useState } from "react";
import api from "../services/api";

function Dashboard() {
  const [data, setData] = useState({ sales: 0, collections: 0, purchase: 0, stockAlerts: 0 });
  const [quoteReminders, setQuoteReminders] = useState({ overdue: 0, today: 0, tomorrow: 0, upcoming: 0 });

  useEffect(() => {
    const load = async () => {
      const [dashboardRes, quoteRemindersRes] = await Promise.all([
        api.get("/reports/dashboard"),
        api.get("/sales/quotes/reminders/summary"),
      ]);
      setData(dashboardRes.data);
      setQuoteReminders(quoteRemindersRes.data || { overdue: 0, today: 0, tomorrow: 0, upcoming: 0 });
    };
    load();
  }, []);

  const fmt = (n) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
  const openQuoteReminders = (filter) => {
    localStorage.setItem("bd_pos_quote_reminder_filter", String(filter || "OVERDUE"));
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "quotations" } }));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Branch Dashboard</div>
          <div className="page-subtitle">Live branch business snapshot</div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-icon">💵</div>
          <div className="metric-label">Sales Today</div>
          <div className="metric-value">{fmt(data.sales)}</div>
        </div>
        <div className="metric success">
          <div className="metric-icon">📥</div>
          <div className="metric-label">Collections</div>
          <div className="metric-value">{fmt(data.collections)}</div>
        </div>
        <div className="metric">
          <div className="metric-icon">🧾</div>
          <div className="metric-label">Purchases</div>
          <div className="metric-value">{fmt(data.purchase)}</div>
        </div>
        <div className="metric warning">
          <div className="metric-icon">⚠️</div>
          <div className="metric-label">Low Stock</div>
          <div className="metric-value">{data.stockAlerts || 0}</div>
        </div>
        <div className="metric warning">
          <div className="metric-icon">📌</div>
          <div className="metric-label">Quote Follow-up Overdue</div>
          <div className="metric-value">{Number(quoteReminders.overdue || 0)}</div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("OVERDUE")}>
            Open Quotes
          </button>
        </div>
        <div className="metric">
          <div className="metric-icon">📅</div>
          <div className="metric-label">Quote Follow-up Today</div>
          <div className="metric-value">{Number(quoteReminders.today || 0)}</div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TODAY")}>
            Open Quotes
          </button>
        </div>
        <div className="metric">
          <div className="metric-icon">🗓️</div>
          <div className="metric-label">Quote Follow-up Tomorrow</div>
          <div className="metric-value">{Number(quoteReminders.tomorrow || 0)}</div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openQuoteReminders("TOMORROW")}>
            Open Quotes
          </button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
