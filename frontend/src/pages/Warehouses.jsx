import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Warehouses() {
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({ name: "" });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    const res = await api.get("/warehouses");
    setWarehouses(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const payload = { name: form.name.trim() };
    if (editingId) {
      await api.put(`/warehouses/${editingId}`, payload);
    } else {
      await api.post("/warehouses", payload);
    }
    setForm({ name: "" });
    setEditingId(null);
    setSelected(null);
    load();
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
    <div>
      <h2>Warehouse Master</h2>
      <form onSubmit={submit} className="form-grid">
        <input
          placeholder="Warehouse Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <button type="submit">{editingId ? "Update Warehouse" : "Add Warehouse"}</button>
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
        searchableKeys={["name"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>
                  Details
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>
                  Edit
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)}>
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
