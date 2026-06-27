import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SearchSelect from "../components/SearchSelect";
import usePermissions from "../hooks/usePermissions";
import { getLang, t } from "../i18n";
import { formatProductStockDisplay } from "../utils/formatSaleLineQty";
import { GROCERY_CATEGORY_CHIPS } from "../constants/retailDepartments";
import {
  notifyActionRequired,
  notifyError,
  notifyPermissionRequired,
  notifySuccess,
} from "../utils/notify";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";
const APPROVAL_FOCUS_KEY = "bd_pos_approval_focus_id";

function Inventory() {
  const { hasPermission } = usePermissions();
  const canAdjustInventory = hasPermission("inventory.adjust");
  const canTransferInventory = hasPermission("inventory.transfer");
  const canExportReports = hasPermission("accounting.report");

  const [uiLang, setUiLang] = useState(() => getLang());
  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

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
  const [lowStockAisleFilter, setLowStockAisleFilter] = useState("ALL");
  const [batchExpiryWindowDays, setBatchExpiryWindowDays] = useState(30);
  const [batchRows, setBatchRows] = useState([]);
  const [batchAlertRows, setBatchAlertRows] = useState([]);
  const [batchAlertSummary, setBatchAlertSummary] = useState({ tracked: 0, nearExpiryCount: 0, expiredCount: 0 });
  const [traceQuery, setTraceQuery] = useState({ batchId: "", batchCode: "", productId: "" });
  const [traceResult, setTraceResult] = useState(null);
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

  // Server-driven data source for the stock-ledger table (backend search/sort/paging).
  const fetchLedgerPage = useCallback(async (q) => {
    const res = await api.get("/inventory/ledger", {
      params: {
        paged: true,
        page: q.page,
        pageSize: q.pageSize,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
        search: JSON.stringify(q.search || {}),
        filters: JSON.stringify(q.filters || {}),
      },
    });
    return { data: res.data?.data || [], total: res.data?.total || 0 };
  }, []);
  const ledgerTable = useServerTable(fetchLedgerPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  useEffect(() => {
    if (inventoryTab === "ops") ledgerTable.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryTab]);
  const [batchExpiryTableFilter, setBatchExpiryTableFilter] = useState("all");
  const [focusWorstMarginImpact, setFocusWorstMarginImpact] = useState(false);
  const [selectedImpactSku, setSelectedImpactSku] = useState("");

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
    try {
      const tab = sessionStorage.getItem("bd_pos_inventory_tab");
      const filter = sessionStorage.getItem("bd_pos_inventory_batch_filter");
      if (tab) {
        setInventoryTab(tab);
        sessionStorage.removeItem("bd_pos_inventory_tab");
      }
      if (filter) {
        setBatchExpiryTableFilter(filter);
        sessionStorage.removeItem("bd_pos_inventory_batch_filter");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const filteredBatchAlertRows = useMemo(() => {
    if (batchExpiryTableFilter === "near") {
      return batchAlertRows.filter((r) => r.isNear && !r.isExpired);
    }
    if (batchExpiryTableFilter === "expired") {
      return batchAlertRows.filter((r) => r.isExpired);
    }
    if (batchExpiryTableFilter === "alert") {
      return batchAlertRows.filter((r) => r.isNear || r.isExpired);
    }
    return batchAlertRows;
  }, [batchAlertRows, batchExpiryTableFilter]);

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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
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
        const pin = window.prompt(tt("invPinHighValueWriteoff"));
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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
      return;
    }
    if (!window.confirm(tt("invConfirmDeleteAdjustment"))) return;
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
        label: `${b.productName} - ${b.batchCode} (${tt("invBatchQtyLabel")} ${b.qtyOnHand})`,
      })),
    [batchRows, tt]
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
      notifyPermissionRequired(tt("invNeedPermTransfer"));
      return;
    }
    const toBranchId = Number(transferForm.toBranchId);
    if (!toBranchId) {
      notifyActionRequired(tt("invSelectDestinationBranch"));
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
      notifyActionRequired(tt("invAddValidTransferLine"));
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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
      return;
    }
    if (!reasonForm.code.trim() || !reasonForm.label.trim()) {
      notifyActionRequired(tt("invReasonCodeAndLabelRequired"));
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
    notifySuccess(editingReasonId ? tt("invReasonUpdated") : tt("invReasonSaved"));
    load();
  };

  const toggleReasonActive = async (row) => {
    if (!canAdjustInventory) {
      notifyPermissionRequired(tt("invNeedPermAdjust"));
      return;
    }
    await api.patch(`/inventory/adjust-reasons/${row.id}`, { isActive: !row.isActive });
    notifySuccess(tt("invReasonStatusUpdated"));
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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
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
      notifyPermissionRequired(tt("invNeedPermAdjust"));
      return;
    }
    const ok = window.confirm(tt("invConfirmMarkdownCampaign"));
    if (!ok) return;
    const res = await api.post("/inventory/batches/markdown-campaign", {
      days: Number(batchExpiryWindowDays || 30),
      validDays: 7,
      maxProducts: 100,
    });
    notifySuccess(res.data?.message || tt("invMarkdownCampaignCreated"));
    window.dispatchEvent(new CustomEvent("bd_pos_promotions_changed"));
    try {
      sessionStorage.setItem("bd_pos_promotions_filter", "expiry_auto");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "promotions" } }));
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
            ? tt("invDirectionOutbound")
            : tt("invDirectionInbound"),
        itemCount: row.items?.length || 0,
        qtyTotal: (row.items || []).reduce((sum, x) => sum + Number(x.qty || 0), 0),
      })),
    [transfers, tt]
  );

  const approveTransfer = async (row) => {
    if (!canTransferInventory) {
      notifyPermissionRequired(tt("invNeedPermTransfer"));
      return;
    }
    const pin = window.prompt(tt("invPinApproveTransfer"));
    if (!pin) return;
    await api.post(`/inventory/transfers/${Number(row.id)}/approve`, { managerApprovalPin: pin });
    notifySuccess(tt("invTransferApproved"));
    await load();
  };

  const rejectTransfer = async (row) => {
    if (!canTransferInventory) {
      notifyPermissionRequired(tt("invNeedPermTransfer"));
      return;
    }
    const reason = (window.prompt(tt("invPromptRejectReason")) || "").trim();
    await api.post(`/inventory/transfers/${Number(row.id)}/reject`, { reason });
    notifySuccess(tt("invTransferRejected"));
    await load();
  };

  const downloadReorderCsv = async () => {
    if (!canExportReports) {
      notifyPermissionRequired(tt("invNeedPermExportReorder"));
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
      notifyError(tt("invExportReorderFailed"));
    }
  };

  const calcMarginPct = (row) => {
    const unit = Number(row?.unitPrice || 0);
    const selling = Number(row?.price || 0);
    if (selling <= 0) return 0;
    return ((selling - unit) / selling) * 100;
  };

  const formatMarginImpact = (row) => {
    const base = Number(row?.baseMarginPct || 0);
    const landed = Number(row?.landedMarginPct || 0);
    const impact = Number(row?.marginImpactPct || 0);
    const sign = impact > 0 ? "+" : "";
    return `${base.toFixed(2)}% -> ${landed.toFixed(2)}% (${sign}${impact.toFixed(2)}%)`;
  };

  const marginImpactRows = (rows = []) => {
    const normalized = Array.isArray(rows) ? rows : [];
    if (!focusWorstMarginImpact) return normalized;
    return normalized
      .filter((row) => Number(row?.marginImpactPct || 0) < 0)
      .sort((a, b) => Number(a?.marginImpactPct || 0) - Number(b?.marginImpactPct || 0));
  };

  const topWorstMarginImpactRows = useMemo(
    () =>
      (Array.isArray(intelligenceRows) ? intelligenceRows : [])
        .filter((row) => Number(row?.marginImpactPct || 0) < 0)
        .sort((a, b) => Number(a?.marginImpactPct || 0) - Number(b?.marginImpactPct || 0))
        .slice(0, 10),
    [intelligenceRows]
  );

  const displayedIntelligenceRows = useMemo(() => {
    const rows = marginImpactRows(intelligenceRows);
    if (!selectedImpactSku) return rows;
    return rows.filter((row) => String(row?.sku || "").trim() === selectedImpactSku);
  }, [intelligenceRows, selectedImpactSku, focusWorstMarginImpact]);

  const displayedLowStockRows = useMemo(() => {
    let rows = marginImpactRows(lowStockRows);
    const aisle = String(lowStockAisleFilter || "ALL").toUpperCase();
    if (aisle !== "ALL") {
      rows = rows.filter((row) => String(row.category || "").trim().toUpperCase() === aisle);
    }
    if (!selectedImpactSku) return rows;
    return rows.filter((row) => String(row?.sku || "").trim() === selectedImpactSku);
  }, [lowStockRows, selectedImpactSku, focusWorstMarginImpact, lowStockAisleFilter]);

  const writeOffExpiredBatch = async (row) => {
    if (!canAdjustInventory) {
      notifyPermissionRequired(tt("invNeedPermAdjust"));
      return;
    }
    const batchId = Number(row.batchId || row.id);
    if (!batchId) return;
    if (!window.confirm(tt("invConfirmSpoilage", { name: row.productName, code: row.batchCode }))) return;
    try {
      await api.post(`/inventory/batches/${batchId}/spoilage`, {
        note: tt("invSpoilageNote", { code: row.batchCode || batchId }),
      });
      notifySuccess(tt("invSpoilageDone"));
      load();
    } catch (err) {
      notifyError(err.response?.data?.error || tt("invSpoilageFailed"));
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("inventory")}</div>
          <div className="page-subtitle">{tt("inventoryPageSubtitle")}</div>
        </div>
      </div>
      <div className="quick-stats">
        <div className="stat-chip">
          {tt("invStatTrackedReorder")}: {lowStockSummary.totalTracked}
        </div>
        <div className="stat-chip">
          {tt("invStatOutOfStock")}: {lowStockSummary.outOfStock}
        </div>
        <div className="stat-chip">
          {tt("invStatLowStock")}: {lowStockSummary.lowStock}
        </div>
        <div className="stat-chip">
          {tt("invStatFastMoving")}: {intelligenceSummary.fastMovingCount}
        </div>
        <div className="stat-chip">
          {tt("invStatSlowMoving")}: {intelligenceSummary.slowMovingCount}
        </div>
        <div className="stat-chip">
          {tt("invStatDeadStock")}: {intelligenceSummary.deadStockCount}
        </div>
        <div className="stat-chip">
          {tt("invStatReorderSuggestions")}: {intelligenceSummary.suggestedReorderCount}
        </div>
        <div className="stat-chip">
          {tt("invStatSeasonalityAdjusted")}: {intelligenceSummary.seasonalityAdjustedCount}
        </div>
        <div className="stat-chip">
          {tt("invStatBatchTracked")}: {batchAlertSummary.tracked}
        </div>
        <div className="stat-chip">
          {tt("invStatNearExpiry")}: {batchAlertSummary.nearExpiryCount}
        </div>
        <div className="stat-chip">
          {tt("invStatExpired")}: {batchAlertSummary.expiredCount}
        </div>
        <div className="stat-chip">
          {tt("invStatTransferSuggestions")}: {transferSuggestionSummary.suggestions}
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label={tt("inventoryTabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "overview"}
            className={`pos-tab ${inventoryTab === "overview" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("overview")}
          >
            {tt("invTabOverview")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "batches"}
            className={`pos-tab ${inventoryTab === "batches" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("batches")}
          >
            {tt("invTabBatches")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "ops"}
            className={`pos-tab ${inventoryTab === "ops" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("ops")}
          >
            {tt("invTabOps")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryTab === "transfers"}
            className={`pos-tab ${inventoryTab === "transfers" ? "pos-tab-active" : ""}`}
            onClick={() => setInventoryTab("transfers")}
          >
            {tt("invTabTransfers")}
          </button>
        </div>
      </div>
      {!canAdjustInventory && (inventoryTab === "batches" || inventoryTab === "ops") ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("invPermBannerAdjust")}</p>
        </div>
      ) : null}
      {!canTransferInventory && inventoryTab === "transfers" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("invPermBannerTransfer")}</p>
        </div>
      ) : null}
      {!canExportReports && inventoryTab === "overview" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("invPermBannerExport")}</p>
        </div>
      ) : null}
      {inventoryTab === "overview" ? (
        <div className="pos-tab-panel">
      <div style={{ margin: "10px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-secondary btn-sm" onClick={downloadReorderCsv} disabled={!canExportReports}>
          {tt("invDownloadReorderCsv")}
        </button>
      </div>
      <div className="form-grid" style={{ margin: "8px 0" }}>
        <input
          type="number"
          min={7}
          value={intelligenceRangeDays}
          onChange={(e) => setIntelligenceRangeDays(e.target.value)}
          placeholder={tt("invPhSalesLookback")}
        />
        <input
          type="number"
          min={15}
          value={deadStockDays}
          onChange={(e) => setDeadStockDays(e.target.value)}
          placeholder={tt("invPhDeadStock")}
        />
        <input
          type="number"
          min={1}
          value={leadDays}
          onChange={(e) => setLeadDays(e.target.value)}
          placeholder={tt("invPhLead")}
        />
        <input
          type="number"
          min={1}
          value={forecastDays}
          onChange={(e) => setForecastDays(e.target.value)}
          placeholder={tt("invPhForecast")}
        />
        <input
          type="number"
          min={1}
          value={batchExpiryWindowDays}
          onChange={(e) => setBatchExpiryWindowDays(e.target.value)}
          placeholder={tt("invPhNearExpiryWindow")}
        />
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "8px 0 4px" }}>
        <input
          type="checkbox"
          checked={showOnlyCriticalLowStock}
          onChange={(e) => setShowOnlyCriticalLowStock(e.target.checked)}
        />
        {tt("invLowStockOnly")}
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 0 8px 12px" }}>
        <input
          type="checkbox"
          checked={focusWorstMarginImpact}
          onChange={(e) => setFocusWorstMarginImpact(e.target.checked)}
        />
        {tt("invFocusWorstMarginImpact")}
      </label>
      {selectedImpactSku ? (
        <div style={{ margin: "0 0 8px 0" }}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedImpactSku("")}>
            {tt("invClearImpactFilter")}
          </button>
        </div>
      ) : null}
      <div className="page-card" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{tt("invTopWorstMarginImpactTitle")}</div>
        {topWorstMarginImpactRows.length ? (
          <div className="quick-stats">
            {topWorstMarginImpactRows.map((row) => (
              <button
                key={`worst-impact-${row.id}-${row.sku || "na"}`}
                type="button"
                className="stat-chip"
                onClick={() => setSelectedImpactSku(String(row.sku || "").trim())}
                title={tt("invClickToFilter")}
              >
                {(row.sku || tt("noData")).toString()} · {Number(row.marginImpactPct || 0).toFixed(2)}%
              </button>
            ))}
          </div>
        ) : (
          <div className="text-muted">{tt("invTopWorstMarginImpactEmpty")}</div>
        )}
      </div>
      <DataTable
        title={tt("invDtIntelligence")}
        rows={displayedIntelligenceRows.map((row) => ({
          ...row,
          lastSoldAtLabel: row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleDateString() : "-",
        }))}
        searchableKeys={["name", "sku", "category", "movementClass"]}
        columns={[
          { key: "name", label: tt("invColProduct") },
          { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
          { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
          { key: "unitPrice", label: tt("prodLblUnitPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "price", label: tt("prodLblSellingPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "profitMargin", label: tt("prodLblProfitMargin"), render: (_, row) => `${calcMarginPct(row).toFixed(2)}%` },
          { key: "marginImpactPct", label: tt("prodLblLandedVsBaseMarginImpact"), render: (_, row) => formatMarginImpact(row) },
          {
            key: "stock",
            label: tt("prodLblStock"),
            render: (_, row) => row.stockDisplay || formatProductStockDisplay(row, tt),
          },
          { key: "soldQty", label: tt("invColSoldQty") },
          { key: "avgDailySold", label: tt("invColAvgDay"), render: (v) => Number(v || 0).toFixed(2) },
          { key: "forecastNeed", label: tt("invColForecastNeed"), render: (v) => Number(v || 0).toFixed(2) },
          { key: "seasonalityMultiplier", label: tt("invColSeasonality"), render: (v) => `${Number(v || 1).toFixed(2)}x` },
          { key: "lastSoldAtLabel", label: tt("invColLastSold") },
          { key: "daysSinceLastSale", label: tt("invColDaysSinceSale"), render: (v) => (v == null ? "-" : v) },
          {
            key: "movementClass",
            label: tt("invColMovement"),
            render: (v) =>
              v === "DEAD" ? (
                <span className="badge badge-danger">{tt("invMovementDEAD")}</span>
              ) : v === "SLOW" ? (
                <span className="badge badge-warning">{tt("invMovementSLOW")}</span>
              ) : v === "FAST" ? (
                <span className="badge badge-success">{tt("invMovementFAST")}</span>
              ) : (
                <span className="badge">{tt("invMovementMEDIUM")}</span>
              ),
          },
          { key: "reorderSuggestionQty", label: tt("invColSuggestedReorderQty") },
          {
            key: "actions",
            label: tt("colActions"),
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
                {tt("invBtnAddSuggestionDraft")}
              </button>
            ),
          },
        ]}
      />
      <div className="pos-department-chips" style={{ marginBottom: 10 }} role="group" aria-label={tt("invLowStockAisleAria")}>
        <button
          type="button"
          className={`pos-dept-chip ${lowStockAisleFilter === "ALL" ? "pos-dept-chip-active" : ""}`}
          onClick={() => setLowStockAisleFilter("ALL")}
        >
          {tt("posDeptAll")}
        </button>
        {GROCERY_CATEGORY_CHIPS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`pos-dept-chip ${lowStockAisleFilter === cat.id ? "pos-dept-chip-active" : ""}`}
            onClick={() => setLowStockAisleFilter(cat.id)}
          >
            {cat.icon} {tt(cat.labelKey)}
          </button>
        ))}
        {lowStockAisleFilter !== "ALL" ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() =>
              appendLowStockToPurchaseDraft(
                displayedLowStockRows
                  .filter((x) => x.status === "LOW" || x.status === "OUT")
                  .map((x) => ({
                    productId: x.kind === "VARIANT" ? Number(x.productId) : Number(x.id),
                    productName: x.name,
                    qty: Math.max(1, Number(x.shortageQty || 1)),
                    cost: Number(x.price || 0),
                  }))
              )
            }
            disabled={!displayedLowStockRows.length}
          >
            {tt("invBtnDraftAisleLow")}
          </button>
        ) : null}
      </div>
      <DataTable
        title={tt("invDtLowStock")}
        rows={displayedLowStockRows}
        searchableKeys={["name", "sku", "category"]}
        columns={[
          { key: "name", label: tt("invColProduct") },
          { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
          { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
          { key: "unitPrice", label: tt("prodLblUnitPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "price", label: tt("prodLblSellingPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "profitMargin", label: tt("prodLblProfitMargin"), render: (_, row) => `${calcMarginPct(row).toFixed(2)}%` },
          { key: "marginImpactPct", label: tt("prodLblLandedVsBaseMarginImpact"), render: (_, row) => formatMarginImpact(row) },
          {
            key: "stock",
            label: tt("prodLblStock"),
            render: (_, row) => row.stockDisplay || formatProductStockDisplay(row, tt),
          },
          { key: "reorderLevel", label: tt("prodLblReorder") },
          { key: "shortageQty", label: tt("dashShortQty") },
          {
            key: "status",
            label: tt("colStatus"),
            render: (v) =>
              v === "OUT" ? (
                <span className="badge badge-danger">{tt("invBadgeOut")}</span>
              ) : v === "LOW" ? (
                <span className="badge badge-warning">{tt("invBadgeLow")}</span>
              ) : (
                <span className="badge badge-success">{tt("invBadgeStockOk")}</span>
              ),
          },
          {
            key: "actions",
            label: tt("colActions"),
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
                {tt("invBtnCreatePurchaseDraft")}
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
            {tt("invBtnCreateDraftAllLow")}
          </button>
        </div>
      ) : null}
        </div>
      ) : null}
      {inventoryTab === "batches" ? (
        <div className="pos-tab-panel">
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h3>{tt("invBatchTraceTitle")}</h3>
        <p className="text-muted" style={{ fontSize: 13 }}>{tt("invBatchTraceHelp")}</p>
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <input
            type="number"
            placeholder={tt("invTraceBatchId")}
            value={traceQuery.batchId}
            onChange={(e) => setTraceQuery((p) => ({ ...p, batchId: e.target.value }))}
          />
          <input
            placeholder={tt("invColBatch")}
            value={traceQuery.batchCode}
            onChange={(e) => setTraceQuery((p) => ({ ...p, batchCode: e.target.value }))}
          />
          <input
            type="number"
            placeholder={tt("invTraceProductId")}
            value={traceQuery.productId}
            onChange={(e) => setTraceQuery((p) => ({ ...p, productId: e.target.value }))}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              const q = new URLSearchParams();
              if (traceQuery.batchId) q.set("batchId", traceQuery.batchId);
              if (traceQuery.batchCode && traceQuery.productId) {
                q.set("batchCode", traceQuery.batchCode);
                q.set("productId", traceQuery.productId);
              }
              try {
                const res = await api.get(`/inventory/batches/traceability?${q.toString()}`);
                setTraceResult(res.data);
              } catch (err) {
                setTraceResult(null);
                notifyError(err?.response?.data?.error || tt("invTraceNotFound"));
              }
            }}
          >
            {tt("invTraceSearch")}
          </button>
        </div>
        {traceResult?.batch ? (
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <strong>{traceResult.batch.productName}</strong> · {traceResult.batch.batchCode} ·{" "}
            {traceResult.batch.expiryDate
              ? new Date(traceResult.batch.expiryDate).toLocaleDateString()
              : tt("invNoExpiry")}{" "}
            · {tt("invBatchQtyLabel")}: {traceResult.batch.qtyOnHand}
            {(traceResult.sales || []).length ? (
              <DataTable
                title={tt("invTraceSales")}
                rows={traceResult.sales}
                pageSize={5}
                allowExport={false}
                columns={[
                  { key: "invoiceNo", label: tt("receiptInvoice") },
                  { key: "soldAt", label: tt("colDate"), render: (v) => (v ? new Date(v).toLocaleString() : "—") },
                  { key: "qty", label: tt("receiptQty") },
                  { key: "linePrice", label: tt("salesLookupColPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
                ]}
              />
            ) : (
              <p className="text-muted">{tt("invTraceNoSales")}</p>
            )}
          </div>
        ) : null}
      </div>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h3>{tt("invBatchSectionTitle")}</h3>
        <form onSubmit={submitBatch} className="form-grid" style={{ marginBottom: 8 }}>
          <SearchSelect
            className="form-select-sm"
            kind="products"
            value={batchForm.productId}
            onChange={(val) => setBatchForm((p) => ({ ...p, productId: val }))}
            placeholder={tt("invPhSelectProduct")}
          />
          <input
            placeholder={tt("invPhBatchCode")}
            value={batchForm.batchCode}
            onChange={(e) => setBatchForm((p) => ({ ...p, batchCode: e.target.value }))}
          />
          <input type="date" value={batchForm.expiryDate} onChange={(e) => setBatchForm((p) => ({ ...p, expiryDate: e.target.value }))} />
          <input type="date" value={batchForm.receivedAt} onChange={(e) => setBatchForm((p) => ({ ...p, receivedAt: e.target.value }))} />
          <input
            type="number"
            min={0}
            step={1}
            placeholder={tt("invPhQuantity")}
            value={batchForm.qtyOnHand}
            onChange={(e) => setBatchForm((p) => ({ ...p, qtyOnHand: e.target.value }))}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder={tt("invPhUnitCost")}
            value={batchForm.unitCost}
            onChange={(e) => setBatchForm((p) => ({ ...p, unitCost: e.target.value }))}
          />
          <input placeholder={tt("invPhNoteOptional")} value={batchForm.note} onChange={(e) => setBatchForm((p) => ({ ...p, note: e.target.value }))} />
          <button type="submit" disabled={!canAdjustInventory}>{tt("invAddBatch")}</button>
        </form>
        <form onSubmit={submitBatchAdjustment} className="form-grid">
          <SearchSelect
            className="form-select-sm"
            value={batchAdjustForm.batchId}
            onChange={(val) => setBatchAdjustForm((p) => ({ ...p, batchId: val }))}
            placeholder={tt("invPhSelectBatch")}
            options={batchOptions}
          />
          <input
            type="number"
            step={1}
            placeholder={tt("invPhQtyChange")}
            value={batchAdjustForm.qtyChange}
            onChange={(e) => setBatchAdjustForm((p) => ({ ...p, qtyChange: e.target.value }))}
          />
          <input
            placeholder={tt("invPhReasonRequired")}
            value={batchAdjustForm.reason}
            onChange={(e) => setBatchAdjustForm((p) => ({ ...p, reason: e.target.value }))}
          />
          <button type="submit" disabled={!canAdjustInventory}>{tt("invUpdateBatchQty")}</button>
        </form>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {[
          { id: "all", label: tt("invExpiryFilterAll") },
          { id: "alert", label: tt("invExpiryFilterAlert") },
          { id: "near", label: tt("invExpiryFilterNear") },
          { id: "expired", label: tt("invExpiryFilterExpired") },
        ].map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`pos-dept-chip${batchExpiryTableFilter === chip.id ? " active" : ""}`}
            onClick={() => setBatchExpiryTableFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <DataTable
        title={tt("invDtNearExpiry")}
        rows={filteredBatchAlertRows.map((row) => ({
          ...row,
          expiryDateLabel: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : "-",
          markdownLabel: `${Number(row.suggestedMarkdownPct || 0).toFixed(0)}%`,
        }))}
        searchableKeys={["productName", "batchCode", "note"]}
        columns={[
          { key: "productName", label: tt("invColProduct") },
          { key: "batchCode", label: tt("invColBatch") },
          { key: "qtyOnHand", label: tt("invBatchQtyLabel") },
          { key: "expiryDateLabel", label: tt("invColExpiryDate") },
          { key: "daysToExpiry", label: tt("invColDaysLeft") },
          { key: "markdownLabel", label: tt("invColSuggestedMarkdown") },
          {
            key: "isExpired",
            label: tt("colStatus"),
            render: (v, row) =>
              v ? (
                <span className="badge badge-danger">{tt("invBadgeExpired")}</span>
              ) : row.isNear ? (
                <span className="badge badge-warning">{tt("invBadgeNearExpiry")}</span>
              ) : (
                <span className="badge badge-success">{tt("invBadgeOk")}</span>
              ),
          },
          {
            key: "actions",
            label: "",
            render: (_, row) =>
              row.isExpired && Number(row.qtyOnHand || 0) > 0 ? (
                <button type="button" className="btn-danger btn-sm" onClick={() => writeOffExpiredBatch(row)}>
                  {tt("invBtnWriteOffExpired")}
                </button>
              ) : null,
          },
        ]}
      />
      <div style={{ marginBottom: 10 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={createExpiryMarkdownCampaign} disabled={!canAdjustInventory}>
          {tt("invBtnMarkdownCampaign")}
        </button>
      </div>
      <DataTable
        title={tt("invDtBatchRegister")}
        rows={batchRows.map((row) => ({
          ...row,
          expiryDateLabel: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : "-",
          receivedAtLabel: row.receivedAt ? new Date(row.receivedAt).toLocaleDateString() : "-",
        }))}
        searchableKeys={["productName", "batchCode", "status", "note"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "productName", label: tt("invColProduct") },
          { key: "batchCode", label: tt("invColBatch") },
          { key: "qtyOnHand", label: tt("invColQtyOnHand") },
          { key: "unitCost", label: tt("invPhUnitCost"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "receivedAtLabel", label: tt("invColReceived") },
          { key: "expiryDateLabel", label: tt("invColExpiry") },
          { key: "daysToExpiry", label: tt("invColDaysLeft"), render: (v) => (v == null ? "-" : v) },
          {
            key: "status",
            label: tt("colStatus"),
            render: (v) => {
              const status = String(v || "").toLowerCase();
              if (status === "completed") return <span className="badge badge-success">{tt("invLedgerStatusCompleted")}</span>;
              if (status === "rejected") return <span className="badge badge-danger">{tt("invLedgerStatusRejected")}</span>;
              if (status === "pending") return <span className="badge badge-warning">{tt("invLedgerStatusPending")}</span>;
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
        <h3>{tt("invReasonMasterTitle")}</h3>
        <form onSubmit={submitReasonMaster} className="form-grid" style={{ marginBottom: 8 }}>
          <input
            placeholder={tt("invPhReasonCode")}
            value={reasonForm.code}
            onChange={(e) => setReasonForm((p) => ({ ...p, code: e.target.value }))}
          />
          <input
            placeholder={tt("invPhLabel")}
            value={reasonForm.label}
            onChange={(e) => setReasonForm((p) => ({ ...p, label: e.target.value }))}
          />
          <SearchSelect
            className="form-select-sm"
            value={reasonForm.direction}
            onChange={(val) => setReasonForm((p) => ({ ...p, direction: val || "BOTH" }))}
            options={[
              { value: "BOTH", label: tt("invDirBoth") },
              { value: "IN", label: tt("invDirInOnly") },
              { value: "OUT", label: tt("invDirOutOnly") },
            ]}
            isClearable={false}
          />
          <SearchSelect
            className="form-select-sm"
            value={reasonForm.accountingImpact}
            onChange={(val) => setReasonForm((p) => ({ ...p, accountingImpact: val || "NONE" }))}
            options={[
              { value: "NONE", label: tt("invAccNone") },
              { value: "WRITE_OFF", label: tt("invAccWriteOff") },
              { value: "GAIN", label: tt("invAccGain") },
            ]}
            isClearable={false}
          />
          <input
            placeholder={tt("invPhAccountCodeOpt")}
            value={reasonForm.accountCode}
            onChange={(e) => setReasonForm((p) => ({ ...p, accountCode: e.target.value }))}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(reasonForm.isActive)}
              onChange={(e) => setReasonForm((p) => ({ ...p, isActive: e.target.checked }))}
            />
            {tt("invActive")}
          </label>
          <button type="submit" disabled={!canAdjustInventory}>{editingReasonId ? tt("invUpdateReason") : tt("invSaveReason")}</button>
          {editingReasonId ? (
            <button type="button" className="btn-secondary" onClick={cancelEditReason}>
              {tt("invCancelEdit")}
            </button>
          ) : null}
        </form>
        <DataTable
          title={tt("invDtReasonCodes")}
          rows={allAdjustReasons}
          searchableKeys={["code", "label", "direction", "accountingImpact", "accountCode"]}
          columns={[
            { key: "code", label: tt("colCode") },
            { key: "label", label: tt("invPhLabel") },
            { key: "direction", label: tt("invColDirection") },
            { key: "accountingImpact", label: tt("invColImpact") },
            { key: "accountCode", label: tt("invColAccount"), render: (v) => v || "-" },
            { key: "isActive", label: tt("colStatus"), render: (v) => (v ? tt("statusActive") : tt("statusInactive")) },
            {
              key: "actions",
              label: tt("invColAction"),
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => startEditReason(row)} disabled={!canAdjustInventory}>
                    {tt("actionEdit")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => toggleReasonActive(row)} disabled={!canAdjustInventory}>
                    {row.isActive ? tt("invDeactivate") : tt("invActivate")}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>
      <form onSubmit={submitAdjustment} className="form-grid">
        <SearchSelect
          className="form-select-sm"
          kind="products"
          value={adjustment.productId}
          onChange={(val) => setAdjustment({ ...adjustment, productId: val })}
          placeholder={tt("invPhSelectProduct")}
        />
        <SearchSelect
          className="form-select-sm"
          kind="warehouses"
          value={adjustment.warehouseId}
          onChange={(val) => setAdjustment({ ...adjustment, warehouseId: val })}
          placeholder={tt("invPhSelectWarehouseOpt")}
        />
        <input
          placeholder={tt("invPhQtyChange")}
          value={adjustment.qtyChange}
          onChange={(e) => setAdjustment({ ...adjustment, qtyChange: e.target.value })}
        />
        <input
          placeholder={tt("invPhReasonRequired")}
          value={adjustment.reason}
          onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
        />
        <SearchSelect
          className="form-select-sm"
          value={adjustment.reasonCode}
          onChange={(val) => setAdjustment({ ...adjustment, reasonCode: val })}
          placeholder={tt("invPhReasonCodeOpt")}
          options={adjustReasonOptions}
        />
        <button type="submit" disabled={!canAdjustInventory}>{editingAdjustmentId ? tt("invUpdateAdjustment") : tt("invAddAdjustment")}</button>
        {editingAdjustmentId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingAdjustmentId(null);
              setAdjustment({ productId: "", warehouseId: "", qtyChange: "", reason: "", reasonCode: "" });
            }}
          >
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>
      <DataTable
        title={tt("invDtLedgerMaster")}
        rows={adjustments.map((r) => ({
          ...r,
          createdAtLabel: new Date(r.createdAt).toLocaleString(),
        }))}
        searchableKeys={["productName", "reason", "createdAtLabel"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "createdAtLabel", label: tt("invColDate") },
          { key: "productName", label: tt("invColProduct") },
          { key: "warehouseName", label: tt("invColWarehouse") },
          { key: "qtyChange", label: tt("invColQtyChange") },
          {
            key: "approvalStatus",
            label: tt("invColApproval"),
            render: (v, row) => {
              const status = String(v || "").toUpperCase();
              let badge = "-";
              if (status === "PENDING") badge = <span className="badge badge-warning">{tt("invApprovalPending")}</span>;
              else if (status === "APPROVED") badge = <span className="badge badge-success">{tt("invApprovalApproved")}</span>;
              else if (status === "REJECTED") badge = <span className="badge badge-danger">{tt("invApprovalRejected")}</span>;
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
                    {tt("invOpen")}
                  </button>
                </div>
              );
            },
          },
          {
            key: "reason",
            label: tt("invColReason"),
            render: (_, row) => (row.reasonCode ? `${row.reasonCode} - ${row.reasonLabel || row.reason || "-"}` : row.reason || "-"),
          },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editAdjustment(row)} disabled={!canAdjustInventory}>{tt("actionEdit")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteAdjustment(row)} disabled={!canAdjustInventory}>{tt("actionDelete")}</button>
              </div>
            ),
          },
        ]}
      />
      <DataTable
        title={tt("invDtStockLedger")}
        serverMode
        totalRows={ledgerTable.total}
        loading={ledgerTable.loading}
        onQueryChange={ledgerTable.onQueryChange}
        initialSort="createdAt"
        initialSortDir="desc"
        pageSize={10}
        rows={ledgerTable.rows.map((r) => ({
          ...r,
          productName: r.product?.name || `#${r.productId}`,
          warehouseName: r.warehouse?.name || "-",
          createdAtLabel: new Date(r.createdAt).toLocaleString(),
        }))}
        filters={[
          {
            key: "refType",
            label: tt("invFilterRefType"),
            options: [...new Set(ledger.map((r) => r.refType))].map((x) => ({ label: x, value: x })),
          },
        ]}
        columns={[
          { key: "id", label: tt("colId"), searchable: false },
          { key: "createdAtLabel", label: tt("invColDate"), searchable: false },
          { key: "refType", label: tt("invColRefType") },
          { key: "productName", label: tt("invColProduct") },
          { key: "warehouseName", label: tt("invColWarehouse") },
          { key: "inQty", label: tt("invColIn"), searchable: false },
          { key: "outQty", label: tt("invColOut"), searchable: false },
        ]}
      />
        </div>
      ) : null}
      {inventoryTab === "transfers" ? (
        <div className="pos-tab-panel">
      <div className="page-card" style={{ marginTop: 14 }}>
        <h3>{tt("invTransferBranchTitle")}</h3>
        <form onSubmit={submitTransfer}>
          <div className="form-grid">
            <SearchSelect
              className="form-select-sm"
              value={transferForm.toBranchId}
              onChange={(val) =>
                setTransferForm({
                  toBranchId: val,
                  items: [{ fromProductId: "", toProductId: "", qty: "" }],
                })
              }
              placeholder={tt("invPhDestinationBranch")}
              options={destinationBranchOptions}
            />
          </div>
          {transferForm.items.map((line, idx) => (
            <div key={`transfer-line-${idx}`} className="form-grid" style={{ marginTop: 8 }}>
              <SearchSelect
                className="form-select-sm"
                value={line.fromProductId}
                options={productOptions.map((opt) => {
                  const p = fromProductMap.get(Number(opt.value));
                  return {
                    value: opt.value,
                    label: `${opt.label} — ${tt("invStockInLabel")} ${p?.stock ?? 0}`,
                  };
                })}
                onChange={(val) => {
                  const fromProductId = val || "";
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
                placeholder={tt("invPhFromProduct")}
              />
              <SearchSelect
                className="form-select-sm"
                value={line.toProductId}
                options={targetBranchProductOptions}
                onChange={(val) => upsertTransferItem(idx, { toProductId: val || "" })}
                placeholder={tt("invPhToProduct")}
              />
              <input
                type="number"
                min={1}
                step={1}
                placeholder={tt("invPhQuantity")}
                value={line.qty}
                onChange={(e) => upsertTransferItem(idx, { qty: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={addTransferLine} disabled={!canTransferInventory}>
                  {tt("invAddLine")}
                </button>
                {transferForm.items.length > 1 ? (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => removeTransferLine(idx)}
                    disabled={!canTransferInventory}
                  >
                    {tt("invRemoveLine")}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <button type="submit" style={{ marginTop: 8 }} disabled={!canTransferInventory}>
            {tt("invSubmitTransferApproval")}
          </button>
        </form>
      </div>
      <DataTable
        title={tt("invDtStockTransfers")}
        rows={transferRows}
        searchableKeys={["createdAtLabel", "status", "directionLabel", "fromBranchName", "toBranchName"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "createdAtLabel", label: tt("invColDate") },
          { key: "directionLabel", label: tt("invColDirection") },
          { key: "status", label: tt("colStatus") },
          { key: "fromBranchName", label: tt("invColFrom") },
          { key: "toBranchName", label: tt("invColTo") },
          { key: "itemCount", label: tt("invColLines") },
          { key: "qtyTotal", label: tt("invColTotalQty") },
          {
            key: "action",
            label: tt("invColApprovalCol"),
            render: (_, row) =>
              String(row.status || "").toLowerCase() === "pending" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => approveTransfer(row)} disabled={!canTransferInventory}>
                    {tt("invApprove")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => rejectTransfer(row)} disabled={!canTransferInventory}>
                    {tt("invReject")}
                  </button>
                </div>
              ) : (
                "-"
              ),
          },
          {
            key: "items",
            label: tt("invColItemsDetail"),
            render: (_, row) =>
              (row.items || [])
                .map((x) => `${x.fromProduct?.name || x.fromProductId} -> ${x.toProduct?.name || x.toProductId} (${x.qty})`)
                .join(", "),
          },
        ]}
      />
      <DataTable
        title={tt("invDtTransferSuggestions")}
        rows={transferSuggestionRows}
        searchableKeys={["fromProductName", "fromSku", "toBranchName", "toProductName"]}
        columns={[
          { key: "fromProductName", label: tt("invColFromProductFull") },
          { key: "fromSku", label: tt("prodLblSku"), render: (v) => v || "-" },
          { key: "fromStock", label: tt("invColFromStock") },
          { key: "toBranchName", label: tt("invColToBranch") },
          { key: "toProductName", label: tt("invColToProduct") },
          { key: "toStock", label: tt("invColToStock") },
          { key: "shortageQty", label: tt("dashShortQty") },
          { key: "suggestedQty", label: tt("invColSuggestedTransferQty") },
          {
            key: "actions",
            label: tt("colActions"),
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
                {tt("invUseSuggestion")}
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
