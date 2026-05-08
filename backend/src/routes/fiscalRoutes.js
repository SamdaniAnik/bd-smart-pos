const express = require("express");
const { getFiscalPeriodStatusToday } = require("../controllers/fiscalPeriodController");
const { requireAuth, requireAnyPermission } = require("../middleware/auth");

const router = express.Router();

/** Single endpoint replaces per-module duplicates so POS / dues / purchases / expenses stay aligned. */
router.get(
  "/fiscal-period-status",
  requireAuth,
  requireAnyPermission([
    "sale.create",
    "report.view",
    "customer.create",
    "supplier.create",
    "purchase.view",
    "purchase.create",
    "purchase.return",
    "expense.view",
    "expense.create",
  ]),
  getFiscalPeriodStatusToday
);

module.exports = router;
