import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function StockCount() {
  const [sessions, setSessions] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [sessionForm, setSessionForm] = useState({ warehouseId: "", note: "", blindMode: false, assignedToUserId: "" });
  const [scheduleForm, setScheduleForm] = useState({
    name: "",
    warehouseId: "",
    frequency: "daily",
    isActive: true,
    blindMode: false,
    assignedToUserId: "",
    note: "",
  });
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [filters, setFilters] = useState({ from: "", to: "", status: "" });
  const [managerPin, setManagerPin] = useState("");
  const [showOnlyMyAssignments, setShowOnlyMyAssignments] = useState(false);
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);
  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem("bd_pos_user");
      const parsed = raw ? JSON.parse(raw) : null;
      const id = Number(parsed?.id || 0);
      return Number.isNaN(id) ? null : id || null;
    } catch (_err) {
      return null;
    }
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (filters.status) q.set("status", filters.status);
    return q.toString() ? `?${q.toString()}` : "";
  }, [filters.from, filters.to, filters.status]);

  const visibleSchedules = useMemo(() => {
    let rows = schedules;
    if (showOnlyMyAssignments && currentUserId) {
      rows = rows.filter((row) => Number(row.assignedToUserId || 0) === Number(currentUserId));
    }
    if (showOnlyUnassigned) {
      rows = rows.filter((row) => !Number(row.assignedToUserId || 0));
    }
    return rows;
  }, [schedules, showOnlyMyAssignments, showOnlyUnassigned, currentUserId]);

  const visibleSessions = useMemo(() => {
    let rows = sessions;
    if (showOnlyMyAssignments && currentUserId) {
      rows = rows.filter((row) => Number(row.assignedToUserId || 0) === Number(currentUserId));
    }
    if (showOnlyUnassigned) {
      rows = rows.filter((row) => !Number(row.assignedToUserId || 0));
    }
    return rows;
  }, [sessions, showOnlyMyAssignments, showOnlyUnassigned, currentUserId]);

  const load = async () => {
    const [sessionRes, scheduleRes, warehouseRes] = await Promise.all([
      api.get(`/inventory/stock-count/sessions${query}`),
      api.get("/inventory/stock-count/schedules"),
      api.get("/warehouses"),
    ]);
    let userRows = [];
    try {
      const usersRes = await api.get("/rbac/users");
      userRows = Array.isArray(usersRes.data) ? usersRes.data : [];
    } catch (_err) {
      userRows = [];
    }
    setSessions(sessionRes.data || []);
    setSchedules(scheduleRes.data || []);
    setWarehouses(warehouseRes.data || []);
    setUsers(userRows);
  };

  useEffect(() => {
    load();
  }, [query]);

  const createSession = async (e) => {
    e.preventDefault();
    await api.post("/inventory/stock-count/sessions", {
      warehouseId: sessionForm.warehouseId ? Number(sessionForm.warehouseId) : null,
      note: sessionForm.note,
      blindMode: sessionForm.blindMode,
      assignedToUserId: sessionForm.assignedToUserId ? Number(sessionForm.assignedToUserId) : null,
    });
    setSessionForm({ warehouseId: "", note: "", blindMode: false, assignedToUserId: "" });
    load();
  };

  const createSchedule = async (e) => {
    e.preventDefault();
    const payload = {
      name: scheduleForm.name,
      warehouseId: scheduleForm.warehouseId ? Number(scheduleForm.warehouseId) : null,
      frequency: scheduleForm.frequency,
      isActive: Boolean(scheduleForm.isActive),
      blindMode: Boolean(scheduleForm.blindMode),
      assignedToUserId: scheduleForm.assignedToUserId ? Number(scheduleForm.assignedToUserId) : null,
      note: scheduleForm.note,
    };
    if (editingScheduleId) {
      await api.put(`/inventory/stock-count/schedules/${editingScheduleId}`, payload);
    } else {
      await api.post("/inventory/stock-count/schedules", payload);
    }
    setEditingScheduleId(null);
    setScheduleForm({ name: "", warehouseId: "", frequency: "daily", isActive: true, blindMode: false, assignedToUserId: "", note: "" });
    load();
  };

  const runDueSchedules = async () => {
    await api.post("/inventory/stock-count/schedules/run", {});
    load();
  };

  const editSchedule = (row) => {
    setEditingScheduleId(row.id);
    setScheduleForm({
      name: row.name || "",
      warehouseId: row.warehouseId ? String(row.warehouseId) : "",
      frequency: row.frequency || "daily",
      isActive: Boolean(row.isActive),
      blindMode: Boolean(row.blindMode),
      assignedToUserId: row.assignedToUserId ? String(row.assignedToUserId) : "",
      note: row.note || "",
    });
  };

  const toggleSchedule = async (row) => {
    await api.patch(`/inventory/stock-count/schedules/${row.id}/toggle`, {});
    load();
  };

  const runScheduleNow = async (row) => {
    await api.post(`/inventory/stock-count/schedules/${row.id}/run`, {});
    load();
  };

  const deleteSchedule = async (row) => {
    if (!window.confirm("Delete this schedule?")) return;
    await api.delete(`/inventory/stock-count/schedules/${row.id}`);
    if (editingScheduleId === row.id) {
      setEditingScheduleId(null);
      setScheduleForm({ name: "", warehouseId: "", frequency: "daily", isActive: true, blindMode: false, assignedToUserId: "", note: "" });
    }
    load();
  };

  const openSession = async (row) => {
    const res = await api.get(`/inventory/stock-count/sessions/${row.id}`);
    setActiveSession(res.data);
  };

  const updateCountedQty = (productId, countedQty) => {
    setActiveSession((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) => {
        if (Number(item.productId) !== Number(productId)) return item;
        const nextCounted = Math.max(0, Math.floor(Number(countedQty || 0)));
        return {
          ...item,
          countedQty: nextCounted,
          variance: nextCounted - Number(item.expectedQty || 0),
        };
      });
      return { ...prev, items };
    });
  };

  const updateVarianceReason = (productId, varianceReason) => {
    setActiveSession((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) => {
        if (Number(item.productId) !== Number(productId)) return item;
        return { ...item, varianceReason };
      });
      return { ...prev, items };
    });
  };

  const saveSessionItems = async () => {
    if (!activeSession) return;
    await api.put(`/inventory/stock-count/sessions/${activeSession.id}/items`, {
      items: activeSession.items.map((x) => ({
        productId: x.productId,
        countedQty: x.countedQty,
        varianceReason: x.varianceReason || "",
      })),
    });
    await openSession(activeSession);
    load();
  };

  const recountSession = async () => {
    if (!activeSession) return;
    await api.post(`/inventory/stock-count/sessions/${activeSession.id}/recount`, {});
    await openSession(activeSession);
    load();
  };

  const finalizeSession = async () => {
    if (!activeSession) return;
    await api.post(`/inventory/stock-count/sessions/${activeSession.id}/finalize`, {
      managerApprovalPin: managerPin,
    });
    setManagerPin("");
    await openSession(activeSession);
    load();
  };

  const exportSessions = async (ext) => {
    const res = await api.get(`/inventory/stock-count/sessions/export.${ext}${query}`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `stock-count-sessions.${ext}`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div>
      <h2>Stock Count (Physical Inventory)</h2>
      <form onSubmit={createSession} className="form-grid">
        <select
          value={sessionForm.warehouseId}
          onChange={(e) => setSessionForm((prev) => ({ ...prev, warehouseId: e.target.value }))}
        >
          <option value="">Select Warehouse (Optional)</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <input
          placeholder="Session note"
          value={sessionForm.note}
          onChange={(e) => setSessionForm((prev) => ({ ...prev, note: e.target.value }))}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={sessionForm.blindMode}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, blindMode: e.target.checked }))}
            style={{ width: "auto" }}
          />
          Blind Count Mode
        </label>
        <select
          value={sessionForm.assignedToUserId}
          onChange={(e) => setSessionForm((prev) => ({ ...prev, assignedToUserId: e.target.value }))}
        >
          <option value="">Assign To (Optional)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <button type="submit">Create Count Session</button>
      </form>

      <h3 style={{ marginTop: 14 }}>Cycle Count Schedules</h3>
      <form onSubmit={createSchedule} className="form-grid">
        <input
          placeholder="Schedule name (e.g. Daily Store Count)"
          value={scheduleForm.name}
          onChange={(e) => setScheduleForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <select
          value={scheduleForm.warehouseId}
          onChange={(e) => setScheduleForm((prev) => ({ ...prev, warehouseId: e.target.value }))}
        >
          <option value="">All/Default Warehouse</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={scheduleForm.frequency}
          onChange={(e) => setScheduleForm((prev) => ({ ...prev, frequency: e.target.value }))}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={scheduleForm.blindMode}
            onChange={(e) => setScheduleForm((prev) => ({ ...prev, blindMode: e.target.checked }))}
            style={{ width: "auto" }}
          />
          Blind Mode
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={scheduleForm.isActive}
            onChange={(e) => setScheduleForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            style={{ width: "auto" }}
          />
          Active
        </label>
        <select
          value={scheduleForm.assignedToUserId}
          onChange={(e) => setScheduleForm((prev) => ({ ...prev, assignedToUserId: e.target.value }))}
        >
          <option value="">Assign To (Optional)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <input
          placeholder="Schedule note"
          value={scheduleForm.note}
          onChange={(e) => setScheduleForm((prev) => ({ ...prev, note: e.target.value }))}
        />
        <button type="submit">{editingScheduleId ? "Update Schedule" : "Create Schedule"}</button>
        {editingScheduleId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingScheduleId(null);
              setScheduleForm({ name: "", warehouseId: "", frequency: "daily", isActive: true, blindMode: false, assignedToUserId: "", note: "" });
            }}
          >
            Cancel Edit
          </button>
        ) : null}
        <button type="button" className="btn-secondary" onClick={runDueSchedules}>Run Due Schedules</button>
      </form>

      <DataTable
        title="Cycle Count Schedule List"
        rows={visibleSchedules.map((row) => ({
          ...row,
          createdAtLabel: row.createdAt ? new Date(row.createdAt).toLocaleString() : "-",
          nextDueAtLabel: row.nextDueAt ? new Date(row.nextDueAt).toLocaleString() : "-",
          lastRunAtLabel: row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : "-",
        }))}
        searchableKeys={["name", "frequency", "note", "nextDueAtLabel"]}
        allowExport={false}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name", render: (v) => v || "-" },
          { key: "frequency", label: "Frequency" },
          { key: "assignedToName", label: "Assigned To", render: (v) => v || "-" },
          { key: "isActive", label: "Active", render: (v) => (v ? "Yes" : "No") },
          { key: "isDue", label: "Due Now", render: (v) => (v ? "Yes" : "No") },
          { key: "nextDueAtLabel", label: "Next Due" },
          { key: "lastRunAtLabel", label: "Last Run" },
          { key: "note", label: "Note", render: (v) => v || "-" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editSchedule(row)}>Edit</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => runScheduleNow(row)}>Run Now</button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!row.lastSessionId}
                  onClick={() => row.lastSessionId && openSession({ id: row.lastSessionId })}
                >
                  Last Session
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => toggleSchedule(row)}>
                  {row.isActive ? "Pause" : "Resume"}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteSchedule(row)}>Delete</button>
              </div>
            ),
          },
        ]}
      />

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="stat">Due Schedules: {visibleSchedules.filter((s) => s.isDue).length}</div>
        <div className="stat">Overdue (&gt;24h): {visibleSchedules.filter((s) => s.isDue && s.nextDueAt && (Date.now() - new Date(s.nextDueAt).getTime()) > 86400000).length}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showOnlyMyAssignments}
            onChange={(e) => setShowOnlyMyAssignments(e.target.checked)}
            style={{ width: "auto" }}
          />
          My Assignments Only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showOnlyUnassigned}
            onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
            style={{ width: "auto" }}
          />
          Unassigned Only
        </label>
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <input type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
        <input type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
        <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All Status</option>
          <option value="OPEN">OPEN</option>
          <option value="CLOSED">CLOSED</option>
        </select>
        <button type="button" className="btn-secondary" onClick={() => setFilters({ from: "", to: "", status: "" })}>
          Clear Filter
        </button>
        <button type="button" onClick={() => exportSessions("csv")}>Export CSV</button>
        <button type="button" className="btn-secondary" onClick={() => exportSessions("pdf")}>Export PDF</button>
        <button type="button" onClick={() => exportSessions("xlsx")}>Export XLSX</button>
      </div>

      <DataTable
        title="Stock Count Sessions"
        rows={visibleSessions.map((row) => ({ ...row, createdAtLabel: new Date(row.createdAt).toLocaleString() }))}
        searchableKeys={["warehouseName", "status", "note", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "warehouseName", label: "Warehouse" },
          { key: "assignedToName", label: "Assigned To", render: (v) => v || "-" },
          { key: "totalItems", label: "Items" },
          { key: "totalVariance", label: "Variance", render: (v) => Number(v || 0).toFixed(2) },
          { key: "totalAbsVariance", label: "Abs Variance", render: (v) => Number(v || 0).toFixed(2) },
          { key: "recountRound", label: "Recount Round", render: (v) => Number(v || 0) },
          { key: "createdAtLabel", label: "Date" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <button type="button" className="btn-secondary btn-sm" onClick={() => openSession(row)}>
                Open
              </button>
            ),
          },
        ]}
      />

      {activeSession ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>Session #{activeSession.id} - {activeSession.status}</h4>
          <p><strong>Warehouse:</strong> {activeSession.warehouseName || "-"}</p>
          <p><strong>Note:</strong> {activeSession.note || "-"}</p>
          <p><strong>Assigned To:</strong> {activeSession.assignedToName || "-"}</p>
          <p><strong>Recount Round:</strong> {Number(activeSession.recountRound || 0)}</p>
          {activeSession.approvalEventId ? <p><strong>Approval Event ID:</strong> {activeSession.approvalEventId}</p> : null}
          <DataTable
            title="Count Sheet"
            rows={activeSession.items || []}
            pageSize={10}
            allowExport={false}
            searchableKeys={["productName"]}
            columns={[
              { key: "productId", label: "Product ID" },
              { key: "productName", label: "Product" },
              {
                key: "expectedQty",
                label: "Expected Qty",
                render: (v) => (activeSession.blindMode ? "***" : Number(v || 0)),
              },
              {
                key: "countedQty",
                label: "Counted Qty",
                render: (v, row) =>
                  activeSession.status === "OPEN" ? (
                    <input
                      type="number"
                      value={v}
                      onChange={(e) => updateCountedQty(row.productId, e.target.value)}
                      style={{ minWidth: 90 }}
                    />
                  ) : (
                    Number(v || 0)
                  ),
              },
              { key: "variance", label: "Variance", render: (v) => Number(v || 0) },
              {
                key: "varianceReason",
                label: "Variance Reason",
                render: (v, row) =>
                  activeSession.status === "OPEN" ? (
                    <input
                      type="text"
                      value={v || ""}
                      onChange={(e) => updateVarianceReason(row.productId, e.target.value)}
                      placeholder="Optional reason"
                      style={{ minWidth: 160 }}
                    />
                  ) : (
                    v || "-"
                  ),
              },
            ]}
          />
          {activeSession.status === "OPEN" ? (
            <div className="form-grid" style={{ marginTop: 8 }}>
              <button type="button" className="btn-secondary" onClick={recountSession}>Start Recount Round</button>
              <button type="button" onClick={saveSessionItems}>Save Count Items</button>
              <input
                placeholder="Manager PIN (required if high variance)"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={finalizeSession}>Finalize Session</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default StockCount;
