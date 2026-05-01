const express = require("express");
const {
  getDashboard,
  getAging,
  getStockValuation,
  exportStockValuationCSV,
  exportAgingCSV,
  exportStockValuationPDF,
  exportAgingPDF,
} = require("./reportController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/dashboard", requireAuth, requirePermission("report.view"), getDashboard);
router.get("/aging", requireAuth, requirePermission("report.view"), getAging);
router.get("/stock-valuation", requireAuth, requirePermission("report.view"), getStockValuation);
router.get("/aging/export.csv", requireAuth, requirePermission("report.view"), exportAgingCSV);
router.get("/stock-valuation/export.csv", requireAuth, requirePermission("report.view"), exportStockValuationCSV);
router.get("/aging/export.pdf", requireAuth, requirePermission("report.view"), exportAgingPDF);
router.get("/stock-valuation/export.pdf", requireAuth, requirePermission("report.view"), exportStockValuationPDF);

module.exports = router;
