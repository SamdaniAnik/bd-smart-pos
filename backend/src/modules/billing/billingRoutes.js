const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  getPlans,
  getSubscription,
  upgradeSubscription,
  checkoutSubscription,
  completeSubscription,
} = require("./billingController");

const router = express.Router();

router.get("/plans", requireAuth, getPlans);
router.get("/subscription", requireAuth, requirePermission("branch.manage"), getSubscription);
router.post("/subscription/checkout", requireAuth, requirePermission("branch.manage"), checkoutSubscription);
router.post("/subscription/complete", requireAuth, requirePermission("branch.manage"), completeSubscription);
router.post("/subscription/upgrade", requireAuth, requirePermission("branch.manage"), upgradeSubscription);

module.exports = router;
