const express = require("express");
const {
  getConfig,
  updateConfig,
  listItems,
  getProductMarkdown,
} = require("./expiryMarkdownController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/config", requireAuth, requirePermission("inventory.view"), getConfig);
router.put("/config", requireAuth, requirePermission("branch.manage"), updateConfig);
router.get("/items", requireAuth, requirePermission("inventory.view"), listItems);
router.get("/product/:productId", requireAuth, requirePermission("sale.create"), getProductMarkdown);

module.exports = router;
