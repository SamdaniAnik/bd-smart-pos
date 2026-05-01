import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Inventory() {
  const [ledger, setLedger] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [adjustment, setAdjustment] = useState({ productId: "", warehouseId: "", qtyChange: "", reason: "" });
  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);

  const load = async () => {
    const [ledgerRes, adjustmentRes, productRes, warehouseRes] = await Promise.all([
      api.get("/inventory/ledger"),
      api.get("/inventory/adjustments"),
      api.get("/products"),
      api.get("/warehouses"),
    ]);
    setLedger(ledgerRes.data);
    setAdjustments(adjustmentRes.data);
    setProducts(productRes.data);
    setWarehouses(warehouseRes.data);
  };

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div>
      <h2>Inventory Ledger</h2>
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
    </div>
  );
}

export default Inventory;
