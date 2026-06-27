const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  retrySaleEfd,
  getEfdStatus,
  listEfdPendingSales,
  previewMushak91,
  submitMushak91,
  runEfdRetrySweep,
} = require("./efdController");

const router = express.Router();

router.get("/pending-sales", requireAuth, requirePermission("report.view"), listEfdPendingSales);
router.post("/retry-sweep", requireAuth, requirePermission("branch.manage"), runEfdRetrySweep);
router.get("/mushak91/preview", requireAuth, requirePermission("report.view"), previewMushak91);
router.post("/mushak91/submit", requireAuth, requirePermission("branch.manage"), submitMushak91);
router.get("/sales/:saleId", requireAuth, requirePermission("sale.view"), getEfdStatus);
router.post("/sales/:saleId/submit", requireAuth, requirePermission("sale.create"), retrySaleEfd);

module.exports = router;
