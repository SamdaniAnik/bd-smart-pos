const express = require("express");
const {
  getStockLedger,
  adjustStock,
  transferStock,
  getStockTransfers,
  getLowStockAlerts,
  getInventoryIntelligence,
  getTransferBranchProducts,
  getStockAdjustments,
  updateStockAdjustment,
  deleteStockAdjustment,
  createStockCountSession,
  createStockCountSchedule,
  getStockCountSchedules,
  updateStockCountSchedule,
  deleteStockCountSchedule,
  toggleStockCountScheduleStatus,
  runStockCountScheduleNow,
  runStockCountSchedules,
  getStockCountSessions,
  getStockCountSessionDetails,
  updateStockCountSessionItems,
  recountStockCountSession,
  finalizeStockCountSession,
  exportStockCountSessionsCSV,
  exportStockCountSessionsPDF,
  exportStockCountSessionsXLSX,
  getInventoryBatches,
  createInventoryBatch,
  updateInventoryBatchQty,
  writeOffExpiredBatch,
  getInventoryBatchAlerts,
  getPosExpiryWarnings,
  getBatchTraceability,
  getTransferSuggestions,
  getReorderSuggestions,
  createExpiryMarkdownCampaign,
  approveStockTransfer,
  rejectStockTransfer,
  listInventoryAdjustReasons,
  createInventoryAdjustReason,
  updateInventoryAdjustReason,
} = require("./inventoryController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/ledger", requireAuth, requirePermission("inventory.view"), getStockLedger);
router.get("/adjust-reasons", requireAuth, requirePermission("inventory.view"), listInventoryAdjustReasons);
router.post("/adjust-reasons", requireAuth, requirePermission("inventory.adjust"), createInventoryAdjustReason);
router.patch("/adjust-reasons/:id", requireAuth, requirePermission("inventory.adjust"), updateInventoryAdjustReason);
router.post("/adjustments", requireAuth, requirePermission("inventory.adjust"), adjustStock);
router.get("/adjustments", requireAuth, requirePermission("inventory.view"), getStockAdjustments);
router.put("/adjustments/:id", requireAuth, requirePermission("inventory.adjust"), updateStockAdjustment);
router.delete("/adjustments/:id", requireAuth, requirePermission("inventory.adjust"), deleteStockAdjustment);
router.post("/stock-count/sessions", requireAuth, requirePermission("inventory.adjust"), createStockCountSession);
router.post("/stock-count/schedules", requireAuth, requirePermission("inventory.adjust"), createStockCountSchedule);
router.get("/stock-count/schedules", requireAuth, requirePermission("inventory.view"), getStockCountSchedules);
router.put("/stock-count/schedules/:id", requireAuth, requirePermission("inventory.adjust"), updateStockCountSchedule);
router.patch("/stock-count/schedules/:id/toggle", requireAuth, requirePermission("inventory.adjust"), toggleStockCountScheduleStatus);
router.post("/stock-count/schedules/:id/run", requireAuth, requirePermission("inventory.adjust"), runStockCountScheduleNow);
router.delete("/stock-count/schedules/:id", requireAuth, requirePermission("inventory.adjust"), deleteStockCountSchedule);
router.post("/stock-count/schedules/run", requireAuth, requirePermission("inventory.adjust"), runStockCountSchedules);
router.get("/stock-count/sessions", requireAuth, requirePermission("inventory.view"), getStockCountSessions);
router.get("/stock-count/sessions/export.csv", requireAuth, requirePermission("inventory.view"), exportStockCountSessionsCSV);
router.get("/stock-count/sessions/export.pdf", requireAuth, requirePermission("inventory.view"), exportStockCountSessionsPDF);
router.get("/stock-count/sessions/export.xlsx", requireAuth, requirePermission("inventory.view"), exportStockCountSessionsXLSX);
router.get("/stock-count/sessions/:id", requireAuth, requirePermission("inventory.view"), getStockCountSessionDetails);
router.put("/stock-count/sessions/:id/items", requireAuth, requirePermission("inventory.adjust"), updateStockCountSessionItems);
router.post("/stock-count/sessions/:id/recount", requireAuth, requirePermission("inventory.adjust"), recountStockCountSession);
router.post("/stock-count/sessions/:id/finalize", requireAuth, requirePermission("inventory.adjust"), finalizeStockCountSession);
router.post("/transfers", requireAuth, requirePermission("inventory.transfer"), transferStock);
router.post("/transfers/:id/approve", requireAuth, requirePermission("inventory.transfer"), approveStockTransfer);
router.post("/transfers/:id/reject", requireAuth, requirePermission("inventory.transfer"), rejectStockTransfer);
router.get("/transfers", requireAuth, requirePermission("inventory.view"), getStockTransfers);
router.get("/transfers/branch-products/:branchId", requireAuth, requirePermission("inventory.transfer"), getTransferBranchProducts);
router.get("/alerts/low-stock", requireAuth, requirePermission("inventory.view"), getLowStockAlerts);
router.get("/intelligence", requireAuth, requirePermission("inventory.view"), getInventoryIntelligence);
router.get("/batches", requireAuth, requirePermission("inventory.view"), getInventoryBatches);
router.post("/batches", requireAuth, requirePermission("inventory.adjust"), createInventoryBatch);
router.post("/batches/:id/qty", requireAuth, requirePermission("inventory.adjust"), updateInventoryBatchQty);
router.post("/batches/:id/spoilage", requireAuth, requirePermission("inventory.adjust"), writeOffExpiredBatch);
router.get("/batches/alerts", requireAuth, requirePermission("inventory.view"), getInventoryBatchAlerts);
router.get("/batches/pos-warnings", requireAuth, requirePermission("sale.create"), getPosExpiryWarnings);
router.get("/batches/traceability", requireAuth, requirePermission("inventory.view"), getBatchTraceability);
router.post("/batches/markdown-campaign", requireAuth, requirePermission("product.create"), createExpiryMarkdownCampaign);
router.get("/transfers/suggestions", requireAuth, requirePermission("inventory.view"), getTransferSuggestions);
router.get("/reorder-suggestions", requireAuth, requirePermission("inventory.view"), getReorderSuggestions);

module.exports = router;
