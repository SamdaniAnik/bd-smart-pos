const express = require("express");
const {
  listPendingOrders,
  createPendingOrder,
  createInboundOrder,
  cancelPendingOrder,
  getPendingOrderPosCart,
} = require("./orderInboxController");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const { storefrontAuth } = require("../../middleware/storefrontAuth");

const router = express.Router();

router.post("/inbound", storefrontAuth, createInboundOrder);
router.get("/", requireAuth, requirePermission("sale.view"), listPendingOrders);
router.post("/", requireAuth, requirePermission("sale.create"), createPendingOrder);
router.get("/:id/pos-cart", requireAuth, requirePermission("sale.create"), getPendingOrderPosCart);
router.post("/:id/cancel", requireAuth, requirePermission("sale.create"), cancelPendingOrder);

module.exports = router;
