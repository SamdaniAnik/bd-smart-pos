const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listShipments,
  createCourierShipment,
  collectShipmentCod,
  listPendingCodSales,
  syncShipment,
  syncAllShipments,
  printShipmentLabel,
  estimateShipmentCost,
  getCostingDefaults,
} = require("./courierController");

const router = express.Router();

router.get("/costing-defaults", requireAuth, requirePermission("sale.view"), getCostingDefaults);
router.post("/estimate-cost", requireAuth, requirePermission("sale.view"), estimateShipmentCost);
router.get("/shipments", requireAuth, requirePermission("sale.view"), listShipments);
router.post("/shipments", requireAuth, requirePermission("sale.create"), createCourierShipment);
router.post("/shipments/sync-all", requireAuth, requirePermission("sale.create"), syncAllShipments);
router.post("/shipments/:id/collect-cod", requireAuth, requirePermission("sale.create"), collectShipmentCod);
router.post("/shipments/:id/sync", requireAuth, requirePermission("sale.create"), syncShipment);
router.get("/shipments/:id/label", requireAuth, requirePermission("sale.view"), printShipmentLabel);
router.get("/cod/pending", requireAuth, requirePermission("sale.view"), listPendingCodSales);

module.exports = router;
