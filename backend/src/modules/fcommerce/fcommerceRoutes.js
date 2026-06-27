const express = require("express");
const { requireAuth, requirePermission, requireAnyPermission } = require("../../middleware/auth");
const {
  getConfig,
  updateConfig,
  getMonitor,
  verifyMetaWebhook,
  handleMetaWebhook,
} = require("./fcommerceController");

const router = express.Router();

router.get("/meta/webhook", verifyMetaWebhook);
router.post("/meta/webhook", handleMetaWebhook);

router.get("/config", requireAuth, requireAnyPermission(["fcommerce.view", "branch.manage"]), getConfig);
router.put("/config", requireAuth, requireAnyPermission(["fcommerce.manage", "branch.manage"]), updateConfig);
router.get("/monitor", requireAuth, requireAnyPermission(["fcommerce.view", "branch.manage"]), getMonitor);

module.exports = router;
