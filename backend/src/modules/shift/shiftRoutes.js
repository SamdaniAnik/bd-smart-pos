const express = require("express");
const {
  openShift,
  getCurrentShift,
  closeShift,
  getShiftHistory,
} = require("./shiftController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/current", requireAuth, requirePermission("sale.view"), getCurrentShift);
router.get("/history", requireAuth, requirePermission("sale.view"), getShiftHistory);
router.post("/open", requireAuth, requirePermission("sale.create"), openShift);
router.post("/close", requireAuth, requirePermission("sale.create"), closeShift);

module.exports = router;
