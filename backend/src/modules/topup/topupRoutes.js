const express = require("express");
const { requireAuth, requirePermission, requireAnyPermission } = require("../../middleware/auth");
const {
  createRecharge,
  createBillPay,
  billInquiry,
  reverseTransaction,
  listTransactions,
  summary,
  listBillers,
  loadFloat,
  exportCsv,
} = require("./topupController");

const router = express.Router();

const canView = requireAnyPermission(["topup.view", "topup.create"]);

router.get("/", requireAuth, canView, listTransactions);
router.get("/summary", requireAuth, canView, summary);
router.get("/billers", requireAuth, canView, listBillers);
router.get("/export.csv", requireAuth, canView, exportCsv);
router.post("/inquiry", requireAuth, requirePermission("topup.create"), billInquiry);
router.post("/recharge", requireAuth, requirePermission("topup.create"), createRecharge);
router.post("/bill-pay", requireAuth, requirePermission("topup.create"), createBillPay);
router.post("/:id/reverse", requireAuth, requirePermission("topup.manage"), reverseTransaction);
router.post("/float-load", requireAuth, requirePermission("topup.manage"), loadFloat);

module.exports = router;
