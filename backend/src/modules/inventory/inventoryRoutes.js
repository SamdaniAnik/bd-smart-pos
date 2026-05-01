const express = require("express");
const {
  getStockLedger,
  adjustStock,
  transferStock,
  getStockTransfers,
  getLowStockAlerts,
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
} = require("./inventoryController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/ledger", requireAuth, requirePermission("inventory.view"), getStockLedger);
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
router.get("/transfers", requireAuth, requirePermission("inventory.view"), getStockTransfers);
router.get("/transfers/branch-products/:branchId", requireAuth, requirePermission("inventory.transfer"), getTransferBranchProducts);
router.get("/alerts/low-stock", requireAuth, requirePermission("inventory.view"), getLowStockAlerts);

module.exports = router;
