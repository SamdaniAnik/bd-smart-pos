const express = require("express");
const {
  getApprovals,
  reviewApproval,
  exportApprovalsCSV,
  exportApprovalsPDF,
  exportApprovalsXLSX,
} = require("./approvalController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("report.view"), getApprovals);
router.put("/:id/review", requireAuth, requirePermission("report.view"), reviewApproval);
router.get("/export.csv", requireAuth, requirePermission("report.view"), exportApprovalsCSV);
router.get("/export.pdf", requireAuth, requirePermission("report.view"), exportApprovalsPDF);
router.get("/export.xlsx", requireAuth, requirePermission("report.view"), exportApprovalsXLSX);

module.exports = router;
