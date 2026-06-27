const express = require("express");
const {
  listPlans,
  getPlan,
  createPlan,
  recordPayment,
  cancelPlan,
  listDueInstallments,
  sendReminders,
} = require("./installmentController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("customer.view"), listPlans);
router.get("/due", requireAuth, requirePermission("customer.view"), listDueInstallments);
router.get("/:id", requireAuth, requirePermission("customer.view"), getPlan);
router.post("/", requireAuth, requirePermission("customer.create"), createPlan);
router.post("/:id/pay", requireAuth, requirePermission("customer.create"), recordPayment);
router.post("/:id/cancel", requireAuth, requirePermission("customer.create"), cancelPlan);
router.post("/reminders", requireAuth, requirePermission("customer.create"), sendReminders);

module.exports = router;
