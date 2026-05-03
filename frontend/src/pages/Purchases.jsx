import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { createSearchSelectStyles } from "../utils/selectStyles";
import {
  notifyActionRequired,
  notifyPermissionRequired,
  notifySuccess,
} from "../utils/notify";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";
const SEARCH_SELECT_STYLES = createSearchSelectStyles(38);

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function Purchases() {
  const permissions = getStoredPermissions();
  const canManagePurchases = hasPermission("purchase.create", permissions);
  const canCreatePurchaseReturn = hasPermission("purchase.return", permissions);
  const canExportReports = hasPermission("accounting.report", permissions);

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
    deferStockPosting: false,
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
  const [optimizationDays, setOptimizationDays] = useState(30);
  const [optimizationLeadDays, setOptimizationLeadDays] = useState(7);
  const [optimizationRows, setOptimizationRows] = useState([]);
  const [planBudget, setPlanBudget] = useState("");
  const [planData, setPlanData] = useState({
    summary: { lineCount: 0, supplierCount: 0, totalEstimatedCost: 0, remainingBudget: 0 },
    supplierGroups: [],
    rows: [],
  });
  const [planReviewRows, setPlanReviewRows] = useState([]);
  const [planApprovals, setPlanApprovals] = useState([]);
  const [supplierScorecardDays, setSupplierScorecardDays] = useState(60);
  const [supplierScorecards, setSupplierScorecards] = useState({
    summary: { supplierCount: 0, avgScore: 0, highRiskSuppliers: 0, totalSpend: 0 },
    rows: [],
  });
  const [grnReceiveQtyByProduct, setGrnReceiveQtyByProduct] = useState({});
  const [purchasesTab, setPurchasesTab] = useState("create");

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (returnRange.from) query.set("from", returnRange.from);
    if (returnRange.to) query.set("to", returnRange.to);
    const returnsUrl = query.toString() ? `/purchases/returns?${query.toString()}` : "/purchases/returns";
    const [purchaseRes, returnsRes, supplierRes, productRes, optimizationRes, approvalsRes, supplierScorecardRes] = await Promise.all([
      api.get("/purchases"),
      api.get(returnsUrl),
      api.get("/master/suppliers"),
      api.get("/products"),
      api.get(`/purchases/optimization?days=${optimizationDays}&leadDays=${optimizationLeadDays}`),
      api.get("/purchases/plan-approvals"),
      api.get(`/purchases/supplier-scorecards?days=${Number(supplierScorecardDays || 60)}`),
    ]);
    setPurchases(purchaseRes.data);
    setPurchaseReturns(returnsRes.data);
    setSuppliers(supplierRes.data);
    setProducts(productRes.data);
    setOptimizationRows(optimizationRes.data?.rows || []);
    setPlanApprovals(Array.isArray(approvalsRes.data) ? approvalsRes.data : []);
    setSupplierScorecards(
      supplierScorecardRes.data || {
        summary: { supplierCount: 0, avgScore: 0, highRiskSuppliers: 0, totalSpend: 0 },
        rows: [],
      }
    );
  }, [returnRange.from, returnRange.to, optimizationDays, optimizationLeadDays, supplierScorecardDays]);

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
  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: String(s.id),
        label: s.name,
      })),
    [suppliers]
  );
  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p.id),
        label: p.name,
      })),
    [products]
  );
  const returnPurchaseOptions = useMemo(
    () =>
      purchases.map((p) => ({
        value: String(p.id),
        label: `#${p.id} - ${p.supplier?.name || "Supplier"} - ৳${Number(p.total || 0).toFixed(2)}`,
      })),
    [purchases]
  );
  const returnProductOptions = useMemo(
    () =>
      returnItems.map((i) => ({
        value: String(i.productId),
        label: `Product #${i.productId} (Purchased Qty: ${i.qty}, Cost: ৳${Number(i.cost || 0).toFixed(2)})`,
      })),
    [returnItems]
  );

  const productVatById = useMemo(
    () => new Map((products || []).map((p) => [Number(p.id), Number(p.vatRate || 0)])),
    [products]
  );

  const suggestedSupplierByProduct = useMemo(() => {
    const fromOptimization = new Map();
    for (const row of optimizationRows || []) {
      if (!row?.bestSupplier?.supplierId) continue;
      fromOptimization.set(Number(row.productId), {
        supplierId: Number(row.bestSupplier.supplierId),
        supplierName: row.bestSupplier.supplierName,
        lastCost: Number(row.bestSupplier.avgCost || 0),
        moq: Number(row.bestSupplier.moq || 1),
        source: "OPTIMIZATION",
      });
    }
    if (fromOptimization.size) return fromOptimization;
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
  }, [purchases, optimizationRows]);

  const draftSuggestions = useMemo(
    () =>
      draftItems.map((x) => ({
        ...x,
        suggestion: suggestedSupplierByProduct.get(Number(x.productId)) || null,
        optimization: optimizationRows.find((o) => Number(o.productId) === Number(x.productId)) || null,
      })),
    [draftItems, suggestedSupplierByProduct, optimizationRows]
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
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
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
      notifyActionRequired("add at least one purchase line or apply draft items.");
      return;
    }
    await api.post("/purchases", {
      supplierId: Number(form.supplierId),
      invoiceNo: form.invoiceNo || null,
      paidAmount: Number(form.paidAmount || 0),
      items: lines,
      deferStockPosting: Boolean(form.deferStockPosting),
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
      deferStockPosting: false,
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
      notifyActionRequired("no supplier suggestions are available for draft items yet.");
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
      notifySuccess(
        `created ${grouped.size} purchase bill(s). ${nextDraftItems.length} item(s) remain without suggestions.`
      );
    } else {
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
      notifySuccess(`created ${grouped.size} purchase bill(s). Draft is now empty.`);
    }
    await load();
  };

  const generatePurchasePlan = async () => {
    const query = new URLSearchParams();
    query.set("days", String(optimizationDays || 30));
    query.set("leadDays", String(optimizationLeadDays || 7));
    if (String(planBudget || "").trim() !== "") query.set("budget", String(Number(planBudget || 0)));
    const res = await api.get(`/purchases/plan-suggestion?${query.toString()}`);
    const nextPlan =
      res.data || {
        summary: { lineCount: 0, supplierCount: 0, totalEstimatedCost: 0, remainingBudget: 0 },
        supplierGroups: [],
        rows: [],
      };
    setPlanData(nextPlan);
    setPlanReviewRows(
      (nextPlan.rows || []).map((row) => ({
        ...row,
        include: true,
        plannedQty: Number(row.plannedQty || row.recommendedQty || 0),
        unitCost: Number(row.unitCost || 0),
      }))
    );
  };

  const exportPlan = async (format) => {
    if (!canExportReports) {
      notifyPermissionRequired("accounting.report to export planning reports.");
      return;
    }
    const query = new URLSearchParams();
    query.set("days", String(optimizationDays || 30));
    query.set("leadDays", String(optimizationLeadDays || 7));
    if (String(planBudget || "").trim() !== "") query.set("budget", String(Number(planBudget || 0)));
    const res = await api.get(`/purchases/plan-suggestion/export.${format}?${query.toString()}`, { responseType: "blob" });
    const filename = format === "csv" ? "purchase-plan.csv" : "purchase-plan.pdf";
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const createSplitPurchasesFromPlan = async () => {
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
    if (!planReviewRows?.length) {
      notifyActionRequired("generate a plan first.");
      return;
    }
    const includedRows = planReviewRows.filter((row) => row.include !== false && Number(row.plannedQty || 0) > 0);
    if (!includedRows.length) {
      notifyActionRequired("include at least one plan row with a valid planned quantity.");
      return;
    }
    const ok = window.confirm("Create split purchases directly from this plan now?");
    if (!ok) return;
    await api.post("/purchases/plan-suggestion/create-split", {
      days: Number(optimizationDays || 30),
      leadDays: Number(optimizationLeadDays || 7),
      budget: Number(planBudget || 0),
      rows: includedRows,
    });
    notifySuccess("split purchases created from plan.");
    setPlanData({
      summary: { lineCount: 0, supplierCount: 0, totalEstimatedCost: 0, remainingBudget: 0 },
      supplierGroups: [],
      rows: [],
    });
    setPlanReviewRows([]);
    await load();
  };

  const submitPlanForApproval = async () => {
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
    if (!planReviewRows?.length) {
      notifyActionRequired("generate a plan first.");
      return;
    }
    const includedRows = planReviewRows.filter((row) => row.include !== false && Number(row.plannedQty || 0) > 0);
    if (!includedRows.length) {
      notifyActionRequired("include at least one plan row with a valid planned quantity.");
      return;
    }
    const note = window.prompt("Approval note (optional):", "") || "";
    await api.post("/purchases/plan-approvals", { rows: includedRows, note });
    notifySuccess("plan submitted for approval.");
    await load();
  };

  const approvePlanRequest = async (approvalId) => {
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
    const pin = window.prompt("Enter manager approval PIN:");
    if (!pin) return;
    await api.post(`/purchases/plan-approvals/${Number(approvalId)}/approve`, { managerApprovalPin: pin });
    notifySuccess("approval completed and split purchase orders were created.");
    await load();
  };

  const rejectPlanRequest = async (approvalId) => {
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
    const reason = (window.prompt("Rejection reason:") || "").trim();
    if (!reason) return;
    await api.post(`/purchases/plan-approvals/${Number(approvalId)}/reject`, { reason });
    notifySuccess("approval request rejected.");
    await load();
  };

  const updatePlanReviewRow = (idx, patch) => {
    setPlanReviewRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        const plannedQty = Math.max(0, Number(next.plannedQty || 0));
        const unitCost = Math.max(0, Number(next.unitCost || 0));
        return {
          ...next,
          plannedQty,
          unitCost,
          estimatedCost: Number((plannedQty * unitCost).toFixed(2)),
        };
      })
    );
  };

  const reviewSummary = useMemo(() => {
    const included = (planReviewRows || []).filter((row) => row.include !== false && Number(row.plannedQty || 0) > 0);
    const suppliers = new Set(included.map((x) => Number(x.supplierId || 0)).filter(Boolean));
    return {
      lineCount: included.length,
      supplierCount: suppliers.size,
      totalEstimatedCost: Number(included.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0).toFixed(2)),
    };
  }, [planReviewRows]);

  const applyPlanToDraft = () => {
    const planRows = Array.isArray(planData.rows) ? planData.rows : [];
    if (!planRows.length) {
      notifyActionRequired("no planned rows are available to apply.");
      return;
    }
    const next = planRows.map((row) => ({
      productId: Number(row.productId),
      productName: row.productName,
      qty: Number(row.plannedQty || row.recommendedQty || 0),
      cost: Number(row.unitCost || 0),
      supplierId: Number(row.supplierId || 0),
      supplierName: row.supplierName || "",
      vatRate: Number(productVatById.get(Number(row.productId)) || 0),
      vatType: "EXCLUSIVE",
    }));
    setDraftItems(next);
    localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(next));
    if (!form.supplierId && planData.supplierGroups?.length === 1) {
      setForm((prev) => ({ ...prev, supplierId: String(planData.supplierGroups[0].supplierId) }));
    }
    notifySuccess(`applied ${next.length} planned line(s) to draft.`);
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
    if (!canCreatePurchaseReturn) {
      notifyPermissionRequired("purchase.return.");
      return;
    }
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
    if (!canExportReports) {
      notifyPermissionRequired("accounting.report to export return reports.");
      return;
    }
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
      const lineMap = Object.fromEntries(
        (res.data?.receiving?.rows || []).map((line) => [String(line.productId), 0])
      );
      setGrnReceiveQtyByProduct(lineMap);
      setPurchaseDetailsModal({ open: true, loading: false, data: res.data });
    } catch (error) {
      setPurchaseDetailsModal({ open: true, loading: false, data: { error: error?.response?.data?.error || "Failed to load purchase details" } });
    }
  };

  const closePurchaseDetails = () => {
    setGrnReceiveQtyByProduct({});
    setPurchaseDetailsModal({ open: false, loading: false, data: null });
  };

  const submitGrnReceive = async () => {
    if (!canManagePurchases) {
      notifyPermissionRequired("purchase.create.");
      return;
    }
    const purchaseId = Number(purchaseDetailsModal.data?.id || 0);
    if (!purchaseId) return;
    const items = Object.entries(grnReceiveQtyByProduct)
      .map(([productId, qty]) => ({ productId: Number(productId), qty: Number(qty || 0) }))
      .filter((x) => x.productId > 0 && Number.isInteger(x.qty) && x.qty > 0);
    if (!items.length) {
      notifyActionRequired("enter receiving quantity for at least one line.");
      return;
    }
    await api.post(`/purchases/${purchaseId}/receive`, { items });
    const detail = await api.get(`/purchases/${purchaseId}`);
    setGrnReceiveQtyByProduct(
      Object.fromEntries((detail.data?.receiving?.rows || []).map((line) => [String(line.productId), 0]))
    );
    setPurchaseDetailsModal({ open: true, loading: false, data: detail.data });
    await load();
  };

  const receiveAllRemaining = () => {
    const rows = purchaseDetailsModal.data?.receiving?.rows || [];
    const all = Object.fromEntries(rows.map((row) => [String(row.productId), Math.max(0, Number(row.remainingQty || 0))]));
    setGrnReceiveQtyByProduct(all);
  };

  const exportPurchaseGrnHistory = async (format) => {
    if (!canExportReports) {
      notifyPermissionRequired("accounting.report to export GRN history.");
      return;
    }
    const purchaseId = Number(purchaseDetailsModal.data?.id || 0);
    if (!purchaseId) return;
    const filename = format === "csv" ? `purchase-${purchaseId}-grn-history.csv` : `purchase-${purchaseId}-grn-history.pdf`;
    const res = await api.get(`/purchases/${purchaseId}/grn-history/export.${format}`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Purchases</div>
          <div className="page-subtitle">Step-by-step purchasing workflow</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label="Purchases workflow">
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "create"}
            className={`pos-tab ${purchasesTab === "create" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("create")}
          >
            1. Create Purchase
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "planning"}
            className={`pos-tab ${purchasesTab === "planning" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("planning")}
          >
            2. Planning & Supplier Risk
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "history"}
            className={`pos-tab ${purchasesTab === "history" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("history")}
          >
            3. History & Returns
          </button>
        </div>
      </div>
      {!canManagePurchases ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>purchase.create</code> to create purchases, plan approvals, GRN posting, and split PO actions.
        </div>
      ) : null}
      {!canCreatePurchaseReturn && purchasesTab === "history" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>purchase.return</code> to create purchase returns.
        </div>
      ) : null}
      {!canExportReports ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <strong>Permission required:</strong> <code>accounting.report</code> to export plan, return, and GRN report files.
        </div>
      ) : null}
      {purchasesTab === "planning" ? (
      <div className="page-card" style={{ marginBottom: 10 }}>
        <h4 style={{ marginTop: 0 }}>Purchase Optimization Controls</h4>
        <div className="form-grid">
          <input
            type="number"
            min={7}
            value={optimizationDays}
            onChange={(e) => setOptimizationDays(e.target.value)}
            placeholder="Sales Lookback Days"
          />
          <input
            type="number"
            min={1}
            value={optimizationLeadDays}
            onChange={(e) => setOptimizationLeadDays(e.target.value)}
            placeholder="Lead Days"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={planBudget}
            onChange={(e) => setPlanBudget(e.target.value)}
            placeholder="PO Planning Budget (Optional)"
          />
          <input
            type="number"
            min={7}
            value={supplierScorecardDays}
            onChange={(e) => setSupplierScorecardDays(e.target.value)}
            placeholder="Supplier Scorecard Lookback Days"
          />
          <button type="button" className="btn-secondary" onClick={generatePurchasePlan}>
            Generate PO Plan
          </button>
          <button type="button" className="btn-secondary" onClick={applyPlanToDraft}>
            Apply Plan to Draft
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportPlan("csv")} disabled={!canExportReports}>
            Export Plan CSV
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportPlan("pdf")} disabled={!canExportReports}>
            Export Plan PDF
          </button>
          <button type="button" className="btn-secondary" onClick={createSplitPurchasesFromPlan} disabled={!canManagePurchases}>
            Create Split POs from Plan
          </button>
          <button type="button" className="btn-secondary" onClick={submitPlanForApproval} disabled={!canManagePurchases}>
            Submit Plan for Approval
          </button>
        </div>
        {planData?.summary ? (
          <div className="quick-stats" style={{ marginTop: 8 }}>
            <div className="stat">Plan Lines: {Number(planData.summary.lineCount || 0)}</div>
            <div className="stat">Suppliers: {Number(planData.summary.supplierCount || 0)}</div>
            <div className="stat">Plan Cost: ৳{Number(planData.summary.totalEstimatedCost || 0).toFixed(2)}</div>
            <div className="stat">Budget Left: ৳{Number(planData.summary.remainingBudget || 0).toFixed(2)}</div>
          </div>
        ) : null}
        {planReviewRows.length ? (
          <div className="quick-stats" style={{ marginTop: 8 }}>
            <div className="stat">Review Lines: {Number(reviewSummary.lineCount || 0)}</div>
            <div className="stat">Review Suppliers: {Number(reviewSummary.supplierCount || 0)}</div>
            <div className="stat">Review Cost: ৳{Number(reviewSummary.totalEstimatedCost || 0).toFixed(2)}</div>
          </div>
        ) : null}
      </div>
      ) : null}
      {purchasesTab === "planning" && planData?.supplierGroups?.length ? (
        <DataTable
          title="PO Plan by Supplier"
          rows={(planData.supplierGroups || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["supplierName"]}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "supplierName", label: "Supplier" },
            { key: "lineCount", label: "Lines" },
            { key: "estimatedCost", label: "Estimated Cost", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          ]}
        />
      ) : null}
      {purchasesTab === "planning" && planReviewRows?.length ? (
        <DataTable
          title="Auto PO Planner Lines (Review Mode)"
          rows={(planReviewRows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["productName", "sku", "supplierName"]}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "productName", label: "Product" },
            { key: "sku", label: "SKU", render: (v) => v || "-" },
            { key: "stock", label: "Stock" },
            { key: "recommendedQty", label: "Recommended" },
            {
              key: "plannedQty",
              label: "Planned Qty",
              render: (v, row) => (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={Number(v || 0)}
                  onChange={(e) => updatePlanReviewRow(Number(row.rowNo) - 1, { plannedQty: Number(e.target.value || 0) })}
                  style={{ width: 90 }}
                />
              ),
            },
            { key: "supplierName", label: "Supplier" },
            {
              key: "unitCost",
              label: "Unit Cost",
              render: (v, row) => (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number(v || 0)}
                  onChange={(e) => updatePlanReviewRow(Number(row.rowNo) - 1, { unitCost: Number(e.target.value || 0) })}
                  style={{ width: 100 }}
                />
              ),
            },
            { key: "estimatedCost", label: "Estimated Cost", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "moq", label: "MOQ" },
            {
              key: "include",
              label: "Include",
              render: (v, row) => (
                <input
                  type="checkbox"
                  checked={Boolean(v)}
                  onChange={(e) => updatePlanReviewRow(Number(row.rowNo) - 1, { include: e.target.checked })}
                />
              ),
            },
          ]}
        />
      ) : null}
      {purchasesTab === "planning" && planApprovals?.length ? (
        <DataTable
          title="PO Plan Approval Queue"
          rows={(planApprovals || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["status", "submittedBy", "note"]}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "status", label: "Status" },
            { key: "submittedBy", label: "Requested By", render: (v) => v || "-" },
            { key: "lineCount", label: "Lines" },
            { key: "totalEstimatedCost", label: "Estimated Cost", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "note", label: "Note", render: (v) => v || "-" },
            {
              key: "action",
              label: "Action",
              render: (_, row) =>
                row.status === "PENDING" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => approvePlanRequest(row.id)}
                      disabled={!canManagePurchases}
                    >
                      Approve & Create
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => rejectPlanRequest(row.id)}
                      disabled={!canManagePurchases}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  "-"
                ),
            },
          ]}
        />
      ) : null}
      {purchasesTab === "planning" ? (
      <div className="page-card" style={{ marginBottom: 10 }}>
        <h4 style={{ marginTop: 0 }}>Supplier Scorecards with Penalties</h4>
        <div className="quick-stats">
          <div className="stat">Suppliers: {Number(supplierScorecards.summary?.supplierCount || 0)}</div>
          <div className="stat">Avg Score: {Number(supplierScorecards.summary?.avgScore || 0).toFixed(2)}</div>
          <div className="stat">High Risk: {Number(supplierScorecards.summary?.highRiskSuppliers || 0)}</div>
          <div className="stat">Total Spend: ৳{Number(supplierScorecards.summary?.totalSpend || 0).toFixed(2)}</div>
        </div>
      </div>
      ) : null}
      {purchasesTab === "planning" && supplierScorecards?.rows?.length ? (
        <DataTable
          title="Supplier Risk & Penalty Scorecards"
          rows={(supplierScorecards.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["supplierName", "riskBand"]}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "supplierName", label: "Supplier" },
            { key: "purchaseCount", label: "Purchases" },
            { key: "totalSpend", label: "Spend", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "returnRatePct", label: "Return %", render: (v) => `${Number(v || 0).toFixed(2)}%` },
            { key: "priceVolatilityPct", label: "Price Volatility %", render: (v) => `${Number(v || 0).toFixed(2)}%` },
            { key: "totalDue", label: "Due", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "penaltyPoints", label: "Penalty", render: (v) => Number(v || 0).toFixed(2) },
            { key: "score", label: "Score", render: (v) => Number(v || 0).toFixed(2) },
            {
              key: "riskBand",
              label: "Risk",
              render: (v) => (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: "#fff",
                    background:
                      String(v || "").toUpperCase() === "HIGH"
                        ? "#b91c1c"
                        : String(v || "").toUpperCase() === "MEDIUM"
                          ? "#d97706"
                          : "#15803d",
                  }}
                >
                  {String(v || "-")}
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {draftItems.length ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <h4>Low-Stock Purchase Draft ({draftItems.length} items)</h4>
          {draftSupplierSummary.length ? (
            <div style={{ marginBottom: 8 }}>
              <strong>Suggested Supplier:</strong>{" "}
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
                      {Number(x.suggestion.moq || 0) > 1 ? ` · MOQ ${Number(x.suggestion.moq)}` : ""}
                    </span>
                  ) : null}
                  {x.optimization ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · Reorder suggestion qty: {Number(x.optimization.recommendedQty || 0)}
                    </span>
                  ) : null}
                  {x.suggestion?.moq && Number(x.qty || 0) < Number(x.suggestion.moq) ? (
                    <span style={{ color: "#b91c1c" }}>
                      {" "}
                      · MOQ warning: draft qty below MOQ ({Number(x.suggestion.moq)})
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
                      Use Best Supplier
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
            disabled={!canManagePurchases}
            style={{ marginTop: 8, marginLeft: 8 }}
          >
            Auto Split & Create Bills
          </button>
        </div>
      ) : null}
      {purchasesTab === "create" ? (
      <form onSubmit={submit} className="form-grid">
        <Select
          className="form-select-sm"
          value={supplierOptions.find((opt) => opt.value === String(form.supplierId)) || null}
          options={supplierOptions}
          onChange={(opt) => setForm({ ...form, supplierId: opt?.value || "" })}
          placeholder="Select Supplier"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <input placeholder="Invoice Number" value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} />
        <input placeholder="Paid Amount (BDT)" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} />
        <Select
          className="form-select-sm"
          value={productOptions.find((opt) => opt.value === String(form.productId)) || null}
          options={productOptions}
          onChange={(opt) => {
            const productId = Number(opt?.value || 0);
            const recommendation = optimizationRows.find((x) => Number(x.productId) === productId);
            setForm({
              ...form,
              productId: opt?.value || "",
              supplierId:
                recommendation?.bestSupplier?.supplierId && !form.supplierId
                  ? String(recommendation.bestSupplier.supplierId)
                  : form.supplierId,
              qty:
                recommendation?.recommendedQty && Number(recommendation.recommendedQty) > 0
                  ? String(recommendation.recommendedQty)
                  : form.qty,
              cost:
                recommendation?.bestSupplier?.avgCost && Number(recommendation.bestSupplier.avgCost) > 0
                  ? String(recommendation.bestSupplier.avgCost)
                  : form.cost,
              vatRate: productId ? String(productVatById.get(productId) || 0) : "",
              vatType: "EXCLUSIVE",
            });
          }}
          placeholder="Select Product"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <input placeholder="Quantity" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input placeholder="Unit Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
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
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(form.deferStockPosting)}
            onChange={(e) => setForm({ ...form, deferStockPosting: e.target.checked })}
          />
          Defer stock posting (Receive by GRN)
        </label>
        <button type="submit" disabled={!canManagePurchases}>Create Purchase</button>
      </form>
      ) : null}
      {purchasesTab === "create" && form.productId ? (
        <div className="page-card" style={{ marginTop: 8 }}>
          {(() => {
            const rec = optimizationRows.find((x) => Number(x.productId) === Number(form.productId));
            if (!rec) return <p className="pos-inline-note">No optimization data yet for selected product.</p>;
            return (
              <>
                <p>
                  <strong>Velocity:</strong> Sold {Number(rec.soldQty || 0)} in period, Avg/day {Number(rec.avgDailySold || 0).toFixed(2)}
                </p>
                <p>
                  <strong>Suggested reorder:</strong> {Number(rec.recommendedQty || 0)}
                </p>
                {rec.bestSupplier ? (
                  <p>
                    <strong>Best Supplier:</strong> {rec.bestSupplier.supplierName} · Avg Cost ৳
                    {Number(rec.bestSupplier.avgCost || 0).toFixed(2)} · MOQ {Number(rec.bestSupplier.moq || 1)}
                    {Number(form.qty || 0) > 0 && Number(form.qty || 0) < Number(rec.bestSupplier.moq || 1) ? (
                      <span style={{ color: "#b91c1c" }}> (Entered quantity is below MOQ)</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="pos-inline-note">No supplier price history found for this product.</p>
                )}
              </>
            );
          })()}
        </div>
      ) : null}

      {purchasesTab === "history" ? <h4 style={{ marginTop: 8 }}>Purchase Return</h4> : null}
      {purchasesTab === "history" ? (
      <form onSubmit={submitReturn} className="form-grid">
        <Select
          className="form-select-sm"
          value={returnPurchaseOptions.find((opt) => opt.value === String(returnForm.purchaseId)) || null}
          options={returnPurchaseOptions}
          onChange={(opt) =>
            setReturnForm({
              ...returnForm,
              purchaseId: opt?.value || "",
              productId: "",
              qty: "",
              cost: "",
            })
          }
          placeholder="Select Purchase"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <Select
          className="form-select-sm"
          value={returnProductOptions.find((opt) => opt.value === String(returnForm.productId)) || null}
          options={returnProductOptions}
          onChange={(opt) => setReturnForm({ ...returnForm, productId: opt?.value || "" })}
          placeholder="Select Product"
          isClearable
          isSearchable
          styles={SEARCH_SELECT_STYLES}
        />
        <input placeholder="Return Quantity" value={returnForm.qty} onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })} />
        <input placeholder="Return Unit Cost" value={returnForm.cost} onChange={(e) => setReturnForm({ ...returnForm, cost: e.target.value })} />
        <input placeholder="Reason" value={returnForm.reason} onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })} />
        <button type="submit" disabled={!canCreatePurchaseReturn}>Create Purchase Return</button>
      </form>
      ) : null}
      {purchasesTab === "history" ? (
      <div className="quick-stats">
        <div className="stat">Bills: {purchases.length}</div>
        <div className="stat">Total: ৳{purchases.reduce((s, p) => s + Number(p.total), 0).toFixed(2)}</div>
        <div className="stat">Paid: ৳{purchases.reduce((s, p) => s + Number(p.paidAmount), 0).toFixed(2)}</div>
        <div className="stat">Due: ৳{purchases.reduce((s, p) => s + Number(p.dueAmount), 0).toFixed(2)}</div>
      </div>
      ) : null}
      {purchasesTab === "history" ? (
      <DataTable
        title="Purchase History"
        rows={purchases.map((p) => ({
          ...p,
          supplierName: p.supplier?.name || "-",
          createdAtLabel: new Date(p.createdAt).toLocaleString(),
          taxableAmount: Number(p.vatBreakdown?.taxableAmount || Math.max(0, Number(p.total || 0))).toFixed(2),
          inputVat: Number(p.vatBreakdown?.inputVat || 0).toFixed(2),
          grossAmount: Number(p.vatBreakdown?.grossAmount || p.total || 0).toFixed(2),
          receiveStatus: p.receiving?.status || "PENDING",
          remainingQty: Number(p.receiving?.remainingQtyTotal || 0),
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
          { key: "receiveStatus", label: "Receive Status", render: (v) => v || "-" },
          { key: "remainingQty", label: "Pending Qty", render: (v) => Number(v || 0) },
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
      ) : null}
      {purchasesTab === "history" ? (
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
      ) : null}
      {purchasesTab === "history" ? (
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
        <button type="button" onClick={() => exportReturns("csv")} disabled={!canExportReports}>Export Returns CSV</button>
        <button type="button" className="btn-secondary" onClick={() => exportReturns("pdf")} disabled={!canExportReports}>Export Returns PDF</button>
      </div>
      ) : null}
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
                  <div className="stat">Receive: {purchaseDetailsModal.data?.receiving?.status || "-"}</div>
                  <div className="stat">Pending Quantity: {Number(purchaseDetailsModal.data?.receiving?.remainingQtyTotal || 0)}</div>
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
                <DataTable
                  title="GRN Receiving Progress"
                  rows={(purchaseDetailsModal.data?.receiving?.rows || []).map((line, idx) => ({
                    rowNo: idx + 1,
                    ...line,
                    productName:
                      (purchaseDetailsModal.data?.vatLines || []).find((x) => Number(x.productId) === Number(line.productId))?.productName ||
                      `Product #${line.productId}`,
                  }))}
                  searchableKeys={["productName"]}
                  pageSize={5}
                  columns={[
                    { key: "rowNo", label: "SL" },
                    { key: "productName", label: "Product" },
                    { key: "orderedQty", label: "Ordered" },
                    { key: "receivedQty", label: "Received" },
                    { key: "remainingQty", label: "Remaining" },
                    {
                      key: "receiveNow",
                      label: "Receive Now",
                      render: (_, row) => (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Number(grnReceiveQtyByProduct[String(row.productId)] || 0)}
                          onChange={(e) =>
                            setGrnReceiveQtyByProduct((prev) => ({
                              ...prev,
                              [String(row.productId)]: Number(e.target.value || 0),
                            }))
                          }
                          style={{ width: 90 }}
                        />
                      ),
                    },
                  ]}
                />
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={receiveAllRemaining} style={{ marginRight: 6 }}>
                    Receive All Remaining
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={submitGrnReceive} disabled={!canManagePurchases}>
                    Post GRN Receive
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => exportPurchaseGrnHistory("csv")}
                    disabled={!canExportReports}
                    style={{ marginLeft: 6 }}
                  >
                    Export GRN CSV
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => exportPurchaseGrnHistory("pdf")}
                    disabled={!canExportReports}
                    style={{ marginLeft: 6 }}
                  >
                    Export GRN PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Purchases;
