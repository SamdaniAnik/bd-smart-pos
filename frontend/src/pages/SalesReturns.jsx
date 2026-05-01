import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function SalesReturns() {
  const [sales, setSales] = useState([]);
  const [productsBySale, setProductsBySale] = useState([]);
  const [form, setForm] = useState({ saleId: "", productId: "", qty: "", reason: "", managerApprovalPin: "" });

  const load = async () => {
    const res = await api.get("/sales/recent");
    setSales(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const selectedSale = sales.find((s) => String(s.id) === String(form.saleId));
    if (!selectedSale) {
      setProductsBySale([]);
      return;
    }
    setProductsBySale(selectedSale.items || []);
  }, [form.saleId, sales]);

  const submit = async (e) => {
    e.preventDefault();
    await api.post(`/sales/${Number(form.saleId)}/return`, {
      reason: form.reason,
      items: [{ productId: Number(form.productId), qty: Number(form.qty) }],
      managerApprovalPin: form.managerApprovalPin,
    });
    setForm({ saleId: "", productId: "", qty: "", reason: "", managerApprovalPin: "" });
    load();
  };

  return (
    <div>
      <h2>Sales Returns</h2>
      <form onSubmit={submit} className="form-grid">
        <select value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value, productId: "" })}>
          <option value="">Select Sale</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.invoiceNo || `Sale-${s.id}`}
            </option>
          ))}
        </select>
        <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Select Product</option>
          {productsBySale.map((i) => (
            <option key={i.productId} value={i.productId}>
              Product #{i.productId} (Sold Qty: {i.qty})
            </option>
          ))}
        </select>
        <input placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <input
          placeholder="Manager Approval PIN"
          value={form.managerApprovalPin}
          onChange={(e) => setForm({ ...form, managerApprovalPin: e.target.value })}
        />
        <button type="submit">Create Return</button>
      </form>
      <DataTable
        rows={sales.map((s) => ({ ...s, itemsCount: s.items?.length || 0 }))}
        searchableKeys={["invoiceNo"]}
        columns={[
          { key: "id", label: "Sale ID" },
          { key: "invoiceNo", label: "Invoice", render: (v) => v || "-" },
          { key: "total", label: "Total", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "itemsCount", label: "Items" },
        ]}
      />
    </div>
  );
}

export default SalesReturns;
