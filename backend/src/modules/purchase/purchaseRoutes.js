const express = require("express");
const {
  createPurchase,
  getPurchases,
  getPurchaseDetails,
  createPurchaseReturn,
  getPurchaseReturns,
  exportPurchaseReturnsCSV,
  exportPurchaseReturnsPDF,
  getPurchaseOptimization,
  getPurchasePlanSuggestion,
  exportPurchasePlanCSV,
  exportPurchasePlanPDF,
  createSplitPurchasesFromPlan,
  submitPurchasePlanApproval,
  getPurchasePlanApprovals,
  approvePurchasePlanApproval,
  rejectPurchasePlanApproval,
  getSupplierScorecards,
  receivePurchaseInStages,
  exportPurchaseGrnHistoryCSV,
  exportPurchaseGrnHistoryPDF,
} = require("./purchaseController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("purchase.view"), getPurchases);
router.get("/optimization", requireAuth, requirePermission("purchase.view"), getPurchaseOptimization);
router.get("/supplier-scorecards", requireAuth, requirePermission("purchase.view"), getSupplierScorecards);
router.get("/plan-suggestion", requireAuth, requirePermission("purchase.view"), getPurchasePlanSuggestion);
router.get("/plan-suggestion/export.csv", requireAuth, requirePermission("purchase.view"), exportPurchasePlanCSV);
router.get("/plan-suggestion/export.pdf", requireAuth, requirePermission("purchase.view"), exportPurchasePlanPDF);
router.post("/plan-suggestion/create-split", requireAuth, requirePermission("purchase.create"), createSplitPurchasesFromPlan);
router.post("/plan-approvals", requireAuth, requirePermission("purchase.create"), submitPurchasePlanApproval);
router.get("/plan-approvals", requireAuth, requirePermission("purchase.view"), getPurchasePlanApprovals);
router.post("/plan-approvals/:id/approve", requireAuth, requirePermission("purchase.create"), approvePurchasePlanApproval);
router.post("/plan-approvals/:id/reject", requireAuth, requirePermission("purchase.create"), rejectPurchasePlanApproval);
router.get("/:id", requireAuth, requirePermission("purchase.view"), getPurchaseDetails);
router.get("/returns", requireAuth, requirePermission("purchase.view"), getPurchaseReturns);
router.get("/returns/export.csv", requireAuth, requirePermission("purchase.view"), exportPurchaseReturnsCSV);
router.get("/returns/export.pdf", requireAuth, requirePermission("purchase.view"), exportPurchaseReturnsPDF);
router.post("/", requireAuth, requirePermission("purchase.create"), createPurchase);
router.post("/:id/receive", requireAuth, requirePermission("purchase.create"), receivePurchaseInStages);
router.get("/:id/grn-history/export.csv", requireAuth, requirePermission("purchase.view"), exportPurchaseGrnHistoryCSV);
router.get("/:id/grn-history/export.pdf", requireAuth, requirePermission("purchase.view"), exportPurchaseGrnHistoryPDF);
router.post("/:id/return", requireAuth, requirePermission("purchase.return"), createPurchaseReturn);

module.exports = router;
