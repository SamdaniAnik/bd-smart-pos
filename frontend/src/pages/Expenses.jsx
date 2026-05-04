import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Expenses() {
  const [rows, setRows] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [form, setForm] = useState({
    category: "",
    description: "",
    amount: "",
    paymentMethod: "Cash",
    costCenterId: "",
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    const [res, ccRes] = await Promise.all([
      api.get("/expenses"),
      api.get("/cost-centers", { params: { active: 1 } }),
    ]);
    setRows(res.data);
    setCostCenters(Array.isArray(ccRes.data) ? ccRes.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({
      category: "",
      description: "",
      amount: "",
      paymentMethod: "Cash",
      costCenterId: "",
      expenseDate: new Date().toISOString().slice(0, 10),
    });
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      category: form.category,
      description: form.description || null,
      amount: Number(form.amount),
      paymentMethod: form.paymentMethod,
      costCenterId: form.costCenterId ? Number(form.costCenterId) : null,
      expenseDate: form.expenseDate,
    };
    if (editingId) {
      await api.put(`/expenses/${editingId}`, payload);
    } else {
      await api.post("/expenses", payload);
    }
    resetForm();
    setSelected(null);
    load();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      category: row.category || "",
      description: row.description || "",
      amount: row.amount ?? "",
      paymentMethod: row.paymentMethod || "Cash",
      costCenterId: row.costCenterId ? String(row.costCenterId) : "",
      expenseDate: new Date(row.expenseDate).toISOString().slice(0, 10),
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/expenses/${row.id}`);
    setSelected(res.data);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete expense #${row.id}?`)) return;
    await api.delete(`/expenses/${row.id}`);
    if (editingId === row.id) resetForm();
    if (selected?.id === row.id) setSelected(null);
    load();
  };

  return (
    <div>
      <h2>Expenses</h2>
      <form onSubmit={submit} className="form-grid">
        <input
          placeholder="Category (e.g. Rent, Salary)"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required
        />
        <select
          value={form.paymentMethod}
          onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
        >
          <option value="Cash">Cash</option>
          <option value="Bank">Bank</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Card">Card</option>
        </select>
        <input
          type="date"
          value={form.expenseDate}
          onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
        />
        <select
          value={form.costCenterId}
          onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}
        >
          <option value="">Cost Center (optional)</option>
          {costCenters.map((cc) => (
            <option key={cc.id} value={cc.id}>
              {cc.code} - {cc.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <button type="submit">{editingId ? "Update Expense" : "Add Expense"}</button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={resetForm}>
            Cancel
          </button>
        ) : null}
      </form>

      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>Expense Details</h4>
          <p><strong>ID:</strong> {selected.id}</p>
          <p><strong>Category:</strong> {selected.category}</p>
          <p><strong>Amount:</strong> ৳{Number(selected.amount || 0).toFixed(2)}</p>
          <p><strong>Payment Method:</strong> {selected.paymentMethod}</p>
          <p>
            <strong>Cost Center:</strong>{" "}
            {selected.costCenter ? `${selected.costCenter.code} - ${selected.costCenter.name}` : "-"}
          </p>
          <p><strong>Date:</strong> {new Date(selected.expenseDate).toLocaleDateString()}</p>
          <p><strong>Description:</strong> {selected.description || "-"}</p>
          <p><strong>Created By:</strong> {selected.creator?.name || selected.creator?.email || "-"}</p>
        </div>
      ) : null}

      <DataTable
        title="Expense List"
        rows={rows.map((r) => ({
          ...r,
          expenseDateLabel: new Date(r.expenseDate).toLocaleDateString(),
          createdByName: r.creator?.name || r.creator?.email || "-",
          costCenterLabel: r.costCenter ? `${r.costCenter.code} - ${r.costCenter.name}` : "-",
        }))}
        searchableKeys={["category", "paymentMethod", "expenseDateLabel", "createdByName", "costCenterLabel"]}
        filters={[
          {
            key: "paymentMethod",
            label: "Payment Method",
            options: [...new Set(rows.map((x) => x.paymentMethod).filter(Boolean))].map((x) => ({
              label: x,
              value: x,
            })),
          },
          {
            key: "costCenterLabel",
            label: "Cost Center",
            options: [...new Set(rows.map((x) => (x.costCenter ? `${x.costCenter.code} - ${x.costCenter.name}` : "-")))]
              .map((x) => ({ label: x, value: x })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "expenseDateLabel", label: "Date" },
          { key: "category", label: "Category" },
          { key: "amount", label: "Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "paymentMethod", label: "Payment" },
          { key: "costCenterLabel", label: "Cost Center" },
          { key: "createdByName", label: "Created By" },
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

export default Expenses;
