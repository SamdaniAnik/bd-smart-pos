const express = require("express");
const {
  getDashboard,
  getDashboardTrends,
  getDashboardInsights,
  getVatSummary,
  getVatSalesRegister,
  exportVatSalesRegisterCSV,
  exportVatSalesRegisterPDF,
  getAging,
  getStockValuation,
  exportStockValuationCSV,
  exportAgingCSV,
  exportStockValuationPDF,
  exportAgingPDF,
  getShrinkageControlReport,
  exportShrinkageControlCSV,
  exportShrinkageControlPDF,
  getStaffPerformanceScorecard,
  getAuditActivityTrail,
  getChequeLedger,
  exportChequeLedgerCSV,
  exportChequeLedgerPDF,
  getHqBranchSummary,
  getHqBranchCompare,
  exportHqBranchCompareCSV,
  getAdvancedMarginAnalytics,
  exportAdvancedMarginAnalyticsCSV,
  exportAdvancedMarginAnalyticsPDF,
  getAdvancedMarginTrend,
  getTaxRiskDashboard,
  exportTaxRiskDashboardCSV,
  exportTaxRiskDashboardPDF,
  getTaxFilingPrevalidation,
  getCategorySalesReport,
  exportCategorySalesCSV,
  getDepartmentSalesReport,
  exportDepartmentSalesCSV,
  getPromotionRoiReport,
  getHourlyCategorySalesReport,
  exportHourlyCategorySalesCSV,
  getShrinkageByCategoryReport,
  exportShrinkageByCategoryCSV,
  exportShrinkageByCategoryPDF,
  getSlowMoversReport,
  exportSlowMoversCSV,
  exportSlowMoversPDF,
  getBasketAnalysisReport,
  exportBasketAnalysisCSV,
  exportBasketAnalysisPDF,
  getLoyaltyByCategoryReport,
  exportLoyaltyByCategoryCSV,
  exportLoyaltyByCategoryPDF,
  getCategoryMarginErosionReport,
  exportCategoryMarginErosionCSV,
  exportCategoryMarginErosionPDF,
  getOwnerDigestPreview,
  sendOwnerDigest,
  runOwnerDigestCron,
} = require("./reportController");
const { requireAuth, requirePermission, requireAnyPermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/owner-digest/preview", requireAuth, requirePermission("branch.manage"), getOwnerDigestPreview);
router.post("/owner-digest/send", requireAuth, requirePermission("branch.manage"), sendOwnerDigest);
router.post("/owner-digest/cron", runOwnerDigestCron);

router.get("/hq-branch-summary", requireAuth, requireAnyPermission(["rbac.manage", "branch.manage"]), getHqBranchSummary);
router.get("/hq-branch-compare", requireAuth, requireAnyPermission(["rbac.manage", "branch.manage"]), getHqBranchCompare);
router.get("/hq-branch-compare/export.csv", requireAuth, requireAnyPermission(["rbac.manage", "branch.manage"]), exportHqBranchCompareCSV);

router.get("/dashboard", requireAuth, requirePermission("report.view"), getDashboard);
router.get("/dashboard/trends", requireAuth, requirePermission("report.view"), getDashboardTrends);
router.get("/dashboard/insights", requireAuth, getDashboardInsights);
router.get("/vat/summary", requireAuth, requirePermission("report.view"), getVatSummary);
router.get("/vat/sales-register", requireAuth, requirePermission("report.view"), getVatSalesRegister);
router.get("/vat/sales-register/export.csv", requireAuth, requirePermission("report.view"), exportVatSalesRegisterCSV);
router.get("/vat/sales-register/export.pdf", requireAuth, requirePermission("report.view"), exportVatSalesRegisterPDF);
router.get("/aging", requireAuth, requirePermission("report.view"), getAging);
router.get("/stock-valuation", requireAuth, requirePermission("report.view"), getStockValuation);
router.get("/aging/export.csv", requireAuth, requirePermission("report.view"), exportAgingCSV);
router.get("/stock-valuation/export.csv", requireAuth, requirePermission("report.view"), exportStockValuationCSV);
router.get("/aging/export.pdf", requireAuth, requirePermission("report.view"), exportAgingPDF);
router.get("/stock-valuation/export.pdf", requireAuth, requirePermission("report.view"), exportStockValuationPDF);
router.get("/shrinkage-control", requireAuth, requirePermission("report.view"), getShrinkageControlReport);
router.get("/shrinkage-control/export.csv", requireAuth, requirePermission("report.view"), exportShrinkageControlCSV);
router.get("/shrinkage-control/export.pdf", requireAuth, requirePermission("report.view"), exportShrinkageControlPDF);
router.get("/staff-kpi", requireAuth, requirePermission("report.view"), getStaffPerformanceScorecard);
router.get("/audit-activity", requireAuth, requirePermission("report.view"), getAuditActivityTrail);
router.get("/cheque-ledger", requireAuth, requirePermission("report.view"), getChequeLedger);
router.get("/cheque-ledger/export.csv", requireAuth, requirePermission("report.view"), exportChequeLedgerCSV);
router.get("/cheque-ledger/export.pdf", requireAuth, requirePermission("report.view"), exportChequeLedgerPDF);
router.get("/advanced-margin", requireAuth, requirePermission("report.view"), getAdvancedMarginAnalytics);
router.get("/advanced-margin/export.csv", requireAuth, requirePermission("report.view"), exportAdvancedMarginAnalyticsCSV);
router.get("/advanced-margin/export.pdf", requireAuth, requirePermission("report.view"), exportAdvancedMarginAnalyticsPDF);
router.get("/advanced-margin/trend", requireAuth, requirePermission("report.view"), getAdvancedMarginTrend);
router.get("/tax-risk", requireAuth, requirePermission("report.view"), getTaxRiskDashboard);
router.get("/tax-risk/export.csv", requireAuth, requirePermission("report.view"), exportTaxRiskDashboardCSV);
router.get("/tax-risk/export.pdf", requireAuth, requirePermission("report.view"), exportTaxRiskDashboardPDF);
router.get("/tax-filing/prevalidate", requireAuth, requirePermission("report.view"), getTaxFilingPrevalidation);
router.get("/category-sales", requireAuth, requirePermission("report.view"), getCategorySalesReport);
router.get("/category-sales/export.csv", requireAuth, requirePermission("report.view"), exportCategorySalesCSV);
router.get("/department-sales", requireAuth, requirePermission("report.view"), getDepartmentSalesReport);
router.get("/department-sales/export.csv", requireAuth, requirePermission("report.view"), exportDepartmentSalesCSV);
router.get("/promotion-roi", requireAuth, requirePermission("report.view"), getPromotionRoiReport);
router.get("/hourly-category-sales", requireAuth, requirePermission("report.view"), getHourlyCategorySalesReport);
router.get("/hourly-category-sales/export.csv", requireAuth, requirePermission("report.view"), exportHourlyCategorySalesCSV);
router.get("/shrinkage-by-category", requireAuth, requirePermission("report.view"), getShrinkageByCategoryReport);
router.get("/shrinkage-by-category/export.csv", requireAuth, requirePermission("report.view"), exportShrinkageByCategoryCSV);
router.get("/shrinkage-by-category/export.pdf", requireAuth, requirePermission("report.view"), exportShrinkageByCategoryPDF);
router.get("/slow-movers", requireAuth, requirePermission("report.view"), getSlowMoversReport);
router.get("/slow-movers/export.csv", requireAuth, requirePermission("report.view"), exportSlowMoversCSV);
router.get("/slow-movers/export.pdf", requireAuth, requirePermission("report.view"), exportSlowMoversPDF);
router.get("/basket-analysis", requireAuth, requirePermission("report.view"), getBasketAnalysisReport);
router.get("/basket-analysis/export.csv", requireAuth, requirePermission("report.view"), exportBasketAnalysisCSV);
router.get("/basket-analysis/export.pdf", requireAuth, requirePermission("report.view"), exportBasketAnalysisPDF);
router.get("/loyalty-by-category", requireAuth, requirePermission("report.view"), getLoyaltyByCategoryReport);
router.get("/loyalty-by-category/export.csv", requireAuth, requirePermission("report.view"), exportLoyaltyByCategoryCSV);
router.get("/loyalty-by-category/export.pdf", requireAuth, requirePermission("report.view"), exportLoyaltyByCategoryPDF);
router.get("/category-margin-erosion", requireAuth, requirePermission("report.view"), getCategoryMarginErosionReport);
router.get("/category-margin-erosion/export.csv", requireAuth, requirePermission("report.view"), exportCategoryMarginErosionCSV);
router.get("/category-margin-erosion/export.pdf", requireAuth, requirePermission("report.view"), exportCategoryMarginErosionPDF);

module.exports = router;
