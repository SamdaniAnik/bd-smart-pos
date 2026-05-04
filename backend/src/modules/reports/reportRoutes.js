const express = require("express");
const {
  getDashboard,
  getDashboardTrends,
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
} = require("./reportController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/dashboard", requireAuth, requirePermission("report.view"), getDashboard);
router.get("/dashboard/trends", requireAuth, requirePermission("report.view"), getDashboardTrends);
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

module.exports = router;
