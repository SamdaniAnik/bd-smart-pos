const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  exportWebhookDeliveriesCsv,
  replayWebhookDelivery,
} = require("./webhookIntegrationController");

const router = express.Router();

router.get("/deliveries/export.csv", requireAuth, requirePermission("rbac.manage"), exportWebhookDeliveriesCsv);
router.post("/deliveries/:deliveryId/replay", requireAuth, requirePermission("rbac.manage"), replayWebhookDelivery);
router.get("/deliveries", requireAuth, requirePermission("rbac.manage"), listWebhookDeliveries);
router.get("/", requireAuth, requirePermission("rbac.manage"), listWebhooks);
router.post("/", requireAuth, requirePermission("rbac.manage"), createWebhook);
router.put("/:id", requireAuth, requirePermission("rbac.manage"), updateWebhook);
router.delete("/:id", requireAuth, requirePermission("rbac.manage"), deleteWebhook);

module.exports = router;
