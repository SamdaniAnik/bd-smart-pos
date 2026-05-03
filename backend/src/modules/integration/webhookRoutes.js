const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} = require("./webhookIntegrationController");

const router = express.Router();

router.get("/", requireAuth, requirePermission("rbac.manage"), listWebhooks);
router.post("/", requireAuth, requirePermission("rbac.manage"), createWebhook);
router.put("/:id", requireAuth, requirePermission("rbac.manage"), updateWebhook);
router.delete("/:id", requireAuth, requirePermission("rbac.manage"), deleteWebhook);

module.exports = router;
