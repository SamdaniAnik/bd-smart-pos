const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

exports.createExpense = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { category, description, amount, paymentMethod, expenseDate } = req.body;
    const costCenterId =
      req.body?.costCenterId != null && req.body?.costCenterId !== "" ? Number(req.body.costCenterId) : null;
    const parsedAmount = Number(amount);
    const parsedDate = expenseDate ? new Date(expenseDate) : new Date();
    if (!category || String(category).trim().length < 2) {
      return res.status(400).json({ error: "Expense category is required" });
    }
    if (!(parsedAmount > 0)) {
      return res.status(400).json({ error: "Expense amount must be greater than zero" });
    }
    if (costCenterId != null && !Number.isFinite(costCenterId)) {
      return res.status(400).json({ error: "Invalid costCenterId" });
    }

    await ensureOpenFiscalPeriod(branchId, parsedDate);
    if (costCenterId != null) {
      const cc = await prisma.costCenter.findFirst({ where: { id: costCenterId, branchId } });
      if (!cc) return res.status(404).json({ error: "Cost center not found in this branch" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          category: String(category).trim(),
          description: description || null,
          amount: parsedAmount,
          paymentMethod: paymentMethod || "Cash",
          costCenterId: costCenterId || null,
          expenseDate: parsedDate,
        },
      });

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const expenseAcc = map.get("5200");
      const cashAcc = map.get("1100");
      if (!expenseAcc || !cashAcc) {
        throw new Error("Required accounts (5200/1100) are missing");
      }

      await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "EXPENSE",
          refId: expense.id,
          costCenterId: costCenterId || null,
          narration: `Expense: ${expense.category}`,
          lines: {
            create: [
              { accountId: expenseAcc.id, debit: parsedAmount, credit: 0 },
              { accountId: cashAcc.id, debit: 0, credit: parsedAmount },
            ],
          },
        },
      });

      return expense;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "EXPENSE_CREATE",
      entity: "Expense",
      entityId: created.id,
      payload: { amount: created.amount, category: created.category },
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { branchId: req.branchId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
      orderBy: { expenseDate: "desc" },
    });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getExpenseDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });
    const expense = await prisma.expense.findFirst({
      where: { id, branchId: req.branchId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
    });
    if (!expense) return res.status(404).json({ error: "Expense not found" });
    res.json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });
    const existing = await prisma.expense.findFirst({ where: { id, branchId: req.branchId } });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    const { category, description, amount, paymentMethod, expenseDate } = req.body;
    const costCenterId =
      req.body?.costCenterId != null && req.body?.costCenterId !== "" ? Number(req.body.costCenterId) : null;
    const parsedAmount = Number(amount);
    const parsedDate = expenseDate ? new Date(expenseDate) : existing.expenseDate;
    if (!category || String(category).trim().length < 2) {
      return res.status(400).json({ error: "Expense category is required" });
    }
    if (!(parsedAmount > 0)) {
      return res.status(400).json({ error: "Expense amount must be greater than zero" });
    }
    if (costCenterId != null && !Number.isFinite(costCenterId)) {
      return res.status(400).json({ error: "Invalid costCenterId" });
    }

    await ensureOpenFiscalPeriod(req.branchId, parsedDate);
    if (costCenterId != null) {
      const cc = await prisma.costCenter.findFirst({ where: { id: costCenterId, branchId: req.branchId } });
      if (!cc) return res.status(404).json({ error: "Cost center not found in this branch" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id },
        data: {
          category: String(category).trim(),
          description: description || null,
          amount: parsedAmount,
          paymentMethod: paymentMethod || "Cash",
          costCenterId: costCenterId || null,
          expenseDate: parsedDate,
        },
      });

      const accounts = await tx.account.findMany({ where: { branchId: req.branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const expenseAcc = map.get("5200");
      const cashAcc = map.get("1100");
      if (!expenseAcc || !cashAcc) {
        throw new Error("Required accounts (5200/1100) are missing");
      }

      const journal = await tx.journal.findFirst({
        where: { branchId: req.branchId, refType: "EXPENSE", refId: id },
      });
      if (journal) {
        await tx.journalLine.deleteMany({ where: { journalId: journal.id } });
        await tx.journal.update({
          where: { id: journal.id },
          data: {
            narration: `Expense: ${expense.category}`,
            costCenterId: costCenterId || null,
            lines: {
              create: [
                { accountId: expenseAcc.id, debit: parsedAmount, credit: 0 },
                { accountId: cashAcc.id, debit: 0, credit: parsedAmount },
              ],
            },
          },
        });
      }
      return expense;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "EXPENSE_UPDATE",
      entity: "Expense",
      entityId: updated.id,
      payload: { amount: updated.amount, category: updated.category },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });
    const existing = await prisma.expense.findFirst({ where: { id, branchId: req.branchId } });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    await prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({
        where: {
          journal: { branchId: req.branchId, refType: "EXPENSE", refId: id },
        },
      });
      await tx.journal.deleteMany({ where: { branchId: req.branchId, refType: "EXPENSE", refId: id } });
      await tx.expense.delete({ where: { id } });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "EXPENSE_DELETE",
      entity: "Expense",
      entityId: id,
      payload: null,
    });

    res.json({ message: "Expense deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
