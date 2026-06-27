import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import SearchSelect from "../components/SearchSelect";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import {
  notifyActionRequired,
  notifyError,
  notifyPermissionRequired,
  notifySuccess,
} from "../utils/notify";
import { getLang, t } from "../i18n";
import { formatProductStockDisplay, formatSaleUnitBadge } from "../utils/formatSaleLineQty";
import {
  productNeedsExpiryOnPurchase,
  suggestExpiryDateFromShelfLife,
} from "../constants/retailDepartments";

const PURCHASE_DRAFT_KEY = "bd_pos_purchase_draft_v1";
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

  const [purchases, setPurchases] = useState([]);
  const [purchaseReturns, setPurchaseReturns] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    supplierId: "",
    invoiceNo: "",
    paidAmount: "",
    transportationCost: "",
    bribesCost: "",
    extraOtherCost: "",
    financingSource: "SUPPLIER_CREDIT",
    loanReference: "",
    loanNote: "",
    loanMaturityDate: "",
    productId: "",
    qty: "",
    cost: "",
    vatRate: "",
    vatType: "EXCLUSIVE",
    deferStockPosting: false,
    productVariantId: "",
    batchCode: "",
    expiryDate: "",
  });

  const purchaseLineKey = (line) =>
    `${line.productId}-${line.productVariantId || 0}-${String(line.batchCode || "").trim()}`;

  const productById = useMemo(() => new Map(products.map((p) => [Number(p.id), p])), [products]);
  const selectedPurchaseProduct = productById.get(Number(form.productId)) || null;
  const purchaseNeedsBatch = productNeedsExpiryOnPurchase(selectedPurchaseProduct);
  const purchaseNeedsVariant = Boolean(
    selectedPurchaseProduct?.hasVariants && selectedPurchaseProduct?.variants?.length
  );

  useEffect(() => {
    if (!selectedPurchaseProduct || !purchaseNeedsBatch) return;
    const suggested = suggestExpiryDateFromShelfLife(selectedPurchaseProduct);
    if (!suggested) return;
    setForm((f) => ({
      ...f,
      expiryDate: f.expiryDate || suggested,
      batchCode:
        f.batchCode ||
        (selectedPurchaseProduct.batchTracked
          ? ""
          : `LOT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`),
    }));
  }, [form.productId, purchaseNeedsBatch, selectedPurchaseProduct?.id, selectedPurchaseProduct?.shelfLifeDays]);
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
  useEffect(() => {
    if (purchasesTab === "history") purchasesHistory.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasesTab]);
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [paymentSchedule, setPaymentSchedule] = useState({
    summary: {
      purchaseCount: 0,
      lineCount: 0,
      openLineCount: 0,
      outstandingTotal: 0,
      overdueCount: 0,
      remindersDue: 0,
      aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    },
    rows: [],
  });
  const [vendorBillModal, setVendorBillModal] = useState({
    open: false,
    purchaseId: null,
    supplierName: "",
    total: 0,
    status: "DRAFT",
    billNo: "",
    dueDate: "",
    note: "",
    attachments: [],
    loading: false,
  });
  const [overrideMeta, setOverrideMeta] = useState({ reason: "", refNo: "" });
  const overridePayload = useMemo(
    () => ({
      overrideReason: String(overrideMeta.reason || "").trim() || undefined,
      overrideRefNo: String(overrideMeta.refNo || "").trim() || undefined,
    }),
    [overrideMeta.reason, overrideMeta.refNo]
  );

  const branchIdForFiscal = typeof window !== "undefined" ? localStorage.getItem("bd_pos_branch_id") || "1" : "1";
  const { data: fiscalGateData } = useQuery({
    queryKey: ["fiscal-gate", branchIdForFiscal],
    queryFn: async () => (await api.get("/fiscal/fiscal-period-status")).data,
    staleTime: 45_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const fiscalBlocked = Boolean(fiscalGateData && fiscalGateData.ok === false);

  // Server-driven data source for the purchase-history table (backend search/sort/paging).
  const fetchPurchasePage = useCallback(async (q) => {
    const res = await api.get("/purchases", {
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
  const purchasesHistory = useServerTable(fetchPurchasePage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (returnRange.from) query.set("from", returnRange.from);
    if (returnRange.to) query.set("to", returnRange.to);
    const returnsUrl = query.toString() ? `/purchases/returns?${query.toString()}` : "/purchases/returns";
    const [purchaseRes, returnsRes, supplierRes, productRes, optimizationRes, approvalsRes, supplierScorecardRes, scheduleRes] = await Promise.all([
      api.get("/purchases"),
      api.get(returnsUrl),
      api.get("/master/suppliers"),
      api.get("/products?include=variants"),
      api.get(`/purchases/optimization?days=${optimizationDays}&leadDays=${optimizationLeadDays}`),
      api.get("/purchases/plan-approvals"),
      api.get(`/purchases/supplier-scorecards?days=${Number(supplierScorecardDays || 60)}`),
      api.get("/purchases/payment-schedule"),
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
    setPaymentSchedule(
      scheduleRes.data || {
        summary: {
          purchaseCount: 0,
          lineCount: 0,
          openLineCount: 0,
          outstandingTotal: 0,
          overdueCount: 0,
          remindersDue: 0,
          aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
        },
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
      products.map((p) => {
        const unit = formatSaleUnitBadge(p, tt);
        return {
          value: String(p.id),
          label: unit ? `${p.name} · ${unit}` : p.name,
        };
      }),
    [products]
  );
  const returnPurchaseOptions = useMemo(
    () =>
      purchases.map((p) => ({
        value: String(p.id),
        label: `#${p.id} — ${p.supplier?.name || tt("purGenericSupplier")} — ৳${Number(p.total || 0).toFixed(2)}${
          String(p.financingSource || "").toUpperCase() === "BANK_LOAN" ? ` ${tt("purPurchaseOptLoan")}` : ""
        }`,
      })),
    [purchases, tt]
  );
  const returnProductOptions = useMemo(
    () =>
      returnItems.map((i) => ({
        value: String(i.productId),
        label: tt("purReturnProductOption", {
          pid: i.productId,
          qty: i.qty,
          cost: Number(i.cost || 0).toFixed(2),
        }),
      })),
    [returnItems, tt]
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
      const label = row.suggestion.supplierName || tt("purSupplierNum", { n: id });
      counts.set(id, {
        supplierId: id,
        supplierName: label,
        count: Number(counts.get(id)?.count || 0) + 1,
      });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [draftSuggestions, tt]);

  const submit = async (e) => {
    e.preventDefault();
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posFiscalNoPeriod"));
      return;
    }
    const manualLine =
      form.productId && form.qty
        ? [
            {
              productId: Number(form.productId),
              productVariantId: form.productVariantId ? Number(form.productVariantId) : null,
              qty: Number(form.qty),
              cost: Number(form.cost || 0),
              batchCode: form.batchCode ? String(form.batchCode).trim() : null,
              expiryDate: form.expiryDate || null,
              vatRate: Number(form.vatRate || productVatById.get(Number(form.productId)) || 0),
              vatType: String(form.vatType || "EXCLUSIVE").toUpperCase(),
            },
          ]
        : [];
    const draftLines = draftItems
      .map((x) => ({
        productId: Number(x.productId),
        productVariantId: x.productVariantId ? Number(x.productVariantId) : null,
        qty: Number(x.qty || 0),
        cost: Number(x.cost || 0),
        batchCode: x.batchCode ? String(x.batchCode).trim() : null,
        expiryDate: x.expiryDate || null,
        vatRate: Number(
          x.vatRate != null ? x.vatRate : productVatById.get(Number(x.productId)) || 0
        ),
        vatType: String(x.vatType || "EXCLUSIVE").toUpperCase(),
      }))
      .filter((x) => x.productId && x.qty > 0);
    const lineMap = new Map();
    for (const line of [...manualLine, ...draftLines]) {
      const key = purchaseLineKey(line);
      if (!lineMap.has(key)) {
        lineMap.set(key, { ...line });
      } else {
        const prev = lineMap.get(key);
        lineMap.set(key, {
          ...prev,
          qty: Number(prev.qty || 0) + Number(line.qty || 0),
          cost: Number(line.cost || prev.cost || 0),
        });
      }
    }
    const lines = [...lineMap.values()].filter((x) => x.qty > 0);
    if (!lines.length) {
      notifyActionRequired(tt("purNotifyAddLineOrDraft"));
      return;
    }
    setSubmittingPurchase(true);
    try {
      await api.post("/purchases", {
        supplierId: Number(form.supplierId),
        invoiceNo: form.invoiceNo || null,
        paidAmount: Number(form.paidAmount || 0),
        transportationCost: Number(form.transportationCost || 0),
        bribesCost: Number(form.bribesCost || 0),
        extraOtherCost: Number(form.extraOtherCost || 0),
        financingSource: form.financingSource || "SUPPLIER_CREDIT",
        loanReference: form.financingSource === "BANK_LOAN" ? form.loanReference?.trim() || null : null,
        loanNote: form.financingSource === "BANK_LOAN" ? form.loanNote?.trim() || null : null,
        loanMaturityDate:
          form.financingSource === "BANK_LOAN" && form.loanMaturityDate ? form.loanMaturityDate : null,
        items: lines,
        deferStockPosting: Boolean(form.deferStockPosting),
        ...overridePayload,
      });
      setForm({
        supplierId: "",
        invoiceNo: "",
        paidAmount: "",
        transportationCost: "",
        bribesCost: "",
        extraOtherCost: "",
        financingSource: "SUPPLIER_CREDIT",
        loanReference: "",
        loanNote: "",
        loanMaturityDate: "",
        productId: "",
        qty: "",
        cost: "",
        vatRate: "",
        vatType: "EXCLUSIVE",
        deferStockPosting: false,
        productVariantId: "",
        batchCode: "",
        expiryDate: "",
      });
      setDraftItems([]);
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
      await load();
      notifySuccess(tt("purSuccessPurchaseCreated"));
    } finally {
      setSubmittingPurchase(false);
    }
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
      notifyActionRequired(tt("purNotifyNoSupplierSuggestions"));
      return;
    }
    const confirmed = window.confirm(tt("purConfirmSplitBills", { n: grouped.size }));
    if (!confirmed) return;
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posFiscalNoPeriod"));
      return;
    }

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
        ...overridePayload,
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
        tt("purSuccessSplitWithRemain", { bills: grouped.size, items: nextDraftItems.length })
      );
    } else {
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
      notifySuccess(tt("purSuccessSplitDraftEmpty", { bills: grouped.size }));
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
      notifyPermissionRequired(tt("purNeedPermExportPlan"));
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
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    if (!planReviewRows?.length) {
      notifyActionRequired(tt("purNotifyGenPlanFirst"));
      return;
    }
    const includedRows = planReviewRows.filter((row) => row.include !== false && Number(row.plannedQty || 0) > 0);
    if (!includedRows.length) {
      notifyActionRequired(tt("purNotifyIncludePlanRow"));
      return;
    }
    const ok = window.confirm(tt("purConfirmSplitFromPlan"));
    if (!ok) return;
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posFiscalNoPeriod"));
      return;
    }
    await api.post("/purchases/plan-suggestion/create-split", {
      days: Number(optimizationDays || 30),
      leadDays: Number(optimizationLeadDays || 7),
      budget: Number(planBudget || 0),
      rows: includedRows,
      ...overridePayload,
    });
    notifySuccess(tt("purSuccessSplitFromPlan"));
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
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    if (!planReviewRows?.length) {
      notifyActionRequired(tt("purNotifyGenPlanFirst"));
      return;
    }
    const includedRows = planReviewRows.filter((row) => row.include !== false && Number(row.plannedQty || 0) > 0);
    if (!includedRows.length) {
      notifyActionRequired(tt("purNotifyIncludePlanRow"));
      return;
    }
    const note = window.prompt(tt("purPromptApprovalNote"), "") || "";
    await api.post("/purchases/plan-approvals", { rows: includedRows, note });
    notifySuccess(tt("purSuccessPlanSubmitted"));
    await load();
  };

  const approvePlanRequest = async (approvalId) => {
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    const pin = window.prompt(tt("purPromptManagerPin"));
    if (!pin) return;
    await api.post(`/purchases/plan-approvals/${Number(approvalId)}/approve`, {
      managerApprovalPin: pin,
      ...overridePayload,
    });
    notifySuccess(tt("purSuccessApprovalCreated"));
    await load();
  };

  const rejectPlanRequest = async (approvalId) => {
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    const reason = (window.prompt(tt("purPromptRejectReason")) || "").trim();
    if (!reason) return;
    await api.post(`/purchases/plan-approvals/${Number(approvalId)}/reject`, { reason });
    notifySuccess(tt("purSuccessApprovalRejected"));
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
      notifyActionRequired(tt("purNotifyNoPlannedRows"));
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
    notifySuccess(tt("purSuccessAppliedDraft", { n: next.length }));
  };

  const removeDraftItem = (lineKey) => {
    const next = draftItems.filter((x) => purchaseLineKey(x) !== lineKey);
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
      notifyPermissionRequired(tt("purNeedPermReturn"));
      return;
    }
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posFiscalNoPeriod"));
      return;
    }
    setSubmittingReturn(true);
    try {
      await api.post(`/purchases/${Number(returnForm.purchaseId)}/return`, {
        reason: returnForm.reason,
        items: [
          {
            productId: Number(returnForm.productId),
            qty: Number(returnForm.qty),
            cost: Number(returnForm.cost),
          },
        ],
        ...overridePayload,
      });
      setReturnForm({ purchaseId: "", productId: "", qty: "", cost: "", reason: "" });
      await load();
      notifySuccess(tt("purSuccessReturnPosted"));
    } finally {
      setSubmittingReturn(false);
    }
  };

  const exportReturns = async (format) => {
    if (!canExportReports) {
      notifyPermissionRequired(tt("purNeedPermExportReturns"));
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
      setPurchaseDetailsModal({ open: true, loading: false, data: { error: error?.response?.data?.error || tt("purErrLoadDetails") } });
    }
  };

  const closePurchaseDetails = () => {
    setGrnReceiveQtyByProduct({});
    setPurchaseDetailsModal({ open: false, loading: false, data: null });
  };

  const submitGrnReceive = async () => {
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    const purchaseId = Number(purchaseDetailsModal.data?.id || 0);
    if (!purchaseId) return;
    const items = Object.entries(grnReceiveQtyByProduct)
      .map(([productId, qty]) => ({ productId: Number(productId), qty: Number(qty || 0) }))
      .filter((x) => x.productId > 0 && Number.isInteger(x.qty) && x.qty > 0);
    if (!items.length) {
      notifyActionRequired(tt("purNotifyReceiveQty"));
      return;
    }
    await api.post(`/purchases/${purchaseId}/receive`, { items, ...overridePayload });
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
      notifyPermissionRequired(tt("purNeedPermExportGrn"));
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

  const runScheduleAutomation = async () => {
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    await api.post("/purchases/payment-schedule/automation/run");
    notifySuccess(tt("purScheduleAutomationDone"));
    await load();
  };

  const exportPaymentSchedule = async (format) => {
    if (!canExportReports) {
      notifyPermissionRequired(tt("purNeedPermExportPlan"));
      return;
    }
    const url = `/purchases/payment-schedule/export.${format}`;
    const filename = format === "csv" ? "purchase-payment-schedule.csv" : "purchase-payment-schedule.pdf";
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const payScheduleEntry = async (row) => {
    if (!canManagePurchases) {
      notifyPermissionRequired(tt("purNeedPermCreate"));
      return;
    }
    const amountRaw = window.prompt(
      tt("purPromptSchedulePayAmount"),
      String(Number(row.outstanding || 0).toFixed(2))
    );
    if (!amountRaw) return;
    const amount = Number(amountRaw);
    if (!(amount > 0)) {
      notifyError(tt("purErrInvalidPayAmount"));
      return;
    }
    const method = (window.prompt(tt("purPromptPayMethod"), "Cash") || "Cash").trim() || "Cash";
    const note = window.prompt(tt("purPromptPayNote"), "") || "";
    await api.post(
      `/purchases/${Number(row.purchaseId)}/payment-schedule/${encodeURIComponent(row.entryKey)}/pay`,
      { amount, method, note, ...overridePayload }
    );
    notifySuccess(tt("purSchedulePaymentPosted"));
    await load();
  };

  const openVendorBillModal = (row) => {
    const vendorBill = row.vendorBill || {};
    setVendorBillModal({
      open: true,
      purchaseId: Number(row.id),
      supplierName: row.supplierName || row.supplier?.name || "-",
      total: Number(row.total || 0),
      status: String(vendorBill.status || "DRAFT"),
      billNo: String(vendorBill.billNo || ""),
      dueDate: vendorBill.dueDate ? String(vendorBill.dueDate).slice(0, 10) : "",
      note: String(vendorBill.note || ""),
      attachments: Array.isArray(vendorBill.attachments) ? vendorBill.attachments : [],
      loading: false,
    });
  };

  const closeVendorBillModal = () => {
    setVendorBillModal({
      open: false,
      purchaseId: null,
      supplierName: "",
      total: 0,
      status: "DRAFT",
      billNo: "",
      dueDate: "",
      note: "",
      attachments: [],
      loading: false,
    });
  };

  const addVendorBillAttachment = () => {
    setVendorBillModal((prev) => ({
      ...prev,
      attachments: [...(prev.attachments || []), { name: "", url: "", mimeType: "", size: 0, note: "" }],
    }));
  };

  const updateVendorBillAttachment = (idx, patch) => {
    setVendorBillModal((prev) => ({
      ...prev,
      attachments: (prev.attachments || []).map((att, i) => (i === idx ? { ...att, ...patch } : att)),
    }));
  };

  const removeVendorBillAttachment = (idx) => {
    setVendorBillModal((prev) => ({
      ...prev,
      attachments: (prev.attachments || []).filter((_, i) => i !== idx),
    }));
  };

  const saveVendorBillRecord = async () => {
    if (!vendorBillModal.purchaseId) return;
    setVendorBillModal((prev) => ({ ...prev, loading: true }));
    try {
      const validUrl = (value) => {
        try {
          const url = new URL(String(value || "").trim());
          return ["http:", "https:"].includes(url.protocol);
        } catch {
          return false;
        }
      };
      const malformed = (vendorBillModal.attachments || []).find(
        (x) => String(x.name || "").trim() && String(x.url || "").trim() && !validUrl(x.url)
      );
      if (malformed) {
        notifyError(tt("purInvalidAttachmentUrl"));
        return;
      }
      const payload = {
        billNo: vendorBillModal.billNo || "",
        dueDate: vendorBillModal.dueDate || null,
        note: vendorBillModal.note || "",
        attachments: (vendorBillModal.attachments || []).filter(
          (x) => String(x.name || "").trim() && String(x.url || "").trim()
        ),
      };
      await api.put(`/purchases/${Number(vendorBillModal.purchaseId)}/vendor-bill`, payload);
      notifySuccess(tt("purBillSaved"));
      await load();
      setVendorBillModal((prev) => ({ ...prev, status: "DRAFT" }));
    } finally {
      setVendorBillModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const submitVendorBillForApproval = async () => {
    if (!vendorBillModal.purchaseId) return;
    setVendorBillModal((prev) => ({ ...prev, loading: true }));
    try {
      await saveVendorBillRecord();
      const res = await api.post(`/purchases/${Number(vendorBillModal.purchaseId)}/vendor-bill/submit`);
      notifySuccess(tt("purBillSubmitted"));
      if (res?.data?.approvalEventId) {
        localStorage.setItem("bd_pos_approval_focus_id", String(res.data.approvalEventId));
      }
      await load();
      setVendorBillModal((prev) => ({ ...prev, status: "SUBMITTED" }));
    } finally {
      setVendorBillModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const openAttachment = (url) => {
    const raw = String(url || "").trim();
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch {
      notifyError(tt("purInvalidAttachmentUrl"));
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("purchases")}</div>
          <div className="page-subtitle">{tt("purchasesPageSubtitle")}</div>
        </div>
      </div>
      {fiscalBlocked ? (
        <div className="page-card fiscal-banner">
          <strong>{tt("purFiscalBannerTitle")}</strong>
          <p>{fiscalGateData?.message || tt("posFiscalNoPeriod")}</p>
        </div>
      ) : null}
      <div className="page-card" style={{ marginBottom: 10 }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Override control (Procurement & Payables)</h4>
        <div className="form-grid">
          <input
            value={overrideMeta.reason}
            onChange={(e) => setOverrideMeta((p) => ({ ...p, reason: e.target.value }))}
            placeholder="Override reason (required if period locked)"
          />
          <input
            value={overrideMeta.refNo}
            onChange={(e) => setOverrideMeta((p) => ({ ...p, refNo: e.target.value }))}
            placeholder="Ticket / reference no. (required if period locked)"
          />
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label={tt("purchasesTabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "create"}
            className={`pos-tab ${purchasesTab === "create" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("create")}
          >
            {tt("purTabCreate")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "planning"}
            className={`pos-tab ${purchasesTab === "planning" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("planning")}
          >
            {tt("purTabPlanning")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={purchasesTab === "history"}
            className={`pos-tab ${purchasesTab === "history" ? "pos-tab-active" : ""}`}
            onClick={() => setPurchasesTab("history")}
          >
            {tt("purTabHistory")}
          </button>
        </div>
      </div>
      {!canManagePurchases ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("purPermBannerCreate")}</p>
        </div>
      ) : null}
      {!canCreatePurchaseReturn && purchasesTab === "history" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("purPermBannerReturn")}</p>
        </div>
      ) : null}
      {!canExportReports ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("purPermBannerExport")}</p>
        </div>
      ) : null}
      {purchasesTab === "planning" ? (
      <div className="page-card" style={{ marginBottom: 10 }}>
        <h4 style={{ marginTop: 0 }}>{tt("purOptControlsTitle")}</h4>
        <div className="form-grid">
          <input
            type="number"
            min={7}
            value={optimizationDays}
            onChange={(e) => setOptimizationDays(e.target.value)}
            placeholder={tt("purPhSalesLookback")}
          />
          <input
            type="number"
            min={1}
            value={optimizationLeadDays}
            onChange={(e) => setOptimizationLeadDays(e.target.value)}
            placeholder={tt("purPhLeadDays")}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={planBudget}
            onChange={(e) => setPlanBudget(e.target.value)}
            placeholder={tt("purPhPlanBudget")}
          />
          <input
            type="number"
            min={7}
            value={supplierScorecardDays}
            onChange={(e) => setSupplierScorecardDays(e.target.value)}
            placeholder={tt("purPhScorecardLookback")}
          />
          <button type="button" className="btn-secondary" onClick={generatePurchasePlan}>
            {tt("purBtnGenPlan")}
          </button>
          <button type="button" className="btn-secondary" onClick={applyPlanToDraft}>
            {tt("purBtnApplyPlanDraft")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportPlan("csv")} disabled={!canExportReports}>
            {tt("purBtnExportPlanCsv")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportPlan("pdf")} disabled={!canExportReports}>
            {tt("purBtnExportPlanPdf")}
          </button>
          <button type="button" className="btn-secondary" onClick={createSplitPurchasesFromPlan} disabled={!canManagePurchases}>
            {tt("purBtnCreateSplitFromPlan")}
          </button>
          <button type="button" className="btn-secondary" onClick={submitPlanForApproval} disabled={!canManagePurchases}>
            {tt("purBtnSubmitPlanApproval")}
          </button>
        </div>
        {planData?.summary ? (
          <div className="quick-stats" style={{ marginTop: 8 }}>
            <div className="stat">{tt("purStatPlanLines")} {Number(planData.summary.lineCount || 0)}</div>
            <div className="stat">{tt("purStatSuppliers")} {Number(planData.summary.supplierCount || 0)}</div>
            <div className="stat">{tt("purStatPlanCost")} ৳{Number(planData.summary.totalEstimatedCost || 0).toFixed(2)}</div>
            <div className="stat">{tt("purStatBudgetLeft")} ৳{Number(planData.summary.remainingBudget || 0).toFixed(2)}</div>
          </div>
        ) : null}
        {planReviewRows.length ? (
          <div className="quick-stats" style={{ marginTop: 8 }}>
            <div className="stat">{tt("purStatReviewLines")} {Number(reviewSummary.lineCount || 0)}</div>
            <div className="stat">{tt("purStatReviewSuppliers")} {Number(reviewSummary.supplierCount || 0)}</div>
            <div className="stat">{tt("purStatReviewCost")} ৳{Number(reviewSummary.totalEstimatedCost || 0).toFixed(2)}</div>
          </div>
        ) : null}
      </div>
      ) : null}
      {purchasesTab === "planning" && planData?.supplierGroups?.length ? (
        <DataTable
          title={tt("purDtPlanBySupplier")}
          rows={(planData.supplierGroups || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["supplierName"]}
          columns={[
            { key: "rowNo", label: tt("colId") },
            { key: "supplierName", label: tt("purColSupplier") },
            { key: "lineCount", label: tt("purColLines") },
            { key: "estimatedCost", label: tt("purColEstimatedCost"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          ]}
        />
      ) : null}
      {purchasesTab === "planning" && planReviewRows?.length ? (
        <DataTable
          title={tt("purDtPlannerReview")}
          rows={(planReviewRows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["productName", "sku", "supplierName"]}
          columns={[
            { key: "rowNo", label: tt("colId") },
            { key: "productName", label: tt("invColProduct") },
            { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
            {
              key: "stock",
              label: tt("prodLblStock"),
              render: (_, row) => row.stockDisplay || formatProductStockDisplay(row, tt),
            },
            { key: "recommendedQty", label: tt("purColRecommended") },
            {
              key: "plannedQty",
              label: tt("purColPlannedQty"),
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
            { key: "supplierName", label: tt("purColSupplier") },
            {
              key: "unitCost",
              label: tt("purColUnitCost"),
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
            { key: "estimatedCost", label: tt("purColEstimatedCost"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "moq", label: tt("purColMoq") },
            {
              key: "include",
              label: tt("purColInclude"),
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
          title={tt("purDtPlanApprovalQueue")}
          rows={(planApprovals || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["status", "submittedBy", "note"]}
          columns={[
            { key: "rowNo", label: tt("colId") },
            { key: "status", label: tt("colStatus") },
            { key: "submittedBy", label: tt("purColRequestedBy"), render: (v) => v || "-" },
            { key: "lineCount", label: tt("purColLines") },
            { key: "totalEstimatedCost", label: tt("purColEstimatedCost"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "note", label: tt("purColNoteShort"), render: (v) => v || "-" },
            {
              key: "action",
              label: tt("colActions"),
              render: (_, row) =>
                row.status === "PENDING" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => approvePlanRequest(row.id)}
                      disabled={!canManagePurchases}
                    >
                      {tt("purBtnApproveCreate")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => rejectPlanRequest(row.id)}
                      disabled={!canManagePurchases}
                    >
                      {tt("invReject")}
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
        <h4 style={{ marginTop: 0 }}>{tt("purScorecardsTitle")}</h4>
        <div className="quick-stats">
          <div className="stat">{tt("purStatScoreSuppliers")} {Number(supplierScorecards.summary?.supplierCount || 0)}</div>
          <div className="stat">{tt("purStatAvgScore")} {Number(supplierScorecards.summary?.avgScore || 0).toFixed(2)}</div>
          <div className="stat">{tt("purStatHighRisk")} {Number(supplierScorecards.summary?.highRiskSuppliers || 0)}</div>
          <div className="stat">{tt("purStatTotalSpend")} ৳{Number(supplierScorecards.summary?.totalSpend || 0).toFixed(2)}</div>
        </div>
      </div>
      ) : null}
      {purchasesTab === "planning" && supplierScorecards?.rows?.length ? (
        <DataTable
          title={tt("purDtSupplierRisk")}
          rows={(supplierScorecards.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["supplierName", "riskBand"]}
          columns={[
            { key: "rowNo", label: tt("colId") },
            { key: "supplierName", label: tt("purColSupplier") },
            { key: "purchaseCount", label: tt("purColPurchaseCount") },
            { key: "totalSpend", label: tt("purColSpend"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "returnRatePct", label: tt("purColReturnPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
            { key: "priceVolatilityPct", label: tt("purColPriceVolatilityPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
            { key: "totalDue", label: tt("dashDue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "penaltyPoints", label: tt("purColPenaltyPts"), render: (v) => Number(v || 0).toFixed(2) },
            { key: "score", label: tt("purColScore"), render: (v) => Number(v || 0).toFixed(2) },
            {
              key: "riskBand",
              label: tt("purColRiskBand"),
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
          <h4>{tt("purDraftTitle", { n: draftItems.length })}</h4>
          {draftSupplierSummary.length ? (
            <div style={{ marginBottom: 8 }}>
              <strong>{tt("purSuggestedSupplier")}</strong>{" "}
              {draftSupplierSummary[0].supplierName}{" "}
              ({tt("purDraftCountOf", { a: draftSupplierSummary[0].count, b: draftItems.length })})
              <button
                type="button"
                className="btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => applySuggestedSupplier(draftSupplierSummary[0].supplierId)}
              >
                {tt("purUseThisSupplier")}
              </button>
              {draftSupplierSummary.length > 1 ? (
                <span style={{ marginLeft: 8, color: "var(--muted)" }}>
                  {tt("purMultipleSuppliers")}
                </span>
              ) : null}
            </div>
          ) : (
            <div style={{ marginBottom: 8, color: "var(--muted)" }}>
              {tt("purNoHistoryMatch")}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {draftSuggestions.map((x) => (
              <div key={`draft-${purchaseLineKey(x)}`} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>
                  {x.productName || tt("purProductNum", { n: x.productId })}
                  {x.batchCode ? ` · ${tt("purBatchLabel")} ${x.batchCode}` : ""}
                  {x.expiryDate ? ` · ${tt("purExpiryLabel")} ${x.expiryDate}` : ""}
                  {" · "}
                  {tt("purDraftQtyLabel")}{" "}
                  {Number(x.qty || 0)} · {tt("purDraftCostLabel")} ৳
                  {Number(x.cost || 0).toFixed(2)}
                  {" · "}
                  {tt("prodLblVat")}{" "}
                  {Number(
                    x.vatRate != null ? x.vatRate : productVatById.get(Number(x.productId)) || 0
                  ).toFixed(2)}
                  % (
                  {String(x.vatType || "EXCLUSIVE").toUpperCase() === "INCLUSIVE"
                    ? tt("purVatInclusiveShort")
                    : tt("purVatExclusiveShort")}
                  )
                  {x.suggestion ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      ·{" "}
                      {tt("purSuggestedLine", {
                        name: x.suggestion.supplierName || tt("purSupplierNum", { n: x.suggestion.supplierId }),
                        cost: Number(x.suggestion.lastCost || 0).toFixed(2),
                      })}
                      {Number(x.suggestion.moq || 0) > 1
                        ? ` · ${tt("purSuggestedMoq", { n: Number(x.suggestion.moq) })}`
                        : ""}
                    </span>
                  ) : null}
                  {x.optimization ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · {tt("purReorderQtyLabel")} {Number(x.optimization.recommendedQty || 0)}
                    </span>
                  ) : null}
                  {x.suggestion?.moq && Number(x.qty || 0) < Number(x.suggestion.moq) ? (
                    <span style={{ color: "#b91c1c" }}>
                      {" "}
                      · {tt("purMoqWarning", { n: Number(x.suggestion.moq) })}
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
                      {tt("purUseBestSupplier")}
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => removeDraftItem(purchaseLineKey(x))}>
                    {tt("purRemove")}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={clearDraftItems} style={{ marginTop: 8 }}>
            {tt("purClearDraft")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={createSplitPurchasesBySuggestedSupplier}
            disabled={!canManagePurchases}
            style={{ marginTop: 8, marginLeft: 8 }}
          >
            {tt("purAutoSplitBills")}
          </button>
        </div>
      ) : null}
      {purchasesTab === "create" ? (
      <form onSubmit={submit} className="form-grid">
        <SearchSelect
          kind="suppliers"
          value={form.supplierId}
          onChange={(val) => setForm({ ...form, supplierId: val })}
          placeholder={tt("purPhSelectSupplier")}
        />
        <input
          placeholder={tt("purPhInvoiceNo")}
          value={form.invoiceNo}
          onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
        />
        <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{tt("purLblFinancing")}</span>
          <SearchSelect
            value={form.financingSource}
            onChange={(val) =>
              setForm({
                ...form,
                financingSource: val || "SUPPLIER_CREDIT",
                ...(val !== "BANK_LOAN" ? { loanReference: "", loanNote: "", loanMaturityDate: "" } : {}),
              })
            }
            options={[
              { value: "SUPPLIER_CREDIT", label: tt("purFinSupplierCredit") },
              { value: "BANK_LOAN", label: tt("purFinBankLoan") },
            ]}
            isClearable={false}
          />
        </label>
        {form.financingSource === "BANK_LOAN" ? (
          <>
            <input
              placeholder={tt("purPhLoanRef")}
              value={form.loanReference}
              onChange={(e) => setForm({ ...form, loanReference: e.target.value })}
            />
            <input
              type="date"
              title={tt("purTitleLoanMaturity")}
              value={form.loanMaturityDate}
              onChange={(e) => setForm({ ...form, loanMaturityDate: e.target.value })}
            />
            <input
              placeholder={tt("purPhNoteOptional")}
              value={form.loanNote}
              onChange={(e) => setForm({ ...form, loanNote: e.target.value })}
              style={{ gridColumn: "1 / -1" }}
            />
          </>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            {form.financingSource === "BANK_LOAN" ? tt("purLblPaidBank") : tt("purLblPaidSupplier")}
          </span>
          <input
            placeholder={form.financingSource === "BANK_LOAN" ? tt("purPhPaidFullLoan") : tt("purPhPaidFullCredit")}
            value={form.paidAmount}
            onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
          />
        </label>
        <input
          placeholder={tt("purPhTransportationCost")}
          type="number"
          min={0}
          step="0.01"
          value={form.transportationCost}
          onChange={(e) => setForm({ ...form, transportationCost: e.target.value })}
        />
        <input
          placeholder={tt("purPhBribesCost")}
          type="number"
          min={0}
          step="0.01"
          value={form.bribesCost}
          onChange={(e) => setForm({ ...form, bribesCost: e.target.value })}
        />
        <input
          placeholder={tt("purPhExtraOtherCost")}
          type="number"
          min={0}
          step="0.01"
          value={form.extraOtherCost}
          onChange={(e) => setForm({ ...form, extraOtherCost: e.target.value })}
        />
        <SearchSelect
          kind="products"
          value={form.productId}
          onChange={(val) => {
            const productId = Number(val || 0);
            const recommendation = optimizationRows.find((x) => Number(x.productId) === productId);
            setForm((prev) => ({
              ...prev,
              productId: val || "",
              supplierId:
                recommendation?.bestSupplier?.supplierId && !prev.supplierId
                  ? String(recommendation.bestSupplier.supplierId)
                  : prev.supplierId,
              qty:
                recommendation?.recommendedQty && Number(recommendation.recommendedQty) > 0
                  ? String(recommendation.recommendedQty)
                  : prev.qty,
              cost:
                recommendation?.bestSupplier?.avgCost && Number(recommendation.bestSupplier.avgCost) > 0
                  ? String(recommendation.bestSupplier.avgCost)
                  : prev.cost,
              vatRate: productId ? String(productVatById.get(productId) || 0) : "",
              vatType: "EXCLUSIVE",
            }));
          }}
          onOptionChange={(opt) => {
            const productId = Number(opt?.value || 0);
            if (!productId || productVatById.has(productId)) return;
            const vatFromRaw = Number(opt?.raw?.vatRate || 0);
            if (Number.isFinite(vatFromRaw)) {
              setForm((prev) =>
                String(prev.productId) === String(productId)
                  ? { ...prev, vatRate: String(vatFromRaw) }
                  : prev
              );
            }
          }}
          placeholder={tt("purPhSelectProduct")}
        />
        <input
          placeholder={tt("purPhQuantity")}
          value={form.qty}
          onChange={(e) => setForm({ ...form, qty: e.target.value })}
        />
        {purchaseNeedsVariant ? (
          <SearchSelect
            value={form.productVariantId}
            onChange={(val) => setForm({ ...form, productVariantId: val || "" })}
            placeholder={tt("posPickVariant")}
            options={(selectedPurchaseProduct.variants || []).map((v) => ({
              value: String(v.id),
              label: v.label || v.sku || `#${v.id}`,
            }))}
          />
        ) : null}
        {purchaseNeedsBatch ? (
          <>
            <input
              placeholder={tt("purPhBatchCode")}
              value={form.batchCode}
              onChange={(e) => setForm({ ...form, batchCode: e.target.value })}
            />
            <input
              type="date"
              placeholder={tt("purPhExpiry")}
              value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            />
          </>
        ) : null}
        <input
          placeholder={tt("purPhUnitCostShort")}
          value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })}
        />
        <input
          placeholder={tt("purPhVatPct")}
          type="number"
          min={0}
          step={0.01}
          value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
        />
        <SearchSelect
          value={form.vatType}
          onChange={(val) => setForm({ ...form, vatType: val || "EXCLUSIVE" })}
          isClearable={false}
          options={[
            { value: "EXCLUSIVE", label: tt("purVatExclusiveOpt") },
            { value: "INCLUSIVE", label: tt("purVatInclusiveOpt") },
          ]}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(form.deferStockPosting)}
            onChange={(e) => setForm({ ...form, deferStockPosting: e.target.checked })}
          />
          {tt("purDeferStockGrn")}
        </label>
        <SubmitButton loading={submittingPurchase} loadingLabel={tt("purCreatingPurchase")} disabled={!canManagePurchases}>
          {tt("purBtnCreatePurchase")}
        </SubmitButton>
      </form>
      ) : null}
      {purchasesTab === "create" && form.productId ? (
        <div className="page-card" style={{ marginTop: 8 }}>
          {(() => {
            const rec = optimizationRows.find((x) => Number(x.productId) === Number(form.productId));
            if (!rec) return <p className="pos-inline-note">{tt("purNoOptProduct")}</p>;
            return (
              <>
                <p>
                  <strong>{tt("purLblVelocity")}</strong>{" "}
                  {tt("purVelocityLine", {
                    sold: Number(rec.soldQty || 0),
                    avg: Number(rec.avgDailySold || 0).toFixed(2),
                  })}
                </p>
                <p>
                  <strong>{tt("purLblSuggestedReorder")}</strong> {Number(rec.recommendedQty || 0)}
                </p>
                {rec.bestSupplier ? (
                  <p>
                    <strong>{tt("purLblBestSupplier")}</strong>{" "}
                    {tt("purBestSupplierDetail", {
                      name: rec.bestSupplier.supplierName,
                      cost: Number(rec.bestSupplier.avgCost || 0).toFixed(2),
                      moq: Number(rec.bestSupplier.moq || 1),
                    })}
                    {Number(form.qty || 0) > 0 && Number(form.qty || 0) < Number(rec.bestSupplier.moq || 1) ? (
                      <span style={{ color: "#b91c1c" }}> {tt("purQtyBelowMoq")}</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="pos-inline-note">{tt("purNoSupplierHistory")}</p>
                )}
              </>
            );
          })()}
        </div>
      ) : null}

      {purchasesTab === "history" ? <h4 style={{ marginTop: 8 }}>{tt("purReturnSectionTitle")}</h4> : null}
      {purchasesTab === "history" ? (
      <form onSubmit={submitReturn} className="form-grid">
        <SearchSelect
          kind="purchases"
          value={returnForm.purchaseId}
          onChange={(val) =>
            setReturnForm({
              ...returnForm,
              purchaseId: val || "",
              productId: "",
              qty: "",
              cost: "",
            })
          }
          placeholder={tt("purPhSelectPurchase")}
        />
        <SearchSelect
          value={returnForm.productId}
          onChange={(val) => setReturnForm({ ...returnForm, productId: val || "" })}
          placeholder={tt("purPhSelectProduct")}
          options={returnProductOptions}
        />
        <input
          placeholder={tt("purPhReturnQty")}
          value={returnForm.qty}
          onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })}
        />
        <input
          placeholder={tt("purPhReturnUnitCost")}
          value={returnForm.cost}
          onChange={(e) => setReturnForm({ ...returnForm, cost: e.target.value })}
        />
        <input
          placeholder={tt("purPhReason")}
          value={returnForm.reason}
          onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
        />
        <SubmitButton loading={submittingReturn} loadingLabel={tt("purPostingReturn")} disabled={!canCreatePurchaseReturn}>
          {tt("purBtnCreateReturn")}
        </SubmitButton>
      </form>
      ) : null}
      {purchasesTab === "history" ? (
      <div className="quick-stats">
        <div className="stat">{tt("purStatBills")} {purchases.length}</div>
        <div className="stat">{tt("purStatPurchaseTotal")} ৳{purchases.reduce((s, p) => s + Number(p.total), 0).toFixed(2)}</div>
        <div className="stat">{tt("purStatPurchasePaid")} ৳{purchases.reduce((s, p) => s + Number(p.paidAmount), 0).toFixed(2)}</div>
        <div className="stat">{tt("purStatPurchaseDue")} ৳{purchases.reduce((s, p) => s + Number(p.dueAmount), 0).toFixed(2)}</div>
      </div>
      ) : null}
      {purchasesTab === "history" ? (
        <div className="page-card" style={{ marginBottom: 10 }}>
          <h4 style={{ marginTop: 0 }}>{tt("purPaymentScheduleTitle")}</h4>
          <div className="quick-stats" style={{ marginBottom: 8 }}>
            <div className="stat">{tt("purScheduleOpenLines")} {Number(paymentSchedule.summary?.openLineCount || 0)}</div>
            <div className="stat">{tt("purScheduleOutstanding")} ৳{Number(paymentSchedule.summary?.outstandingTotal || 0).toFixed(2)}</div>
            <div className="stat">{tt("purScheduleOverdue")} {Number(paymentSchedule.summary?.overdueCount || 0)}</div>
            <div className="stat">{tt("purScheduleRemindersDue")} {Number(paymentSchedule.summary?.remindersDue || 0)}</div>
            <div className="stat">{tt("purAgingCurrent")} ৳{Number(paymentSchedule.summary?.aging?.current || 0).toFixed(2)}</div>
            <div className="stat">{tt("purAging1to30")} ৳{Number(paymentSchedule.summary?.aging?.d1_30 || 0).toFixed(2)}</div>
            <div className="stat">{tt("purAging31to60")} ৳{Number(paymentSchedule.summary?.aging?.d31_60 || 0).toFixed(2)}</div>
            <div className="stat">{tt("purAging61to90")} ৳{Number(paymentSchedule.summary?.aging?.d61_90 || 0).toFixed(2)}</div>
            <div className="stat">{tt("purAging90Plus")} ৳{Number(paymentSchedule.summary?.aging?.d90_plus || 0).toFixed(2)}</div>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={runScheduleAutomation} disabled={!canManagePurchases}>
            {tt("purBtnRunScheduleAutomation")}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => exportPaymentSchedule("csv")} disabled={!canExportReports} style={{ marginLeft: 6 }}>
            {tt("purBtnExportScheduleCsv")}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => exportPaymentSchedule("pdf")} disabled={!canExportReports} style={{ marginLeft: 6 }}>
            {tt("purBtnExportSchedulePdf")}
          </button>
        </div>
      ) : null}
      {purchasesTab === "history" ? (
        <DataTable
          title={tt("purDtPaymentSchedule")}
          rows={(paymentSchedule.rows || []).map((row, idx) => ({
            rowNo: idx + 1,
            ...row,
            dueDateLabel: row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "-",
          }))}
          searchableKeys={["supplierName", "entryKey", "status", "financingSource"]}
          columns={[
            { key: "rowNo", label: tt("colId") },
            { key: "purchaseId", label: tt("purColPurchaseId") },
            { key: "supplierName", label: tt("purColSupplier") },
            { key: "entryKey", label: tt("purColScheduleKey") },
            { key: "dueDateLabel", label: tt("purColScheduleDueDate") },
            { key: "amount", label: tt("receiptAmount"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "paidAmount", label: tt("dashPaid"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "outstanding", label: tt("dashDue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            { key: "daysPastDue", label: tt("purColDaysPastDue"), render: (v) => Number(v || 0) },
            { key: "reminderCount", label: tt("purColReminderCount"), render: (v) => Number(v || 0) },
            { key: "status", label: tt("colStatus") },
            {
              key: "actions",
              label: tt("colActions"),
              render: (_, row) =>
                Number(row.outstanding || 0) > 0 ? (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => payScheduleEntry(row)} disabled={!canManagePurchases}>
                    {tt("purBtnPaySchedule")}
                  </button>
                ) : (
                  "-"
                ),
            },
          ]}
        />
      ) : null}
      {purchasesTab === "history" ? (
      <DataTable
        title={tt("purDtPurchaseHistory")}
        serverMode
        totalRows={purchasesHistory.total}
        loading={purchasesHistory.loading}
        onQueryChange={purchasesHistory.onQueryChange}
        initialSort="createdAt"
        initialSortDir="desc"
        pageSize={10}
        rows={purchasesHistory.rows.map((p) => ({
          ...p,
          supplierName: p.supplier?.name || "-",
          createdAtLabel: new Date(p.createdAt).toLocaleString(),
          taxableAmount: Number(p.vatBreakdown?.taxableAmount || Math.max(0, Number(p.total || 0))).toFixed(2),
          inputVat: Number(p.vatBreakdown?.inputVat || 0).toFixed(2),
          grossAmount: Number(p.vatBreakdown?.grossAmount || p.total || 0).toFixed(2),
          receiveStatus: p.receiving?.status || "PENDING",
          remainingQty: Number(p.receiving?.remainingQtyTotal || 0),
          vendorBillStatus: String(p.vendorBill?.status || "DRAFT"),
          financeLabel: String(p.financingSource || "SUPPLIER_CREDIT").toUpperCase() === "BANK_LOAN" ? tt("purFinanceLoan") : tt("purFinanceCredit"),
        }))}
        columns={[
          { key: "id", label: tt("colId"), searchable: false },
          { key: "createdAtLabel", label: tt("receiptDate"), searchable: false },
          { key: "supplierName", label: tt("purColSupplier") },
          { key: "invoiceNo", label: tt("receiptInvoice"), render: (v) => v || "-" },
          { key: "financeLabel", label: tt("purColFinance"), searchable: false, render: (v) => v || "-" },
          { key: "total", label: tt("receiptTotal"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "transportationCost", label: tt("purColTransportationCost"), searchable: false, render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "bribesCost", label: tt("purColBribesCost"), searchable: false, render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "extraOtherCost", label: tt("purColExtraOtherCost"), searchable: false, render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "taxableAmount", label: tt("purColTaxable"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "inputVat", label: tt("purColInputVat"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "grossAmount", label: tt("purColGross"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "receiveStatus", label: tt("purColReceiveStatus"), searchable: false, render: (v) => v || "-" },
          { key: "vendorBillStatus", label: tt("purColVendorBillStatus"), searchable: false, render: (v) => v || "DRAFT" },
          { key: "remainingQty", label: tt("purColPendingQty"), searchable: false, render: (v) => Number(v || 0) },
          { key: "paidAmount", label: tt("dashPaid"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "dueAmount", label: tt("dashDue"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => openPurchaseDetails(row)}>
                  {tt("purBtnDetails")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => openVendorBillModal(row)}>
                  {tt("purBtnVendorBill")}
                </button>
              </div>
            ),
          },
        ]}
      />
      ) : null}
      {purchasesTab === "history" ? (
      <DataTable
        title={tt("purDtReturnHistory")}
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
            label: tt("purColSupplier"),
            options: [...new Set(purchaseReturns.map((r) => r.purchase?.supplier?.name).filter(Boolean))].map((x) => ({
              label: x,
              value: x,
            })),
          },
        ]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "purchaseId", label: tt("purColPurchaseId") },
          { key: "invoiceNo", label: tt("receiptInvoice") },
          { key: "supplierName", label: tt("purColSupplier") },
          { key: "amount", label: tt("receiptAmount"), render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "reason", label: tt("invColReason"), render: (v) => v || "-" },
          { key: "createdAtLabel", label: tt("receiptDate") },
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
          {tt("purBtnToday")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("last7")}>
          {tt("purBtnLast7Days")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("month")}>
          {tt("purBtnThisMonth")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setReturnPresetRange("clear")}>
          {tt("purBtnClearRange")}
        </button>
        <button type="button" onClick={() => exportReturns("csv")} disabled={!canExportReports}>{tt("purBtnExportReturnsCsv")}</button>
        <button type="button" className="btn-secondary" onClick={() => exportReturns("pdf")} disabled={!canExportReports}>{tt("purBtnExportReturnsPdf")}</button>
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
              <h3>{tt("purModalVatTitle")}</h3>
              <button type="button" className="btn-secondary btn-sm" onClick={closePurchaseDetails}>
                {tt("ksClose")}
              </button>
            </div>
            {purchaseDetailsModal.loading ? (
              <p className="text-muted">{tt("purModalLoading")}</p>
            ) : purchaseDetailsModal.data?.error ? (
              <p style={{ color: "#b91c1c" }}>{purchaseDetailsModal.data.error}</p>
            ) : (
              <>
                <div className="quick-stats" style={{ marginBottom: 8 }}>
                  <div className="stat">{tt("purMdlPurchaseId")} {purchaseDetailsModal.data?.id}</div>
                  <div className="stat">{tt("purMdlInvoice")} {purchaseDetailsModal.data?.invoiceNo || "-"}</div>
                  <div className="stat">{tt("purMdlSupplier")} {purchaseDetailsModal.data?.supplier?.name || "-"}</div>
                  <div className="stat">
                    {tt("purMdlFinance")}{" "}
                    {String(purchaseDetailsModal.data?.financingSource || "SUPPLIER_CREDIT").toUpperCase() === "BANK_LOAN"
                      ? tt("purMdlBankLoan")
                      : tt("purMdlSupplierCredit")}
                  </div>
                  {String(purchaseDetailsModal.data?.financingSource || "").toUpperCase() === "BANK_LOAN" &&
                  (purchaseDetailsModal.data?.loanReference || purchaseDetailsModal.data?.loanMaturityDate || purchaseDetailsModal.data?.loanNote) ? (
                    <>
                      {purchaseDetailsModal.data?.loanReference ? (
                        <div className="stat">{tt("purMdlLoanRef")} {purchaseDetailsModal.data.loanReference}</div>
                      ) : null}
                      {purchaseDetailsModal.data?.loanMaturityDate ? (
                        <div className="stat">
                          {tt("purMdlMaturity")} {new Date(purchaseDetailsModal.data.loanMaturityDate).toLocaleDateString()}
                        </div>
                      ) : null}
                      {purchaseDetailsModal.data?.loanNote ? (
                        <div className="stat" style={{ gridColumn: "1 / -1" }}>
                          {tt("purMdlNote")} {purchaseDetailsModal.data.loanNote}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="stat">{tt("purColTaxable")}: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.taxableAmount || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purColInputVat")}: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.inputVat || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purColGross")}: ৳{Number(purchaseDetailsModal.data?.vatBreakdown?.grossAmount || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purMdlReceive")} {purchaseDetailsModal.data?.receiving?.status || "-"}</div>
                  <div className="stat">{tt("purMdlPendingQty")} {Number(purchaseDetailsModal.data?.receiving?.remainingQtyTotal || 0)}</div>
                  <div className="stat">{tt("purMdlTransportationCost")} ৳{Number(purchaseDetailsModal.data?.transportationCost || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purMdlBribesCost")} ৳{Number(purchaseDetailsModal.data?.bribesCost || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purMdlExtraOtherCost")} ৳{Number(purchaseDetailsModal.data?.extraOtherCost || 0).toFixed(2)}</div>
                  <div className="stat">{tt("purMdlLandedTotal")} ৳{Number(purchaseDetailsModal.data?.landedCostAllocation?.landedTotal || purchaseDetailsModal.data?.total || 0).toFixed(2)}</div>
                </div>
                <DataTable
                  title={tt("purDtVatTrace")}
                  rows={(purchaseDetailsModal.data?.vatLines || []).map((line, idx) => ({
                    rowNo: idx + 1,
                    ...line,
                  }))}
                  searchableKeys={["productName", "vatType"]}
                  pageSize={5}
                  columns={[
                    { key: "rowNo", label: tt("purColSl") },
                    { key: "productName", label: tt("invColProduct") },
                    { key: "qty", label: tt("receiptQty") },
                    { key: "cost", label: tt("purPhUnitCostShort"), render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "vatRate", label: tt("prodLblVat") },
                    { key: "vatType", label: tt("purColVatType") },
                    { key: "taxableAmount", label: tt("purColTaxable"), render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "vatAmount", label: tt("receiptVat"), render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "grossAmount", label: tt("purColGross"), render: (v) => `৳${Number(v).toFixed(2)}` },
                    { key: "allocatedExtraCost", label: tt("purColAllocatedExtra"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
                    { key: "landedUnitCost", label: tt("purColLandedUnitCost"), render: (v) => `৳${Number(v || 0).toFixed(4)}` },
                    { key: "landedLineTotal", label: tt("purColLandedLineTotal"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
                  ]}
                />
                <DataTable
                  title={tt("purDtGrnProgress")}
                  rows={(purchaseDetailsModal.data?.receiving?.rows || []).map((line, idx) => ({
                    rowNo: idx + 1,
                    ...line,
                    productName:
                      (purchaseDetailsModal.data?.vatLines || []).find((x) => Number(x.productId) === Number(line.productId))?.productName ||
                      tt("purProductNum", { n: line.productId }),
                  }))}
                  searchableKeys={["productName"]}
                  pageSize={5}
                  columns={[
                    { key: "rowNo", label: tt("purColSl") },
                    { key: "productName", label: tt("invColProduct") },
                    { key: "orderedQty", label: tt("purColOrdered") },
                    { key: "receivedQty", label: tt("purColReceived") },
                    { key: "remainingQty", label: tt("purColRemaining") },
                    {
                      key: "receiveNow",
                      label: tt("purColReceiveNow"),
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
                    {tt("purBtnReceiveAllRemaining")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={submitGrnReceive} disabled={!canManagePurchases}>
                    {tt("purBtnPostGrn")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => exportPurchaseGrnHistory("csv")}
                    disabled={!canExportReports}
                    style={{ marginLeft: 6 }}
                  >
                    {tt("purBtnExportGrnCsv")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => exportPurchaseGrnHistory("pdf")}
                    disabled={!canExportReports}
                    style={{ marginLeft: 6 }}
                  >
                    {tt("purBtnExportGrnPdf")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {vendorBillModal.open ? (
        <div className="shortcuts-overlay" onClick={closeVendorBillModal}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="shortcuts-modal-head">
              <h3>{tt("purVendorBillTitle")}</h3>
              <button type="button" className="btn-secondary btn-sm" onClick={closeVendorBillModal}>
                {tt("ksClose")}
              </button>
            </div>
            <div className="quick-stats" style={{ marginBottom: 8 }}>
              <div className="stat">{tt("purMdlPurchaseId")} {vendorBillModal.purchaseId}</div>
              <div className="stat">{tt("purMdlSupplier")} {vendorBillModal.supplierName}</div>
              <div className="stat">{tt("receiptTotal")} ৳{Number(vendorBillModal.total || 0).toFixed(2)}</div>
              <div className="stat">{tt("purColVendorBillStatus")} {vendorBillModal.status || "DRAFT"}</div>
            </div>
            <div className="form-grid" style={{ marginBottom: 10 }}>
              <input
                placeholder={tt("purPhBillNo")}
                value={vendorBillModal.billNo}
                onChange={(e) => setVendorBillModal((prev) => ({ ...prev, billNo: e.target.value }))}
              />
              <input
                type="date"
                value={vendorBillModal.dueDate}
                onChange={(e) => setVendorBillModal((prev) => ({ ...prev, dueDate: e.target.value }))}
              />
              <input
                placeholder={tt("purPhNoteOptional")}
                value={vendorBillModal.note}
                onChange={(e) => setVendorBillModal((prev) => ({ ...prev, note: e.target.value }))}
                style={{ gridColumn: "1 / -1" }}
              />
            </div>
            <div className="page-card" style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{tt("purVendorBillAttachments")}</div>
              {(vendorBillModal.attachments || []).map((att, idx) => (
                <div key={`vb-att-${idx}`} className="form-grid" style={{ marginBottom: 6 }}>
                  <input
                    placeholder={tt("purPhAttachmentName")}
                    value={att.name || ""}
                    onChange={(e) => updateVendorBillAttachment(idx, { name: e.target.value })}
                  />
                  <input
                    placeholder={tt("purPhAttachmentUrl")}
                    value={att.url || ""}
                    onChange={(e) => updateVendorBillAttachment(idx, { url: e.target.value })}
                  />
                  <input
                    placeholder={tt("purPhAttachmentType")}
                    value={att.mimeType || ""}
                    onChange={(e) => updateVendorBillAttachment(idx, { mimeType: e.target.value })}
                  />
                  <input
                    placeholder={tt("purPhNoteOptional")}
                    value={att.note || ""}
                    onChange={(e) => updateVendorBillAttachment(idx, { note: e.target.value })}
                  />
                  <button type="button" className="btn-danger btn-sm" onClick={() => removeVendorBillAttachment(idx)}>
                    {tt("purRemove")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openAttachment(att.url)}>
                    {tt("purBtnOpenAttachment")}
                  </button>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-sm" onClick={addVendorBillAttachment}>
                {tt("purBtnAddAttachment")}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={saveVendorBillRecord}
                disabled={vendorBillModal.loading}
              >
                {tt("purBtnSaveVendorBill")}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={submitVendorBillForApproval}
                disabled={vendorBillModal.loading}
              >
                {tt("purBtnSubmitVendorBillApproval")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Purchases;
