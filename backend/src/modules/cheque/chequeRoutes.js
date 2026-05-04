const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listCheques,
  summary,
  getCheque,
  createCheque,
  updateCheque,
  depositCheque,
  clearCheque,
  bounceCheque,
  cancelCheque,
} = require("./chequeController");

const router = express.Router();

router.get("/summary", requireAuth, requirePermission("cheque.view"), summary);
router.get("/", requireAuth, requirePermission("cheque.view"), listCheques);
router.get("/:id", requireAuth, requirePermission("cheque.view"), getCheque);
router.post("/", requireAuth, requirePermission("cheque.manage"), createCheque);
router.patch("/:id", requireAuth, requirePermission("cheque.manage"), updateCheque);
router.post("/:id/deposit", requireAuth, requirePermission("cheque.manage"), depositCheque);
router.post("/:id/clear", requireAuth, requirePermission("cheque.clear"), clearCheque);
router.post("/:id/bounce", requireAuth, requirePermission("cheque.clear"), bounceCheque);
router.post("/:id/cancel", requireAuth, requirePermission("cheque.manage"), cancelCheque);

module.exports = router;
