const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const { listClaims, createClaim, updateClaimStatus } = require("./warrantyController");

const router = express.Router();

router.get("/claims", requireAuth, requirePermission("customer.view"), listClaims);
router.post("/claims", requireAuth, requirePermission("customer.create"), createClaim);
router.patch("/claims/:id/status", requireAuth, requirePermission("customer.create"), updateClaimStatus);

module.exports = router;
