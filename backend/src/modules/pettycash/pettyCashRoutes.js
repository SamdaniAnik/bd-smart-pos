const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listFunds,
  createFund,
  updateFund,
  listTransactions,
  postTransaction,
  listClaims,
  createClaim,
  approveClaim,
  rejectClaim,
} = require("./pettyCashController");

const router = express.Router();

router.get("/funds", requireAuth, requirePermission("pettycash.view"), listFunds);
router.post("/funds", requireAuth, requirePermission("pettycash.manage"), createFund);
router.patch("/funds/:id", requireAuth, requirePermission("pettycash.manage"), updateFund);
router.get("/transactions", requireAuth, requirePermission("pettycash.view"), listTransactions);
router.post("/transactions", requireAuth, requirePermission("pettycash.manage"), postTransaction);
router.get("/claims", requireAuth, requirePermission("pettycash.view"), listClaims);
router.post("/claims", requireAuth, requirePermission("pettycash.manage"), createClaim);
router.post("/claims/:id/approve", requireAuth, requirePermission("pettycash.manage"), approveClaim);
router.post("/claims/:id/reject", requireAuth, requirePermission("pettycash.manage"), rejectClaim);

module.exports = router;
