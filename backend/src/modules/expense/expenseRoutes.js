const express = require("express");
const {
  createExpense,
  getExpenses,
  getExpenseDetails,
  updateExpense,
  deleteExpense,
} = require("./expenseController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("expense.view"), getExpenses);
router.post("/", requireAuth, requirePermission("expense.create"), createExpense);
router.get("/:id", requireAuth, requirePermission("expense.view"), getExpenseDetails);
router.put("/:id", requireAuth, requirePermission("expense.create"), updateExpense);
router.delete("/:id", requireAuth, requirePermission("expense.create"), deleteExpense);

module.exports = router;
