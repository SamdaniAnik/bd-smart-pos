const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  getSaleMushak63Xml,
  getSaleMushak63CompletenessReport,
  exportMushak91Xml,
  getMushak91Summary,
} = require("./nbrController");

const router = express.Router();

// Per-sale Mushak 6.3 endpoints (mounted under /api/sales/:id/...)
router.get(
  "/sales/:id/mushak63.xml",
  requireAuth,
  requirePermission("sale.view"),
  getSaleMushak63Xml
);
router.get(
  "/sales/:id/mushak63/completeness",
  requireAuth,
  requirePermission("sale.view"),
  getSaleMushak63CompletenessReport
);

// Period Mushak 9.1 endpoints (mounted under /api/reports/...)
router.get(
  "/reports/mushak91.xml",
  requireAuth,
  requirePermission("report.view"),
  exportMushak91Xml
);
router.get(
  "/reports/mushak91/summary",
  requireAuth,
  requirePermission("report.view"),
  getMushak91Summary
);

module.exports = router;
