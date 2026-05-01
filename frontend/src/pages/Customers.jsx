import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ name: "", phone: "", address: "", creditLimit: "0" });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    const res = await api.get("/master/customers");
    setCustomers(res.data);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (editingId) {
      await api.put(`/master/customers/${editingId}`, form);
    } else {
      await api.post("/master/customers", form);
    }
    setForm({ name: "", phone: "", address: "", creditLimit: "0" });
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
      creditLimit: String(row.creditLimit ?? 0),
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/master/customers/${row.id}`);
    setSelected(res.data);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: "", phone: "", address: "", creditLimit: "0" });
  };

  return (
    <div>
      <h2>Customers</h2>
      <form onSubmit={submit} className="form-grid">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="Credit limit BDT (0 = unlimited)"
          value={form.creditLimit}
          onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
        />
        <button type="submit">{editingId ? "Update Customer" : "Add Customer"}</button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={cancelEdit}>
            Cancel
          </button>
        ) : null}
      </form>
      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          {(() => {
            const creditLimit = Number(selected.creditLimit || 0);
            const due = Number(selected.balance || 0);
            const available = creditLimit > 0 ? Math.max(0, creditLimit - due) : null;
            const usagePercent = creditLimit > 0 ? Math.min(100, (due / creditLimit) * 100) : null;
            return (
              <>
                <h4>Customer Details</h4>
                <p><strong>Name:</strong> {selected.name}</p>
                <p><strong>Phone:</strong> {selected.phone || "-"}</p>
                <p><strong>Address:</strong> {selected.address || "-"}</p>
                <p><strong>Due:</strong> ৳{due.toFixed(2)}</p>
                <p><strong>Credit limit:</strong> ৳{creditLimit.toFixed(2)} {creditLimit <= 0 ? "(no limit)" : ""}</p>
                {creditLimit > 0 ? (
                  <>
                    <p><strong>Available credit:</strong> ৳{available.toFixed(2)}</p>
                    <p><strong>Credit usage:</strong> {usagePercent.toFixed(1)}%</p>
                  </>
                ) : null}
                <p><strong>Loyalty Points:</strong> {Number(selected.loyaltyPoints || 0).toFixed(0)}</p>
                <p><strong>Loyalty Tier:</strong> {selected.loyaltyTier || "REGULAR"}</p>
                <p><strong>Total Spent:</strong> ৳{Number(selected.loyaltyTotalSpent || 0).toFixed(2)}</p>
              </>
            );
          })()}
        </div>
      ) : null}
      <DataTable
        rows={customers}
        searchableKeys={["name", "phone", "address"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "address", label: "Address", render: (v) => v || "-" },
          { key: "balance", label: "Due", render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "creditLimit",
            label: "Credit cap",
            render: (v) => (Number(v || 0) > 0 ? `৳${Number(v).toFixed(2)}` : "∞"),
          },
          {
            key: "creditRemaining",
            label: "Available Credit",
            render: (_, row) => {
              const creditLimit = Number(row.creditLimit || 0);
              const balance = Number(row.balance || 0);
              if (creditLimit <= 0) return "∞";
              return `৳${Math.max(0, creditLimit - balance).toFixed(2)}`;
            },
          },
          {
            key: "creditUsage",
            label: "Credit Usage",
            render: (_, row) => {
              const creditLimit = Number(row.creditLimit || 0);
              const balance = Number(row.balance || 0);
              if (creditLimit <= 0) return "-";
              return `${Math.min(100, (balance / creditLimit) * 100).toFixed(1)}%`;
            },
          },
          { key: "loyaltyPoints", label: "Points", render: (v) => Number(v || 0).toFixed(0) },
          { key: "loyaltyTier", label: "Tier", render: (v) => v || "REGULAR" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>Details</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>Edit</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Customers;
