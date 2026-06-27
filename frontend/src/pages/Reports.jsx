import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import {
  downloadMushak63XmlWithCompletenessHint,
  resolveSaleIdForMushak63Lookup,
  runMushak63CompletenessCheck,
} from "../services/nbrMushak63";
import DataTable from "../components/DataTable";
import { notifyError, notifySuccess } from "../utils/notify";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { formatBDT, formatBdNumber, toBanglaDigits } from "../utils/currency";
import { getLang, t } from "../i18n";
import { SALE_UNIT_LABEL_KEYS } from "../constants/saleUnits";
import { GROCERY_CATEGORY_CHIPS, RETAIL_DEPARTMENTS } from "../constants/retailDepartments";
import { mergeIntoLabelQueue, navigateToLabelQueue } from "../utils/labelPrintQueue";
import SearchSelect from "../components/SearchSelect";

function mapWithholdingVoucherRow(r, bdtFn) {
  const net =
    r.netPaid != null
      ? Number(r.netPaid)
      : Number(r.amount || 0) - Number(r.aitAmount || 0) - Number(r.vdsAmount || 0);
  return {
    voucherId: r.id,
    dateLabel: new Date(r.createdAt).toISOString().slice(0, 10),
    supplierName: r.supplier?.name || "—",
    tin: r.supplier?.tinNumber || "—",
    bin: r.supplier?.binNumber || "—",
    taxCategory: r.taxCategory || r.supplier?.taxCategory || "—",
    method: r.method || "—",
    grossLabel: bdtFn(r.amount),
    aitRateLabel: `${Number(r.aitRate || 0).toFixed(2)}%`,
    aitLabel: bdtFn(r.aitAmount),
    vdsRateLabel: `${Number(r.vdsRate || 0).toFixed(2)}%`,
    vdsLabel: bdtFn(r.vdsAmount),
    netLabel: bdtFn(net),
    mushak66: r.mushak66DocumentNo || "—",
    mushak66Eligible: Number(r.aitAmount || 0) > 0 || Number(r.vdsAmount || 0) > 0,
    note: r.withholdingNote || r.note || "—",
  };
}

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getRiskBand = (score) => {
  const value = Number(score || 0);
  if (value >= 10) return { labelKey: "repRiskCritical", color: "#b42318", bg: "#fee4e2" };
  if (value >= 7) return { labelKey: "repRiskHigh", color: "#b54708", bg: "#ffead5" };
  if (value >= 4) return { labelKey: "repRiskMedium", color: "#1d4ed8", bg: "#dbeafe" };
  return { labelKey: "repRiskLow", color: "#166534", bg: "#dcfce7" };
};

function Reports() {
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
  useEffect(() => {
    try {
      const tab = sessionStorage.getItem("bd_pos_reports_tab");
      if (tab) setReportsTab(tab);
      if (sessionStorage.getItem("bd_pos_margin_erosion_only") === "1") {
        setMarginErosionFilterOnly(true);
      }
      sessionStorage.removeItem("bd_pos_reports_tab");
      sessionStorage.removeItem("bd_pos_margin_erosion_only");
    } catch {
      /* ignore */
    }
  }, []);
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);
  const bdt = (v) => formatBDT(v, { lang: uiLang, decimals: 2 });
  const bdt0 = (v) => formatBDT(v, { lang: uiLang, decimals: 0 });

  const permissions = getStoredPermissions();
  const canExportAdvanced = hasPermission("accounting.report", permissions);
  const canHqBranchCompare =
    hasPermission("branch.manage", permissions) || hasPermission("rbac.manage", permissions);
  const [aging, setAging] = useState({ customers: [], suppliers: [] });
  const [stockValuation, setStockValuation] = useState({ totalValue: 0, rows: [] });
  const [stockValuationFilter, setStockValuationFilter] = useState({
    asOf: "",
    category: "",
    warehouseId: "",
  });
  const [warehouses, setWarehouses] = useState([]);
  const [settlementRange, setSettlementRange] = useState({ from: "", to: "" });
  const marginReportQuerySuffix = useMemo(() => {
    const q = new URLSearchParams();
    if (settlementRange.from) q.set("from", settlementRange.from);
    if (settlementRange.to) q.set("to", settlementRange.to);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [settlementRange.from, settlementRange.to]);
  const [settlement, setSettlement] = useState({
    from: null,
    to: null,
    billCount: 0,
    totalPaid: 0,
    totalDue: 0,
    digitalCollectionTotal: 0,
    digitalMissingRefCount: 0,
    walletFlow: { cashIn: 0, cashOut: 0, net: 0 },
    methods: [],
    channels: [],
    digitalRefs: [],
    days: [],
  });
  const [loyaltyRedemptions, setLoyaltyRedemptions] = useState({
    rows: [],
    summary: { redeemedPoints: 0, redeemedAmount: 0, tierDiscountAmount: 0, count: 0 },
  });
  const [vatSummary, setVatSummary] = useState({
    from: null,
    to: null,
    salesCount: 0,
    zeroVatSales: 0,
    taxableSales: 0,
    outputVat: 0,
    grossSales: 0,
    inputVatTracked: 0,
    netVatPayable: 0,
    note: "",
  });
  const [vatSalesRegister, setVatSalesRegister] = useState([]);
  const [shrinkageControl, setShrinkageControl] = useState({
    totals: { totalCashiers: 0, totalSales: 0, totalDiscount: 0, totalReturns: 0, totalOverrides: 0 },
    summaryRows: [],
    eventRows: [],
  });
  const [shrinkageThresholds, setShrinkageThresholds] = useState({
    discountAlertMin: 200,
    returnAlertMin: 200,
    criticalAmount: 1000,
  });
  const [staffKpi, setStaffKpi] = useState({
    summary: { staffCount: 0, totalSales: 0, totalInvoices: 0 },
    rows: [],
  });
  const [auditActivity, setAuditActivity] = useState({
    count: 0,
    rows: [],
  });
  const [chequeLedger, setChequeLedger] = useState({
    summary: { journalCount: 0, mismatchedJournalCount: 0, totalDebit: 0, totalCredit: 0 },
    rows: [],
  });
  const [chequeLedgerFilter, setChequeLedgerFilter] = useState({
    direction: "",
    status: "",
    onlyMismatched: false,
  });
  const [reportsTab, setReportsTab] = useState("overview");
  const [marginErosionFilterOnly, setMarginErosionFilterOnly] = useState(false);
  const [marginThresholdPct, setMarginThresholdPct] = useState(5);
  const [categoryMarginErosion, setCategoryMarginErosion] = useState({
    summary: {
      categoryCount: 0,
      soldCategoryCount: 0,
      belowTargetCount: 0,
      costErosionCount: 0,
      alertCount: 0,
      worstGapPct: 0,
    },
    rows: [],
  });
  const [advancedMargin, setAdvancedMargin] = useState({
    summary: { skuCount: 0, soldSkuCount: 0, erosionAlertCount: 0, totalRevenue: 0, totalLandedCogs: 0, totalGrossProfit: 0 },
    categoryRows: [],
    rows: [],
  });
  const [advancedMarginTrend, setAdvancedMarginTrend] = useState({ months: 12, rows: [] });
  const [categorySales, setCategorySales] = useState({
    rows: [],
    summary: { categoryCount: 0, totalRevenue: 0, totalCogs: 0, totalGrossProfit: 0 },
  });
  const [departmentSales, setDepartmentSales] = useState({
    rows: [],
    summary: { departmentCount: 0, totalRevenue: 0, totalCogs: 0, totalGrossProfit: 0 },
  });
  const [promotionRoi, setPromotionRoi] = useState({
    rows: [],
    summary: { saleCount: 0, salesWithPromo: 0, ruleCount: 0, totalDiscount: 0, unattributedPromoTotal: 0 },
  });
  const [hourlyCategoryFilter, setHourlyCategoryFilter] = useState("ALL");
  const [slowMoverDays, setSlowMoverDays] = useState(60);
  const [slowMoverCategory, setSlowMoverCategory] = useState("ALL");
  const [shrinkageByCategory, setShrinkageByCategory] = useState({
    rows: [],
    summary: { categoryCount: 0, adjustmentCount: 0, unitsWrittenOff: 0, estimatedCost: 0 },
  });
  const [hqBranchCompare, setHqBranchCompare] = useState({ from: "", to: "", branches: [] });
  const [loyaltyByCategory, setLoyaltyByCategory] = useState({
    rows: [],
    summary: { categoryCount: 0, totalRevenue: 0, totalPoints: 0, bonusPoints: 0 },
    aisleBonusActive: false,
  });
  const [slowMovers, setSlowMovers] = useState({
    rows: [],
    summary: { slowMoverCount: 0, stockValueAtRisk: 0 },
  });
  const [basketAnalysis, setBasketAnalysis] = useState({
    mode: "product",
    rows: [],
    summary: { saleCount: 0, multiItemSaleCount: 0, pairCount: 0 },
  });
  const [basketMode, setBasketMode] = useState("product");
  const [basketMinCount, setBasketMinCount] = useState(3);
  const [hourlyCategorySales, setHourlyCategorySales] = useState({
    rows: [],
    hourTotals: [],
    categories: [],
    summary: { peakHour: 0, peakHourLabel: "00:00", peakHourRevenue: 0, totalRevenue: 0 },
  });
  const [taxRisk, setTaxRisk] = useState({
    summary: {
      vatSalesCount: 0,
      vatZeroSalesCount: 0,
      withholdingVoucherCount: 0,
      withholdingHighRiskCount: 0,
      salesHighRiskCount: 0,
      totalOutputVat: 0,
      totalTaxableSales: 0,
    },
    withholdingRows: [],
    salesRows: [],
  });
  const [taxRiskMinScore, setTaxRiskMinScore] = useState(0);
  const [taxPrevalidation, setTaxPrevalidation] = useState({
    summary: { salesRows: 0, paymentVouchers: 0, warningCount: 0 },
    warnings: [],
    readyForExport: false,
  });
  const [efdPending, setEfdPending] = useState([]);
  const [efdPendingLoading, setEfdPendingLoading] = useState(false);
  const [focusWorstMarginImpact, setFocusWorstMarginImpact] = useState(false);
  const [selectedImpactProductId, setSelectedImpactProductId] = useState(null);
  const todayPeriodKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const [mushak91Period, setMushak91Period] = useState(todayPeriodKey);
  const [mushak91Summary, setMushak91Summary] = useState(null);
  const [mushak91Loading, setMushak91Loading] = useState(false);
  const [mushak91Error, setMushak91Error] = useState("");
  const [withholdingRegistersPreview, setWithholdingRegistersPreview] = useState(null);
  const [withholdingRegistersPreviewLoading, setWithholdingRegistersPreviewLoading] = useState(false);
  const [withholdingRegistersPreviewError, setWithholdingRegistersPreviewError] = useState("");
  const [mushak63ManualSaleId, setMushak63ManualSaleId] = useState("");
  const [mushak63LookupMode, setMushak63LookupMode] = useState("auto");
  const [mushak63BusyId, setMushak63BusyId] = useState(null);

  const manualMushak63Check = async () => {
    setMushak63BusyId(-1);
    try {
      const target = await resolveSaleIdForMushak63Lookup(mushak63ManualSaleId, mushak63LookupMode);
      if (!target) {
        notifyError(
          mushak63LookupMode === "saleId"
            ? tt("repEnterNumericSaleId")
            : mushak63LookupMode === "invoice"
              ? tt("repEnterInvoice")
              : tt("repEnterSaleOrInvoice")
        );
        return;
      }
      setMushak63BusyId(target.saleId);
      await runMushak63CompletenessCheck(target.saleId);
    } catch (err) {
      notifyError(err.response?.data?.error || tt("repCompletenessFailed"));
    } finally {
      setMushak63BusyId(null);
    }
  };

  const manualMushak63Xml = async () => {
    setMushak63BusyId(-1);
    try {
      const target = await resolveSaleIdForMushak63Lookup(mushak63ManualSaleId, mushak63LookupMode);
      if (!target) {
        notifyError(
          mushak63LookupMode === "saleId"
            ? tt("repEnterNumericSaleId")
            : mushak63LookupMode === "invoice"
              ? tt("repEnterInvoice")
              : tt("repEnterSaleOrInvoice")
        );
        return;
      }
      setMushak63BusyId(target.saleId);
      await downloadMushak63XmlWithCompletenessHint(target.saleId, target.mushakDocumentNo);
    } catch (err) {
      notifyError(err.response?.data?.error || tt("repMushak63DownloadFailed"));
    } finally {
      setMushak63BusyId(null);
    }
  };

  const previewMushak91 = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mushak91Period)) {
      setMushak91Error(tt("repPeriodMustYYYYMM"));
      return;
    }
    setMushak91Error("");
    setMushak91Loading(true);
    try {
      const res = await api.get(`/nbr/reports/mushak91/summary?period=${mushak91Period}`);
      setMushak91Summary(res.data);
    } catch (err) {
      setMushak91Error(err?.response?.data?.error || err?.message || tt("repFailedToLoad"));
      setMushak91Summary(null);
    } finally {
      setMushak91Loading(false);
    }
  };

  const downloadMushak91Xml = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mushak91Period)) {
      setMushak91Error(tt("repPeriodMustYYYYMM"));
      return;
    }
    setMushak91Error("");
    try {
      const res = await api.get(`/nbr/reports/mushak91.xml?period=${mushak91Period}`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mushak-9.1-${mushak91Period}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMushak91Error(err?.response?.data?.error || err?.message || tt("repDownloadFailed"));
    }
  };

  const downloadWithholdingRegisterCsv = async (kind) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mushak91Period)) {
      setMushak91Error(tt("repPeriodMustYYYYMM"));
      return;
    }
    try {
      const res = await api.get(
        `/withholding/registers/${kind}/export.csv?period=${mushak91Period}`,
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-register-${mushak91Period}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMushak91Error(err?.response?.data?.error || err?.message || tt("repDownloadFailed"));
    }
  };

  const previewWithholdingRegisters = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mushak91Period)) {
      setWithholdingRegistersPreviewError(tt("repPeriodPreviewHint"));
      return;
    }
    setWithholdingRegistersPreviewError("");
    setWithholdingRegistersPreviewLoading(true);
    try {
      const period = encodeURIComponent(mushak91Period);
      const [aitRes, vdsRes] = await Promise.all([
        api.get(`/withholding/registers/ait?period=${period}`),
        api.get(`/withholding/registers/vds?period=${period}`),
      ]);
      setWithholdingRegistersPreview({ ait: aitRes.data, vds: vdsRes.data });
    } catch (err) {
      setWithholdingRegistersPreview(null);
      setWithholdingRegistersPreviewError(
        err?.response?.data?.error || err?.message || tt("repWithholdingLoadFailed")
      );
    } finally {
      setWithholdingRegistersPreviewLoading(false);
    }
  };

  const downloadWithholdingMushak66Pdf = async (voucherId) => {
    try {
      const res = await api.get(`/withholding/vouchers/${voucherId}/mushak66.pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mushak-6.6-${voucherId}.pdf`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("repMushak66DownloadFailed"));
    }
  };

  useEffect(() => {
    setWithholdingRegistersPreview(null);
    setWithholdingRegistersPreviewError("");
  }, [mushak91Period]);

  const loadEfdPending = async () => {
    setEfdPendingLoading(true);
    try {
      const q = new URLSearchParams();
      if (settlementRange.from) q.set("from", settlementRange.from);
      if (settlementRange.to) q.set("to", settlementRange.to);
      q.set("limit", "50");
      const res = await api.get(`/efd/pending-sales?${q.toString()}`);
      setEfdPending(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      notifyError(err?.response?.data?.error || tt("repEfdRetryFailed"));
      setEfdPending([]);
    } finally {
      setEfdPendingLoading(false);
    }
  };

  const retryEfdSale = async (saleId) => {
    try {
      await api.post(`/efd/sales/${saleId}/submit`);
      notifySuccess(tt("repEfdRetryOk"));
      await loadEfdPending();
    } catch (err) {
      notifyError(err?.response?.data?.error || tt("repEfdRetryFailed"));
    }
  };

  useEffect(() => {
    if (reportsTab === "tax") void loadEfdPending();
  }, [reportsTab, settlementRange.from, settlementRange.to]);

  useEffect(() => {
    const load = async () => {
      const settlementQuery = new URLSearchParams();
      if (settlementRange.from) settlementQuery.set("from", settlementRange.from);
      if (settlementRange.to) settlementQuery.set("to", settlementRange.to);
      settlementQuery.set("discountAlertMin", String(shrinkageThresholds.discountAlertMin || 0));
      settlementQuery.set("returnAlertMin", String(shrinkageThresholds.returnAlertMin || 0));
      settlementQuery.set("criticalAmount", String(shrinkageThresholds.criticalAmount || 0));
      const settlementUrl = settlementQuery.toString()
        ? `/sales/summary/settlement-today?${settlementQuery.toString()}`
        : "/sales/summary/settlement-today";
      const loyaltyUrl = settlementQuery.toString()
        ? `/sales/loyalty/redemptions?${settlementQuery.toString()}`
        : "/sales/loyalty/redemptions";
      const stockQuery = new URLSearchParams();
      if (stockValuationFilter.asOf) stockQuery.set("asOf", stockValuationFilter.asOf);
      if (stockValuationFilter.category) stockQuery.set("category", stockValuationFilter.category);
      if (stockValuationFilter.warehouseId) stockQuery.set("warehouseId", stockValuationFilter.warehouseId);
      const stockSuffix = stockQuery.toString() ? `?${stockQuery.toString()}` : "";
      const taxRiskQuery = new URLSearchParams(settlementQuery.toString());
      if (Number(taxRiskMinScore || 0) > 0) taxRiskQuery.set("minRiskScore", String(taxRiskMinScore));
      const categorySalesQuery = new URLSearchParams();
      if (settlementRange.from) categorySalesQuery.set("from", settlementRange.from);
      if (settlementRange.to) categorySalesQuery.set("to", settlementRange.to);
      const categorySalesSuffix = categorySalesQuery.toString() ? `?${categorySalesQuery.toString()}` : "";
      const hourlyCategoryQuery = new URLSearchParams(categorySalesQuery.toString());
      if (hourlyCategoryFilter && hourlyCategoryFilter !== "ALL") {
        hourlyCategoryQuery.set("category", hourlyCategoryFilter);
      }
      const hourlyCategorySuffix = hourlyCategoryQuery.toString() ? `?${hourlyCategoryQuery.toString()}` : "";
      const slowMoverQuery = new URLSearchParams(categorySalesQuery.toString());
      slowMoverQuery.set("days", String(slowMoverDays || 60));
      if (slowMoverCategory && slowMoverCategory !== "ALL") {
        slowMoverQuery.set("category", slowMoverCategory);
      }
      const slowMoverSuffix = slowMoverQuery.toString() ? `?${slowMoverQuery.toString()}` : "";
      const basketQuery = new URLSearchParams(categorySalesQuery.toString());
      basketQuery.set("mode", basketMode === "category" ? "category" : "product");
      basketQuery.set("minCount", String(basketMinCount || 3));
      const basketSuffix = basketQuery.toString() ? `?${basketQuery.toString()}` : "";

      const marginQuery = (() => {
        const q = new URLSearchParams();
        if (settlementRange.from) q.set("from", settlementRange.from);
        if (settlementRange.to) q.set("to", settlementRange.to);
        q.set("erosionThresholdPct", String(marginThresholdPct || 5));
        const s = q.toString();
        return s ? `?${s}` : "";
      })();
      const [agingRes, stockRes, settlementRes, loyaltyRes, vatSummaryRes, vatRegisterRes, shrinkageRes, staffKpiRes, auditTrailRes, chequeLedgerRes, warehouseRes, marginRes, marginTrendRes, marginErosionRes, taxRiskRes, taxPrecheckRes, categorySalesRes, departmentSalesRes, promotionRoiRes, hourlyCategorySalesRes, shrinkageByCategoryRes, slowMoversRes, hqBranchCompareRes, loyaltyByCategoryRes, basketAnalysisRes] =
        await Promise.all([
        api.get("/reports/aging"),
        api.get(`/reports/stock-valuation${stockSuffix}`),
        api.get(settlementUrl),
        api.get(loyaltyUrl),
        api.get(`/reports/vat/summary${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/vat/sales-register${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/shrinkage-control${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/staff-kpi${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(`/reports/audit-activity${settlementQuery.toString() ? `?${settlementQuery.toString()}` : ""}`),
        api.get(
          `/reports/cheque-ledger${
            (() => {
              const q = new URLSearchParams(settlementQuery.toString());
              if (chequeLedgerFilter.direction) q.set("direction", chequeLedgerFilter.direction);
              if (chequeLedgerFilter.status) q.set("status", chequeLedgerFilter.status);
              if (chequeLedgerFilter.onlyMismatched) q.set("onlyMismatched", "1");
              const s = q.toString();
              return s ? `?${s}` : "";
            })()
          }`
        ),
        api.get("/warehouses"),
        api.get(`/reports/advanced-margin${marginQuery}`),
        api.get("/reports/advanced-margin/trend?months=12"),
        api.get(`/reports/category-margin-erosion${marginQuery}`),
        api.get(`/reports/tax-risk${taxRiskQuery.toString() ? `?${taxRiskQuery.toString()}` : ""}`),
        api.get(`/reports/tax-filing/prevalidate${taxRiskQuery.toString() ? `?${taxRiskQuery.toString()}` : ""}`),
        api.get(`/reports/category-sales${categorySalesSuffix}`),
        api.get(`/reports/department-sales${categorySalesSuffix}`),
        api.get(`/reports/promotion-roi${categorySalesSuffix}`),
        api.get(`/reports/hourly-category-sales${hourlyCategorySuffix}`),
        api.get(`/reports/shrinkage-by-category${categorySalesSuffix}`),
        api.get(`/reports/slow-movers${slowMoverSuffix}`),
        canHqBranchCompare
          ? api.get(`/reports/hq-branch-compare${categorySalesSuffix}`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
        api.get(`/reports/loyalty-by-category${categorySalesSuffix}`),
        api.get(`/reports/basket-analysis${basketSuffix}`),
      ]);
      setAging(agingRes.data);
      setStockValuation(stockRes.data);
      setWarehouses(warehouseRes.data || []);
      setSettlement(settlementRes.data);
      setLoyaltyRedemptions(loyaltyRes.data);
      setVatSummary(vatSummaryRes.data || {});
      setVatSalesRegister(vatRegisterRes.data || []);
      setShrinkageControl(
        shrinkageRes.data || {
          totals: { totalCashiers: 0, totalSales: 0, totalDiscount: 0, totalReturns: 0, totalOverrides: 0 },
          summaryRows: [],
          eventRows: [],
        }
      );
      setStaffKpi(staffKpiRes.data || { summary: { staffCount: 0, totalSales: 0, totalInvoices: 0 }, rows: [] });
      setAuditActivity(auditTrailRes.data || { count: 0, rows: [] });
      setChequeLedger(
        chequeLedgerRes.data || {
          summary: { journalCount: 0, mismatchedJournalCount: 0, totalDebit: 0, totalCredit: 0 },
          rows: [],
        }
      );
      setAdvancedMargin(
        marginRes.data || {
          summary: { skuCount: 0, soldSkuCount: 0, erosionAlertCount: 0, totalRevenue: 0, totalLandedCogs: 0, totalGrossProfit: 0 },
          categoryRows: [],
          rows: [],
        }
      );
      setAdvancedMarginTrend(marginTrendRes.data || { months: 12, rows: [] });
      setCategoryMarginErosion(
        marginErosionRes.data || {
          summary: {
            categoryCount: 0,
            soldCategoryCount: 0,
            belowTargetCount: 0,
            costErosionCount: 0,
            alertCount: 0,
            worstGapPct: 0,
          },
          rows: [],
        }
      );
      setCategorySales(
        categorySalesRes.data || {
          rows: [],
          summary: { categoryCount: 0, totalRevenue: 0, totalCogs: 0, totalGrossProfit: 0 },
        }
      );
      setDepartmentSales(
        departmentSalesRes.data || {
          rows: [],
          summary: { departmentCount: 0, totalRevenue: 0, totalCogs: 0, totalGrossProfit: 0 },
        }
      );
      setPromotionRoi(
        promotionRoiRes.data || {
          rows: [],
          summary: { saleCount: 0, salesWithPromo: 0, ruleCount: 0, totalDiscount: 0, unattributedPromoTotal: 0 },
        }
      );
      setHourlyCategorySales(
        hourlyCategorySalesRes.data || {
          rows: [],
          hourTotals: [],
          categories: [],
          summary: { peakHour: 0, peakHourLabel: "00:00", peakHourRevenue: 0, totalRevenue: 0 },
        }
      );
      setShrinkageByCategory(
        shrinkageByCategoryRes.data || {
          rows: [],
          summary: { categoryCount: 0, adjustmentCount: 0, unitsWrittenOff: 0, estimatedCost: 0 },
        }
      );
      setSlowMovers(
        slowMoversRes.data || {
          rows: [],
          summary: { slowMoverCount: 0, stockValueAtRisk: 0 },
        }
      );
      setHqBranchCompare(
        hqBranchCompareRes?.data && Array.isArray(hqBranchCompareRes.data.branches)
          ? hqBranchCompareRes.data
          : { from: "", to: "", branches: [] }
      );
      setLoyaltyByCategory(
        loyaltyByCategoryRes.data || {
          rows: [],
          summary: { categoryCount: 0, totalRevenue: 0, totalPoints: 0, bonusPoints: 0 },
          aisleBonusActive: false,
        }
      );
      setBasketAnalysis(
        basketAnalysisRes.data || {
          mode: basketMode,
          rows: [],
          summary: { saleCount: 0, multiItemSaleCount: 0, pairCount: 0 },
        }
      );
      setTaxRisk(
        taxRiskRes.data || {
          summary: {
            vatSalesCount: 0,
            vatZeroSalesCount: 0,
            withholdingVoucherCount: 0,
            withholdingHighRiskCount: 0,
            salesHighRiskCount: 0,
            totalOutputVat: 0,
            totalTaxableSales: 0,
          },
          withholdingRows: [],
          salesRows: [],
        }
      );
      setTaxPrevalidation(
        taxPrecheckRes.data || {
          summary: { salesRows: 0, paymentVouchers: 0, warningCount: 0 },
          warnings: [],
          readyForExport: false,
        }
      );
    };
    load();
  }, [
    settlementRange.from,
    settlementRange.to,
    shrinkageThresholds.discountAlertMin,
    shrinkageThresholds.returnAlertMin,
    shrinkageThresholds.criticalAmount,
    chequeLedgerFilter.direction,
    chequeLedgerFilter.status,
    chequeLedgerFilter.onlyMismatched,
    stockValuationFilter.asOf,
    stockValuationFilter.category,
    stockValuationFilter.warehouseId,
    marginThresholdPct,
    taxRiskMinScore,
    hourlyCategoryFilter,
    slowMoverDays,
    slowMoverCategory,
    basketMode,
    basketMinCount,
    canHqBranchCompare,
  ]);

  const exportCSV = async (url, filename) => {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const exportSettlement = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      methodCsv: ["/sales/summary/settlement-today/export-method.csv", "today-settlement-by-method.csv"],
      channelCsv: ["/sales/summary/settlement-today/export-channel.csv", "today-settlement-by-channel.csv"],
      methodPdf: ["/sales/summary/settlement-today/export-method.pdf", "today-settlement-by-method.pdf"],
      channelPdf: ["/sales/summary/settlement-today/export-channel.pdf", "today-settlement-by-channel.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportLoyaltyRedemption = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/sales/loyalty/redemptions/export.csv", "loyalty-redemption-history.csv"],
      pdf: ["/sales/loyalty/redemptions/export.pdf", "loyalty-redemption-history.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportVatSalesRegister = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/vat/sales-register/export.csv", "vat-sales-register.csv"],
      pdf: ["/reports/vat/sales-register/export.pdf", "vat-sales-register.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const openSaleLookupDeepLink = (invoiceNo, saleId) => {
    const queryVal = invoiceNo ? String(invoiceNo).trim() : String(saleId ?? "").trim();
    if (!queryVal) return;
    const mode = invoiceNo ? "invoice" : "saleId";
    try {
      sessionStorage.setItem(
        "bd_pos_sales_lookup_prefill",
        JSON.stringify({ query: queryVal, mode, autoSearch: true })
      );
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "salesLookup" } }));
  };

  const exportShrinkageControl = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    query.set("discountAlertMin", String(shrinkageThresholds.discountAlertMin || 0));
    query.set("returnAlertMin", String(shrinkageThresholds.returnAlertMin || 0));
    query.set("criticalAmount", String(shrinkageThresholds.criticalAmount || 0));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/shrinkage-control/export.csv", "shrinkage-risk-summary.csv"],
      pdf: ["/reports/shrinkage-control/export.pdf", "shrinkage-risk-summary.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportChequeLedger = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    if (chequeLedgerFilter.direction) query.set("direction", chequeLedgerFilter.direction);
    if (chequeLedgerFilter.status) query.set("status", chequeLedgerFilter.status);
    if (chequeLedgerFilter.onlyMismatched) query.set("onlyMismatched", "1");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/cheque-ledger/export.csv", "cheque-ledger.csv"],
      pdf: ["/reports/cheque-ledger/export.pdf", "cheque-ledger.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportStockValuation = async (type) => {
    const query = new URLSearchParams();
    if (stockValuationFilter.asOf) query.set("asOf", stockValuationFilter.asOf);
    if (stockValuationFilter.category) query.set("category", stockValuationFilter.category);
    if (stockValuationFilter.warehouseId) query.set("warehouseId", stockValuationFilter.warehouseId);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/stock-valuation/export.csv", "stock-valuation.csv"],
      pdf: ["/reports/stock-valuation/export.pdf", "stock-valuation.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportAdvancedMargin = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    query.set("erosionThresholdPct", String(marginThresholdPct || 5));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/advanced-margin/export.csv", "advanced-margin-analytics.csv"],
      pdf: ["/reports/advanced-margin/export.pdf", "advanced-margin-analytics.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportCategoryMarginErosion = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    query.set("erosionThresholdPct", String(marginThresholdPct || 5));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/category-margin-erosion/export.csv", "category-margin-erosion.csv"],
      pdf: ["/reports/category-margin-erosion/export.pdf", "category-margin-erosion.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const exportTaxRisk = async (type) => {
    const query = new URLSearchParams();
    if (settlementRange.from) query.set("from", settlementRange.from);
    if (settlementRange.to) query.set("to", settlementRange.to);
    if (Number(taxRiskMinScore || 0) > 0) query.set("minRiskScore", String(taxRiskMinScore));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const endpoints = {
      csv: ["/reports/tax-risk/export.csv", "tax-risk-dashboard.csv"],
      pdf: ["/reports/tax-risk/export.pdf", "tax-risk-dashboard.pdf"],
    };
    const [url, filename] = endpoints[type];
    await exportCSV(`${url}${suffix}`, filename);
  };

  const marginTrendMax = useMemo(
    () =>
      Math.max(
        1,
        ...(advancedMarginTrend.rows || []).map((row) => Math.abs(Number(row.marginImpactPct || 0)))
      ),
    [advancedMarginTrend.rows]
  );

  const categoryMarginErosionRows = useMemo(() => {
    const rows = categoryMarginErosion.rows || [];
    if (marginErosionFilterOnly) return rows.filter((row) => row.alert);
    return rows;
  }, [categoryMarginErosion.rows, marginErosionFilterOnly]);

  const setSettlementPresetRange = (preset) => {
    const now = new Date();
    if (preset === "today") {
      const today = toInputDate(now);
      setSettlementRange({ from: today, to: today });
      return;
    }
    if (preset === "last7") {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      setSettlementRange({ from: toInputDate(from), to: toInputDate(now) });
      return;
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setSettlementRange({ from: toInputDate(start), to: toInputDate(now) });
      return;
    }
    setSettlementRange({ from: "", to: "" });
  };

  const filteredStockValuationRows = useMemo(() => {
    const rows = Array.isArray(stockValuation.rows) ? stockValuation.rows : [];
    const impacted = !focusWorstMarginImpact
      ? rows
      : rows
      .filter((row) => Number(row?.marginImpactPct || 0) < 0)
      .sort((a, b) => Number(a?.marginImpactPct || 0) - Number(b?.marginImpactPct || 0));
    if (!selectedImpactProductId) return impacted;
    return impacted.filter((row) => Number(row?.productId || 0) === Number(selectedImpactProductId));
  }, [stockValuation.rows, focusWorstMarginImpact, selectedImpactProductId]);

  const topWorstValuationImpactRows = useMemo(
    () =>
      (Array.isArray(stockValuation.rows) ? stockValuation.rows : [])
        .filter((row) => Number(row?.marginImpactPct || 0) < 0)
        .sort((a, b) => Number(a?.marginImpactPct || 0) - Number(b?.marginImpactPct || 0))
        .slice(0, 10),
    [stockValuation.rows]
  );

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("repTitle")}</div>
          <div className="page-subtitle">{tt("repSubtitle")}</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label={tt("repTabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "overview"}
            className={`pos-tab ${reportsTab === "overview" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("overview")}
          >
            {tt("repTabOverview")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "tax"}
            className={`pos-tab ${reportsTab === "tax" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("tax")}
          >
            {tt("repTabTax")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "risk"}
            className={`pos-tab ${reportsTab === "risk" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("risk")}
          >
            {tt("repTabRisk")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "finance"}
            className={`pos-tab ${reportsTab === "finance" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("finance")}
          >
            {tt("repTabFinance")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportsTab === "margin"}
            className={`pos-tab ${reportsTab === "margin" ? "pos-tab-active" : ""}`}
            onClick={() => setReportsTab("margin")}
          >
            {tt("repTabMargin")}
          </button>
        </div>
      </div>
      <details className="page-card" style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>{tt("repAdvancedExports")}</summary>
        {canExportAdvanced ? (
          <div className="pos-action-row" style={{ marginTop: 10 }}>
            <button onClick={() => exportCSV("/reports/aging/export.csv", "aging-report.csv")}>{tt("repBtnAgingCsv")}</button>
            <button onClick={() => exportCSV("/reports/aging/export.pdf", "aging-report.pdf")}>{tt("repBtnAgingPdf")}</button>
            <button onClick={() => exportStockValuation("csv")}>{tt("repBtnStockCsv")}</button>
            <button onClick={() => exportStockValuation("pdf")}>{tt("repBtnStockPdf")}</button>
            <button onClick={() => exportSettlement("methodCsv")}>{tt("repBtnSettlementMethodCsv")}</button>
            <button onClick={() => exportSettlement("channelCsv")}>{tt("repBtnSettlementChannelCsv")}</button>
            <button onClick={() => exportSettlement("methodPdf")}>{tt("repBtnSettlementMethodPdf")}</button>
            <button onClick={() => exportSettlement("channelPdf")}>{tt("repBtnSettlementChannelPdf")}</button>
            <button onClick={() => exportLoyaltyRedemption("csv")}>{tt("repBtnLoyaltyCsv")}</button>
            <button onClick={() => exportLoyaltyRedemption("pdf")}>{tt("repBtnLoyaltyPdf")}</button>
            <button onClick={() => exportVatSalesRegister("csv")}>{tt("repBtnVatRegisterCsv")}</button>
            <button onClick={() => exportVatSalesRegister("pdf")}>{tt("repBtnVatRegisterPdf")}</button>
            <button onClick={() => exportTaxRisk("csv")}>{tt("repBtnTaxRiskCsv")}</button>
            <button onClick={() => exportTaxRisk("pdf")}>{tt("repBtnTaxRiskPdf")}</button>
            <button onClick={() => exportShrinkageControl("csv")}>{tt("repBtnShrinkageCsv")}</button>
            <button onClick={() => exportShrinkageControl("pdf")}>{tt("repBtnShrinkagePdf")}</button>
            <button onClick={() => exportChequeLedger("csv")}>{tt("repBtnChequeCsv")}</button>
            <button onClick={() => exportChequeLedger("pdf")}>{tt("repBtnChequePdf")}</button>
            <button onClick={() => exportAdvancedMargin("csv")}>{tt("repBtnMarginCsv")}</button>
            <button onClick={() => exportAdvancedMargin("pdf")}>{tt("repBtnMarginPdf")}</button>
          </div>
        ) : (
          <div className="text-muted" style={{ marginTop: 10 }}>{tt("repPermExportAdvanced")}</div>
        )}
      </details>
      <div className="form-grid" style={{ marginBottom: "12px" }}>
        <input
          type="date"
          value={settlementRange.from}
          onChange={(e) => setSettlementRange((prev) => ({ ...prev, from: e.target.value }))}
        />
        <input
          type="date"
          value={settlementRange.to}
          onChange={(e) => setSettlementRange((prev) => ({ ...prev, to: e.target.value }))}
        />
        <button type="button" className="btn-secondary" onClick={() => setSettlementRange({ from: "", to: "" })}>
          {tt("repClearDateFilter")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("today")}>
          {tt("repToday")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("last7")}>
          {tt("repLast7Days")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSettlementPresetRange("month")}>
          {tt("repThisMonth")}
        </button>
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.discountAlertMin}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              discountAlertMin: Number(e.target.value || 0),
            }))
          }
          placeholder={tt("repPhHighDiscountThreshold")}
        />
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.returnAlertMin}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              returnAlertMin: Number(e.target.value || 0),
            }))
          }
          placeholder={tt("repPhHighReturnThreshold")}
        />
        <input
          type="number"
          min="0"
          step="1"
          value={shrinkageThresholds.criticalAmount}
          onChange={(e) =>
            setShrinkageThresholds((prev) => ({
              ...prev,
              criticalAmount: Number(e.target.value || 0),
            }))
          }
          placeholder={tt("repPhCriticalAmountThreshold")}
        />
      </div>
      {reportsTab === "overview" ? (
        <div className="pos-tab-panel">
      {canHqBranchCompare && hqBranchCompare.branches?.length ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>{tt("repHqBranchCompareTitle")}</h4>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
            {tt("repHqBranchCompareSub", {
              from: hqBranchCompare.from || "—",
              to: hqBranchCompare.to || "—",
            })}
          </p>
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                exportCSV(
                  `/reports/hq-branch-compare/export.csv${marginReportQuerySuffix}`,
                  "hq-branch-compare.csv"
                )
              }
            >
              {tt("repExportHqBranchCompareCsv")}
            </button>
          </div>
          {[
            { key: "salesToday", labelKey: "repHqMetricSales" },
            { key: "groceryRevenueToday", labelKey: "repHqMetricGrocery" },
            { key: "groceryMarginPctToday", labelKey: "dashGroceryMarginShort", isPct: true },
          ].map((metric) => {
            const maxVal = Math.max(
              ...hqBranchCompare.branches.map((b) => Number(b[metric.key] || 0)),
              1
            );
            return (
              <div key={metric.key} style={{ marginBottom: 14 }}>
                <strong style={{ fontSize: 13 }}>{tt(metric.labelKey)}</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {hqBranchCompare.branches.map((b) => {
                    const val = Number(b[metric.key] || 0);
                    const pct = Math.min(100, (val / maxVal) * 100);
                    return (
                      <div key={`${metric.key}-${b.branchId}`}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            marginBottom: 4,
                          }}
                        >
                          <span>
                            {b.name} <span style={{ opacity: 0.65 }}>({b.code})</span>
                          </span>
                          <span>{metric.isPct ? `${val.toFixed(1)}%` : bdt(val)}</span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: "#e5e7eb",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: "#1d4ed8",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <DataTable
        title={tt("repSettleByMethodTitle")}
        rows={settlement.methods.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["method"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "method", label: tt("repPaymentMethod") },
          { key: "amount", label: tt("repCollected"), render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title={tt("repSettleByChannelTitle")}
        rows={settlement.channels.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["channel"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "channel", label: tt("repChannel") },
          { key: "amount", label: tt("repCollected"), render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title={tt("repDigitalRefUsageTitle")}
        rows={(settlement.digitalRefs || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["channel"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "channel", label: tt("repTxnRef") },
          { key: "count", label: tt("repUsageCount") },
        ]}
      />
      <DataTable
        title={tt("repSettlementTrendTitle")}
        rows={settlement.days.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["date"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "date", label: tt("receiptDate") },
          { key: "paid", label: tt("dashPaid"), render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">{tt("dashPillBills")}: {settlement.billCount}</div>
        <div className="stat">{tt("dashPaid")}: {bdt(settlement.totalPaid)}</div>
        <div className="stat">{tt("dashDue")}: {bdt(settlement.totalDue)}</div>
        <div className="stat">{tt("repDigitalPaid")}: {bdt(settlement.digitalCollectionTotal)}</div>
        <div className="stat">{tt("repMissingDigitalRefs")}: {Number(settlement.digitalMissingRefCount || 0)}</div>
        <div className="stat">{tt("dashWalletCashOut")}: {bdt(settlement.walletFlow?.cashOut || 0)}</div>
        <div className="stat">{tt("dashWalletCashIn")}: {bdt(settlement.walletFlow?.cashIn || 0)}</div>
        <div className="stat">{tt("dashWalletNet")}: {bdt(settlement.walletFlow?.net || 0)}</div>
      </div>
        </div>
      ) : null}
      {reportsTab === "tax" ? (
        <div className="pos-tab-panel">
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">{tt("repLoyaltyEntries")}: {Number(loyaltyRedemptions.summary?.count || 0)}</div>
        <div className="stat">{tt("repRedeemedPoints")}: {Number(loyaltyRedemptions.summary?.redeemedPoints || 0).toFixed(0)}</div>
        <div className="stat">{tt("repRedeemedAmount")}: {bdt(loyaltyRedemptions.summary?.redeemedAmount)}</div>
        <div className="stat">{tt("repTierDiscount")}: {bdt(loyaltyRedemptions.summary?.tierDiscountAmount)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">{tt("repVatSalesCount")}: {Number(vatSummary.salesCount || 0)}</div>
        <div className="stat">{tt("repTaxableSales")}: {bdt(vatSummary.taxableSales)}</div>
        <div className="stat">{tt("repOutputVat")}: {bdt(vatSummary.outputVat)}</div>
        <div className="stat">{tt("repInputVatTracked")}: {bdt(vatSummary.inputVatTracked)}</div>
        <div className="stat">{tt("repNetVatPayable")}: {bdt(vatSummary.netVatPayable)}</div>
      </div>
      <div className="page-card" style={{ marginBottom: "12px" }}>
        <h4 style={{ marginTop: 0 }}>{tt("repTaxRiskTitle")}</h4>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>{tt("repTaxRiskMinScore")}</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={taxRiskMinScore}
            onChange={(e) => setTaxRiskMinScore(Number(e.target.value || 0))}
            placeholder={tt("repTaxRiskMinScore")}
            style={{ width: 120 }}
          />
          <span style={{ fontSize: 12, color: "#475569" }}>{tt("repTaxRiskQuickThresholds")}</span>
          {[5, 7, 10].map((value) => (
            <button
              key={value}
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setTaxRiskMinScore(value)}
              style={{
                background: Number(taxRiskMinScore || 0) === value ? "#1d4ed8" : undefined,
                color: Number(taxRiskMinScore || 0) === value ? "#fff" : undefined,
              }}
            >
              {`>=${value}`}
            </button>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setTaxRiskMinScore(0)}>
            {tt("repTaxRiskClearThreshold")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => exportTaxRisk("csv")}>
            {tt("repBtnTaxRiskCsv")}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => exportTaxRisk("pdf")}>
            {tt("repBtnTaxRiskPdf")}
          </button>
        </div>
        <div className="quick-stats">
          <div className="stat">{tt("repTaxRiskVatSales")}: {Number(taxRisk.summary?.vatSalesCount || 0)}</div>
          <div className="stat">{tt("repTaxRiskVatZero")}: {Number(taxRisk.summary?.vatZeroSalesCount || 0)}</div>
          <div className="stat">{tt("repTaxRiskWithholding")}: {Number(taxRisk.summary?.withholdingVoucherCount || 0)}</div>
          <div className="stat">{tt("repTaxRiskWithholdingHigh")}: {Number(taxRisk.summary?.withholdingHighRiskCount || 0)}</div>
          <div className="stat">{tt("repTaxRiskSalesHigh")}: {Number(taxRisk.summary?.salesHighRiskCount || 0)}</div>
        </div>
      </div>
      <div className="page-card" style={{ marginBottom: "12px" }}>
        <h4 style={{ marginTop: 0 }}>Tax filing workspace pre-validation</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          Pre-check Mushak and withholding completeness before export.
        </p>
        <div className="quick-stats" style={{ marginBottom: 8 }}>
          <div className="stat">Sales rows: {Number(taxPrevalidation.summary?.salesRows || 0)}</div>
          <div className="stat">Payment vouchers: {Number(taxPrevalidation.summary?.paymentVouchers || 0)}</div>
          <div className="stat">Warnings: {Number(taxPrevalidation.summary?.warningCount || 0)}</div>
          <div className="stat" style={{ background: taxPrevalidation.readyForExport ? "#dcfce7" : "#fee2e2" }}>
            {taxPrevalidation.readyForExport ? "Ready for export" : "Needs fix"}
          </div>
        </div>
        <DataTable
          title=""
          rows={(taxPrevalidation.warnings || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
          searchableKeys={["key", "severity"]}
          allowExport={false}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "key", label: "Check" },
            { key: "count", label: "Count" },
            { key: "severity", label: "Severity" },
          ]}
        />
      </div>
      <DataTable
        title={tt("repTaxRiskWithholdingTitle")}
        rows={(taxRisk.withholdingRows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["supplierName", "taxCategory", "mushak66DocumentNo"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "supplierName", label: tt("purColSupplier") },
          { key: "taxCategory", label: tt("repTaxCategory") },
          { key: "amount", label: tt("receiptAmount"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "aitAmount", label: "AIT", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "vdsAmount", label: "VDS", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "mushak66DocumentNo", label: "Mushak 6.6", render: (v) => v || "-" },
          { key: "riskScore", label: tt("repRiskScore"), render: (v) => Number(v || 0).toFixed(2) },
        ]}
      />
      <DataTable
        title={tt("repTaxRiskSalesTitle")}
        rows={(taxRisk.salesRows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["invoiceNo", "customer", "date"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "invoiceNo", label: tt("receiptInvoice") },
          { key: "date", label: tt("receiptDate") },
          { key: "customer", label: tt("salesCustomer"), render: (v) => v || "-" },
          { key: "taxableAmount", label: tt("repTaxableSales"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "vatAmount", label: tt("repOutputVat"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "impliedVatRatePct", label: tt("repTaxRiskImpliedVat"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
          { key: "riskScore", label: tt("repRiskScore"), render: (v) => Number(v || 0).toFixed(2) },
        ]}
      />

      <div className="page-card" style={{ marginBottom: "12px" }}>
        <h4 style={{ marginTop: 0 }}>{tt("repEfdQueueTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("repEfdQueueHelp")}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={loadEfdPending} disabled={efdPendingLoading}>
            {efdPendingLoading ? tt("settingsLoading") : tt("settingsRefreshReadiness")}
          </button>
        </div>
        {efdPending.length === 0 && !efdPendingLoading ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{tt("repEfdNoPending")}</p>
        ) : (
          <DataTable
            rows={efdPending}
            columns={[
              { key: "invoiceNo", label: tt("repInvoiceNumber"), render: (v, row) => v || `#${row.id}` },
              {
                key: "createdAt",
                label: tt("colDate"),
                render: (v) => (v ? new Date(v).toLocaleString() : "—"),
              },
              { key: "total", label: tt("receiptTotal"), render: (v) => formatBDT(v || 0) },
              { key: "paymentMethod", label: tt("receiptPayment") },
              {
                key: "id",
                label: tt("colActions"),
                render: (_, row) => (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => retryEfdSale(row.id)}>
                    {tt("repEfdRetry")}
                  </button>
                ),
              },
            ]}
          />
        )}
      </div>

      <div className="page-card" style={{ marginBottom: "12px" }}>
        <h4 style={{ marginTop: 0 }}>{tt("repMushak63Title")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("repMushak63HelpA")} <strong>{tt("repInvoiceNumber")}</strong> {tt("repMushak63HelpB")}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {tt("repMatchBy")}
            <SearchSelect
              className="form-select-sm"
              value={mushak63LookupMode}
              onChange={(val) => setMushak63LookupMode(val || "auto")}
              options={[
                { value: "auto", label: tt("repAuto") },
                { value: "saleId", label: tt("repSaleId") },
                { value: "invoice", label: tt("repInvoiceNumber") },
              ]}
              isClearable={false}
            />
          </label>
          <input
            type="text"
            placeholder={
              mushak63LookupMode === "saleId"
                ? "Sale ID"
                : mushak63LookupMode === "invoice"
                  ? tt("repInvoiceNumber")
                  : tt("repSaleOrInvoice")
            }
            value={mushak63ManualSaleId}
            onChange={(e) => setMushak63ManualSaleId(e.target.value)}
            style={{ width: 200 }}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={manualMushak63Check}
            disabled={mushak63BusyId !== null}
          >
            {tt("repCheckCompleteness")}
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={manualMushak63Xml}
            disabled={mushak63BusyId !== null}
          >
            {tt("repDownloadMushak63Xml")}
          </button>
        </div>
      </div>

      <div className="page-card" style={{ marginBottom: "12px" }}>
        <h4 style={{ marginTop: 0 }}>{tt("repMushak91Title")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("repMushak91Help")}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>{tt("repPeriodYYYYMM")}</label>
          <input
            type="month"
            value={mushak91Period}
            onChange={(e) => setMushak91Period(e.target.value)}
            style={{ width: 160 }}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={previewMushak91}
            disabled={mushak91Loading}
          >
            {mushak91Loading ? tt("repLoading") : tt("repPreview")}
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={downloadMushak91Xml}
            disabled={mushak91Loading}
            title={tt("repDownloadMushak91Title")}
          >
            {tt("repDownloadMushak91Xml")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => downloadWithholdingRegisterCsv("ait")}
            title={tt("repAitRegisterTitle")}
          >
            {tt("repAitRegisterCsv")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => downloadWithholdingRegisterCsv("vds")}
            title={tt("repVdsRegisterTitle")}
          >
            {tt("repVdsRegisterCsv")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={previewWithholdingRegisters}
            disabled={withholdingRegistersPreviewLoading || mushak91Loading}
            title={tt("repPreviewWithholdingTitle")}
          >
            {withholdingRegistersPreviewLoading ? tt("repLoadingRegisters") : tt("repPreviewWithholding")}
          </button>
        </div>
        {mushak91Error ? (
          <p style={{ color: "#b42318", marginTop: 8, fontSize: 13 }}>{mushak91Error}</p>
        ) : null}
        {mushak91Summary ? (
          <div style={{ marginTop: 10 }}>
            <div className="quick-stats">
              <div className="stat">{tt("repSales")}: {Number(mushak91Summary.summary.counts.salesCount)}</div>
              <div className="stat">{tt("repPurchases")}: {Number(mushak91Summary.summary.counts.purchaseCount)}</div>
              <div className="stat">{tt("repOutputVat")}: {bdt(mushak91Summary.summary.output.totalVat)}</div>
              <div className="stat">{tt("repInputVat")}: {bdt(mushak91Summary.summary.input.totalVat)}</div>
              <div className="stat" style={{ background: "#dcfce7" }}>
                {tt("repNetVatPayable")}: {bdt(mushak91Summary.summary.netVatPayable)}
              </div>
            </div>
            {mushak91Summary.warnings && mushak91Summary.warnings.length > 0 ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  background: "#fff7ed",
                  border: "1px solid #fdba74",
                  borderRadius: 6,
                }}
              >
                <strong style={{ color: "#9a3412" }}>{tt("repCompletenessWarnings")}</strong>
                <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                  {mushak91Summary.warnings.map((w, idx) => (
                    <li key={idx} style={{ color: "#9a3412", fontSize: 13 }}>
                      {w}
                    </li>
                  ))}
                </ul>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#9a3412" }}>{tt("repCompletenessWarnHelp")}</p>
              </div>
            ) : (
              <p style={{ marginTop: 8, color: "#15803d", fontSize: 13 }}>
                {tt("repNoCompletenessWarnings")}
              </p>
            )}
            {mushak91Summary.summary.output.buckets.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <strong style={{ fontSize: 13 }}>{tt("repOutputVatByHs")}</strong>
                <table style={{ width: "100%", marginTop: 6, fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 4, borderBottom: "1px solid #e5e7eb" }}>{tt("repHsCode")}</th>
                      <th style={{ textAlign: "right", padding: 4, borderBottom: "1px solid #e5e7eb" }}>{tt("repRate")}</th>
                      <th style={{ textAlign: "right", padding: 4, borderBottom: "1px solid #e5e7eb" }}>{tt("repLines")}</th>
                      <th style={{ textAlign: "right", padding: 4, borderBottom: "1px solid #e5e7eb" }}>Net</th>
                      <th style={{ textAlign: "right", padding: 4, borderBottom: "1px solid #e5e7eb" }}>VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mushak91Summary.summary.output.buckets.map((b, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: 4 }}>{b.hsCode}</td>
                        <td style={{ padding: 4, textAlign: "right" }}>{Number(b.rate).toFixed(2)}%</td>
                        <td style={{ padding: 4, textAlign: "right" }}>{Number(b.lineCount)}</td>
                        <td style={{ padding: 4, textAlign: "right" }}>{bdt(b.net)}</td>
                        <td style={{ padding: 4, textAlign: "right" }}>{bdt(b.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-muted" style={{ marginTop: 8, fontSize: 11 }}>
              {tt("repXmlHash")}: <code>{mushak91Summary.hash}</code>
            </p>
          </div>
        ) : null}
      </div>

      {withholdingRegistersPreview ? (
        <div className="page-card" style={{ marginBottom: "12px" }}>
          <h4 style={{ marginTop: 0 }}>Withholding registers ({mushak91Period})</h4>
          <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
            Supplier payments with AIT / VDS for the same month as Mushak 9.1. CSV exports match these rows.
          </p>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 13 }}>AIT register</strong>
            <div className="quick-stats" style={{ marginTop: 6 }}>
              <div className="stat">Vouchers: {Number(withholdingRegistersPreview.ait?.summary?.voucherCount || 0)}</div>
              <div className="stat">Gross: {bdt(withholdingRegistersPreview.ait?.summary?.totalGross)}</div>
              <div className="stat">AIT: {bdt(withholdingRegistersPreview.ait?.summary?.totalAit)}</div>
              <div className="stat">Net paid: {bdt(withholdingRegistersPreview.ait?.summary?.totalNet)}</div>
            </div>
            <DataTable
              title=""
              rows={(withholdingRegistersPreview.ait?.rows || []).map((r) => mapWithholdingVoucherRow(r, bdt))}
              pageSize={8}
              allowExport={false}
              searchableKeys={[
                "supplierName",
                "tin",
                "bin",
                "taxCategory",
                "method",
                "mushak66",
                "note",
                "voucherId",
              ]}
              columns={[
                { key: "voucherId", label: "Voucher" },
                { key: "dateLabel", label: "Date" },
                { key: "supplierName", label: "Supplier" },
                { key: "tin", label: "TIN" },
                { key: "bin", label: "BIN" },
                { key: "taxCategory", label: "Tax cat." },
                { key: "method", label: "Method" },
                { key: "grossLabel", label: "Gross" },
                { key: "aitRateLabel", label: "AIT %" },
                { key: "aitLabel", label: "AIT" },
                { key: "netLabel", label: "Net paid" },
                { key: "mushak66", label: "Mushak 6.6" },
                {
                  key: "mushak66pdf",
                  label: "6.6 PDF",
                  render: (_, row) =>
                    row.mushak66Eligible ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => downloadWithholdingMushak66Pdf(row.voucherId)}
                      >
                        PDF
                      </button>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    ),
                },
                { key: "note", label: "Note", render: (v) => <span title={v}>{v}</span> },
              ]}
            />
          </div>

          <div>
            <strong style={{ fontSize: 13 }}>VDS register</strong>
            <div className="quick-stats" style={{ marginTop: 6 }}>
              <div className="stat">Vouchers: {Number(withholdingRegistersPreview.vds?.summary?.voucherCount || 0)}</div>
              <div className="stat">Gross: {bdt(withholdingRegistersPreview.vds?.summary?.totalGross)}</div>
              <div className="stat">VDS: {bdt(withholdingRegistersPreview.vds?.summary?.totalVds)}</div>
              <div className="stat">Net paid: {bdt(withholdingRegistersPreview.vds?.summary?.totalNet)}</div>
            </div>
            <DataTable
              title=""
              rows={(withholdingRegistersPreview.vds?.rows || []).map((r) => mapWithholdingVoucherRow(r, bdt))}
              pageSize={8}
              allowExport={false}
              searchableKeys={[
                "supplierName",
                "tin",
                "bin",
                "taxCategory",
                "method",
                "mushak66",
                "note",
                "voucherId",
              ]}
              columns={[
                { key: "voucherId", label: "Voucher" },
                { key: "dateLabel", label: "Date" },
                { key: "supplierName", label: "Supplier" },
                { key: "tin", label: "TIN" },
                { key: "bin", label: "BIN" },
                { key: "taxCategory", label: "Tax cat." },
                { key: "method", label: "Method" },
                { key: "grossLabel", label: "Gross" },
                { key: "vdsRateLabel", label: "VDS %" },
                { key: "vdsLabel", label: "VDS" },
                { key: "netLabel", label: "Net paid" },
                { key: "mushak66", label: "Mushak 6.6" },
                {
                  key: "mushak66pdf",
                  label: "6.6 PDF",
                  render: (_, row) =>
                    row.mushak66Eligible ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => downloadWithholdingMushak66Pdf(row.voucherId)}
                      >
                        PDF
                      </button>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    ),
                },
                { key: "note", label: "Note", render: (v) => <span title={v}>{v}</span> },
              ]}
            />
          </div>
        </div>
      ) : withholdingRegistersPreviewError ? (
        <div className="page-card" style={{ marginBottom: "12px" }}>
          <h4 style={{ marginTop: 0 }}>Withholding registers</h4>
          <p style={{ color: "#b42318", marginTop: 0, fontSize: 13 }}>{withholdingRegistersPreviewError}</p>
          <button type="button" className="btn-secondary btn-sm" onClick={previewWithholdingRegisters}>
            Retry preview
          </button>
        </div>
      ) : null}

      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Cashiers Tracked: {Number(shrinkageControl.totals?.totalCashiers || 0)}</div>
        <div className="stat">Sales in Scope: {bdt(shrinkageControl.totals?.totalSales)}</div>
        <div className="stat">Discount Exposure: {bdt(shrinkageControl.totals?.totalDiscount)}</div>
        <div className="stat">Return Exposure: {bdt(shrinkageControl.totals?.totalReturns)}</div>
        <div className="stat">Override Actions: {Number(shrinkageControl.totals?.totalOverrides || 0)}</div>
      </div>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Staff Tracked: {Number(staffKpi.summary?.staffCount || 0)}</div>
        <div className="stat">Staff Sales: {bdt(staffKpi.summary?.totalSales)}</div>
        <div className="stat">Invoices: {Number(staffKpi.summary?.totalInvoices || 0)}</div>
      </div>
      <p className="text-muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
        {tt("repShrinkageByCategoryHelp")}
      </p>
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">{tt("repShrinkageCategories")}: {Number(shrinkageByCategory.summary?.categoryCount || 0)}</div>
        <div className="stat">{tt("repShrinkageUnits")}: {Number(shrinkageByCategory.summary?.unitsWrittenOff || 0).toFixed(2)}</div>
        <div className="stat">{tt("repShrinkageEstCost")}: {bdt(shrinkageByCategory.summary?.estimatedCost || 0)}</div>
      </div>
      <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            exportCSV(
              `/reports/shrinkage-by-category/export.csv${marginReportQuerySuffix}`,
              "shrinkage-by-category.csv"
            )
          }
        >
          {tt("repExportShrinkageCategoryCsv")}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            exportCSV(
              `/reports/shrinkage-by-category/export.pdf${marginReportQuerySuffix}`,
              "shrinkage-by-category.pdf"
            )
          }
        >
          {tt("repExportShrinkageCategoryPdf")}
        </button>
      </div>
      <DataTable
        title={tt("repShrinkageByCategoryTitle")}
        rows={(shrinkageByCategory.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["category", "department"]}
        columns={[
          { key: "rowNo", label: tt("colId") },
          { key: "category", label: tt("repColCategory") },
          {
            key: "department",
            label: tt("repColDepartment"),
            render: (v) => {
              const dept = RETAIL_DEPARTMENTS.find((d) => d.id === String(v || "").toUpperCase());
              return dept ? tt(dept.labelKey) : v || "—";
            },
          },
          { key: "adjustmentCount", label: tt("repShrinkageAdjCount") },
          { key: "unitsWrittenOff", label: tt("repColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
          { key: "estimatedCost", label: tt("repShrinkageEstCost"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
        ]}
      />
            <div className="page-card" style={{ marginBottom: "12px" }}>
        <strong>Shrinkage Risk Guide:</strong>{" "}
        High discount events are flagged at {bdt0(shrinkageThresholds.discountAlertMin)}+, high
        return events at {bdt0(shrinkageThresholds.returnAlertMin)}+, and timeline risk becomes
        critical at {bdt0(shrinkageThresholds.criticalAmount)}+.
        <br />
        <small>
          Risk score is based on discount count, price overrides, return count, discount %, and return % relative to
          gross sales.
        </small>
      </div>
      {vatSummary.note ? (
        <div className="page-card" style={{ marginBottom: "12px" }}>
          <strong>VAT Note:</strong> {vatSummary.note}
        </div>
      ) : null}
      <DataTable
        title="VAT Sales Register"
        rows={vatSalesRegister.map((row) => ({
          ...row,
          taxableAmountLabel: `৳${Number(row.taxableAmount || 0).toFixed(2)}`,
          vatAmountLabel: `৳${Number(row.vatAmount || 0).toFixed(2)}`,
          grossAmountLabel: `৳${Number(row.grossAmount || 0).toFixed(2)}`,
        }))}
        searchableKeys={["invoiceNo", "date", "customer", "customerPhone", "saleId"]}
        columns={[
          { key: "serial", label: "SL" },
          { key: "saleId", label: "Sale ID" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "customerPhone", label: "Phone" },
          { key: "taxableAmountLabel", label: "Taxable Amount" },
          { key: "vatAmountLabel", label: "Output VAT" },
          { key: "grossAmountLabel", label: "Gross Amount" },
          {
            key: "mushak63",
            label: "Mushak 6.3",
            render: (_, row) => {
              const sid = row.saleId;
              const anyBusy = mushak63BusyId !== null;
              const rowBusy = mushak63BusyId === sid;
              return (
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={anyBusy}
                    title="Open in Sale lookup"
                    onClick={() => openSaleLookupDeepLink(row.invoiceNo, row.saleId)}
                  >
                    Lookup
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={anyBusy}
                    title="Run NBR completeness check"
                    onClick={async () => {
                      setMushak63BusyId(sid);
                      try {
                        await runMushak63CompletenessCheck(sid);
                      } catch (err) {
                        notifyError(err.response?.data?.error || "Completeness check failed");
                      } finally {
                        setMushak63BusyId(null);
                      }
                    }}
                  >
                    {rowBusy ? "…" : "Check"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={anyBusy}
                    title="Download Mushak 6.3 XML"
                    onClick={async () => {
                      setMushak63BusyId(sid);
                      try {
                        await downloadMushak63XmlWithCompletenessHint(sid);
                      } catch (err) {
                        notifyError(err.response?.data?.error || "Unable to download Mushak 6.3 XML");
                      } finally {
                        setMushak63BusyId(null);
                      }
                    }}
                  >
                    {rowBusy ? "…" : "XML"}
                  </button>
                </span>
              );
            },
          },
        ]}
      />
      <DataTable
        title="Loyalty Redemption & Tier Discount History"
        rows={(loyaltyRedemptions.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          createdAtLabel: new Date(row.createdAt).toLocaleString(),
        }))}
        searchableKeys={["invoiceNo", "customerName", "customerPhone", "tier", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "customerName", label: "Customer" },
          { key: "customerPhone", label: "Phone" },
          { key: "tier", label: "Tier" },
          { key: "redeemedPoints", label: "Redeemed Points" },
          { key: "redeemedAmount", label: "Redeemed Amount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "tierDiscountAmount", label: "Tier Discount", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "createdAtLabel", label: "Date" },
        ]}
      />
        </div>
      ) : null}
      {reportsTab === "risk" ? (
        <div className="pos-tab-panel">
      <DataTable
        title="Shrinkage Risk Summary (By Cashier)"
        rows={(shrinkageControl.summaryRows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          grossSalesLabel: `৳${Number(row.grossSales || 0).toFixed(2)}`,
          discountAmountLabel: `৳${Number(row.discountAmount || 0).toFixed(2)}`,
          returnAmountLabel: `৳${Number(row.returnAmount || 0).toFixed(2)}`,
          discountRateLabel: `${Number(row.discountRate || 0).toFixed(2)}%`,
          returnRateLabel: `${Number(row.returnRate || 0).toFixed(2)}%`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["userName"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "userName", label: "Cashier/User" },
          { key: "saleCount", label: "Sales" },
          { key: "grossSalesLabel", label: "Gross Sales" },
          { key: "discountCount", label: "Discount Txn" },
          { key: "discountAmountLabel", label: "Discount Amount" },
          { key: "priceOverrideCount", label: "Price Overrides" },
          { key: "returnCount", label: "Returns" },
          { key: "returnAmountLabel", label: "Return Amount" },
          { key: "discountRateLabel", label: "Discount %" },
          { key: "returnRateLabel", label: "Return %" },
          { key: "riskScore", label: "Risk Score" },
          {
            key: "riskBand",
            label: "Risk Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {tt(v?.labelKey || "repRiskLow")}
              </span>
            ),
          },
        ]}
      />
      <DataTable
        title="Suspicious Event Timeline (Recent)"
        rows={(shrinkageControl.eventRows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          createdAtLabel: row.createdAt ? new Date(row.createdAt).toLocaleString() : "-",
          amountLabel: `৳${Number(row.amount || 0).toFixed(2)}`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["type", "userName", "ref", "note", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "createdAtLabel", label: "Date/Time" },
          { key: "type", label: "Event" },
          { key: "userName", label: "Cashier/User" },
          { key: "ref", label: "Reference" },
          { key: "amountLabel", label: "Amount" },
          { key: "riskScore", label: "Risk" },
          {
            key: "riskBand",
            label: "Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {tt(v?.labelKey || "repRiskLow")}
              </span>
            ),
          },
          { key: "note", label: "Note", render: (v) => v || "-" },
        ]}
      />
      <DataTable
        title="Staff Performance Scorecard"
        rows={(staffKpi.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          grossSalesLabel: `৳${Number(row.grossSales || 0).toFixed(2)}`,
          avgBillLabel: `৳${Number(row.avgBill || 0).toFixed(2)}`,
          discountRateLabel: `${Number(row.discountRate || 0).toFixed(2)}%`,
          returnRateLabel: `${Number(row.returnRate || 0).toFixed(2)}%`,
          riskBand: getRiskBand(row.riskScore),
        }))}
        searchableKeys={["userName"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "userName", label: "Staff" },
          { key: "invoiceCount", label: "Invoices" },
          { key: "grossSalesLabel", label: "Gross Sales" },
          { key: "avgBillLabel", label: "Avg Bill" },
          { key: "returnCount", label: "Returns" },
          { key: "overrideCount", label: "Overrides" },
          { key: "discountRateLabel", label: "Discount %" },
          { key: "returnRateLabel", label: "Return %" },
          { key: "riskScore", label: "Risk" },
          {
            key: "riskBand",
            label: "Band",
            render: (v) => (
              <span
                style={{
                  color: v?.color || "#111827",
                  background: v?.bg || "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-block",
                }}
              >
                {tt(v?.labelKey || "repRiskLow")}
              </span>
            ),
          },
        ]}
      />
      <DataTable
        title="Audit Activity Trail (Recent)"
        rows={(auditActivity.rows || []).map((row, idx) => {
          const payloadPreview =
            row.payload == null
              ? "-"
              : (() => {
                  try {
                    const json = JSON.stringify(row.payload);
                    return json.length > 120 ? `${json.slice(0, 120)}...` : json;
                  } catch {
                    return String(row.payload || "-");
                  }
                })();
          return {
            rowNo: idx + 1,
            ...row,
            createdAtLabel: row.createdAt ? new Date(row.createdAt).toLocaleString() : "-",
            entityRef: row.entityId != null ? `${row.entity}#${row.entityId}` : row.entity,
            actor: row.userRole && row.userRole !== "-" ? `${row.userName} (${row.userRole})` : row.userName,
            payloadPreview,
          };
        })}
        searchableKeys={["action", "entityRef", "actor", "payloadPreview", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "createdAtLabel", label: "Date/Time" },
          { key: "action", label: "Action" },
          { key: "entityRef", label: "Entity" },
          { key: "actor", label: "Actor" },
          { key: "payloadPreview", label: "Payload (Preview)" },
        ]}
      />
        </div>
      ) : null}
      {reportsTab === "finance" ? (
        <div className="pos-tab-panel">
      <DataTable
        title="Customer Due Aging"
        rows={aging.customers.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name", "phone"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "balance", label: "Due", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <DataTable
        title="Supplier Payable Aging"
        rows={aging.suppliers.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name", "phone"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "payableBalance", label: "Payable", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
      <div className="quick-stats" style={{ marginBottom: "12px" }}>
        <div className="stat">Cheque Journals: {Number(chequeLedger.summary?.journalCount || 0)}</div>
        <div className="stat">Total Debit: {bdt(chequeLedger.summary?.totalDebit)}</div>
        <div className="stat">Total Credit: {bdt(chequeLedger.summary?.totalCredit)}</div>
      </div>
      <div className="form-grid" style={{ marginBottom: "12px" }}>
        <SearchSelect
          className="form-select-sm"
          value={chequeLedgerFilter.direction}
          onChange={(val) => setChequeLedgerFilter((prev) => ({ ...prev, direction: val }))}
          placeholder="All Directions"
          options={[
            { value: "RECEIVED", label: "RECEIVED" },
            { value: "ISSUED", label: "ISSUED" },
          ]}
        />
        <SearchSelect
          className="form-select-sm"
          value={chequeLedgerFilter.status}
          onChange={(val) => setChequeLedgerFilter((prev) => ({ ...prev, status: val }))}
          placeholder="All Status"
          options={[
            { value: "CLEARED", label: "CLEARED" },
            { value: "BOUNCED", label: "BOUNCED" },
            { value: "DEPOSITED", label: "DEPOSITED" },
            { value: "PENDING", label: "PENDING" },
            { value: "CANCELLED", label: "CANCELLED" },
          ]}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setChequeLedgerFilter({ direction: "", status: "", onlyMismatched: false })}
        >
          Reset Cheque Filters
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(chequeLedgerFilter.onlyMismatched)}
            onChange={(e) =>
              setChequeLedgerFilter((prev) => ({
                ...prev,
                onlyMismatched: e.target.checked,
              }))
            }
          />
          Only mismatched journals (debit != credit)
          {Number(chequeLedger.summary?.mismatchedJournalCount || 0) > 0 ? (
            <span
              style={{
                background: "#fee2e2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                borderRadius: 999,
                padding: "1px 8px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {Number(chequeLedger.summary?.mismatchedJournalCount || 0)} mismatch
              {Number(chequeLedger.summary?.mismatchedJournalCount || 0) > 1 ? "es" : ""}
            </span>
          ) : null}
        </label>
      </div>
      <DataTable
        title="Cheque Ledger (Accounting Entries)"
        rows={(chequeLedger.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          journalDateLabel: row.journalDate ? new Date(row.journalDate).toLocaleString() : "-",
          chequeAmountLabel: `৳${Number(row.chequeAmount || 0).toFixed(2)}`,
          debitLabel: `৳${Number(row.debit || 0).toFixed(2)}`,
          creditLabel: `৳${Number(row.credit || 0).toFixed(2)}`,
        }))}
        searchableKeys={["entryType", "chequeNo", "bankName", "direction", "status", "accountCode", "accountName", "partyName", "narration"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "journalDateLabel", label: "Date/Time" },
          { key: "entryType", label: "Entry" },
          { key: "chequeNo", label: "Cheque" },
          { key: "bankName", label: "Bank" },
          { key: "direction", label: "Direction" },
          { key: "status", label: "Status" },
          { key: "chequeAmountLabel", label: "Cheque Amount" },
          { key: "accountCode", label: "A/C Code" },
          { key: "accountName", label: "A/C Name" },
          { key: "debitLabel", label: "Debit" },
          { key: "creditLabel", label: "Credit" },
          { key: "partyName", label: "Drawer/Payee" },
          { key: "narration", label: "Narration" },
        ]}
      />
      <h4 style={{ marginTop: "12px" }}>Stock Valuation</h4>
      <div className="form-grid" style={{ marginBottom: "8px" }}>
        <input
          type="date"
          value={stockValuationFilter.asOf}
          onChange={(e) => setStockValuationFilter((prev) => ({ ...prev, asOf: e.target.value }))}
        />
        <input
          placeholder="Filter category"
          value={stockValuationFilter.category}
          onChange={(e) => setStockValuationFilter((prev) => ({ ...prev, category: e.target.value }))}
        />
        <SearchSelect
          className="form-select-sm"
          kind="warehouses"
          value={stockValuationFilter.warehouseId}
          onChange={(val) => setStockValuationFilter((prev) => ({ ...prev, warehouseId: val }))}
          placeholder="All Warehouses"
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setStockValuationFilter({ asOf: "", category: "", warehouseId: "" })}
        >
          Reset Valuation Filters
        </button>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={focusWorstMarginImpact}
          onChange={(e) => setFocusWorstMarginImpact(e.target.checked)}
        />
        {tt("repFocusWorstMarginImpact")}
      </label>
      {selectedImpactProductId ? (
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedImpactProductId(null)}>
            {tt("repClearImpactFilter")}
          </button>
        </div>
      ) : null}
      <div className="page-card" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{tt("repTopWorstMarginImpactTitle")}</div>
        {topWorstValuationImpactRows.length ? (
          <div className="quick-stats">
            {topWorstValuationImpactRows.map((row) => (
              <button
                key={`rep-worst-impact-${row.productId}-${row.name}`}
                type="button"
                className="stat-chip"
                onClick={() => setSelectedImpactProductId(Number(row.productId))}
                title={tt("repClickToFilter")}
              >
                {row.name} · {Number(row.marginImpactPct || 0).toFixed(2)}%
              </button>
            ))}
          </div>
        ) : (
          <div className="text-muted">{tt("repTopWorstMarginImpactEmpty")}</div>
        )}
      </div>
      <div>Total Value: ৳{Number(stockValuation.totalValue || 0).toFixed(2)}</div>
      <DataTable
        rows={filteredStockValuationRows.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Product" },
          { key: "saleUnit", label: tt("prodLblUom"), render: (v) => (v ? tt(SALE_UNIT_LABEL_KEYS[v] || v) : "—") },
          {
            key: "stockDisplay",
            label: tt("prodLblStock"),
            render: (v, row) => v || row.stock,
          },
          { key: "unitCost", label: "Unit Cost", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "sellingPrice", label: tt("prodLblSellingPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "profitMargin", label: tt("prodLblProfitMargin"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
          {
            key: "marginImpactPct",
            label: tt("prodLblLandedVsBaseMarginImpact"),
            render: (_, row) => {
              const base = Number(row?.baseMarginPct || 0);
              const landed = Number(row?.landedMarginPct || 0);
              const impact = Number(row?.marginImpactPct || 0);
              const sign = impact > 0 ? "+" : "";
              return `${base.toFixed(2)}% -> ${landed.toFixed(2)}% (${sign}${impact.toFixed(2)}%)`;
            },
          },
          { key: "valuation", label: "Valuation", render: (v) => `৳${Number(v).toFixed(2)}` },
        ]}
      />
        </div>
      ) : null}
      {reportsTab === "margin" ? (
        <div className="pos-tab-panel">
          <div className="form-grid" style={{ marginBottom: "12px" }}>
            <input
              type="number"
              min="0"
              step="0.1"
              value={marginThresholdPct}
              onChange={(e) => setMarginThresholdPct(Number(e.target.value || 0))}
              placeholder={tt("repPhMarginThreshold")}
            />
            <button type="button" className="btn-secondary" onClick={() => exportAdvancedMargin("csv")}>
              {tt("repBtnMarginCsv")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => exportAdvancedMargin("pdf")}>
              {tt("repBtnMarginPdf")}
            </button>
          </div>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repMarginSkuCount")}: {Number(advancedMargin.summary?.skuCount || 0)}</div>
            <div className="stat">{tt("repMarginSoldSkuCount")}: {Number(advancedMargin.summary?.soldSkuCount || 0)}</div>
            <div className="stat">{tt("repMarginAlerts")}: {Number(advancedMargin.summary?.erosionAlertCount || 0)}</div>
            <div className="stat">{tt("repMarginRevenue")}: {bdt(advancedMargin.summary?.totalRevenue || 0)}</div>
            <div className="stat">{tt("repMarginLandedCogs")}: {bdt(advancedMargin.summary?.totalLandedCogs || 0)}</div>
            <div className="stat">{tt("repMarginGrossProfit")}: {bdt(advancedMargin.summary?.totalGrossProfit || 0)}</div>
          </div>
          <div className="page-card" style={{ marginBottom: "12px" }}>
            <h4 style={{ marginTop: 0 }}>{tt("repMarginTrendTitle")}</h4>
            <div style={{ display: "grid", gap: 6 }}>
              {(advancedMarginTrend.rows || []).map((row) => {
                const value = Number(row.marginImpactPct || 0);
                const widthPct = Math.max(4, (Math.abs(value) / marginTrendMax) * 100);
                return (
                  <div key={row.monthKey} style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 12 }}>{row.monthKey}</div>
                    <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999 }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${widthPct}%`,
                          borderRadius: 999,
                          background: value < 0 ? "#dc2626" : "#16a34a",
                        }}
                      />
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12 }}>{value.toFixed(2)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
            {tt("repCategorySalesHelp")}
          </p>
          <div style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                exportCSV(
                  `/reports/category-sales/export.csv${marginReportQuerySuffix}`,
                  "category-sales.csv"
                )
              }
            >
              {tt("repExportCategoryCsv")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                exportCSV(
                  `/reports/department-sales/export.csv${marginReportQuerySuffix}`,
                  "department-sales.csv"
                )
              }
            >
              {tt("repExportDepartmentCsv")}
            </button>
          </div>
          <DataTable
            title={tt("repCategorySalesTitle")}
            rows={(categorySales.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "category", label: tt("repColCategory") },
              { key: "soldQty", label: tt("repColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "revenue", label: tt("repMarginRevenue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "cogs", label: tt("repColCogs"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "grossProfit", label: tt("repColGrossProfit"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "marginPct", label: tt("repColMarginPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repDepartmentSalesHelp")}
          </p>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repDeptCount")}: {Number(departmentSales.summary?.departmentCount || 0)}</div>
            <div className="stat">{tt("repMarginRevenue")}: {bdt(departmentSales.summary?.totalRevenue || 0)}</div>
            <div className="stat">{tt("repColCogs")}: {bdt(departmentSales.summary?.totalCogs || 0)}</div>
            <div className="stat">{tt("repColGrossProfit")}: {bdt(departmentSales.summary?.totalGrossProfit || 0)}</div>
          </div>
          <DataTable
            title={tt("repDepartmentSalesTitle")}
            rows={(departmentSales.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["department"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              {
                key: "department",
                label: tt("repColDepartment"),
                render: (v) => {
                  const dept = RETAIL_DEPARTMENTS.find((d) => d.id === String(v || "").toUpperCase());
                  return dept ? tt(dept.labelKey) : v || "—";
                },
              },
              { key: "soldQty", label: tt("repColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "revenue", label: tt("repMarginRevenue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "cogs", label: tt("repColCogs"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "grossProfit", label: tt("repColGrossProfit"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "marginPct", label: tt("repColMarginPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repHourlyCategoryHelp")}
          </p>
          <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const q = new URLSearchParams(marginReportQuerySuffix.replace(/^\?/, ""));
                if (hourlyCategoryFilter && hourlyCategoryFilter !== "ALL") {
                  q.set("category", hourlyCategoryFilter);
                }
                const suffix = q.toString() ? `?${q.toString()}` : "";
                exportCSV(`/reports/hourly-category-sales/export.csv${suffix}`, "hourly-category-sales.csv");
              }}
            >
              {tt("repExportHourlyCsv")}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              className={`pos-dept-chip${hourlyCategoryFilter === "ALL" ? " active" : ""}`}
              onClick={() => setHourlyCategoryFilter("ALL")}
            >
              {tt("repHourlyAllAisles")}
            </button>
            {GROCERY_CATEGORY_CHIPS.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`pos-dept-chip${hourlyCategoryFilter === cat.id ? " active" : ""}`}
                onClick={() => setHourlyCategoryFilter(cat.id)}
              >
                {tt(cat.labelKey)}
              </button>
            ))}
          </div>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repHourlyPeakHour")}: {hourlyCategorySales.summary?.peakHourLabel || "—"}</div>
            <div className="stat">{tt("repMarginRevenue")}: {bdt(hourlyCategorySales.summary?.totalRevenue || 0)}</div>
          </div>
          <div className="page-card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>{tt("repHourlyCategoryTitle")}</h4>
            <div style={{ display: "grid", gap: 6 }}>
              {(hourlyCategorySales.hourTotals || []).map((row) => {
                const maxRev = Math.max(
                  1,
                  ...(hourlyCategorySales.hourTotals || []).map((h) => Number(h.revenue || 0))
                );
                const widthPct = Math.max(2, (Number(row.revenue || 0) / maxRev) * 100);
                return (
                  <div
                    key={row.hour}
                    style={{ display: "grid", gridTemplateColumns: "52px 1fr 88px", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ fontSize: 12 }}>{row.hourLabel}</div>
                    <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999 }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${widthPct}%`,
                          borderRadius: 999,
                          background: "var(--primary, #2563eb)",
                        }}
                      />
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12 }}>{bdt(row.revenue)}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <DataTable
            title={tt("repHourlyCategoryDetailTitle")}
            rows={(hourlyCategorySales.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["category", "hourLabel"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "hourLabel", label: tt("repHourlyColHour") },
              { key: "category", label: tt("repColCategory") },
              { key: "soldQty", label: tt("repColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "revenue", label: tt("repMarginRevenue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repBasketAnalysisHelp")}
          </p>
          <div className="quick-stats" style={{ marginBottom: 10 }}>
            <div className="stat">{tt("repBasketSales")}: {Number(basketAnalysis.summary?.saleCount || 0)}</div>
            <div className="stat">{tt("repBasketMultiItem")}: {Number(basketAnalysis.summary?.multiItemSaleCount || 0)}</div>
            <div className="stat">{tt("repBasketPairs")}: {Number(basketAnalysis.summary?.pairCount || 0)}</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <button
              type="button"
              className={`pos-dept-chip${basketMode === "product" ? " active" : ""}`}
              onClick={() => setBasketMode("product")}
            >
              {tt("repBasketModeProduct")}
            </button>
            <button
              type="button"
              className={`pos-dept-chip${basketMode === "category" ? " active" : ""}`}
              onClick={() => setBasketMode("category")}
            >
              {tt("repBasketModeCategory")}
            </button>
            <label style={{ fontSize: 13 }}>
              {tt("repBasketMinCount")}{" "}
              <input
                type="number"
                min={2}
                max={100}
                value={basketMinCount}
                onChange={(e) => setBasketMinCount(Number(e.target.value) || 3)}
                style={{ width: 56, marginLeft: 6 }}
              />
            </label>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const q = new URLSearchParams(marginReportQuerySuffix.replace(/^\?/, ""));
                q.set("mode", basketMode === "category" ? "category" : "product");
                q.set("minCount", String(basketMinCount || 3));
                const s = q.toString();
                exportCSV(`/reports/basket-analysis/export.csv${s ? `?${s}` : ""}`, "basket-analysis.csv");
              }}
            >
              {tt("repExportBasketCsv")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const q = new URLSearchParams(marginReportQuerySuffix.replace(/^\?/, ""));
                q.set("mode", basketMode === "category" ? "category" : "product");
                q.set("minCount", String(basketMinCount || 3));
                const s = q.toString();
                exportCSV(`/reports/basket-analysis/export.pdf${s ? `?${s}` : ""}`, "basket-analysis.pdf");
              }}
            >
              {tt("repExportBasketPdf")}
            </button>
          </div>
          <DataTable
            title={tt("repBasketAnalysisTitle")}
            rows={(basketAnalysis.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["itemA", "itemB", "skuA", "skuB", "categoryA", "categoryB"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "itemA", label: tt("repBasketItemA") },
              ...(basketMode === "product"
                ? [
                    { key: "skuA", label: tt("prodLblSku"), render: (v) => v || "—" },
                    { key: "categoryA", label: tt("repColCategory"), render: (v) => v || "—" },
                  ]
                : []),
              { key: "itemB", label: tt("repBasketItemB") },
              ...(basketMode === "product"
                ? [
                    { key: "skuB", label: tt("repBasketSkuB"), render: (v) => v || "—" },
                    { key: "categoryB", label: tt("repBasketCatB"), render: (v) => v || "—" },
                  ]
                : []),
              { key: "pairCount", label: tt("repBasketTogether") },
              {
                key: "supportPct",
                label: tt("repBasketSupport"),
                render: (v) => `${Number(v || 0).toFixed(1)}%`,
              },
              {
                key: "confidenceAPct",
                label: tt("repBasketConfA"),
                render: (v) => `${Number(v || 0).toFixed(1)}%`,
              },
              {
                key: "confidenceBPct",
                label: tt("repBasketConfB"),
                render: (v) => `${Number(v || 0).toFixed(1)}%`,
              },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repSlowMoversHelp")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>
              {tt("repSlowMoversDays")}{" "}
              <input
                type="number"
                min={7}
                max={365}
                value={slowMoverDays}
                onChange={(e) => setSlowMoverDays(Number(e.target.value) || 60)}
                style={{ width: 72, marginLeft: 6 }}
              />
            </label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSlowMoverCategory("ALL")}>
              {tt("repHourlyAllAisles")}
            </button>
            {GROCERY_CATEGORY_CHIPS.map((cat) => (
              <button
                key={`slow-${cat.id}`}
                type="button"
                className={`pos-dept-chip${slowMoverCategory === cat.id ? " active" : ""}`}
                onClick={() => setSlowMoverCategory(cat.id)}
              >
                {tt(cat.labelKey)}
              </button>
            ))}
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const q = new URLSearchParams(marginReportQuerySuffix.replace(/^\?/, ""));
                q.set("days", String(slowMoverDays || 60));
                if (slowMoverCategory && slowMoverCategory !== "ALL") q.set("category", slowMoverCategory);
                const suffix = q.toString() ? `?${q.toString()}` : "";
                exportCSV(`/reports/slow-movers/export.csv${suffix}`, "slow-movers.csv");
              }}
            >
              {tt("repExportSlowMoversCsv")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const q = new URLSearchParams(marginReportQuerySuffix.replace(/^\?/, ""));
                q.set("days", String(slowMoverDays || 60));
                if (slowMoverCategory && slowMoverCategory !== "ALL") q.set("category", slowMoverCategory);
                const suffix = q.toString() ? `?${q.toString()}` : "";
                exportCSV(`/reports/slow-movers/export.pdf${suffix}`, "slow-movers.pdf");
              }}
            >
              {tt("repExportSlowMoversPdf")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                const entries = (slowMovers.rows || []).map((row) => ({
                  productId: row.productId,
                  qty: 1,
                }));
                if (!entries.length) {
                  notifyError(tt("repSlowMoversQueueEmpty"));
                  return;
                }
                mergeIntoLabelQueue(entries);
                navigateToLabelQueue({
                  aisle: slowMoverCategory !== "ALL" ? slowMoverCategory : "",
                });
              }}
            >
              {tt("repQueueSlowMoversLabels")}
            </button>
          </div>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repSlowMoverCount")}: {Number(slowMovers.summary?.slowMoverCount || 0)}</div>
            <div className="stat">{tt("repSlowMoverStockValue")}: {bdt(slowMovers.summary?.stockValueAtRisk || 0)}</div>
          </div>
          <DataTable
            title={tt("repSlowMoversTitle")}
            rows={(slowMovers.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["name", "sku", "category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "name", label: tt("colName") },
              { key: "sku", label: "SKU" },
              { key: "category", label: tt("repColCategory") },
              { key: "stockUnits", label: tt("repColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "stockValue", label: tt("repSlowMoverStockValue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repLoyaltyByCategoryHelp")}
          </p>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repLoyaltyCategories")}: {Number(loyaltyByCategory.summary?.categoryCount || 0)}</div>
            <div className="stat">{tt("repLoyaltyTotalPoints")}: {Number(loyaltyByCategory.summary?.totalPoints || 0)}</div>
            <div className="stat">{tt("repLoyaltyBonusPoints")}: {Number(loyaltyByCategory.summary?.bonusPoints || 0)}</div>
          </div>
          <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                exportCSV(
                  `/reports/loyalty-by-category/export.csv${marginReportQuerySuffix}`,
                  "loyalty-by-category.csv"
                )
              }
            >
              {tt("repExportLoyaltyCategoryCsv")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                exportCSV(
                  `/reports/loyalty-by-category/export.pdf${marginReportQuerySuffix}`,
                  "loyalty-by-category.pdf"
                )
              }
            >
              {tt("repExportLoyaltyCategoryPdf")}
            </button>
          </div>
          <DataTable
            title={tt("repLoyaltyByCategoryTitle")}
            rows={(loyaltyByCategory.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "category", label: tt("repColCategory") },
              { key: "revenue", label: tt("repMarginRevenue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "multiplier", label: tt("repLoyaltyMultiplier"), render: (v) => `${Number(v || 1).toFixed(1)}×` },
              { key: "totalPoints", label: tt("repLoyaltyTotalPoints") },
              { key: "bonusPoints", label: tt("repLoyaltyBonusPoints") },
            ]}
          />
          <p className="text-muted" style={{ margin: "16px 0 8px", fontSize: 13 }}>
            {tt("repPromotionRoiHelp")}
          </p>
          <div className="quick-stats" style={{ marginBottom: "12px" }}>
            <div className="stat">{tt("repPromoSalesWithOffer")}: {Number(promotionRoi.summary?.salesWithPromo || 0)}</div>
            <div className="stat">{tt("repPromoTotalDiscount")}: {bdt(promotionRoi.summary?.totalDiscount || 0)}</div>
          </div>
          <DataTable
            title={tt("repPromotionRoiTitle")}
            rows={(promotionRoi.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["name", "type", "category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "name", label: tt("promoColName") },
              { key: "type", label: tt("promoColType") },
              { key: "category", label: tt("repColCategory"), render: (v) => v || "—" },
              { key: "redemptionCount", label: tt("repPromoRedemptions") },
              { key: "discountTotal", label: tt("repPromoDiscountTotal"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
            ]}
          />
          <div className="page-card" style={{ marginBottom: "12px" }}>
            <h4 style={{ marginTop: 0 }}>{tt("repMarginErosionTitle")}</h4>
            <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
              {tt("repMarginErosionHelp")}
            </p>
            <div className="quick-stats" style={{ marginBottom: 10 }}>
              <div className="stat">{tt("repMarginErosionBelowTarget")}: {Number(categoryMarginErosion.summary?.belowTargetCount || 0)}</div>
              <div className="stat">{tt("repMarginErosionAlerts")}: {Number(categoryMarginErosion.summary?.alertCount || 0)}</div>
              <div className="stat">{tt("repMarginErosionWorstGap")}: {Number(categoryMarginErosion.summary?.worstGapPct || 0).toFixed(1)}%</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <button
                type="button"
                className={`btn-secondary btn-sm ${marginErosionFilterOnly ? "pos-tab-active" : ""}`}
                onClick={() => setMarginErosionFilterOnly((v) => !v)}
              >
                {marginErosionFilterOnly ? tt("repMarginErosionShowAll") : tt("repMarginErosionFilterOnly")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => exportCategoryMarginErosion("csv")}>
                {tt("repBtnMarginErosionCsv")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => exportCategoryMarginErosion("pdf")}>
                {tt("repBtnMarginErosionPdf")}
              </button>
            </div>
            <DataTable
              title=""
              rows={categoryMarginErosionRows.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
              searchableKeys={["category", "department"]}
              allowExport={false}
              columns={[
                { key: "rowNo", label: tt("colId") },
                { key: "category", label: tt("prodLblCategory") },
                {
                  key: "department",
                  label: tt("repColDepartment"),
                  render: (v) => {
                    const dept = RETAIL_DEPARTMENTS.find((d) => d.id === v);
                    return dept ? tt(dept.labelKey) : v || "—";
                  },
                },
                { key: "soldQty", label: tt("invColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
                { key: "realizedMarginPct", label: tt("repMarginRealizedPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
                { key: "minMarginPct", label: tt("repMarginMinTarget"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
                {
                  key: "gapPct",
                  label: tt("repMarginGapPct"),
                  render: (v) => (
                    <span style={{ color: Number(v || 0) < 0 ? "#b91c1c" : "#166534", fontWeight: 600 }}>
                      {Number(v || 0).toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: "belowTarget",
                  label: tt("repMarginBelowTarget"),
                  render: (v) =>
                    v ? (
                      <span className="badge badge-danger">{tt("repMarginAlertYes")}</span>
                    ) : (
                      <span className="badge badge-success">{tt("repMarginAlertNo")}</span>
                    ),
                },
                {
                  key: "costErosion",
                  label: tt("repMarginCostErosion"),
                  render: (v) =>
                    v ? (
                      <span className="badge badge-danger">{tt("repMarginAlertYes")}</span>
                    ) : (
                      <span className="badge badge-success">{tt("repMarginAlertNo")}</span>
                    ),
                },
              ]}
            />
          </div>
          <DataTable
            title={tt("repMarginCategoryTitle")}
            rows={(advancedMargin.categoryRows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "category", label: tt("prodLblCategory") },
              { key: "soldQty", label: tt("invColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "revenue", label: tt("repMarginRevenue"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "landedCogs", label: tt("repMarginLandedCogs"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "realizedGrossProfit", label: tt("repMarginGrossProfit"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "marginImpactPct", label: tt("repMarginImpactPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
              { key: "realizedMarginPct", label: tt("repMarginRealizedPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
            ]}
          />
          <DataTable
            title={tt("repMarginProductTitle")}
            rows={(advancedMargin.rows || []).map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["name", "sku", "category"]}
            columns={[
              { key: "rowNo", label: tt("colId") },
              { key: "name", label: tt("invColProduct") },
              { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
              { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
              { key: "soldQty", label: tt("invColSoldQty"), render: (v) => Number(v || 0).toFixed(2) },
              { key: "avgSellingPrice", label: tt("repMarginAvgSell"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              { key: "baseUnitCost", label: tt("repMarginBaseCost"), render: (v) => `৳${Number(v || 0).toFixed(4)}` },
              { key: "landedUnitCost", label: tt("repMarginLandedCost"), render: (v) => `৳${Number(v || 0).toFixed(4)}` },
              { key: "marginImpactPct", label: tt("repMarginImpactPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
              { key: "realizedMarginPct", label: tt("repMarginRealizedPct"), render: (v) => `${Number(v || 0).toFixed(2)}%` },
              {
                key: "erosionAlert",
                label: tt("repMarginAlert"),
                render: (v) => (v ? <span className="badge badge-danger">{tt("repMarginAlertYes")}</span> : <span className="badge badge-success">{tt("repMarginAlertNo")}</span>),
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export default Reports;
