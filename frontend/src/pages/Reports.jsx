import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function Reports() {
  const [aging, setAging] = useState({ customers: [], suppliers: [] });
  const [stockValuation, setStockValuation] = useState({ totalValue: 0, rows: [] });
  const [settlementRange, setSettlementRange] = useState({ from: "", to: "" });
  const [settlement, setSettlement] = useState({
    from: null,
    to: null,
    billCount: 0,
    totalPaid: 0,
    totalDue: 0,
    methods: [],
    channels: [],
    days: [],
  });
  const [loyaltyRedemptions, setLoyaltyRedemptions] = useState({
    rows: [],
    summary: { redeemedPoints: 0, redeemedAmount: 0, tierDiscountAmount: 0, count: 0 },
  });

  useEffect(() => {
    const load = async () => {
      const settlementQuery = new URLSearchParams();
      if (settlementRange.from) settlementQuery.set("from", settlementRange.from);
      if (settlementRange.to) settlementQuery.set("to", settlementRange.to);
      const settlementUrl = settlementQuery.toString()
        ? `/sales/summary/settlement-today?${settlementQuery.toString()}`
        : "/sales/summary/settlement-today";
      const loyaltyUrl = settlementQuery.toString()
        ? `/sales/loyalty/redemptions?${settlementQuery.toString()}`
        : "/sales/loyalty/redemptions";
      const [agingRes, stockRes, settlementRes, loyaltyRes] = await Promise.all([
        api.get("/reports/aging"),
        api.get("/reports/stock-valuation"),
        api.get(settlementUrl),
        api.get(loyaltyUrl),
      ]);
      setAging(agingRes.data);
      setStockValuation(stockRes.data);
      setSettlement(settlementRes.data);
      setLoyaltyRedemptions(loyaltyRes.data);
    };
    load();
  }, [settlementRange.from, settlementRange.to]);

  const exportCSV = async (url, filename) => {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const exportSettlement = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      methodCsv: ["/sales/summary/settlement-today/export-method.csv", "today-settlement-by-method.csv"],
      channelCsv: ["/sales/summary/settlement-today/export-channel.csv", "today-settlement-by-channel.csv"],
      methodPdf: ["/sales/summary/settlement-today/export-method.pdf", "today-settlement-by-method.pdf"],
      channelPdf: ["/sales/summary/settlement-today/export-channel.pdf", "today-settlement-by-channel.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportLoyaltyRedemption = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/sales/loyalty/redemptions/export.csv", "loyalty-redemption-history.csv"],
      pdf: ["/sales/loyalty/redemptions/export.pdf", "loyalty-redemption-history.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const setSettlementPresetRange = (preset) => {
    const now = new Date();
    if (preset === "today") {
      const today = toInputDate(now);
      setSettlementRange({ from: today, to: today });
      return;
    }
    if (preset === "last7") {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      setSettlementRange({ from: toInputDate(from), to: toInputDate(now) });
      return;
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setSettlementRange({ from: toInputDate(start), to: toInputDate(now) });
      return;
    }
    setSettlementRange({ from: "", to: "" });
  };

  return (
    <div>
      <h2>Reports Center</h2>
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
        <button onClick={() => exportCSV("/reports/aging/export.csv", "aging-report.csv")}>
          Export Aging CSV
        </button>
        <button onClick={() => exportCSV("/reports/stock-valuation/export.csv", "stock-valuation.csv")}>
          Export Stock CSV
        </button>
        <button onClick={() => exportCSV("/reports/aging/export.pdf", "aging-report.pdf")}>
          Export Aging PDF
        </button>
        <button onClick={() => exportCSV("/reports/stock-valuation/export.pdf", "stock-valuation.pdf")}>
          Export Stock PDF
        </button>
        <button onClick={() => exportSettlement("methodCsv")}>
          Export Settlement Method CSV
        </button>
        <button onClick={() => exportSettlement("channelCsv")}>
          Export Settlement Channel CSV
        </button>
        <button onClick={() => exportSettlement("methodPdf")}>
          Export Settlement Method PDF
        </button>
        <button onClick={() => exportSettlement("channelPdf")}>
          Export Settlement Channel PDF
        </button>
        <button onClick={() => exportLoyaltyRedemption("csv")}>
          Export Loyalty Redemption CSV
        </button>
        <button onClick={() => exportLoyaltyRedemption("pdf")}>
          Export Loyalty Redemption PDF
        </button>
      </div>
      <div className="form-grid" style={{ marginBottom: "12px" }}>
        <input
          type="date"
          value={settlementRange.from}
          onChange={(e) => setSettlementRange((prev) => ({ ...prev, from: e.target.value }))}
        />
        <input
          type="date"
          value={settlementRange.to}
          onChange={(e) => setSettlementRange((prev) => ({ ...prev, to: e.target.value }))}
        />
        <button type="button" className="btn-secondary" onClick={() => setSettlementRange({ from: "", to: "" })}>
          Clear Date Filter
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("today")}>
          Today
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("last7")}>
          Last 7 Days
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("month")}>
          This Month
        </button>
      </div>
      <DataTable
        title="Today Payment Settlement (By Method)"
        rows={settlement.methods.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["method"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "method", label: "Payment Method" },
          { key: "amount", label: "Collected", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title="Today Payment Settlement (By Channel/Ref)"
        rows={settlement.channels.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["channel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "channel", label: "Channel" },
          { key: "amount", label: "Collected", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title="Settlement Paid Trend (By Date)"
        rows={settlement.days.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["date"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "date", label: "Date" },
          { key: "paid", label: "Paid", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Bills: {settlement.billCount}</div>
        <div className="stat">Paid: ৳{Number(settlement.totalPaid || 0).toFixed(2)}</div>
        <div className="stat">Due: ৳{Number(settlement.totalDue || 0).toFixed(2)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Loyalty Entries: {Number(loyaltyRedemptions.summary?.count || 0)}</div>
        <div className="stat">Redeemed Points: {Number(loyaltyRedemptions.summary?.redeemedPoints || 0).toFixed(0)}</div>
        <div className="stat">Redeemed Amount: ৳{Number(loyaltyRedemptions.summary?.redeemedAmount || 0).toFixed(2)}</div>
        <div className="stat">Tier Discount: ৳{Number(loyaltyRedemptions.summary?.tierDiscountAmount || 0).toFixed(2)}</div>
      </div>
      <DataTable
        title="Loyalty Redemption & Tier Discount History"
        rows={(loyaltyRedemptions.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          createdAtLabel: new Date(row.createdAt).toLocaleString(),
        }))}
        searchableKeys={["invoiceNo", "customerName", "customerPhone", "tier", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "customerName", label: "Customer" },
          { key: "customerPhone", label: "Phone" },
          { key: "tier", label: "Tier" },
          { key: "redeemedPoints", label: "Redeemed Points" },
          { key: "redeemedAmount", label: "Redeemed Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "tierDiscountAmount", label: "Tier Discount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "createdAtLabel", label: "Date" },
        ]}
      />
      <DataTable
        title="Customer Due Aging"
        rows={aging.customers.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name", "phone"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "balance", label: "Due", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title="Supplier Payable Aging"
        rows={aging.suppliers.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name", "phone"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "payableBalance", label: "Payable", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <h4 style={{ marginTop: "12px" }}>Stock Valuation</h4>
      <div>Total Value: ৳{Number(stockValuation.totalValue || 0).toFixed(2)}</div>
      <DataTable
        rows={stockValuation.rows.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Product" },
          { key: "stock", label: "Stock" },
          { key: "unitCost", label: "Unit Cost", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "valuation", label: "Valuation", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
    </div>
  );
}

export default Reports;
