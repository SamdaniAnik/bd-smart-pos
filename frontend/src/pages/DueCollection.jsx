import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function DueCollection() {
  const [summary, setSummary] = useState({ customers: [], suppliers: [] });
  const [customerCollections, setCustomerCollections] = useState([]);
  const [supplierPayments, setSupplierPayments] = useState([]);
  const [customerForm, setCustomerForm] = useState({ customerId: "", amount: "", method: "Cash", note: "" });
  const [supplierForm, setSupplierForm] = useState({ supplierId: "", amount: "", method: "Cash", note: "" });

  const load = async () => {
    const [summaryRes, cRes, sRes] = await Promise.all([
      api.get("/dues/summary"),
      api.get("/dues/customer-collections"),
      api.get("/dues/supplier-payments"),
    ]);
    setSummary(summaryRes.data);
    setCustomerCollections(cRes.data);
    setSupplierPayments(sRes.data);
  };

  useEffect(() => {
    load();
  }, []);

  const submitCustomerCollection = async (e) => {
    e.preventDefault();
    await api.post("/dues/customer-collections", {
      customerId: Number(customerForm.customerId),
      amount: Number(customerForm.amount),
      method: customerForm.method,
      note: customerForm.note || null,
    });
    setCustomerForm({ customerId: "", amount: "", method: "Cash", note: "" });
    load();
  };

  const submitSupplierPayment = async (e) => {
    e.preventDefault();
    await api.post("/dues/supplier-payments", {
      supplierId: Number(supplierForm.supplierId),
      amount: Number(supplierForm.amount),
      method: supplierForm.method,
      note: supplierForm.note || null,
    });
    setSupplierForm({ supplierId: "", amount: "", method: "Cash", note: "" });
    load();
  };

  return (
    <div>
      <h2>Due Collection & Settlement</h2>

      <h4 style={{ marginTop: 8 }}>Collect Customer Due</h4>
      <form onSubmit={submitCustomerCollection} className="form-grid">
        <select
          value={customerForm.customerId}
          onChange={(e) => setCustomerForm({ ...customerForm, customerId: e.target.value })}
          required
        >
          <option value="">Select Customer</option>
          {summary.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (Due: ৳{Number(c.balance || 0).toFixed(2)})
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={customerForm.amount}
          onChange={(e) => setCustomerForm({ ...customerForm, amount: e.target.value })}
          required
        />
        <select value={customerForm.method} onChange={(e) => setCustomerForm({ ...customerForm, method: e.target.value })}>
          <option value="Cash">Cash</option>
          <option value="Bank">Bank</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Card">Card</option>
        </select>
        <input
          placeholder="Note (optional)"
          value={customerForm.note}
          onChange={(e) => setCustomerForm({ ...customerForm, note: e.target.value })}
        />
        <button type="submit">Collect Due</button>
      </form>

      <h4 style={{ marginTop: 8 }}>Pay Supplier Due</h4>
      <form onSubmit={submitSupplierPayment} className="form-grid">
        <select
          value={supplierForm.supplierId}
          onChange={(e) => setSupplierForm({ ...supplierForm, supplierId: e.target.value })}
          required
        >
          <option value="">Select Supplier</option>
          {summary.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (Payable: ৳{Number(s.payableBalance || 0).toFixed(2)})
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={supplierForm.amount}
          onChange={(e) => setSupplierForm({ ...supplierForm, amount: e.target.value })}
          required
        />
        <select value={supplierForm.method} onChange={(e) => setSupplierForm({ ...supplierForm, method: e.target.value })}>
          <option value="Cash">Cash</option>
          <option value="Bank">Bank</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Card">Card</option>
        </select>
        <input
          placeholder="Note (optional)"
          value={supplierForm.note}
          onChange={(e) => setSupplierForm({ ...supplierForm, note: e.target.value })}
        />
        <button type="submit">Pay Supplier</button>
      </form>

      <DataTable
        title="Customer Collections"
        rows={customerCollections.map((x) => ({
          ...x,
          customerName: x.customer?.name || "-",
          createdAtLabel: new Date(x.createdAt).toLocaleString(),
        }))}
        searchableKeys={["customerName", "method", "note", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "customerName", label: "Customer" },
          { key: "amount", label: "Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "method", label: "Method" },
          { key: "note", label: "Note", render: (v) => v || "-" },
        ]}
      />

      <DataTable
        title="Supplier Payments"
        rows={supplierPayments.map((x) => ({
          ...x,
          supplierName: x.supplier?.name || "-",
          createdAtLabel: new Date(x.createdAt).toLocaleString(),
        }))}
        searchableKeys={["supplierName", "method", "note", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "supplierName", label: "Supplier" },
          { key: "amount", label: "Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "method", label: "Method" },
          { key: "note", label: "Note", render: (v) => v || "-" },
        ]}
      />
    </div>
  );
}

export default DueCollection;
