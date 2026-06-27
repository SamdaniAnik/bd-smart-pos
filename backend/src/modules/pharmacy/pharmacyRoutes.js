const express = require("express");
const {
  listPrescriptions,
  getPrescription,
  createPrescription,
  updatePrescription,
  cancelPrescription,
  getPrescriptionPosCart,
} = require("./pharmacyController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("pharmacy.view"), listPrescriptions);
router.post("/", requireAuth, requirePermission("pharmacy.manage"), createPrescription);
router.get("/:id/pos-cart", requireAuth, requirePermission("pharmacy.dispense"), getPrescriptionPosCart);
router.get("/:id", requireAuth, requirePermission("pharmacy.view"), getPrescription);
router.put("/:id", requireAuth, requirePermission("pharmacy.manage"), updatePrescription);
router.post("/:id/cancel", requireAuth, requirePermission("pharmacy.manage"), cancelPrescription);

module.exports = router;
