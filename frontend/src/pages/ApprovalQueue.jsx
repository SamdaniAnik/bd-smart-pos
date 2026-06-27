import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SearchSelect from "../components/SearchSelect";

const APPROVAL_FOCUS_KEY = "bd_pos_approval_focus_id";

function ApprovalQueue() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [overrideAuthority, setOverrideAuthority] = useState({ summary: {}, roleRows: [], userRows: [] });
  const [overrideExceptions, setOverrideExceptions] = useState({ summary: {}, rows: [] });
  const [filters, setFilters] = useState({ id: "", from: "", to: "", action: "", status: "", overdueOnly: false });
  const [reviewRemark, setReviewRemark] = useState("");

  const queryString = () => {
    const q = new URLSearchParams();
    if (filters.id) q.set("id", filters.id);
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (filters.action) q.set("action", filters.action);
    if (filters.status) q.set("status", filters.status);
    if (filters.overdueOnly) q.set("overdueOnly", "true");
    return q.toString() ? `?${q.toString()}` : "";
  };

  const load = async () => {
    const [res, authorityRes, exceptionsRes] = await Promise.all([
      api.get(`/approvals${queryString()}`),
      api.get("/approvals/override-authority"),
      api.get(`/approvals/override-exceptions${queryString()}`),
    ]);
    setRows(res.data.rows || []);
    setSummary(res.data.summary || {});
    setOverrideAuthority(authorityRes.data || { summary: {}, roleRows: [], userRows: [] });
    setOverrideExceptions(exceptionsRes.data || { summary: {}, rows: [] });
  };

  useEffect(() => {
    const focusedId = localStorage.getItem(APPROVAL_FOCUS_KEY) || "";
    if (focusedId) {
      setFilters((p) => ({ ...p, id: focusedId }));
      localStorage.removeItem(APPROVAL_FOCUS_KEY);
    }
  }, []);

  useEffect(() => {
    load();
  }, [filters.id, filters.from, filters.to, filters.action, filters.status, filters.overdueOnly]);

  const exportFile = async (ext) => {
    const res = await api.get(`/approvals/export.${ext}${queryString()}`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `approval-queue.${ext}`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const review = async (row) => {
    if (row.status === "REVIEWED") return;
    await api.put(`/approvals/${row.id}/review`, {
      decision: "REVIEWED",
      remark: reviewRemark || "Reviewed by manager",
    });
    setReviewRemark("");
    load();
  };

  const decide = async (row, decision) => {
    if (["APPROVED", "REJECTED"].includes(String(row.status || "").toUpperCase())) return;
    await api.put(`/approvals/${row.id}/review`, {
      decision,
      remark: reviewRemark || `${decision} by manager`,
    });
    setReviewRemark("");
    load();
  };

  const escalate = async (row) => {
    const reason = (window.prompt("Escalation reason (optional):") || "").trim();
    await api.post(`/approvals/${row.id}/escalate`, { reason });
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Approval queue &amp; exceptions</div>
          <div className="page-subtitle">Review discounts, returns, stock counts, and other gated actions</div>
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input
          placeholder="Approval Event ID"
          value={filters.id}
          onChange={(e) => setFilters((p) => ({ ...p, id: e.target.value }))}
        />
        <input type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
        <input type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
        <SearchSelect
          className="form-select-sm"
          value={filters.action}
          onChange={(val) => setFilters((p) => ({ ...p, action: val }))}
          placeholder="All Actions"
          options={[
            { value: "APPROVAL_DISCOUNT", label: "Discount Approval" },
            { value: "APPROVAL_REDEMPTION", label: "Redemption Approval" },
            { value: "APPROVAL_RETURN", label: "Return Approval" },
            { value: "APPROVAL_STOCK_COUNT", label: "Stock Count Approval" },
            { value: "APPROVAL_STOCK_ADJUSTMENT", label: "Stock Write-off Approval" },
            { value: "APPROVAL_VENDOR_BILL", label: "Vendor Bill Approval" },
            { value: "APPROVAL_PETTY_CASH_CLAIM", label: "Petty Cash Claim Approval" },
            { value: "APPROVAL_HOLD_DISCARD", label: "Held Cart Discard (other cashier)" },
            { value: "APPROVAL_HOLD_RESUME", label: "Held Cart Resume (other cashier)" },
            { value: "APPROVAL_CREDIT_LIMIT", label: "Credit limit override" },
            { value: "APPROVAL_FINANCIAL_PERIOD_REOPEN", label: "Fiscal period reopen" },
            { value: "APPROVAL_MANUAL_JOURNAL_HIGH_VALUE", label: "High-value manual journal" },
          ]}
        />
        <SearchSelect
          className="form-select-sm"
          value={filters.status}
          onChange={(val) => setFilters((p) => ({ ...p, status: val }))}
          placeholder="All Status"
          options={[
            { value: "APPROVED", label: "Approved" },
            { value: "REJECTED", label: "Rejected" },
            { value: "PENDING", label: "Pending" },
            { value: "REVIEWED", label: "Reviewed" },
          ]}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(filters.overdueOnly)}
            onChange={(e) => setFilters((p) => ({ ...p, overdueOnly: e.target.checked }))}
          />
          Pending overdue only
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setFilters({ id: "", from: "", to: "", action: "", status: "", overdueOnly: false })}
        >
          Clear Filter
        </button>
        <button type="button" onClick={() => exportFile("csv")}>Export CSV</button>
        <button type="button" className="btn-secondary" onClick={() => exportFile("pdf")}>Export PDF</button>
        <button type="button" onClick={() => exportFile("xlsx")}>Export XLSX</button>
      </div>
      <div className="quick-stats" style={{ marginBottom: 12 }}>
        <div className="stat">Total: {Number(summary.count || 0)}</div>
        <div className="stat">Pending: {Number(summary.pending || 0)}</div>
        <div className="stat">Approved: {Number(summary.approved || 0)}</div>
        <div className="stat">Rejected: {Number(summary.rejected || 0)}</div>
        <div className="stat">Reviewed: {Number(summary.reviewed || 0)}</div>
        <div className="stat">Overdue 30m+: {Number(summary.overdue30m || 0)}</div>
        <div className="stat">Overdue 2h+: {Number(summary.overdue2h || 0)}</div>
        <div className="stat">Overdue 24h+: {Number(summary.overdue24h || 0)}</div>
        <div className="stat">Amount: ৳{Number(summary.totalAmount || 0).toFixed(2)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: 12 }}>
        <div className="stat">Override roles: {Number(overrideAuthority.summary?.roleCount || 0)}</div>
        <div className="stat">Override users: {Number(overrideAuthority.summary?.userCount || 0)}</div>
        <div className="stat">Maturity override roles: {Number(overrideAuthority.summary?.maturityOverrideRoleCount || 0)}</div>
        <div className="stat">Override exceptions: {Number(overrideExceptions.summary?.count || 0)}</div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input
          placeholder="Review remark for selected row action"
          value={reviewRemark}
          onChange={(e) => setReviewRemark(e.target.value)}
        />
      </div>
      <DataTable
        title="Who can override"
        rows={overrideAuthority.roleRows || []}
        searchableKeys={["roleName"]}
        columns={[
          { key: "roleName", label: "Role" },
          { key: "override", label: "Can override", render: (v) => (v ? "Yes" : "No") },
          { key: "maturityOverride", label: "Can override maturity lock", render: (v) => (v ? "Yes" : "No") },
          { key: "userCount", label: "Users" },
        ]}
      />
      <DataTable
        title="Override exception review report"
        rows={(overrideExceptions.rows || []).map((r) => ({ ...r, dateLabel: new Date(r.date).toLocaleString() }))}
        searchableKeys={["userName", "roleName", "actionName", "overrideReason", "overrideRefNo"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "dateLabel", label: "Date" },
          { key: "userName", label: "User" },
          { key: "roleName", label: "Role" },
          { key: "actionName", label: "Action" },
          { key: "overrideReason", label: "Reason" },
          { key: "overrideRefNo", label: "Ticket/Ref" },
          { key: "monthUsageAfter", label: "Monthly usage after" },
          { key: "quota", label: "Quota" },
        ]}
      />
      <DataTable
        rows={rows.map((r) => ({ ...r, createdAtLabel: new Date(r.createdAt).toLocaleString() }))}
        searchableKeys={["action", "status", "reason", "reviewRemark", "requestedByName", "reviewedByName", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "action", label: "Action" },
          { key: "status", label: "Status" },
          {
            key: "slaLevel",
            label: "SLA",
            render: (_, row) => {
              const level = String(row.slaLevel || "ON_TIME").toUpperCase();
              if (level === "OVERDUE_24H") return <span className="badge badge-danger">24H+</span>;
              if (level === "OVERDUE_2H") return <span className="badge badge-warning">2H+</span>;
              if (level === "OVERDUE_30M") return <span className="badge">30M+</span>;
              return <span className="badge badge-success">ON TIME</span>;
            },
          },
          {
            key: "requestedByName",
            label: "Requested By",
            render: (_, row) =>
              row.requestedByName ? (
                <span>
                  {row.requestedByName}{" "}
                  <span className="badge badge-primary">{row.requestedByRole || "Role"}</span>
                </span>
              ) : "-",
          },
          {
            key: "reviewedByName",
            label: "Reviewed By",
            render: (_, row) =>
              row.reviewedByName ? (
                <span>
                  {row.reviewedByName}{" "}
                  <span className="badge badge-primary">{row.reviewedByRole || "Role"}</span>
                </span>
              ) : "-",
          },
          { key: "amount", label: "Amount", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "reason", label: "Reason", render: (v) => v || "-" },
          { key: "reviewRemark", label: "Remark", render: (v) => v || "-" },
          { key: "createdAtLabel", label: "Date" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={["REVIEWED", "APPROVED", "REJECTED"].includes(String(row.status || "").toUpperCase())}
                  onClick={() => review(row)}
                >
                  Mark Reviewed
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={["APPROVED", "REJECTED"].includes(String(row.status || "").toUpperCase())}
                  onClick={() => decide(row, "APPROVED")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  disabled={["APPROVED", "REJECTED"].includes(String(row.status || "").toUpperCase())}
                  onClick={() => decide(row, "REJECTED")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={String(row.status || "").toUpperCase() !== "PENDING"}
                  onClick={() => escalate(row)}
                >
                  Escalate
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default ApprovalQueue;
