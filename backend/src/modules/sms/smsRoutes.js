const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  handleDeliveryReport,
  listDeliveryLogs,
  listTemplates,
  upsertTemplate,
  deleteTemplate,
} = require("./smsController");

const router = express.Router();

// Public provider DLR webhook (no auth — matched by provider message id).
router.get("/dlr", handleDeliveryReport);
router.post("/dlr", handleDeliveryReport);

router.get("/logs", requireAuth, requirePermission("report.view"), listDeliveryLogs);
router.get("/templates", requireAuth, requirePermission("branch.manage"), listTemplates);
router.post("/templates", requireAuth, requirePermission("branch.manage"), upsertTemplate);
router.delete("/templates/:id", requireAuth, requirePermission("branch.manage"), deleteTemplate);

module.exports = router;
