import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { getStoredPermissions, hasPermission } from "../utils/permissions";

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getRiskBand = (score) => {
  const value = Number(score || 0);
  if (value >= 10) return { label: "Critical", color: "#b42318", bg: "#fee4e2" };
  if (value >= 7) return { label: "High", color: "#b54708", bg: "#ffead5" };
  if (value >= 4) return { label: "Medium", color: "#1d4ed8", bg: "#dbeafe" };
  return { label: "Low", color: "#166534", bg: "#dcfce7" };
};

function Reports() {
  const permissions = getStoredPermissions();
  const canExportAdvanced = hasPermission("accounting.report", permissions);
  const [aging, setAging] = useState({ customers: [], suppliers: [] });
  const [stockValuation, setStockValuation] = useState({ totalValue: 0, rows: [] });
  const [settlementRange, setSettlementRange] = useState({ from: "", to: "" });
  const [settlement, setSettlement] = useState({
    from: null,
    to: null,
    billCount: 0,
    totalPaid: 0,
    totalDue: 0,
    digitalCollectionTotal: 0,
    digitalMissingRefCount: 0,
    methods: [],
    channels: [],
    digitalRefs: [],
    days: [],
  });
  const [loyaltyRedemptions, setLoyaltyRedemptions] = useState({
    rows: [],
    summary: { redeemedPoints: 0, redeemedAmount: 0, tierDiscountAmount: 0, count: 0 },
  });
  const [vatSummary, setVatSummary] = useState({
    from: null,
    to: null,
    salesCount: 0,
    zeroVatSales: 0,
    taxableSales: 0,
    outputVat: 0,
    grossSales: 0,
    inputVatTracked: 0,
    netVatPayable: 0,
    note: "",
  });
  const [vatSalesRegister, setVatSalesRegister] = useState([]);
  const [shrinkageControl, setShrinkageControl] = useState({
    totals: { totalCashiers: 0, totalSales: 0, totalDiscount: 0, totalReturns: 0, totalOverrides: 0 },
    summaryRows: [],
    eventRows: [],
  });
  const [shrinkageThresholds, setShrinkageThresholds] = useState({
    discountAlertMin: 200,
    returnAlertMin: 200,
    criticalAmount: 1000,
  });
  const [staffKpi, setStaffKpi] = useState({
    summary: { staffCount: 0, totalSales: 0, totalInvoices: 0 },
    rows: [],
  });
  const [auditActivity, setAuditActivity] = useState({
    count: 0,
    rows: [],
  });
  const [reportsTab, setReportsTab] = useState("overview");

  useEffect(() => {
    const load = async () => {
      const settlementQuery = new URLSearchParams();
      if (settlementRange.from) settlementQuery.set("from", settlementRange.from);
      if (settlementRange.to) settlementQuery.set("to", settlementRange.to);
      settlementQuery.set("discountAlertMin", String(shrinkageThresholds.discountAlertMin || 0));
      settlementQuery.set("returnAlertMin", String(shrinkageThresholds.returnAlertMin || 0));
      settlementQuery.set("criticalAmount", String(shrinkageThresholds.criticalAmount || 0));
      const settlementUrl = settlementQuery.toString()
        ? `/sales/summary/settlement-today?${settlementQuery.toString()}`
        : "/sales/summary/settlement-today";
      const loyaltyUrl = settlementQuery.toString()
        ? `/sales/loyalty/redemptions?${settlementQuery.toString()}`
        : "/sales/loyalty/redemptions";
      const [agingRes, stockRes, settlementRes, loyaltyRes, vatSummaryRes, vatRegisterRes, shrinkageRes, staffKpiRes, auditTrailRes] =
        await Promise.all([
        api.get("/reports/aging"),
        api.get("/reports/stock-valuation"),
        api.get(settlementUrl),
        api.get(loyaltyUrl),
        api.get(`/reports/vat/summary${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/vat/sales-register${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/shrinkage-control${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/staff-kpi${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/audit-activity${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
      ]);
      setAging(agingRes.data);
      setStockValuation(stockRes.data);
      setSettlement(settlementRes.data);
      setLoyaltyRedemptions(loyaltyRes.data);
      setVatSummary(vatSummaryRes.data || {});
      setVatSalesRegister(vatRegisterRes.data || []);
      setShrinkageControl(
        shrinkageRes.data || {
          totals: { totalCashiers: 0, totalSales: 0, totalDiscount: 0, totalReturns: 0, totalOverrides: 0 },
          summaryRows: [],
          eventRows: [],
        }
      );
      setStaffKpi(staffKpiRes.data || { summary: { staffCount: 0, totalSales: 0, totalInvoices: 0 }, rows: [] });
      setAuditActivity(auditTrailRes.data || { count: 0, rows: [] });
    };
    load();
  }, [
    settlementRange.from,
    settlementRange.to,
    shrinkageThresholds.discountAlertMin,
    shrinkageThresholds.returnAlertMin,
    shrinkageThresholds.criticalAmount,
  ]);

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

  const exportVatSalesRegister = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/vat/sales-register/export.csv", "vat-sales-register.csv"],
      pdf: ["/reports/vat/sales-register/export.pdf", "vat-sales-register.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportShrinkageControl = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    query.set("discountAlertMin", String(shrinkageThresholds.discountAlertMin || 0));
    query.set("returnAlertMin", String(shrinkageThresholds.returnAlertMin || 0));
    query.set("criticalAmount", String(shrinkageThresholds.criticalAmount || 0));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/shrinkage-control/export.csv", "shrinkage-risk-summary.csv"],
      pdf: ["/reports/shrinkage-control/export.pdf", "shrinkage-risk-summary.pdf"],
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
      <div className="page-header">
        <div>
          <div className="page-title">Reports Center</div>
          <div className="page-subtitle">Step-by-step reporting workflow</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label="Reports tabs">
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "overview"}
            className={`pos-tab ${reportsTab === "overview" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("overview")}
          >
            1. Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "tax"}
            className={`pos-tab ${reportsTab === "tax" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("tax")}
          >
            2. VAT & Loyalty
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "risk"}
            className={`pos-tab ${reportsTab === "risk" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("risk")}
          >
            3. Risk Control
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "finance"}
            className={`pos-tab ${reportsTab === "finance" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("finance")}
          >
            4. Aging & Stock
          </button>
        </div>
      </div>
      <details className="page-card" style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced Exports</summary>
        {canExportAdvanced ? (
          <div className="pos-action-row" style={{ marginTop: 10 }}>
            <button onClick={() => exportCSV("/reports/aging/export.csv", "aging-report.csv")}>Aging CSV</button>
            <button onClick={() => exportCSV("/reports/aging/export.pdf", "aging-report.pdf")}>Aging PDF</button>
            <button onClick={() => exportCSV("/reports/stock-valuation/export.csv", "stock-valuation.csv")}>Stock CSV</button>
            <button onClick={() => exportCSV("/reports/stock-valuation/export.pdf", "stock-valuation.pdf")}>Stock PDF</button>
            <button onClick={() => exportSettlement("methodCsv")}>Settlement Method CSV</button>
            <button onClick={() => exportSettlement("channelCsv")}>Settlement Channel CSV</button>
            <button onClick={() => exportSettlement("methodPdf")}>Settlement Method PDF</button>
            <button onClick={() => exportSettlement("channelPdf")}>Settlement Channel PDF</button>
            <button onClick={() => exportLoyaltyRedemption("csv")}>Loyalty CSV</button>
            <button onClick={() => exportLoyaltyRedemption("pdf")}>Loyalty PDF</button>
            <button onClick={() => exportVatSalesRegister("csv")}>VAT Register CSV</button>
            <button onClick={() => exportVatSalesRegister("pdf")}>VAT Register PDF</button>
            <button onClick={() => exportShrinkageControl("csv")}>Shrinkage CSV</button>
            <button onClick={() => exportShrinkageControl("pdf")}>Shrinkage PDF</button>
          </div>
        ) : (
          <div className="text-muted" style={{ marginTop: 10 }}>
            Permission required: <code>accounting.report</code> to export advanced reports.
          </div>
        )}
      </details>
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
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.discountAlertMin}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              discountAlertMin: Number(e.target.value || 0),
            }))
          }
          placeholder="High Discount Threshold"
        />
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.returnAlertMin}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              returnAlertMin: Number(e.target.value || 0),
            }))
          }
          placeholder="High Return Threshold"
        />
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.criticalAmount}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              criticalAmount: Number(e.target.value || 0),
            }))
          }
          placeholder="Critical Amount Threshold"
        />
      </div>
      {reportsTab === "overview" ? (
        <div className="pos-tab-panel">
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
        title="Digital Transaction Reference Usage"
        rows={(settlement.digitalRefs || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["channel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "channel", label: "Transaction Ref" },
          { key: "count", label: "Usage Count" },
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
        <div className="stat">Digital Paid: ৳{Number(settlement.digitalCollectionTotal || 0).toFixed(2)}</div>
        <div className="stat">Missing Digital Refs: {Number(settlement.digitalMissingRefCount || 0)}</div>
      </div>
        </div>
      ) : null}
      {reportsTab === "tax" ? (
        <div className="pos-tab-panel">
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Loyalty Entries: {Number(loyaltyRedemptions.summary?.count || 0)}</div>
        <div className="stat">Redeemed Points: {Number(loyaltyRedemptions.summary?.redeemedPoints || 0).toFixed(0)}</div>
        <div className="stat">Redeemed Amount: ৳{Number(loyaltyRedemptions.summary?.redeemedAmount || 0).toFixed(2)}</div>
        <div className="stat">Tier Discount: ৳{Number(loyaltyRedemptions.summary?.tierDiscountAmount || 0).toFixed(2)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">VAT Sales Count: {Number(vatSummary.salesCount || 0)}</div>
        <div className="stat">Taxable Sales: ৳{Number(vatSummary.taxableSales || 0).toFixed(2)}</div>
        <div className="stat">Output VAT: ৳{Number(vatSummary.outputVat || 0).toFixed(2)}</div>
        <div className="stat">Input VAT Tracked: ৳{Number(vatSummary.inputVatTracked || 0).toFixed(2)}</div>
        <div className="stat">Net VAT Payable: ৳{Number(vatSummary.netVatPayable || 0).toFixed(2)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Cashiers Tracked: {Number(shrinkageControl.totals?.totalCashiers || 0)}</div>
        <div className="stat">Sales in Scope: ৳{Number(shrinkageControl.totals?.totalSales || 0).toFixed(2)}</div>
        <div className="stat">Discount Exposure: ৳{Number(shrinkageControl.totals?.totalDiscount || 0).toFixed(2)}</div>
        <div className="stat">Return Exposure: ৳{Number(shrinkageControl.totals?.totalReturns || 0).toFixed(2)}</div>
        <div className="stat">Override Actions: {Number(shrinkageControl.totals?.totalOverrides || 0)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Staff Tracked: {Number(staffKpi.summary?.staffCount || 0)}</div>
        <div className="stat">Staff Sales: ৳{Number(staffKpi.summary?.totalSales || 0).toFixed(2)}</div>
        <div className="stat">Invoices: {Number(staffKpi.summary?.totalInvoices || 0)}</div>
      </div>
      <div className="page-card" style={{ marginBottom: "12px" }}>
        <strong>Shrinkage Risk Guide:</strong>{" "}
        High discount events are flagged at ৳{Number(shrinkageThresholds.discountAlertMin || 0).toFixed(0)}+, high
        return events at ৳{Number(shrinkageThresholds.returnAlertMin || 0).toFixed(0)}+, and timeline risk becomes
        critical at ৳{Number(shrinkageThresholds.criticalAmount || 0).toFixed(0)}+.
        <br />
        <small>
          Risk score is based on discount count, price overrides, return count, discount %, and return % relative to
          gross sales.
        </small>
      </div>
      {vatSummary.note ? (
        <div className="page-card" style={{ marginBottom: "12px" }}>
          <strong>VAT Note:</strong> {vatSummary.note}
        </div>
      ) : null}
      <DataTable
        title="VAT Sales Register"
        rows={vatSalesRegister.map((row) => ({
          ...row,
          taxableAmountLabel: `৳${Number(row.taxableAmount || 0).toFixed(2)}`,
          vatAmountLabel: `৳${Number(row.vatAmount || 0).toFixed(2)}`,
          grossAmountLabel: `৳${Number(row.grossAmount || 0).toFixed(2)}`,
        }))}
        searchableKeys={["invoiceNo", "date", "customer", "customerPhone"]}
        columns={[
          { key: "serial", label: "SL" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "customerPhone", label: "Phone" },
          { key: "taxableAmountLabel", label: "Taxable Amount" },
          { key: "vatAmountLabel", label: "Output VAT" },
          { key: "grossAmountLabel", label: "Gross Amount" },
        ]}
      />
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
        </div>
      ) : null}
      {reportsTab === "risk" ? (
        <div className="pos-tab-panel">
      <DataTable
        title="Shrinkage Risk Summary (By Cashier)"
        rows={(shrinkageControl.summaryRows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          grossSalesLabel: `৳${Number(row.grossSales || 0).toFixed(2)}`,
          discountAmountLabel: `৳${Number(row.discountAmount || 0).toFixed(2)}`,
          returnAmountLabel: `৳${Number(row.returnAmount || 0).toFixed(2)}`,
          discountRateLabel: `${Number(row.discountRate || 0).toFixed(2)}%`,
          returnRateLabel: `${Number(row.returnRate || 0).toFixed(2)}%`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["userName"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "userName", label: "Cashier/User" },
          { key: "saleCount", label: "Sales" },
          { key: "grossSalesLabel", label: "Gross Sales" },
          { key: "discountCount", label: "Discount Txn" },
          { key: "discountAmountLabel", label: "Discount Amount" },
          { key: "priceOverrideCount", label: "Price Overrides" },
          { key: "returnCount", label: "Returns" },
          { key: "returnAmountLabel", label: "Return Amount" },
          { key: "discountRateLabel", label: "Discount %" },
          { key: "returnRateLabel", label: "Return %" },
          { key: "riskScore", label: "Risk Score" },
          {
            key: "riskBand",
            label: "Risk Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {v?.label || "Low"}
              </span>
            ),
          },
        ]}
      />
      <DataTable
        title="Suspicious Event Timeline (Recent)"
        rows={(shrinkageControl.eventRows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          createdAtLabel: row.createdAt ? new Date(row.createdAt).toLocaleString() : "-",
          amountLabel: `৳${Number(row.amount || 0).toFixed(2)}`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["type", "userName", "ref", "note", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "createdAtLabel", label: "Date/Time" },
          { key: "type", label: "Event" },
          { key: "userName", label: "Cashier/User" },
          { key: "ref", label: "Reference" },
          { key: "amountLabel", label: "Amount" },
          { key: "riskScore", label: "Risk" },
          {
            key: "riskBand",
            label: "Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {v?.label || "Low"}
              </span>
            ),
          },
          { key: "note", label: "Note", render: (v) => v || "-" },
        ]}
      />
      <DataTable
        title="Staff Performance Scorecard"
        rows={(staffKpi.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          grossSalesLabel: `৳${Number(row.grossSales || 0).toFixed(2)}`,
          avgBillLabel: `৳${Number(row.avgBill || 0).toFixed(2)}`,
          discountRateLabel: `${Number(row.discountRate || 0).toFixed(2)}%`,
          returnRateLabel: `${Number(row.returnRate || 0).toFixed(2)}%`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["userName"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "userName", label: "Staff" },
          { key: "invoiceCount", label: "Invoices" },
          { key: "grossSalesLabel", label: "Gross Sales" },
          { key: "avgBillLabel", label: "Avg Bill" },
          { key: "returnCount", label: "Returns" },
          { key: "overrideCount", label: "Overrides" },
          { key: "discountRateLabel", label: "Discount %" },
          { key: "returnRateLabel", label: "Return %" },
          { key: "riskScore", label: "Risk" },
          {
            key: "riskBand",
            label: "Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {v?.label || "Low"}
              </span>
            ),
          },
        ]}
      />
      <DataTable
        title="Audit Activity Trail (Recent)"
        rows={(auditActivity.rows || []).map((row, idx) => {
          const payloadPreview =
            row.payload == null
              ? "-"
              : (() => {
                  try {
                    const json = JSON.stringify(row.payload);
                    return json.length > 120 ? `${json.slice(0, 120)}...` : json;
                  } catch {
                    return String(row.payload || "-");
                  }
                })();
          return {
            rowNo: idx + 1,
            ...row,
            createdAtLabel: row.createdAt ? new Date(row.createdAt).toLocaleString() : "-",
            entityRef: row.entityId != null ? `${row.entity}#${row.entityId}` : row.entity,
            actor: row.userRole && row.userRole !== "-" ? `${row.userName} (${row.userRole})` : row.userName,
            payloadPreview,
          };
        })}
        searchableKeys={["action", "entityRef", "actor", "payloadPreview", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "createdAtLabel", label: "Date/Time" },
          { key: "action", label: "Action" },
          { key: "entityRef", label: "Entity" },
          { key: "actor", label: "Actor" },
          { key: "payloadPreview", label: "Payload (Preview)" },
        ]}
      />
        </div>
      ) : null}
      {reportsTab === "finance" ? (
        <div className="pos-tab-panel">
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
      ) : null}
    </div>
  );
}

export default Reports;
