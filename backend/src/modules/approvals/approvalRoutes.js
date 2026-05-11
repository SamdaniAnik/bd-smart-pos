const express = require("express");
const {
  getApprovals,
  reviewApproval,
  escalateApproval,
  exportApprovalsCSV,
  exportApprovalsPDF,
  exportApprovalsXLSX,
  getOverrideAuthorityDashboard,
  getOverrideExceptionReport,
} = require("./approvalController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("report.view"), getApprovals);
router.put("/:id/review", requireAuth, requirePermission("report.view"), reviewApproval);
router.post("/:id/escalate", requireAuth, requirePermission("report.view"), escalateApproval);
router.get("/export.csv", requireAuth, requirePermission("report.view"), exportApprovalsCSV);
router.get("/export.pdf", requireAuth, requirePermission("report.view"), exportApprovalsPDF);
router.get("/export.xlsx", requireAuth, requirePermission("report.view"), exportApprovalsXLSX);
router.get("/override-authority", requireAuth, requirePermission("report.view"), getOverrideAuthorityDashboard);
router.get("/override-exceptions", requireAuth, requirePermission("report.view"), getOverrideExceptionReport);

module.exports = router;
