const express = require("express");
const {
  createWarehouse,
  getWarehouses,
  getWarehouseDetails,
  updateWarehouse,
  deleteWarehouse,
} = require("./warehouseController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("inventory.view"), getWarehouses);
router.post("/", requireAuth, requirePermission("inventory.adjust"), createWarehouse);
router.get("/:id", requireAuth, requirePermission("inventory.view"), getWarehouseDetails);
router.put("/:id", requireAuth, requirePermission("inventory.adjust"), updateWarehouse);
router.delete("/:id", requireAuth, requirePermission("inventory.adjust"), deleteWarehouse);

module.exports = router;
