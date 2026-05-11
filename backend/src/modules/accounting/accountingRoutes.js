const express = require("express");
const {
  getAccounts,
  createJournal,
  getTrialBalance,
  getProfitAndLoss,
  exportProfitAndLossCSV,
  exportProfitAndLossPDF,
  getCashFlowStatement,
  exportCashFlowCSV,
  exportCashFlowPDF,
  getCashFlowTrend,
  getBalanceSheet,
  getFiscalPeriods,
  createFiscalPeriod,
  closeFiscalPeriod,
  reopenFiscalPeriod,
  closeCurrentMonthFiscalPeriod,
  getFiscalPeriodCloseChecklist,
} = require("./accountingController");
const { requireAuth, requirePermission, requireAnyPermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/accounts", requireAuth, requirePermission("accounting.view"), getAccounts);
router.post("/journals", requireAuth, requirePermission("accounting.journal.create"), createJournal);
router.get("/reports/trial-balance", requireAuth, requirePermission("accounting.report"), getTrialBalance);
router.get("/reports/profit-loss", requireAuth, requirePermission("accounting.report"), getProfitAndLoss);
router.get("/reports/profit-loss/export.csv", requireAuth, requirePermission("accounting.report"), exportProfitAndLossCSV);
router.get("/reports/profit-loss/export.pdf", requireAuth, requirePermission("accounting.report"), exportProfitAndLossPDF);
router.get("/reports/cash-flow", requireAuth, requirePermission("accounting.report"), getCashFlowStatement);
router.get("/reports/cash-flow/export.csv", requireAuth, requirePermission("accounting.report"), exportCashFlowCSV);
router.get("/reports/cash-flow/export.pdf", requireAuth, requirePermission("accounting.report"), exportCashFlowPDF);
router.get("/reports/cash-flow/trend", requireAuth, requirePermission("accounting.report"), getCashFlowTrend);
router.get("/reports/balance-sheet", requireAuth, requirePermission("accounting.report"), getBalanceSheet);
router.get("/fiscal-periods", requireAuth, requirePermission("accounting.report"), getFiscalPeriods);
router.post("/fiscal-periods", requireAuth, requireAnyPermission(["financial.lock.manage", "branch.manage"]), createFiscalPeriod);
router.post(
  "/fiscal-periods/:id/close",
  requireAuth,
  requireAnyPermission(["financial.lock.manage", "branch.manage"]),
  closeFiscalPeriod
);
router.post(
  "/fiscal-periods/:id/reopen",
  requireAuth,
  requireAnyPermission(["financial.lock.manage", "branch.manage"]),
  reopenFiscalPeriod
);
router.post(
  "/fiscal-periods/close-current-month",
  requireAuth,
  requireAnyPermission(["financial.lock.manage", "branch.manage"]),
  closeCurrentMonthFiscalPeriod
);
router.get(
  "/fiscal-periods/:id/close-checklist",
  requireAuth,
  requireAnyPermission(["financial.lock.manage", "branch.manage", "accounting.report"]),
  getFiscalPeriodCloseChecklist
);

module.exports = router;
