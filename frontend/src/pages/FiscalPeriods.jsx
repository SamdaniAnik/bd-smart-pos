import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { getLang, t } from "../i18n";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default function FiscalPeriods() {
  const [uiLang, setUiLang] = useState(() => getLang());
  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

  const permissions = getStoredPermissions();
  const canManage = hasPermission("financial.lock.manage", permissions) || hasPermission("branch.manage", permissions);
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
  const [selectedChecklistId, setSelectedChecklistId] = useState(null);
  const [closeChecklist, setCloseChecklist] = useState(null);

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
      notifySuccess(tt("fpNotifyClosed"));
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reopenPeriod = async (id) => {
    setBusyId(id);
    try {
      const res = await api.post(`/accounting/fiscal-periods/${id}/reopen`, {
        reason: reason.trim() || undefined,
      });
      if (res.data?.requiresApproval) {
        notifyActionRequired(`Reopen submitted for approval (#${res.data.approvalId}).`);
      } else {
        notifySuccess(tt("fpNotifyReopened"));
      }
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const loadChecklist = async (id) => {
    setSelectedChecklistId(id);
    setCloseChecklist(null);
    try {
      const res = await api.get(`/accounting/fiscal-periods/${id}/close-checklist`);
      setCloseChecklist(res.data || null);
    } finally {
      setSelectedChecklistId(null);
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
      notifySuccess(tt("fpNotifyCreated"));
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
      notifySuccess(tt("fpNotifyCurrentClosed"));
      setReason("");
      await load();
    } finally {
      setBusyGlobal(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Fiscal period lock control</div>
          <div className="page-title">{tt("fiscalPeriods")}</div>
          <div className="page-subtitle">{tt("fpSubtitle")}</div>
        </div>
      </div>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <strong>{tt("fpCurrentActivePeriod")}:</strong>{" "}
        {activePeriod ? (
          <>
            <span>{activePeriod.name || tt("fpPeriodById", { id: activePeriod.id })}</span>{" "}
            <span style={{ color: activePeriod.isClosed ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
              ({activePeriod.isClosed ? tt("fpClosed") : tt("fpOpen")})
            </span>{" "}
            <span className="text-muted">
              [{formatDate(activePeriod.startDate)} - {formatDate(activePeriod.endDate)}]
            </span>
          </>
        ) : (
          <span className="text-muted">{tt("fpNoActivePeriodToday")}</span>
        )}
      </div>

      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 760 }}>
        <label>
          {tt("fpOptionalReason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tt("fpReasonPlaceholder")}
          />
        </label>
        <label>
          {tt("fpStatusFilter")}
          <select className="form-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">{tt("fpAll")}</option>
            <option value="OPEN">{tt("fpOpenOnly")}</option>
            <option value="CLOSED">{tt("fpClosedOnly")}</option>
          </select>
        </label>
      </div>
      {canManage ? (
        <form onSubmit={createPeriod} className="form-grid" style={{ marginBottom: 12, maxWidth: 980 }}>
          <label>
            {tt("fpNewPeriodName")}
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={tt("fpNamePlaceholder")}
              required
            />
          </label>
          <label>
            {tt("fpStartDate")}
            <input
              type="date"
              value={createForm.startDate}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
              required
            />
          </label>
          <label>
            {tt("fpEndDate")}
            <input
              type="date"
              value={createForm.endDate}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, endDate: e.target.value }))}
              required
            />
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="submit" disabled={busyGlobal}>
              {busyGlobal ? tt("fpProcessing") : tt("fpCreatePeriod")}
            </button>
            <button type="button" className="btn-secondary" onClick={closeCurrentMonth} disabled={busyGlobal}>
              {busyGlobal ? tt("fpProcessing") : tt("fpCloseCurrentMonth")}
            </button>
          </div>
        </form>
      ) : null}

      {!canManage ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          {tt("fpPermissionRequired")} <code>financial.lock.manage</code> {tt("fpToCloseReopen")}
        </div>
      ) : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{tt("colName")}</th>
            <th>{tt("fpStart")}</th>
            <th>{tt("fpEnd")}</th>
            <th>{tt("colStatus")}</th>
            <th style={{ width: 200 }}>{tt("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>
                {tt("fpNoFiscalPeriods")}
              </td>
            </tr>
          ) : (
            filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.name || tt("fpPeriodById", { id: row.id })}</td>
                <td>{formatDate(row.startDate)}</td>
                <td>{formatDate(row.endDate)}</td>
                <td>
                  {row.isClosed ? (
                    <span style={{ color: "#b91c1c", fontWeight: 600 }}>{tt("fpClosed")}</span>
                  ) : (
                    <span style={{ color: "#15803d", fontWeight: 600 }}>{tt("fpOpen")}</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    style={{ marginRight: 8 }}
                    disabled={selectedChecklistId === row.id}
                    onClick={() => loadChecklist(row.id)}
                  >
                    {selectedChecklistId === row.id ? "..." : "Checklist"}
                  </button>
                  {canManage ? (
                    row.isClosed ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => reopenPeriod(row.id)}
                      >
                        {busyId === row.id ? tt("fpProcessing") : tt("fpReopen")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => closePeriod(row.id)}
                      >
                        {busyId === row.id ? tt("fpProcessing") : tt("fpClose")}
                      </button>
                    )
                  ) : (
                    <span className="text-muted">{tt("fpViewOnly")}</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {closeChecklist ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>
            Period-end checklist: {closeChecklist.period?.name || `#${closeChecklist.period?.id || ""}`}
          </h4>
          <div className="quick-stats" style={{ marginBottom: 10 }}>
            <div className="stat">Pending approvals: {Number(closeChecklist?.checklist?.find((x) => x.key === "pendingApprovals")?.count || 0)}</div>
            <div className="stat">Pending voucher approvals: {Number(closeChecklist?.checklist?.find((x) => x.key === "pendingVoucherApprovals")?.count || 0)}</div>
            <div className="stat">Unresolved vendor bills: {Number(closeChecklist?.checklist?.find((x) => x.key === "unresolvedVendorBills")?.count || 0)}</div>
            <div className="stat" style={{ background: closeChecklist.canClose ? "#dcfce7" : "#fee2e2" }}>
              {closeChecklist.canClose ? "Ready to close" : "Blocked"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
