import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    const res = await api.get("/master/suppliers");
    setSuppliers(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (editingId) {
      await api.put(`/master/suppliers/${editingId}`, form);
    } else {
      await api.post("/master/suppliers", form);
    }
    setForm({ name: "", phone: "", address: "" });
    setEditingId(null);
    setSelected(null);
    load();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/master/suppliers/${row.id}`);
    setSelected(res.data);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: "", phone: "", address: "" });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete supplier "${row.name}"?`)) return;
    await api.delete(`/master/suppliers/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) {
      setEditingId(null);
      setForm({ name: "", phone: "", address: "" });
    }
    load();
  };

  return (
    <div>
      <h2>Suppliers</h2>
      <form onSubmit={submit} className="form-grid">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <button type="submit">{editingId ? "Update Supplier" : "Add Supplier"}</button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={cancelEdit}>
            Cancel
          </button>
        ) : null}
      </form>
      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>Supplier Details</h4>
          <p><strong>Name:</strong> {selected.name}</p>
          <p><strong>Phone:</strong> {selected.phone || "-"}</p>
          <p><strong>Address:</strong> {selected.address || "-"}</p>
          <p><strong>Payable:</strong> ৳{Number(selected.payableBalance || 0).toFixed(2)}</p>
        </div>
      ) : null}
      <DataTable
        rows={suppliers}
        searchableKeys={["name", "phone", "address"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "address", label: "Address", render: (v) => v || "-" },
          { key: "payableBalance", label: "Payable", render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>Details</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>Edit</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Suppliers;
