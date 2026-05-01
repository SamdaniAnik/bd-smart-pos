import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";

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
  const [form, setForm] = useState({
    supplierId: "",
    invoiceNo: "",
    paidAmount: "",
    productId: "",
    qty: "",
    cost: "",
    vatRate: "",
    vatType: "EXCLUSIVE",
  });
  const [returnForm, setReturnForm] = useState({
    purchaseId: "",
    productId: "",
    qty: "",
    cost: "",
    reason: "",
  });
  const [returnRange, setReturnRange] = useState({ from: "", to: "" });
  const [draftItems, setDraftItems] = useState([]);
  const [purchaseDetailsModal, setPurchaseDetailsModal] = useState({ open: false, loading: false, data: null });

  const load = useCallback(async () => {
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
  }, [returnRange.from, returnRange.to]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const loadDraft = () => {
      try {
        const raw = localStorage.getItem(PURCHASE_DRAFT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setDraftItems(Array.isArray(parsed) ? parsed : []);
      } catch {
        setDraftItems([]);
      }
    };
    const timer = setTimeout(loadDraft, 0);
    window.addEventListener("storage", loadDraft);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", loadDraft);
    };
  }, []);

  const returnItems = useMemo(() => {
    const purchase = purchases.find((p) => String(p.id) === String(returnForm.purchaseId));
    return purchase?.items || [];
  }, [returnForm.purchaseId, purchases]);

  const productVatById = useMemo(
    () => new Map((products || []).map((p) => [Number(p.id), Number(p.vatRate || 0)])),
    [products]
  );

  const suggestedSupplierByProduct = useMemo(() => {
    const byProduct = new Map();
    const sorted = [...purchases].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    for (const purchase of sorted) {
      const supplierId = Number(purchase.supplierId || 0);
      const supplierName = purchase.supplier?.name || "";
      if (!supplierId) continue;
      for (const item of purchase.items || []) {
        const productId = Number(item.productId || 0);
        if (!productId || byProduct.has(productId)) continue;
        byProduct.set(productId, {
          supplierId,
          supplierName,
          lastCost: Number(item.cost || 0),
          lastPurchaseId: purchase.id,
          lastPurchaseAt: purchase.createdAt,
        });
      }
    }
    return byProduct;
  }, [purchases]);

  const draftSuggestions = useMemo(
    () =>
      draftItems.map((x) => ({
        ...x,
        suggestion: suggestedSupplierByProduct.get(Number(x.productId)) || null,
      })),
    [draftItems, suggestedSupplierByProduct]
  );

  const draftSupplierSummary = useMemo(() => {
    const counts = new Map();
    for (const row of draftSuggestions) {
      if (!row.suggestion?.supplierId) continue;
      const id = Number(row.suggestion.supplierId);
      const label = row.suggestion.supplierName || `Supplier #${id}`;
      counts.set(id, {
        supplierId: id,
        supplierName: label,
        count: Number(counts.get(id)?.count || 0) + 1,
      });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [draftSuggestions]);

  const submit = async (e) => {
    e.preventDefault();
    const manualLine =
      form.productId && form.qty
        ? [
            {
              productId: Number(form.productId),
              qty: Number(form.qty),
              cost: Number(form.cost || 0),
              vatRate: Number(form.vatRate || productVatById.get(Number(form.productId)) || 0),
              vatType: String(form.vatType || "EXCLUSIVE").toUpperCase(),
            },
          ]
        : [];
    const draftLines = draftItems
      .map((x) => ({
        productId: Number(x.productId),
        qty: Number(x.qty || 0),
        cost: Number(x.cost || 0),
        vatRate: Number(
          x.vatRate != null ? x.vatRate : productVatById.get(Number(x.productId)) || 0
        ),
        vatType: String(x.vatType || "EXCLUSIVE").toUpperCase(),
      }))
      .filter((x) => x.productId && x.qty > 0);
    const lineMap = new Map();
    for (const line of [...manualLine, ...draftLines]) {
      if (!lineMap.has(line.productId)) {
        lineMap.set(line.productId, { ...line });
      } else {
        const prev = lineMap.get(line.productId);
        lineMap.set(line.productId, {
          ...prev,
          qty: Number(prev.qty || 0) + Number(line.qty || 0),
          cost: Number(line.cost || prev.cost || 0),
        });
      }
    }
    const lines = [...lineMap.values()].filter((x) => x.qty > 0);
    if (!lines.length) {
      alert("Add at least one purchase line or apply draft items.");
      return;
    }
    await api.post("/purchases", {
      supplierId: Number(form.supplierId),
      invoiceNo: form.invoiceNo || null,
      paidAmount: Number(form.paidAmount || 0),
      items: lines,
    });
    setForm({
      supplierId: "",
      invoiceNo: "",
      paidAmount: "",
      productId: "",
      qty: "",
      cost: "",
      vatRate: "",
      vatType: "EXCLUSIVE",
    });
    setDraftItems([]);
    localStorage.removeItem(PURCHASE_DRAFT_KEY);
    load();
  };

  const createSplitPurchasesBySuggestedSupplier = async () => {
    const grouped = new Map();
    const unmatched = [];
    for (const row of draftSuggestions) {
      const productId = Number(row.productId);
      const qty = Number(row.qty || 0);
      const cost = Number(row.cost || 0);
      const suggestedSupplierId = Number(row.suggestion?.supplierId || 0);
      if (!productId || qty <= 0) continue;
      if (!suggestedSupplierId) {
        unmatched.push(row);
        continue;
      }
      if (!grouped.has(suggestedSupplierId)) grouped.set(suggestedSupplierId, []);
      grouped.get(suggestedSupplierId).push({
        productId,
        qty,
        cost,
        vatRate: Number(
          row.vatRate != null ? row.vatRate : productVatById.get(Number(row.productId)) || 0
        ),
        vatType: String(row.vatType || "EXCLUSIVE").toUpperCase(),
      });
    }
    if (!grouped.size) {
      alert("No draft items have supplier suggestions yet.");
      return;
    }
    const confirmed = window.confirm(
      `Create ${grouped.size} purchase bill(s) split by suggested supplier?`
    );
    if (!confirmed) return;

    for (const [supplierId, items] of grouped.entries()) {
      await api.post("/purchases", {
        supplierId: Number(supplierId),
        invoiceNo: null,
        paidAmount: 0,
        items: items.map((item) => ({
          ...item,
          vatRate: Number(
            item.vatRate != null ? item.vatRate : productVatById.get(Number(item.productId)) || 0
          ),
          vatType: String(item.vatType || "EXCLUSIVE").toUpperCase(),
        })),
      });
    }

    const nextDraftItems = unmatched.map((x) => ({
      productId: Number(x.productId),
      productName: x.productName,
      qty: Number(x.qty || 0),
      cost: Number(x.cost || 0),
      vatRate: Number(
        x.vatRate != null ? x.vatRate : productVatById.get(Number(x.productId)) || 0
      ),
      vatType: String(x.vatType || "EXCLUSIVE").toUpperCase(),
    }));
    setDraftItems(nextDraftItems);
    if (nextDraftItems.length) {
      localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(nextDraftItems));
      alert(
        `Created ${grouped.size} purchase bill(s). ${nextDraftItems.length} item(s) remain without suggestions.`
      );
    } else {
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
      alert(`Created ${grouped.size} purchase bill(s). Draft is now empty.`);
    }
    await load();
  };

  const removeDraftItem = (productId) => {
    const next = draftItems.filter((x) => Number(x.productId) !== Number(productId));
    setDraftItems(next);
    localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(next));
  };

  const clearDraftItems = () => {
    setDraftItems([]);
    localStorage.removeItem(PURCHASE_DRAFT_KEY);
  };

  const applySuggestedSupplier = (supplierId) => {
    setForm((prev) => ({
      ...prev,
      supplierId: String(supplierId || ""),
    }));
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

  const openPurchaseDetails = async (row) => {
    setPurchaseDetailsModal({ open: true, loading: true, data: null });
    try {
      const res = await api.get(`/purchases/${Number(row.id)}`);
      setPurchaseDetailsModal({ open: true, loading: false, data: res.data });
    } catch (error) {
      setPurchaseDetailsModal({ open: true, loading: false, data: { error: error?.response?.data?.error || "Failed to load purchase details" } });
    }
  };

  const closePurchaseDetails = () => {
    setPurchaseDetailsModal({ open: false, loading: false, data: null });
  };

  return (
    <div>
      <h2>Purchases</h2>
      {draftItems.length ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <h4>Low-Stock Purchase Draft ({draftItems.length} items)</h4>
          {draftSupplierSummary.length ? (
            <div style={{ marginBottom: 8 }}>
              <strong>Suggested supplier:</strong>{" "}
              {draftSupplierSummary[0].supplierName} ({draftSupplierSummary[0].count}/{draftItems.length} items)
              <button
                type="button"
                className="btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => applySuggestedSupplier(draftSupplierSummary[0].supplierId)}
              >
                Use This Supplier
              </button>
              {draftSupplierSummary.length > 1 ? (
                <span style={{ marginLeft: 8, color: "var(--muted)" }}>
                  Multiple suppliers detected
                </span>
              ) : null}
            </div>
          ) : (
            <div style={{ marginBottom: 8, color: "var(--muted)" }}>
              No purchase history match found for draft items.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {draftSuggestions.map((x) => (
              <div key={`draft-${x.productId}`} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>
                  {x.productName || `Product #${x.productId}`} · Qty {Number(x.qty || 0)} · Cost ৳
                  {Number(x.cost || 0).toFixed(2)}
                  {" · VAT "}
                  {Number(
                    x.vatRate != null ? x.vatRate : productVatById.get(Number(x.productId)) || 0
                  ).toFixed(2)}
                  % ({String(x.vatType || "EXCLUSIVE").toUpperCase() === "INCLUSIVE" ? "Inclusive" : "Exclusive"})
                  {x.suggestion ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · Suggested: {x.suggestion.supplierName || `Supplier #${x.suggestion.supplierId}`} (last ৳
                      {Number(x.suggestion.lastCost || 0).toFixed(2)})
                    </span>
                  ) : null}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {x.suggestion?.supplierId ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => applySuggestedSupplier(x.suggestion.supplierId)}
                    >
                      Use Supplier
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => removeDraftItem(x.productId)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={clearDraftItems} style={{ marginTop: 8 }}>
            Clear Draft
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={createSplitPurchasesBySuggestedSupplier}
            style={{ marginTop: 8, marginLeft: 8 }}
          >
            Auto Split & Create Bills
          </button>
        </div>
      ) : null}
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
        <select
          value={form.productId}
          onChange={(e) => {
            const productId = Number(e.target.value || 0);
            setForm({
              ...form,
              productId: e.target.value,
              vatRate: productId ? String(productVatById.get(productId) || 0) : "",
              vatType: "EXCLUSIVE",
            });
          }}
        >
          <option value="">Select Product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input placeholder="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <input
          placeholder="VAT %"
          type="number"
          min={0}
          step={0.01}
          value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
        />
        <select
          value={form.vatType}
          onChange={(e) => setForm({ ...form, vatType: e.target.value })}
        >
          <option value="EXCLUSIVE">VAT Exclusive</option>
          <option value="INCLUSIVE">VAT Inclusive</option>
        </select>
        <button type="submit">Create Purchase</button>
      </form>

      <h4 style={{ marginTop: 8 }}>Purchase Return</h4>
      <form onSubmit={submitReturn} className="form-grid">
        <select
          value={returnForm.purchaseId}
          onChange={(e) =>
            setReturnForm({
              ...returnForm,
              purchaseId: e.target.value,
              productId: "",
              qty: "",
              cost: "",
            })
          }
        >
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
        rows={purchases.map((p) => ({
          ...p,
          supplierName: p.supplier?.name || "-",
          createdAtLabel: new Date(p.createdAt).toLocaleString(),
          taxableAmount: Number(p.vatBreakdown?.taxableAmount || Math.max(0, Number(p.total || 0))).toFixed(2),
          inputVat: Number(p.vatBreakdown?.inputVat || 0).toFixed(2),
          grossAmount: Number(p.vatBreakdown?.grossAmount || p.total || 0).toFixed(2),
        }))}
        searchableKeys={["supplierName", "invoiceNo", "createdAtLabel"]}
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
          { key: "createdAtLabel", label: "Date" },
          { key: "supplierName", label: "Supplier" },
          { key: "invoiceNo", label: "Invoice", render: (v) => v || "-" },
          { key: "total", label: "Total", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "taxableAmount", label: "Taxable", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "inputVat", label: "Input VAT", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "grossAmount", label: "Gross", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "paidAmount", label: "Paid", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "dueAmount", label: "Due", render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <button type="button" className="btn-secondary btn-sm" onClick={() => openPurchaseDetails(row)}>
                Details
              </button>
            ),
          },
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
      {purchaseDetailsModal.open ? (
        <div className="shortcuts-overlay" onClick={closePurchaseDetails}>
          <div
            className="shortcuts-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 980 }}
          >
            <div className="shortcuts-modal-head">
              <h3>Purchase VAT Details</h3>
              <button type="button" className="btn-secondary btn-sm" onClick={closePurchaseDetails}>
                Close
              </button>
            </div>
            {purchaseDetailsModal.loading ? (
              <p className="text-muted">Loading...</p>
            ) : purchaseDetailsModal.data?.error ? (
              <p style={{ color: "#b91c1c" }}>{purchaseDetailsModal.data.error}</p>
            ) : (
              <>
                <div className="quick-stats" style={{ marginBottom: 8 }}>
                  <div className="stat">Purchase ID: {purchaseDetailsModal.data?.id}</div>
                  <div className="stat">Invoice: {purchaseDetailsModal.data?.invoiceNo || "-"}</div>
                  <div className="stat">Supplier: {purchaseDetailsModal.data?.supplier?.name || "-"}</div>
                  <div className="stat">Taxable: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.taxableAmount || 0).toFixed(2)}</div>
                  <div className="stat">Input VAT: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.inputVat || 0).toFixed(2)}</div>
                  <div className="stat">Gross: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.grossAmount || 0).toFixed(2)}</div>
                </div>
                <DataTable
                  title="Line-wise VAT Trace"
                  rows={(purchaseDetailsModal.data?.vatLines || []).map((line, idx) => ({
                    rowNo: idx + 1,
                    ...line,
                  }))}
                  searchableKeys={["productName", "vatType"]}
                  pageSize={5}
                  columns={[
                    { key: "rowNo", label: "SL" },
                    { key: "productName", label: "Product" },
                    { key: "qty", label: "Qty" },
                    { key: "cost", label: "Unit Cost", render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "vatRate", label: "VAT %" },
                    { key: "vatType", label: "VAT Type" },
                    { key: "taxableAmount", label: "Taxable", render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "vatAmount", label: "VAT", render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "grossAmount", label: "Gross", render: (v) => `৳${Number(v).toFixed(2)}` },
                  ]}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Purchases;
