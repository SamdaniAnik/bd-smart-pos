const express = require("express");
const { validate, lookup, list, intake, updateStatus } = require("./imeiController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/validate", requireAuth, requirePermission("sale.create"), validate);
router.get("/lookup", requireAuth, requirePermission("product.view"), lookup);
router.get("/", requireAuth, requirePermission("product.view"), list);
router.post("/intake", requireAuth, requirePermission("inventory.adjust"), intake);
router.post("/:id/status", requireAuth, requirePermission("inventory.adjust"), updateStatus);

module.exports = router;
