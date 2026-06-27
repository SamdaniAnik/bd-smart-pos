const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  initiateMfsPayment,
  verifyMfsPayment,
  refundMfsPayment,
  queryMfsPayment,
  getMfsPaymentStatus,
  mfsCallback,
} = require("./mfsPaymentController");

const router = express.Router();

// Public provider callbacks (no auth — identified by providerPaymentId).
router.get("/mfs/callback/:provider", mfsCallback);
router.post("/mfs/callback/:provider", mfsCallback);

router.post("/mfs/initiate", requireAuth, requirePermission("sale.create"), initiateMfsPayment);
router.post("/mfs/verify", requireAuth, requirePermission("sale.create"), verifyMfsPayment);
router.post("/mfs/:id/refund", requireAuth, requirePermission("sale.return"), refundMfsPayment);
router.get("/mfs/:id/query", requireAuth, requirePermission("sale.view"), queryMfsPayment);
router.get("/mfs/:id", requireAuth, requirePermission("sale.view"), getMfsPaymentStatus);

module.exports = router;
