import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { notifySuccess } from "../utils/notify";
import { getStoredPermissions, hasPermission } from "../utils/permissions";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default function FiscalPeriods() {
  const permissions = getStoredPermissions();
  const canManage = hasPermission("branch.manage", permissions);
  const [rows, setRows] = useState([]);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [createForm, setCreateForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
  });
  const [busyGlobal, setBusyGlobal] = useState(false);

  const load = async () => {
    const res = await api.get("/accounting/fiscal-periods");
    setRows(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return rows;
    if (statusFilter === "OPEN") return rows.filter((r) => !r.isClosed);
    if (statusFilter === "CLOSED") return rows.filter((r) => r.isClosed);
    return rows;
  }, [rows, statusFilter]);

  const activePeriod = useMemo(() => {
    const now = new Date();
    return rows.find((row) => {
      const start = row?.startDate ? new Date(row.startDate) : null;
      const end = row?.endDate ? new Date(row.endDate) : null;
      if (!start || !end) return false;
      return start <= now && end >= now;
    }) || null;
  }, [rows]);

  const closePeriod = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/accounting/fiscal-periods/${id}/close`, {
        reason: reason.trim() || undefined,
      });
      notifySuccess("fiscal period closed.");
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reopenPeriod = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/accounting/fiscal-periods/${id}/reopen`, {
        reason: reason.trim() || undefined,
      });
      notifySuccess("fiscal period reopened.");
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const createPeriod = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.startDate || !createForm.endDate) return;
    setBusyGlobal(true);
    try {
      await api.post("/accounting/fiscal-periods", {
        name: createForm.name.trim(),
        startDate: createForm.startDate,
        endDate: createForm.endDate,
      });
      notifySuccess("fiscal period created.");
      setCreateForm({ name: "", startDate: "", endDate: "" });
      await load();
    } finally {
      setBusyGlobal(false);
    }
  };

  const closeCurrentMonth = async () => {
    setBusyGlobal(true);
    try {
      await api.post("/accounting/fiscal-periods/close-current-month", {
        reason: reason.trim() || undefined,
      });
      notifySuccess("current month fiscal period closed.");
      setReason("");
      await load();
    } finally {
      setBusyGlobal(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Fiscal Period Lock Control</h2>
      <p className="text-muted">
        Close a period to block posting/editing transactions inside that date range.
      </p>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <strong>Current Active Period:</strong>{" "}
        {activePeriod ? (
          <>
            <span>{activePeriod.name || `Period #${activePeriod.id}`}</span>{" "}
            <span style={{ color: activePeriod.isClosed ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
              ({activePeriod.isClosed ? "Closed" : "Open"})
            </span>{" "}
            <span className="text-muted">
              [{formatDate(activePeriod.startDate)} - {formatDate(activePeriod.endDate)}]
            </span>
          </>
        ) : (
          <span className="text-muted">No active period for today.</span>
        )}
      </div>

      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 760 }}>
        <label>
          Optional reason (stored in audit trail)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Month close completed, approved by finance manager, etc."
          />
        </label>
        <label>
          Status filter
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All</option>
            <option value="OPEN">Open only</option>
            <option value="CLOSED">Closed only</option>
          </select>
        </label>
      </div>
      {canManage ? (
        <form onSubmit={createPeriod} className="form-grid" style={{ marginBottom: 12, maxWidth: 980 }}>
          <label>
            New period name
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="2026 Q2 / FY 2026-2027"
              required
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={createForm.startDate}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
              required
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={createForm.endDate}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, endDate: e.target.value }))}
              required
            />
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="submit" disabled={busyGlobal}>
              {busyGlobal ? "Processing..." : "Create Period"}
            </button>
            <button type="button" className="btn-secondary" onClick={closeCurrentMonth} disabled={busyGlobal}>
              {busyGlobal ? "Processing..." : "Close Current Month"}
            </button>
          </div>
        </form>
      ) : null}

      {!canManage ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          Permission required: <code>branch.manage</code> to close/reopen periods.
        </div>
      ) : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Start</th>
            <th>End</th>
            <th>Status</th>
            <th style={{ width: 200 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>
                No fiscal periods found.
              </td>
            </tr>
          ) : (
            filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.name || `Period #${row.id}`}</td>
                <td>{formatDate(row.startDate)}</td>
                <td>{formatDate(row.endDate)}</td>
                <td>
                  {row.isClosed ? (
                    <span style={{ color: "#b91c1c", fontWeight: 600 }}>Closed</span>
                  ) : (
                    <span style={{ color: "#15803d", fontWeight: 600 }}>Open</span>
                  )}
                </td>
                <td>
                  {canManage ? (
                    row.isClosed ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => reopenPeriod(row.id)}
                      >
                        {busyId === row.id ? "Processing..." : "Reopen"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => closePeriod(row.id)}
                      >
                        {busyId === row.id ? "Processing..." : "Close"}
                      </button>
                    )
                  ) : (
                    <span className="text-muted">View only</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
