const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listCostCenters,
  createCostCenter,
  updateCostCenter,
  getCostCenterSummary,
  listCostCenterBudgets,
  upsertCostCenterBudget,
  getCostCenterBudgetVsActual,
} = require("./costCenterController");

const router = express.Router();

router.get("/", requireAuth, requirePermission("costcenter.view"), listCostCenters);
router.post("/", requireAuth, requirePermission("costcenter.manage"), createCostCenter);
router.patch("/:id", requireAuth, requirePermission("costcenter.manage"), updateCostCenter);
router.get("/summary/report", requireAuth, requirePermission("costcenter.view"), getCostCenterSummary);
router.get("/budgets", requireAuth, requirePermission("costcenter.view"), listCostCenterBudgets);
router.post("/budgets", requireAuth, requirePermission("costcenter.manage"), upsertCostCenterBudget);
router.get("/budget-vs-actual", requireAuth, requirePermission("costcenter.view"), getCostCenterBudgetVsActual);

module.exports = router;
