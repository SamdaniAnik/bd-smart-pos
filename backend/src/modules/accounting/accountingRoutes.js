const express = require("express");
const {
  getAccounts,
  createJournal,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
} = require("./accountingController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/accounts", requireAuth, requirePermission("accounting.view"), getAccounts);
router.post("/journals", requireAuth, requirePermission("accounting.journal.create"), createJournal);
router.get("/reports/trial-balance", requireAuth, requirePermission("accounting.report"), getTrialBalance);
router.get("/reports/profit-loss", requireAuth, requirePermission("accounting.report"), getProfitAndLoss);
router.get("/reports/balance-sheet", requireAuth, requirePermission("accounting.report"), getBalanceSheet);

module.exports = router;
