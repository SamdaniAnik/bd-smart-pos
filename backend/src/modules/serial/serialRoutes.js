const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const { lookupSerial, checkSerialAvailable } = require("./serialController");

const router = express.Router();

router.get("/lookup", requireAuth, requirePermission("sale.view"), lookupSerial);
router.get("/available", requireAuth, requirePermission("sale.create"), checkSerialAvailable);

module.exports = router;
