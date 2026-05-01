import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [purchaseReturns, setPurchaseReturns] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [returnItems, setReturnItems] = useState([]);
  const [form, setForm] = useState({
    supplierId: "",
    invoiceNo: "",
    paidAmount: "",
    productId: "",
    qty: "",
    cost: "",
  });
  const [returnForm, setReturnForm] = useState({
    purchaseId: "",
    productId: "",
    qty: "",
    cost: "",
    reason: "",
  });
  const [returnRange, setReturnRange] = useState({ from: "", to: "" });

  const load = async () => {
    const query = new URLSearchParams();
    if (returnRange.from) query.set("from", returnRange.from);
    if (returnRange.to) query.set("to", returnRange.to);
    const returnsUrl = query.toString() ? `/purchases/returns?${query.toString()}` : "/purchases/returns";
    const [purchaseRes, returnsRes, supplierRes, productRes] = await Promise.all([
      api.get("/purchases"),
      api.get(returnsUrl),
      api.get("/master/suppliers"),
      api.get("/products"),
    ]);
    setPurchases(purchaseRes.data);
    setPurchaseReturns(returnsRes.data);
    setSuppliers(supplierRes.data);
    setProducts(productRes.data);
  };

  useEffect(() => {
    load();
  }, [returnRange.from, returnRange.to]);

  useEffect(() => {
    const purchase = purchases.find((p) => String(p.id) === String(returnForm.purchaseId));
    setReturnItems(purchase?.items || []);
    setReturnForm((prev) => ({ ...prev, productId: "", qty: "", cost: "" }));
  }, [returnForm.purchaseId, purchases]);

  const submit = async (e) => {
    e.preventDefault();
    await api.post("/purchases", {
      supplierId: Number(form.supplierId),
      invoiceNo: form.invoiceNo || null,
      paidAmount: Number(form.paidAmount || 0),
      items: [{ productId: Number(form.productId), qty: Number(form.qty), cost: Number(form.cost) }],
    });
    setForm({ supplierId: "", invoiceNo: "", paidAmount: "", productId: "", qty: "", cost: "" });
    load();
  };

  const submitReturn = async (e) => {
    e.preventDefault();
    await api.post(`/purchases/${Number(returnForm.purchaseId)}/return`, {
      reason: returnForm.reason,
      items: [
        {
          productId: Number(returnForm.productId),
          qty: Number(returnForm.qty),
          cost: Number(returnForm.cost),
        },
      ],
    });
    setReturnForm({ purchaseId: "", productId: "", qty: "", cost: "", reason: "" });
    setReturnItems([]);
    load();
  };

  const exportReturns = async (format) => {
    const query = new URLSearchParams();
    if (returnRange.from) query.set("from", returnRange.from);
    if (returnRange.to) query.set("to", returnRange.to);
    const url = `/purchases/returns/export.${format}${query.toString() ? `?${query.toString()}` : ""}`;
    const filename = format === "csv" ? "purchase-returns.csv" : "purchase-returns.pdf";
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const setReturnPresetRange = (preset) => {
    const now = new Date();
    if (preset === "today") {
      const today = toInputDate(now);
      setReturnRange({ from: today, to: today });
      return;
    }
    if (preset === "last7") {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      setReturnRange({ from: toInputDate(from), to: toInputDate(now) });
      return;
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setReturnRange({ from: toInputDate(start), to: toInputDate(now) });
      return;
    }
    setReturnRange({ from: "", to: "" });
  };

  return (
    <div>
      <h2>Purchases</h2>
      <form onSubmit={submit} className="form-grid">
        <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
          <option value="">Select Supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input placeholder="Invoice No" value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} />
        <input placeholder="Paid Amount" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} />
        <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Select Product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input placeholder="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <button type="submit">Create Purchase</button>
      </form>

      <h4 style={{ marginTop: 8 }}>Purchase Return</h4>
      <form onSubmit={submitReturn} className="form-grid">
        <select value={returnForm.purchaseId} onChange={(e) => setReturnForm({ ...returnForm, purchaseId: e.target.value })}>
          <option value="">Select Purchase</option>
          {purchases.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id} - {p.supplier?.name || "Supplier"} - ৳{Number(p.total || 0).toFixed(2)}
            </option>
          ))}
        </select>
        <select value={returnForm.productId} onChange={(e) => setReturnForm({ ...returnForm, productId: e.target.value })}>
          <option value="">Select Product</option>
          {returnItems.map((i) => (
            <option key={i.productId} value={i.productId}>
              Product #{i.productId} (Purchased Qty: {i.qty}, Cost: ৳{Number(i.cost || 0).toFixed(2)})
            </option>
          ))}
        </select>
        <input placeholder="Return Qty" value={returnForm.qty} onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })} />
        <input placeholder="Return Cost" value={returnForm.cost} onChange={(e) => setReturnForm({ ...returnForm, cost: e.target.value })} />
        <input placeholder="Reason" value={returnForm.reason} onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })} />
        <button type="submit">Create Purchase Return</button>
      </form>
      <div className="quick-stats">
        <div className="stat">Bills: {purchases.length}</div>
        <div className="stat">Total: ৳{purchases.reduce((s, p) => s + Number(p.total), 0).toFixed(2)}</div>
        <div className="stat">Paid: ৳{purchases.reduce((s, p) => s + Number(p.paidAmount), 0).toFixed(2)}</div>
        <div className="stat">Due: ৳{purchases.reduce((s, p) => s + Number(p.dueAmount), 0).toFixed(2)}</div>
      </div>
      <DataTable
        title="Purchase History"
        rows={purchases.map((p) => ({ ...p, supplierName: p.supplier?.name || "-" }))}
        searchableKeys={["supplierName", "invoiceNo"]}
        filters={[
          {
            key: "supplierName",
            label: "Supplier",
            options: [...new Set(purchases.map((p) => p.supplier?.name).filter(Boolean))].map((x) => ({
              label: x,
              value: x,
            })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "supplierName", label: "Supplier" },
          { key: "invoiceNo", label: "Invoice", render: (v) => v || "-" },
          { key: "total", label: "Total", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "paidAmount", label: "Paid", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "dueAmount", label: "Due", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title="Purchase Return History"
        rows={purchaseReturns.map((r) => ({
          ...r,
          purchaseId: r.purchase?.id || r.purchaseId,
          supplierName: r.purchase?.supplier?.name || "-",
          invoiceNo: r.purchase?.invoiceNo || "-",
          createdAtLabel: new Date(r.createdAt).toLocaleString(),
        }))}
        searchableKeys={["supplierName", "invoiceNo", "reason", "createdAtLabel"]}
        filters={[
          {
            key: "supplierName",
            label: "Supplier",
            options: [...new Set(purchaseReturns.map((r) => r.purchase?.supplier?.name).filter(Boolean))].map((x) => ({
              label: x,
              value: x,
            })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "purchaseId", label: "Purchase ID" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "supplierName", label: "Supplier" },
          { key: "amount", label: "Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "reason", label: "Reason", render: (v) => v || "-" },
          { key: "createdAtLabel", label: "Date" },
        ]}
      />
      <div className="form-grid">
        <input
          type="date"
          value={returnRange.from}
          onChange={(e) => setReturnRange((prev) => ({ ...prev, from: e.target.value }))}
        />
        <input
          type="date"
          value={returnRange.to}
          onChange={(e) => setReturnRange((prev) => ({ ...prev, to: e.target.value }))}
        />
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("today")}>
          Today
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("last7")}>
          Last 7 Days
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("month")}>
          This Month
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("clear")}>
          Clear Range
        </button>
        <button type="button" onClick={() => exportReturns("csv")}>Export Return CSV</button>
        <button type="button" className="btn-secondary" onClick={() => exportReturns("pdf")}>Export Return PDF</button>
      </div>
    </div>
  );
}

export default Purchases;
