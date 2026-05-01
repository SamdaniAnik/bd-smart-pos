import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function ApprovalQueue() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ from: "", to: "", action: "", status: "" });
  const [reviewRemark, setReviewRemark] = useState("");

  const queryString = () => {
    const q = new URLSearchParams();
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (filters.action) q.set("action", filters.action);
    if (filters.status) q.set("status", filters.status);
    return q.toString() ? `?${q.toString()}` : "";
  };

  const load = async () => {
    const res = await api.get(`/approvals${queryString()}`);
    setRows(res.data.rows || []);
    setSummary(res.data.summary || {});
  };

  useEffect(() => {
    load();
  }, [filters.from, filters.to, filters.action, filters.status]);

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
    await api.put(`/approvals/${row.id}/review`, { remark: reviewRemark || "Reviewed by manager" });
    setReviewRemark("");
    load();
  };

  return (
    <div>
      <h2>Approval Queue & Exceptions</h2>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
        <input type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
        <select value={filters.action} onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}>
          <option value="">All Actions</option>
          <option value="APPROVAL_DISCOUNT">Discount Approval</option>
          <option value="APPROVAL_REDEMPTION">Redemption Approval</option>
          <option value="APPROVAL_RETURN">Return Approval</option>
          <option value="APPROVAL_STOCK_COUNT">Stock Count Approval</option>
          <option value="APPROVAL_HOLD_DISCARD">Held Cart Discard (other cashier)</option>
          <option value="APPROVAL_HOLD_RESUME">Held Cart Resume (other cashier)</option>
          <option value="APPROVAL_CREDIT_LIMIT">Credit limit override</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All Status</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="PENDING">Pending</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
        <button type="button" className="btn-secondary" onClick={() => setFilters({ from: "", to: "", action: "", status: "" })}>
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
        <div className="stat">Amount: ৳{Number(summary.totalAmount || 0).toFixed(2)}</div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input
          placeholder="Review remark for selected row action"
          value={reviewRemark}
          onChange={(e) => setReviewRemark(e.target.value)}
        />
      </div>
      <DataTable
        rows={rows.map((r) => ({ ...r, createdAtLabel: new Date(r.createdAt).toLocaleString() }))}
        searchableKeys={["action", "status", "reason", "reviewRemark", "requestedByName", "reviewedByName", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "action", label: "Action" },
          { key: "status", label: "Status" },
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
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={row.status === "REVIEWED"}
                onClick={() => review(row)}
              >
                Mark Reviewed
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

export default ApprovalQueue;
