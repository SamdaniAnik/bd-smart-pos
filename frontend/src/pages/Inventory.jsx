import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";

function Inventory() {
  const [ledger, setLedger] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [lowStockRows, setLowStockRows] = useState([]);
  const [lowStockSummary, setLowStockSummary] = useState({ totalTracked: 0, outOfStock: 0, lowStock: 0 });
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [targetBranchProducts, setTargetBranchProducts] = useState([]);
  const [showOnlyCriticalLowStock, setShowOnlyCriticalLowStock] = useState(true);
  const [adjustment, setAdjustment] = useState({ productId: "", warehouseId: "", qtyChange: "", reason: "" });
  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);
  const [transferForm, setTransferForm] = useState({
    toBranchId: "",
    items: [{ fromProductId: "", toProductId: "", qty: "" }],
  });

  const load = useCallback(async () => {
    const [ledgerRes, adjustmentRes, productRes, warehouseRes, transferRes, lowStockRes, branchRes] = await Promise.all([
      api.get("/inventory/ledger"),
      api.get("/inventory/adjustments"),
      api.get("/products"),
      api.get("/warehouses"),
      api.get("/inventory/transfers"),
      api.get(`/inventory/alerts/low-stock?onlyCritical=${showOnlyCriticalLowStock}`),
      api.get("/branches"),
    ]);
    setLedger(ledgerRes.data);
    setAdjustments(adjustmentRes.data);
    setProducts(productRes.data);
    setWarehouses(warehouseRes.data);
    setTransfers(transferRes.data || []);
    setLowStockRows(lowStockRes.data?.rows || []);
    setLowStockSummary(
      lowStockRes.data?.summary || { totalTracked: 0, outOfStock: 0, lowStock: 0 }
    );
    setBranches(branchRes.data || []);
  }, [showOnlyCriticalLowStock]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const toBranchId = Number(transferForm.toBranchId || 0);
    const timer = setTimeout(() => {
      if (!toBranchId) {
        setTargetBranchProducts([]);
        return;
      }
      api
        .get(`/inventory/transfers/branch-products/${toBranchId}`)
        .then((res) => setTargetBranchProducts(res.data || []))
        .catch(() => setTargetBranchProducts([]));
    }, 0);
    return () => clearTimeout(timer);
  }, [transferForm.toBranchId]);

  const submitAdjustment = async (e) => {
    e.preventDefault();
    const payload = {
      productId: Number(adjustment.productId),
      warehouseId: adjustment.warehouseId ? Number(adjustment.warehouseId) : null,
      qtyChange: Number(adjustment.qtyChange),
      reason: adjustment.reason,
    };
    if (editingAdjustmentId) {
      await api.put(`/inventory/adjustments/${editingAdjustmentId}`, payload);
    } else {
      await api.post("/inventory/adjustments", payload);
    }
    setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "" });
    setEditingAdjustmentId(null);
    load();
  };

  const editAdjustment = (row) => {
    setEditingAdjustmentId(row.id);
    setAdjustment({
      productId: String(row.productId),
      warehouseId: row.warehouseId ? String(row.warehouseId) : "",
      qtyChange: String(row.qtyChange),
      reason: row.reason || "",
    });
  };

  const deleteAdjustment = async (row) => {
    if (!window.confirm("Delete this ledger adjustment?")) return;
    await api.delete(`/inventory/adjustments/${row.id}`);
    if (editingAdjustmentId === row.id) {
      setEditingAdjustmentId(null);
      setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "" });
    }
    load();
  };

  const upsertTransferItem = (idx, patch) => {
    setTransferForm((prev) => ({
      ...prev,
      items: prev.items.map((row, rowIdx) => {
        if (rowIdx !== idx) return row;
        return { ...row, ...patch };
      }),
    }));
  };

  const addTransferLine = () => {
    setTransferForm((prev) => ({
      ...prev,
      items: [...prev.items, { fromProductId: "", toProductId: "", qty: "" }],
    }));
  };

  const removeTransferLine = (idx) => {
    setTransferForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, rowIdx) => rowIdx !== idx),
    }));
  };

  const fromProductMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const submitTransfer = async (e) => {
    e.preventDefault();
    const toBranchId = Number(transferForm.toBranchId);
    if (!toBranchId) {
      alert("Select destination branch");
      return;
    }
    const items = transferForm.items
      .map((x) => ({
        fromProductId: Number(x.fromProductId),
        toProductId: Number(x.toProductId),
        qty: Number(x.qty),
      }))
      .filter((x) => x.fromProductId && x.toProductId && Number.isInteger(x.qty) && x.qty > 0);
    if (!items.length) {
      alert("Add at least one valid transfer line");
      return;
    }
    await api.post("/inventory/transfers", { toBranchId, items });
    setTransferForm({
      toBranchId: "",
      items: [{ fromProductId: "", toProductId: "", qty: "" }],
    });
    setTargetBranchProducts([]);
    load();
  };

  const appendLowStockToPurchaseDraft = (items) => {
    const normalized = (Array.isArray(items) ? items : [])
      .map((x) => ({
        productId: Number(x.productId),
        productName: String(x.productName || x.name || "").trim(),
        qty: Math.max(1, Number(x.qty || x.shortageQty || 1)),
        cost: Number(x.cost || x.price || 0),
      }))
      .filter((x) => x.productId && x.productName && x.qty > 0);
    if (!normalized.length) return;
    let existing = [];
    try {
      existing = JSON.parse(localStorage.getItem(PURCHASE_DRAFT_KEY) || "[]");
      if (!Array.isArray(existing)) existing = [];
    } catch {
      // Ignore malformed previous draft and continue with empty draft.
    }
    const map = new Map();
    for (const row of [...existing, ...normalized]) {
      const key = Number(row.productId);
      if (!map.has(key)) {
        map.set(key, {
          productId: key,
          productName: row.productName,
          qty: Number(row.qty || 0),
          cost: Number(row.cost || 0),
        });
      } else {
        const current = map.get(key);
        map.set(key, {
          ...current,
          qty: Number(current.qty || 0) + Number(row.qty || 0),
          cost: Number(row.cost || current.cost || 0),
        });
      }
    }
    localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify([...map.values()]));
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "purchases" } }));
  };

  const transferRows = useMemo(
    () =>
      transfers.map((row) => ({
        ...row,
        createdAtLabel: new Date(row.createdAt).toLocaleString(),
        fromBranchName: row.fromBranch?.name || `#${row.fromBranchId}`,
        toBranchName: row.toBranch?.name || `#${row.toBranchId}`,
        directionLabel:
          row.fromBranchId === Number(localStorage.getItem("bd_pos_branch_id") || "1")
            ? "Outbound"
            : "Inbound",
        itemCount: row.items?.length || 0,
        qtyTotal: (row.items || []).reduce((sum, x) => sum + Number(x.qty || 0), 0),
      })),
    [transfers]
  );

  return (
    <div>
      <h2>Inventory Ledger</h2>
      <div className="quick-stats">
        <div className="stat-chip">Tracked reorder products: {lowStockSummary.totalTracked}</div>
        <div className="stat-chip">Out of stock: {lowStockSummary.outOfStock}</div>
        <div className="stat-chip">Low stock: {lowStockSummary.lowStock}</div>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "8px 0 4px" }}>
        <input
          type="checkbox"
          checked={showOnlyCriticalLowStock}
          onChange={(e) => setShowOnlyCriticalLowStock(e.target.checked)}
        />
        Show only low/out of stock
      </label>
      <DataTable
        title="Low Stock Alerts"
        rows={lowStockRows}
        searchableKeys={["name", "sku", "category"]}
        columns={[
          { key: "name", label: "Product" },
          { key: "sku", label: "SKU", render: (v) => v || "-" },
          { key: "category", label: "Category", render: (v) => v || "-" },
          { key: "stock", label: "Stock" },
          { key: "reorderLevel", label: "Reorder Level" },
          { key: "shortageQty", label: "Shortage" },
          {
            key: "status",
            label: "Status",
            render: (v) =>
              v === "OUT" ? (
                <span className="badge badge-danger">OUT</span>
              ) : v === "LOW" ? (
                <span className="badge badge-warning">LOW</span>
              ) : (
                <span className="badge badge-success">OK</span>
              ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  appendLowStockToPurchaseDraft([
                    {
                      productId: row.id,
                      productName: row.name,
                      qty: Math.max(1, Number(row.shortageQty || 1)),
                      cost: Number(row.price || 0),
                    },
                  ])
                }
              >
                Create Purchase Draft
              </button>
            ),
          },
        ]}
      />
      {lowStockRows.length ? (
        <div style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() =>
              appendLowStockToPurchaseDraft(
                lowStockRows
                  .filter((x) => x.status === "LOW" || x.status === "OUT")
                  .map((x) => ({
                    productId: x.id,
                    productName: x.name,
                    qty: Math.max(1, Number(x.shortageQty || 1)),
                    cost: Number(x.price || 0),
                  }))
              )
            }
          >
            Create Draft for All Low/Out Items
          </button>
        </div>
      ) : null}
      <form onSubmit={submitAdjustment} className="form-grid">
        <select value={adjustment.productId} onChange={(e) => setAdjustment({ ...adjustment, productId: e.target.value })}>
          <option value="">Select Product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={adjustment.warehouseId} onChange={(e) => setAdjustment({ ...adjustment, warehouseId: e.target.value })}>
          <option value="">Select Warehouse (Optional)</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Qty Change (+/-)"
          value={adjustment.qtyChange}
          onChange={(e) => setAdjustment({ ...adjustment, qtyChange: e.target.value })}
        />
        <input
          placeholder="Reason"
          value={adjustment.reason}
          onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
        />
        <button type="submit">{editingAdjustmentId ? "Update Adjustment" : "Add Adjustment"}</button>
        {editingAdjustmentId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingAdjustmentId(null);
              setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "" });
            }}
          >
            Cancel
          </button>
        ) : null}
      </form>
      <DataTable
        title="Ledger Master (Add/Edit/Delete)"
        rows={adjustments.map((r) => ({
          ...r,
          createdAtLabel: new Date(r.createdAt).toLocaleString(),
        }))}
        searchableKeys={["productName", "reason", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "productName", label: "Product" },
          { key: "warehouseName", label: "Warehouse" },
          { key: "qtyChange", label: "Qty Change" },
          { key: "reason", label: "Reason", render: (v) => v || "-" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editAdjustment(row)}>Edit</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteAdjustment(row)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
      <DataTable
        title="Stock Ledger"
        rows={ledger.map((r) => ({
          ...r,
          productName: r.product?.name || `#${r.productId}`,
          warehouseName: r.warehouse?.name || "-",
          createdAtLabel: new Date(r.createdAt).toLocaleString(),
        }))}
        searchableKeys={["productName", "warehouseName", "refType", "createdAtLabel"]}
        filters={[
          {
            key: "refType",
            label: "Ref Type",
            options: [...new Set(ledger.map((r) => r.refType))].map((x) => ({ label: x, value: x })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "refType", label: "Ref Type" },
          { key: "productName", label: "Product" },
          { key: "warehouseName", label: "Warehouse" },
          { key: "inQty", label: "In" },
          { key: "outQty", label: "Out" },
        ]}
      />
      <div className="page-card" style={{ marginTop: 14 }}>
        <h3>Branch Stock Transfer</h3>
        <form onSubmit={submitTransfer}>
          <div className="form-grid">
            <select
              value={transferForm.toBranchId}
              onChange={(e) =>
                setTransferForm({
                  toBranchId: e.target.value,
                  items: [{ fromProductId: "", toProductId: "", qty: "" }],
                })
              }
            >
              <option value="">Destination Branch</option>
              {branches
                .filter((b) => Number(b.id) !== Number(localStorage.getItem("bd_pos_branch_id") || "1"))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} {b.name}
                  </option>
                ))}
            </select>
          </div>
          {transferForm.items.map((line, idx) => (
            <div key={`transfer-line-${idx}`} className="form-grid" style={{ marginTop: 8 }}>
              <select
                value={line.fromProductId}
                onChange={(e) => {
                  const fromProductId = e.target.value;
                  const fromProduct = fromProductMap.get(Number(fromProductId));
                  const autoMatch = targetBranchProducts.find(
                    (p) =>
                      fromProduct?.sku &&
                      p.sku &&
                      String(p.sku).trim().toLowerCase() === String(fromProduct.sku).trim().toLowerCase()
                  );
                  upsertTransferItem(idx, {
                    fromProductId,
                    toProductId: autoMatch ? String(autoMatch.id) : line.toProductId,
                  });
                }}
              >
                <option value="">From Product (Current Branch)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""} - Stock {p.stock}
                  </option>
                ))}
              </select>
              <select
                value={line.toProductId}
                onChange={(e) => upsertTransferItem(idx, { toProductId: e.target.value })}
              >
                <option value="">To Product (Destination Branch)</option>
                {targetBranchProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Qty"
                value={line.qty}
                onChange={(e) => upsertTransferItem(idx, { qty: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={addTransferLine}>
                  + Line
                </button>
                {transferForm.items.length > 1 ? (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => removeTransferLine(idx)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <button type="submit" style={{ marginTop: 8 }}>
            Create Transfer
          </button>
        </form>
      </div>
      <DataTable
        title="Stock Transfers"
        rows={transferRows}
        searchableKeys={["createdAtLabel", "status", "directionLabel", "fromBranchName", "toBranchName"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "directionLabel", label: "Direction" },
          { key: "status", label: "Status" },
          { key: "fromBranchName", label: "From" },
          { key: "toBranchName", label: "To" },
          { key: "itemCount", label: "Lines" },
          { key: "qtyTotal", label: "Total Qty" },
          {
            key: "items",
            label: "Items",
            render: (_, row) =>
              (row.items || [])
                .map((x) => `${x.fromProduct?.name || x.fromProductId} -> ${x.toProduct?.name || x.toProductId} (${x.qty})`)
                .join(", "),
          },
        ]}
      />
    </div>
  );
}

export default Inventory;
