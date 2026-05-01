const express = require("express");
const {
  createPurchase,
  getPurchases,
  getPurchaseDetails,
  createPurchaseReturn,
  getPurchaseReturns,
  exportPurchaseReturnsCSV,
  exportPurchaseReturnsPDF,
} = require("./purchaseController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("purchase.view"), getPurchases);
router.get("/:id", requireAuth, requirePermission("purchase.view"), getPurchaseDetails);
router.get("/returns", requireAuth, requirePermission("purchase.view"), getPurchaseReturns);
router.get("/returns/export.csv", requireAuth, requirePermission("purchase.view"), exportPurchaseReturnsCSV);
router.get("/returns/export.pdf", requireAuth, requirePermission("purchase.view"), exportPurchaseReturnsPDF);
router.post("/", requireAuth, requirePermission("purchase.create"), createPurchase);
router.post("/:id/return", requireAuth, requirePermission("purchase.return"), createPurchaseReturn);

module.exports = router;
