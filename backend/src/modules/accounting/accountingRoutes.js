const express = require("express");
const {
  getAccounts,
  createJournal,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getFiscalPeriods,
  createFiscalPeriod,
  closeFiscalPeriod,
  reopenFiscalPeriod,
  closeCurrentMonthFiscalPeriod,
} = require("./accountingController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/accounts", requireAuth, requirePermission("accounting.view"), getAccounts);
router.post("/journals", requireAuth, requirePermission("accounting.journal.create"), createJournal);
router.get("/reports/trial-balance", requireAuth, requirePermission("accounting.report"), getTrialBalance);
router.get("/reports/profit-loss", requireAuth, requirePermission("accounting.report"), getProfitAndLoss);
router.get("/reports/balance-sheet", requireAuth, requirePermission("accounting.report"), getBalanceSheet);
router.get("/fiscal-periods", requireAuth, requirePermission("accounting.report"), getFiscalPeriods);
router.post("/fiscal-periods", requireAuth, requirePermission("branch.manage"), createFiscalPeriod);
router.post("/fiscal-periods/:id/close", requireAuth, requirePermission("branch.manage"), closeFiscalPeriod);
router.post("/fiscal-periods/:id/reopen", requireAuth, requirePermission("branch.manage"), reopenFiscalPeriod);
router.post("/fiscal-periods/close-current-month", requireAuth, requirePermission("branch.manage"), closeCurrentMonthFiscalPeriod);

module.exports = router;
