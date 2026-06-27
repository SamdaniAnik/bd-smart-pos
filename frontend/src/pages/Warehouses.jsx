import { useCallback, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import { notifyPermissionRequired } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";

function Warehouses() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canManageWarehouses = hasPermission("inventory.adjust");

  const requireWarehouseManage = () => {
    if (canManageWarehouses) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "inventory.adjust" }));
    return false;
  };

  const [form, setForm] = useState({ name: "" });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchWarehousePage = useCallback(async (q) => {
    const res = await api.get("/warehouses", {
      params: {
        paged: true,
        page: q.page,
        pageSize: q.pageSize,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
        search: JSON.stringify(q.search || {}),
        filters: JSON.stringify(q.filters || {}),
      },
    });
    return { data: res.data?.data || [], total: res.data?.total || 0 };
  }, []);
  const warehousesTable = useServerTable(fetchWarehousePage, {
    pageSize: 10,
    sortKey: "id",
    sortDir: "desc",
  });
  const warehouses = warehousesTable.rows;
  const load = warehousesTable.refresh;

  const submit = async (e) => {
    e.preventDefault();
    if (!requireWarehouseManage()) return;
    const payload = { name: form.name.trim() };
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/warehouses/${editingId}`, payload);
      } else {
        await api.post("/warehouses", payload);
      }
      setForm({ name: "" });
      setEditingId(null);
      setSelected(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/warehouses/${row.id}`);
    setSelected(res.data);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
    });
  };

  const handleDelete = async (row) => {
    if (!requireWarehouseManage()) return;
    if (!window.confirm(`Delete warehouse "${row.name}"?`)) return;
    await api.delete(`/warehouses/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) {
      setEditingId(null);
      setForm({ name: "" });
    }
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Warehouse master</div>
          <div className="page-subtitle">Storage locations for stock and transfers</div>
        </div>
      </div>
      <PermissionBanner show={!canManageWarehouses} code="inventory.adjust" tt={tt} />
      <form onSubmit={submit} className="form-grid">
        <input
          placeholder="Warehouse Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <SubmitButton loading={submitting} loadingLabel={editingId ? "Updating…" : "Saving…"} disabled={!canManageWarehouses}>
          {editingId ? "Update warehouse" : "Add warehouse"}
        </SubmitButton>
        {editingId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingId(null);
              setForm({ name: "" });
            }}
          >
            Cancel
          </button>
        ) : null}
      </form>

      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>Warehouse Details</h4>
          <p>
            <strong>Name:</strong> {selected.name}
          </p>
          <p>
            <strong>ID:</strong> {selected.id}
          </p>
        </div>
      ) : null}

      <DataTable
        title="Warehouse List"
        rows={warehouses}
        serverMode
        totalRows={warehousesTable.total}
        loading={warehousesTable.loading}
        onQueryChange={warehousesTable.onQueryChange}
        initialSort="id"
        initialSortDir="desc"
        pageSize={10}
        columns={[
          { key: "id", label: "ID", searchable: false },
          { key: "name", label: "Name" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>
                  Details
                </button>
                <button type="button" className="btn-secondary btn-sm" disabled={!canManageWarehouses} onClick={() => handleEdit(row)}>
                  Edit
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={!canManageWarehouses} onClick={() => handleDelete(row)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Warehouses;
