import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { createSearchSelectStyles } from "../utils/selectStyles";
import {
  notifyActionRequired,
  notifyError,
  notifyPermissionRequired,
  notifySuccess,
} from "../utils/notify";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";
const APPROVAL_FOCUS_KEY = "bd_pos_approval_focus_id";
const SEARCH_SELECT_STYLES = createSearchSelectStyles(32);

function Inventory() {
  const permissions = getStoredPermissions();
  const canAdjustInventory = hasPermission("inventory.adjust", permissions);
  const canTransferInventory = hasPermission("inventory.transfer", permissions);
  const canExportReports = hasPermission("accounting.report", permissions);

  const [ledger, setLedger] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [lowStockRows, setLowStockRows] = useState([]);
  const [lowStockSummary, setLowStockSummary] = useState({ totalTracked: 0, outOfStock: 0, lowStock: 0 });
  const [products, setProducts] = useState([]);
  const [adjustReasons, setAdjustReasons] = useState([]);
  const [allAdjustReasons, setAllAdjustReasons] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [targetBranchProducts, setTargetBranchProducts] = useState([]);
  const [showOnlyCriticalLowStock, setShowOnlyCriticalLowStock] = useState(true);
  const [batchExpiryWindowDays, setBatchExpiryWindowDays] = useState(30);
  const [batchRows, setBatchRows] = useState([]);
  const [batchAlertRows, setBatchAlertRows] = useState([]);
  const [batchAlertSummary, setBatchAlertSummary] = useState({ tracked: 0, nearExpiryCount: 0, expiredCount: 0 });
  const [transferSuggestionRows, setTransferSuggestionRows] = useState([]);
  const [transferSuggestionSummary, setTransferSuggestionSummary] = useState({ suggestions: 0, totalSuggestedQty: 0 });
  const [intelligenceRangeDays, setIntelligenceRangeDays] = useState(30);
  const [deadStockDays, setDeadStockDays] = useState(60);
  const [leadDays, setLeadDays] = useState(7);
  const [forecastDays, setForecastDays] = useState(14);
  const [intelligenceRows, setIntelligenceRows] = useState([]);
  const [intelligenceSummary, setIntelligenceSummary] = useState({
    fastMovingCount: 0,
    slowMovingCount: 0,
    deadStockCount: 0,
    suggestedReorderCount: 0,
    seasonalityAdjustedCount: 0,
  });
  const [adjustment, setAdjustment] = useState({
    productId: "",
    warehouseId: "",
    qtyChange: "",
    reason: "",
    reasonCode: "",
  });
  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);
  const [transferForm, setTransferForm] = useState({
    toBranchId: "",
    items: [{ fromProductId: "", toProductId: "", qty: "" }],
  });
  const [batchForm, setBatchForm] = useState({
    productId: "",
    batchCode: "",
    expiryDate: "",
    receivedAt: "",
    qtyOnHand: "",
    unitCost: "",
    note: "",
  });
  const [batchAdjustForm, setBatchAdjustForm] = useState({ batchId: "", qtyChange: "", reason: "" });
  const [reasonForm, setReasonForm] = useState({
    code: "",
    label: "",
    direction: "BOTH",
    accountingImpact: "NONE",
    accountCode: "",
    isActive: true,
  });
  const [editingReasonId, setEditingReasonId] = useState(null);
  const [inventoryTab, setInventoryTab] = useState("overview");

  const load = useCallback(async () => {
    const [
      ledgerRes,
      adjustmentRes,
      productRes,
      adjustReasonRes,
      adjustReasonAllRes,
      warehouseRes,
      transferRes,
      lowStockRes,
      branchRes,
      intelRes,
      batchRes,
      batchAlertRes,
      transferSuggestRes,
    ] = await Promise.all([
      api.get("/inventory/ledger"),
      api.get("/inventory/adjustments"),
      api.get("/products"),
      api.get("/inventory/adjust-reasons?active=1"),
      api.get("/inventory/adjust-reasons"),
      api.get("/warehouses"),
      api.get("/inventory/transfers"),
      api.get(`/inventory/alerts/low-stock?onlyCritical=${showOnlyCriticalLowStock}`),
      api.get("/branches"),
      api.get(
        `/inventory/intelligence?days=${encodeURIComponent(intelligenceRangeDays)}&deadDays=${encodeURIComponent(
          deadStockDays
        )}&leadDays=${encodeURIComponent(leadDays)}&forecastDays=${encodeURIComponent(forecastDays)}`
      ),
      api.get("/inventory/batches"),
      api.get(`/inventory/batches/alerts?days=${encodeURIComponent(batchExpiryWindowDays)}`),
      api.get("/inventory/transfers/suggestions"),
    ]);
    setLedger(ledgerRes.data);
    setAdjustments(adjustmentRes.data);
    setProducts(productRes.data);
    setAdjustReasons(adjustReasonRes.data || []);
    setAllAdjustReasons(adjustReasonAllRes.data || []);
    setWarehouses(warehouseRes.data);
    setTransfers(transferRes.data || []);
    setLowStockRows(lowStockRes.data?.rows || []);
    setLowStockSummary(
      lowStockRes.data?.summary || { totalTracked: 0, outOfStock: 0, lowStock: 0 }
    );
    setBranches(branchRes.data || []);
    setIntelligenceRows(intelRes.data?.rows || []);
    setIntelligenceSummary(
      intelRes.data?.summary || {
        fastMovingCount: 0,
        slowMovingCount: 0,
        deadStockCount: 0,
        suggestedReorderCount: 0,
        seasonalityAdjustedCount: 0,
      }
    );
    setBatchRows(batchRes.data || []);
    setBatchAlertRows(batchAlertRes.data?.rows || []);
    setBatchAlertSummary(batchAlertRes.data?.summary || { tracked: 0, nearExpiryCount: 0, expiredCount: 0 });
    setTransferSuggestionRows(transferSuggestRes.data?.rows || []);
    setTransferSuggestionSummary(transferSuggestRes.data?.summary || { suggestions: 0, totalSuggestedQty: 0 });
  }, [showOnlyCriticalLowStock, intelligenceRangeDays, deadStockDays, leadDays, forecastDays, batchExpiryWindowDays]);

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
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    const payload = {
      productId: Number(adjustment.productId),
      warehouseId: adjustment.warehouseId ? Number(adjustment.warehouseId) : null,
      qtyChange: Number(adjustment.qtyChange),
      reason: adjustment.reason,
      reasonCode: adjustment.reasonCode || null,
    };
    try {
      if (editingAdjustmentId) {
        await api.put(`/inventory/adjustments/${editingAdjustmentId}`, payload);
      } else {
        await api.post("/inventory/adjustments", payload);
      }
    } catch (error) {
      if (error?.response?.status === 403) {
        const pin = window.prompt("Manager PIN required for this high-value write-off:");
        if (!pin) return;
        const retryPayload = { ...payload, managerApprovalPin: pin };
        if (editingAdjustmentId) {
          await api.put(`/inventory/adjustments/${editingAdjustmentId}`, retryPayload);
        } else {
          await api.post("/inventory/adjustments", retryPayload);
        }
      } else {
        throw error;
      }
    }
    setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "", reasonCode: "" });
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
      reasonCode: row.reasonCode || "",
    });
  };

  const deleteAdjustment = async (row) => {
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    if (!window.confirm("Delete this ledger adjustment?")) return;
    await api.delete(`/inventory/adjustments/${row.id}`);
    if (editingAdjustmentId === row.id) {
      setEditingAdjustmentId(null);
      setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "", reasonCode: "" });
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
  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p.id),
        label: `${p.name}${p.sku ? ` (${p.sku})` : ""}`,
      })),
    [products]
  );
  const warehouseOptions = useMemo(
    () =>
      warehouses.map((w) => ({
        value: String(w.id),
        label: w.name,
      })),
    [warehouses]
  );
  const adjustReasonOptions = useMemo(
    () =>
      (adjustReasons || []).map((r) => ({
        value: String(r.code),
        label: `${r.code} - ${r.label}`,
      })),
    [adjustReasons]
  );
  const batchOptions = useMemo(
    () =>
      batchRows.map((b) => ({
        value: String(b.id),
        label: `${b.productName} - ${b.batchCode} (Qty ${b.qtyOnHand})`,
      })),
    [batchRows]
  );
  const destinationBranchOptions = useMemo(
    () =>
      branches
        .filter((b) => Number(b.id) !== Number(localStorage.getItem("bd_pos_branch_id") || "1"))
        .map((b) => ({
          value: String(b.id),
          label: `#${b.id} ${b.name}`,
        })),
    [branches]
  );
  const targetBranchProductOptions = useMemo(
    () =>
      targetBranchProducts.map((p) => ({
        value: String(p.id),
        label: `${p.name}${p.sku ? ` (${p.sku})` : ""}`,
      })),
    [targetBranchProducts]
  );

  const submitTransfer = async (e) => {
    e.preventDefault();
    if (!canTransferInventory) {
      notifyPermissionRequired("inventory.transfer.");
      return;
    }
    const toBranchId = Number(transferForm.toBranchId);
    if (!toBranchId) {
      notifyActionRequired("select a destination branch.");
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
      notifyActionRequired("add at least one valid transfer line.");
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

  const submitBatch = async (e) => {
    e.preventDefault();
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    await api.post("/inventory/batches", {
      productId: Number(batchForm.productId),
      batchCode: batchForm.batchCode,
      expiryDate: batchForm.expiryDate || null,
      receivedAt: batchForm.receivedAt || null,
      qtyOnHand: Number(batchForm.qtyOnHand || 0),
      unitCost: Number(batchForm.unitCost || 0),
      note: batchForm.note,
    });
    setBatchForm({
      productId: "",
      batchCode: "",
      expiryDate: "",
      receivedAt: "",
      qtyOnHand: "",
      unitCost: "",
      note: "",
    });
    load();
  };

  const submitReasonMaster = async (e) => {
    e.preventDefault();
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    if (!reasonForm.code.trim() || !reasonForm.label.trim()) {
      notifyActionRequired("reason code and label are required.");
      return;
    }
    const payload = {
      code: reasonForm.code.trim().toUpperCase(),
      label: reasonForm.label.trim(),
      direction: reasonForm.direction,
      accountingImpact: reasonForm.accountingImpact,
      accountCode: reasonForm.accountCode.trim() || null,
      isActive: Boolean(reasonForm.isActive),
    };
    if (editingReasonId) {
      await api.patch(`/inventory/adjust-reasons/${editingReasonId}`, payload);
    } else {
      await api.post("/inventory/adjust-reasons", payload);
    }
    setReasonForm({
      code: "",
      label: "",
      direction: "BOTH",
      accountingImpact: "NONE",
      accountCode: "",
      isActive: true,
    });
    setEditingReasonId(null);
    notifySuccess(editingReasonId ? "adjustment reason updated." : "adjustment reason saved.");
    load();
  };

  const toggleReasonActive = async (row) => {
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    await api.patch(`/inventory/adjust-reasons/${row.id}`, { isActive: !row.isActive });
    notifySuccess("reason status updated.");
    load();
  };

  const startEditReason = (row) => {
    setEditingReasonId(row.id);
    setReasonForm({
      code: row.code || "",
      label: row.label || "",
      direction: row.direction || "BOTH",
      accountingImpact: row.accountingImpact || "NONE",
      accountCode: row.accountCode || "",
      isActive: Boolean(row.isActive),
    });
  };

  const cancelEditReason = () => {
    setEditingReasonId(null);
    setReasonForm({
      code: "",
      label: "",
      direction: "BOTH",
      accountingImpact: "NONE",
      accountCode: "",
      isActive: true,
    });
  };

  const submitBatchAdjustment = async (e) => {
    e.preventDefault();
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    await api.post(`/inventory/batches/${Number(batchAdjustForm.batchId)}/qty`, {
      qtyChange: Number(batchAdjustForm.qtyChange || 0),
      reason: batchAdjustForm.reason,
    });
    setBatchAdjustForm({ batchId: "", qtyChange: "", reason: "" });
    load();
  };

  const createExpiryMarkdownCampaign = async () => {
    if (!canAdjustInventory) {
      notifyPermissionRequired("inventory.adjust.");
      return;
    }
    const ok = window.confirm("Create auto markdown promotions from near-expiry batches?");
    if (!ok) return;
    const res = await api.post("/inventory/batches/markdown-campaign", {
      days: Number(batchExpiryWindowDays || 30),
      validDays: 7,
      maxProducts: 100,
    });
    notifySuccess(res.data?.message || "markdown campaign created.");
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

  const approveTransfer = async (row) => {
    if (!canTransferInventory) {
      notifyPermissionRequired("inventory.transfer.");
      return;
    }
    const pin = window.prompt("Enter manager PIN to approve transfer:");
    if (!pin) return;
    await api.post(`/inventory/transfers/${Number(row.id)}/approve`, { managerApprovalPin: pin });
    notifySuccess("transfer approved and posted to stock.");
    await load();
  };

  const rejectTransfer = async (row) => {
    if (!canTransferInventory) {
      notifyPermissionRequired("inventory.transfer.");
      return;
    }
    const reason = (window.prompt("Rejection reason (optional):") || "").trim();
    await api.post(`/inventory/transfers/${Number(row.id)}/reject`, { reason });
    notifySuccess("transfer rejected.");
    await load();
  };

  const downloadReorderCsv = async () => {
    if (!canExportReports) {
      notifyPermissionRequired("accounting.report to export reorder CSV.");
      return;
    }
    try {
      const res = await api.get("/inventory/reorder-suggestions?format=csv", { responseType: "blob" });
      const blobUrl = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "reorder-suggestions.csv";
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      notifyError("could not export reorder CSV.");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Inventory</div>
          <div className="page-subtitle">Step-by-step inventory workflow</div>
        </div>
      </div>
      <div className="quick-stats">
        <div className="stat-chip">Tracked reorder products: {lowStockSummary.totalTracked}</div>
        <div className="stat-chip">Out of Stock: {lowStockSummary.outOfStock}</div>
        <div className="stat-chip">Low Stock: {lowStockSummary.lowStock}</div>
        <div className="stat-chip">Fast Moving: {intelligenceSummary.fastMovingCount}</div>
        <div className="stat-chip">Slow Moving: {intelligenceSummary.slowMovingCount}</div>
        <div className="stat-chip">Dead Stock: {intelligenceSummary.deadStockCount}</div>
        <div className="stat-chip">Reorder Suggestions: {intelligenceSummary.suggestedReorderCount}</div>
        <div className="stat-chip">Seasonality Adjusted: {intelligenceSummary.seasonalityAdjustedCount}</div>
        <div className="stat-chip">Batch Tracked: {batchAlertSummary.tracked}</div>
        <div className="stat-chip">Near Expiry: {batchAlertSummary.nearExpiryCount}</div>
        <div className="stat-chip">Expired: {batchAlertSummary.expiredCount}</div>
        <div className="stat-chip">Transfer Suggestions: {transferSuggestionSummary.suggestions}</div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label="Inventory workflow">
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "overview"}
            className={`pos-tab ${inventoryTab === "overview" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("overview")}
          >
            1. Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "batches"}
            className={`pos-tab ${inventoryTab === "batches" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("batches")}
          >
            2. Batches & Expiry
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "ops"}
            className={`pos-tab ${inventoryTab === "ops" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("ops")}
          >
            3. Stock Ops
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "transfers"}
            className={`pos-tab ${inventoryTab === "transfers" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("transfers")}
          >
            4. Transfers
          </button>
        </div>
      </div>
      {!canAdjustInventory && (inventoryTab === "batches" || inventoryTab === "ops") ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>inventory.adjust</code> to add batches, adjust batch quantities, and edit/delete stock adjustments.
        </div>
      ) : null}
      {!canTransferInventory && inventoryTab === "transfers" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>inventory.transfer</code> to submit, approve, or reject stock transfers.
        </div>
      ) : null}
      {!canExportReports && inventoryTab === "overview" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>accounting.report</code> to export reorder CSV files.
        </div>
      ) : null}
      {inventoryTab === "overview" ? (
        <div className="pos-tab-panel">
      <div style={{ margin: "10px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-secondary btn-sm" onClick={downloadReorderCsv} disabled={!canExportReports}>
          Download reorder CSV (at/below reorder level)
        </button>
      </div>
      <div className="form-grid" style={{ margin: "8px 0" }}>
        <input
          type="number"
          min={7}
          value={intelligenceRangeDays}
          onChange={(e) => setIntelligenceRangeDays(e.target.value)}
          placeholder="Sales Lookback Days"
        />
        <input
          type="number"
          min={15}
          value={deadStockDays}
          onChange={(e) => setDeadStockDays(e.target.value)}
          placeholder="Dead Stock Days"
        />
        <input
          type="number"
          min={1}
          value={leadDays}
          onChange={(e) => setLeadDays(e.target.value)}
          placeholder="Lead Days"
        />
        <input
          type="number"
          min={1}
          value={forecastDays}
          onChange={(e) => setForecastDays(e.target.value)}
          placeholder="Forecast Days"
        />
        <input
          type="number"
          min={1}
          value={batchExpiryWindowDays}
          onChange={(e) => setBatchExpiryWindowDays(e.target.value)}
          placeholder="Near-Expiry Window Days"
        />
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
        title="Inventory Intelligence (Fast/Slow/Dead + Reorder)"
        rows={intelligenceRows.map((row) => ({
          ...row,
          lastSoldAtLabel: row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleDateString() : "-",
        }))}
        searchableKeys={["name", "sku", "category", "movementClass"]}
        columns={[
          { key: "name", label: "Product" },
          { key: "sku", label: "SKU", render: (v) => v || "-" },
          { key: "category", label: "Category", render: (v) => v || "-" },
          { key: "stock", label: "Stock" },
          { key: "soldQty", label: "Sold Qty" },
          { key: "avgDailySold", label: "Avg/Day", render: (v) => Number(v || 0).toFixed(2) },
          { key: "forecastNeed", label: "Forecast Need", render: (v) => Number(v || 0).toFixed(2) },
          { key: "seasonalityMultiplier", label: "Seasonality", render: (v) => `${Number(v || 1).toFixed(2)}x` },
          { key: "lastSoldAtLabel", label: "Last Sold" },
          { key: "daysSinceLastSale", label: "Days Since Last Sale", render: (v) => (v == null ? "-" : v) },
          {
            key: "movementClass",
            label: "Movement",
            render: (v) =>
              v === "DEAD" ? (
                <span className="badge badge-danger">DEAD</span>
              ) : v === "SLOW" ? (
                <span className="badge badge-warning">SLOW</span>
              ) : v === "FAST" ? (
                <span className="badge badge-success">FAST</span>
              ) : (
                <span className="badge">MEDIUM</span>
              ),
          },
          { key: "reorderSuggestionQty", label: "Suggested Reorder Qty" },
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
                      qty: Math.max(1, Number(row.reorderSuggestionQty || 1)),
                      cost: Number(row.price || 0),
                    },
                  ])
                }
                disabled={Number(row.reorderSuggestionQty || 0) <= 0}
              >
                Add Suggestion to Draft
              </button>
            ),
          },
        ]}
      />
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
                      productId:
                        row.kind === "VARIANT" ? Number(row.productId) : Number(row.id),
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
                    productId: x.kind === "VARIANT" ? Number(x.productId) : Number(x.id),
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
        </div>
      ) : null}
      {inventoryTab === "batches" ? (
        <div className="pos-tab-panel">
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h3>Batch & Expiry Tracking (FEFO Ready)</h3>
        <form onSubmit={submitBatch} className="form-grid" style={{ marginBottom: 8 }}>
          <Select
            className="form-select-sm"
            value={productOptions.find((opt) => opt.value === String(batchForm.productId)) || null}
            options={productOptions}
            onChange={(opt) => setBatchForm((p) => ({ ...p, productId: opt?.value || "" }))}
            placeholder="Select Product"
            isClearable
            isSearchable
            styles={SEARCH_SELECT_STYLES}
          />
          <input
            placeholder="Batch Code"
            value={batchForm.batchCode}
            onChange={(e) => setBatchForm((p) => ({ ...p, batchCode: e.target.value }))}
          />
          <input type="date" value={batchForm.expiryDate} onChange={(e) => setBatchForm((p) => ({ ...p, expiryDate: e.target.value }))} />
          <input type="date" value={batchForm.receivedAt} onChange={(e) => setBatchForm((p) => ({ ...p, receivedAt: e.target.value }))} />
          <input
            type="number"
            min={0}
            step={1}
            placeholder="Quantity"
            value={batchForm.qtyOnHand}
            onChange={(e) => setBatchForm((p) => ({ ...p, qtyOnHand: e.target.value }))}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Unit Cost"
            value={batchForm.unitCost}
            onChange={(e) => setBatchForm((p) => ({ ...p, unitCost: e.target.value }))}
          />
          <input placeholder="Note (Optional)" value={batchForm.note} onChange={(e) => setBatchForm((p) => ({ ...p, note: e.target.value }))} />
          <button type="submit" disabled={!canAdjustInventory}>Add Batch</button>
        </form>
        <form onSubmit={submitBatchAdjustment} className="form-grid">
          <Select
            className="form-select-sm"
            value={batchOptions.find((opt) => opt.value === String(batchAdjustForm.batchId)) || null}
            options={batchOptions}
            onChange={(opt) => setBatchAdjustForm((p) => ({ ...p, batchId: opt?.value || "" }))}
            placeholder="Select Batch"
            isClearable
            isSearchable
            styles={SEARCH_SELECT_STYLES}
          />
          <input
            type="number"
            step={1}
            placeholder="Quantity Change (+/-)"
            value={batchAdjustForm.qtyChange}
            onChange={(e) => setBatchAdjustForm((p) => ({ ...p, qtyChange: e.target.value }))}
          />
          <input
            placeholder="Reason (Required)"
            value={batchAdjustForm.reason}
            onChange={(e) => setBatchAdjustForm((p) => ({ ...p, reason: e.target.value }))}
          />
          <button type="submit" disabled={!canAdjustInventory}>Update Batch Quantity</button>
        </form>
      </div>
      <DataTable
        title="Near Expiry / Expired Batch Alerts"
        rows={batchAlertRows.map((row) => ({
          ...row,
          expiryDateLabel: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : "-",
          markdownLabel: `${Number(row.suggestedMarkdownPct || 0).toFixed(0)}%`,
        }))}
        searchableKeys={["productName", "batchCode", "note"]}
        columns={[
          { key: "productName", label: "Product" },
          { key: "batchCode", label: "Batch" },
          { key: "qtyOnHand", label: "Qty" },
          { key: "expiryDateLabel", label: "Expiry Date" },
          { key: "daysToExpiry", label: "Days Left" },
          { key: "markdownLabel", label: "Suggested Markdown" },
          {
            key: "isExpired",
            label: "Status",
            render: (v, row) =>
              v ? (
                <span className="badge badge-danger">EXPIRED</span>
              ) : row.isNear ? (
                <span className="badge badge-warning">NEAR EXPIRY</span>
              ) : (
                <span className="badge badge-success">OK</span>
              ),
          },
        ]}
      />
      <div style={{ marginBottom: 10 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={createExpiryMarkdownCampaign} disabled={!canAdjustInventory}>
          Create Auto Markdown Campaign
        </button>
      </div>
      <DataTable
        title="Batch Register"
        rows={batchRows.map((row) => ({
          ...row,
          expiryDateLabel: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : "-",
          receivedAtLabel: row.receivedAt ? new Date(row.receivedAt).toLocaleDateString() : "-",
        }))}
        searchableKeys={["productName", "batchCode", "status", "note"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "productName", label: "Product" },
          { key: "batchCode", label: "Batch" },
          { key: "qtyOnHand", label: "Qty On Hand" },
          { key: "unitCost", label: "Unit Cost", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "receivedAtLabel", label: "Received" },
          { key: "expiryDateLabel", label: "Expiry" },
          { key: "daysToExpiry", label: "Days Left", render: (v) => (v == null ? "-" : v) },
          {
            key: "status",
            label: "Status",
            render: (v) => {
              const status = String(v || "").toLowerCase();
              if (status === "completed") return <span className="badge badge-success">COMPLETED</span>;
              if (status === "rejected") return <span className="badge badge-danger">REJECTED</span>;
              if (status === "pending") return <span className="badge badge-warning">PENDING</span>;
              return <span className="badge">{String(v || "-").toUpperCase()}</span>;
            },
          },
        ]}
      />
        </div>
      ) : null}
      {inventoryTab === "ops" ? (
        <div className="pos-tab-panel">
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h3>Adjustment Reason Master</h3>
        <form onSubmit={submitReasonMaster} className="form-grid" style={{ marginBottom: 8 }}>
          <input
            placeholder="Code (e.g., DAMAGE)"
            value={reasonForm.code}
            onChange={(e) => setReasonForm((p) => ({ ...p, code: e.target.value }))}
          />
          <input
            placeholder="Label"
            value={reasonForm.label}
            onChange={(e) => setReasonForm((p) => ({ ...p, label: e.target.value }))}
          />
          <select value={reasonForm.direction} onChange={(e) => setReasonForm((p) => ({ ...p, direction: e.target.value }))}>
            <option value="BOTH">Both</option>
            <option value="IN">IN only</option>
            <option value="OUT">OUT only</option>
          </select>
          <select
            value={reasonForm.accountingImpact}
            onChange={(e) => setReasonForm((p) => ({ ...p, accountingImpact: e.target.value }))}
          >
            <option value="NONE">No accounting impact</option>
            <option value="WRITE_OFF">Write-off</option>
            <option value="GAIN">Gain</option>
          </select>
          <input
            placeholder="Account code (optional)"
            value={reasonForm.accountCode}
            onChange={(e) => setReasonForm((p) => ({ ...p, accountCode: e.target.value }))}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(reasonForm.isActive)}
              onChange={(e) => setReasonForm((p) => ({ ...p, isActive: e.target.checked }))}
            />
            Active
          </label>
          <button type="submit" disabled={!canAdjustInventory}>{editingReasonId ? "Update Reason" : "Save Reason"}</button>
          {editingReasonId ? (
            <button type="button" className="btn-secondary" onClick={cancelEditReason}>
              Cancel Edit
            </button>
          ) : null}
        </form>
        <DataTable
          title="Reason Codes"
          rows={allAdjustReasons}
          searchableKeys={["code", "label", "direction", "accountingImpact", "accountCode"]}
          columns={[
            { key: "code", label: "Code" },
            { key: "label", label: "Label" },
            { key: "direction", label: "Direction" },
            { key: "accountingImpact", label: "Impact" },
            { key: "accountCode", label: "Account", render: (v) => v || "-" },
            { key: "isActive", label: "Status", render: (v) => (v ? "Active" : "Inactive") },
            {
              key: "actions",
              label: "Action",
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => startEditReason(row)} disabled={!canAdjustInventory}>
                    Edit
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => toggleReasonActive(row)} disabled={!canAdjustInventory}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>
      <form onSubmit={submitAdjustment} className="form-grid">
        <Select
          className="form-select-sm"
          value={productOptions.find((opt) => opt.value === String(adjustment.productId)) || null}
          options={productOptions}
          onChange={(opt) => setAdjustment({ ...adjustment, productId: opt?.value || "" })}
          placeholder="Select Product"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <Select
          className="form-select-sm"
          value={warehouseOptions.find((opt) => opt.value === String(adjustment.warehouseId)) || null}
          options={warehouseOptions}
          onChange={(opt) => setAdjustment({ ...adjustment, warehouseId: opt?.value || "" })}
          placeholder="Select Warehouse (Optional)"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <input
          placeholder="Quantity Change (+/-)"
          value={adjustment.qtyChange}
          onChange={(e) => setAdjustment({ ...adjustment, qtyChange: e.target.value })}
        />
        <input
          placeholder="Reason (Required)"
          value={adjustment.reason}
          onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
        />
        <Select
          className="form-select-sm"
          value={adjustReasonOptions.find((opt) => opt.value === String(adjustment.reasonCode)) || null}
          options={adjustReasonOptions}
          onChange={(opt) => setAdjustment({ ...adjustment, reasonCode: opt?.value || "" })}
          placeholder="Reason Code (Optional)"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <button type="submit" disabled={!canAdjustInventory}>{editingAdjustmentId ? "Update Adjustment" : "Add Adjustment"}</button>
        {editingAdjustmentId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingAdjustmentId(null);
              setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "", reasonCode: "" });
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
          {
            key: "approvalStatus",
            label: "Approval",
            render: (v, row) => {
              const status = String(v || "").toUpperCase();
              let badge = "-";
              if (status === "PENDING") badge = <span className="badge badge-warning">PENDING</span>;
              else if (status === "APPROVED") badge = <span className="badge badge-success">APPROVED</span>;
              else if (status === "REJECTED") badge = <span className="badge badge-danger">REJECTED</span>;
              else if (status) badge = <span className="badge">{status}</span>;
              if (!row.approvalEventId) return badge;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {badge}
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      localStorage.setItem(APPROVAL_FOCUS_KEY, String(row.approvalEventId));
                      window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "approvals" } }));
                    }}
                  >
                    Open
                  </button>
                </div>
              );
            },
          },
          {
            key: "reason",
            label: "Reason",
            render: (_, row) => (row.reasonCode ? `${row.reasonCode} - ${row.reasonLabel || row.reason || "-"}` : row.reason || "-"),
          },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editAdjustment(row)} disabled={!canAdjustInventory}>Edit</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteAdjustment(row)} disabled={!canAdjustInventory}>Delete</button>
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
      ) : null}
      {inventoryTab === "transfers" ? (
        <div className="pos-tab-panel">
      <div className="page-card" style={{ marginTop: 14 }}>
        <h3>Branch Stock Transfer</h3>
        <form onSubmit={submitTransfer}>
          <div className="form-grid">
            <Select
              className="form-select-sm"
              value={destinationBranchOptions.find((opt) => opt.value === String(transferForm.toBranchId)) || null}
              options={destinationBranchOptions}
              onChange={(opt) =>
                setTransferForm({
                  toBranchId: opt?.value || "",
                  items: [{ fromProductId: "", toProductId: "", qty: "" }],
                })
              }
              placeholder="Destination Branch"
              isClearable
              isSearchable
              styles={SEARCH_SELECT_STYLES}
            />
          </div>
          {transferForm.items.map((line, idx) => (
            <div key={`transfer-line-${idx}`} className="form-grid" style={{ marginTop: 8 }}>
              <Select
                className="form-select-sm"
                value={productOptions.find((opt) => opt.value === String(line.fromProductId)) || null}
                options={productOptions.map((opt) => {
                  const p = fromProductMap.get(Number(opt.value));
                  return {
                    value: opt.value,
                    label: `${opt.label} - Stock ${p?.stock ?? 0}`,
                  };
                })}
                onChange={(opt) => {
                  const fromProductId = opt?.value || "";
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
                placeholder="From Product (Current Branch)"
                isClearable
                isSearchable
                styles={SEARCH_SELECT_STYLES}
              />
              <Select
                className="form-select-sm"
                value={targetBranchProductOptions.find((opt) => opt.value === String(line.toProductId)) || null}
                options={targetBranchProductOptions}
                onChange={(opt) => upsertTransferItem(idx, { toProductId: opt?.value || "" })}
                placeholder="To Product (Destination Branch)"
                isClearable
                isSearchable
                styles={SEARCH_SELECT_STYLES}
              />
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Quantity"
                value={line.qty}
                onChange={(e) => upsertTransferItem(idx, { qty: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={addTransferLine} disabled={!canTransferInventory}>
                  + Line
                </button>
                {transferForm.items.length > 1 ? (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => removeTransferLine(idx)}
                    disabled={!canTransferInventory}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <button type="submit" style={{ marginTop: 8 }} disabled={!canTransferInventory}>
            Submit Transfer For Approval
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
            key: "action",
            label: "Approval",
            render: (_, row) =>
              String(row.status || "").toLowerCase() === "pending" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => approveTransfer(row)} disabled={!canTransferInventory}>
                    Approve
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => rejectTransfer(row)} disabled={!canTransferInventory}>
                    Reject
                  </button>
                </div>
              ) : (
                "-"
              ),
          },
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
      <DataTable
        title="Auto Transfer Suggestions (Cross-Branch Balancing)"
        rows={transferSuggestionRows}
        searchableKeys={["fromProductName", "fromSku", "toBranchName", "toProductName"]}
        columns={[
          { key: "fromProductName", label: "From Product" },
          { key: "fromSku", label: "SKU", render: (v) => v || "-" },
          { key: "fromStock", label: "From Stock" },
          { key: "toBranchName", label: "To Branch" },
          { key: "toProductName", label: "To Product" },
          { key: "toStock", label: "To Stock" },
          { key: "shortageQty", label: "Shortage" },
          { key: "suggestedQty", label: "Suggested Transfer" },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  setTransferForm({
                    toBranchId: String(row.toBranchId),
                    items: [
                      {
                        fromProductId: String(row.fromProductId),
                        toProductId: String(row.toProductId),
                        qty: String(Math.max(1, Number(row.suggestedQty || 1))),
                      },
                    ],
                  })
                }
              >
                Use Suggestion
              </button>
            ),
          },
        ]}
      />
        </div>
      ) : null}
    </div>
  );
}

export default Inventory;
