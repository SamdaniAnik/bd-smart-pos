const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

function parseDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

exports.getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { branchId: req.branchId },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createJournal = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { refType = "MANUAL", narration = "", lines } = req.body;
    const costCenterId = req.body?.costCenterId != null && req.body?.costCenterId !== ""
      ? Number(req.body.costCenterId)
      : null;
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ error: "At least two journal lines required" });
    }
    const debit = lines.reduce((a, l) => a + Number(l.debit || 0), 0);
    const credit = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
    if (Math.abs(debit - credit) > 0.001) {
      return res.status(400).json({ error: "Journal not balanced" });
    }
    if (costCenterId != null && !Number.isFinite(costCenterId)) {
      return res.status(400).json({ error: "Invalid costCenterId" });
    }
    await ensureOpenFiscalPeriod(branchId);
    if (costCenterId != null) {
      const cc = await prisma.costCenter.findFirst({ where: { id: costCenterId, branchId } });
      if (!cc) return res.status(404).json({ error: "Cost center not found in this branch" });
    }

    const journal = await prisma.journal.create({
      data: {
        branchId,
        createdBy: req.user?.id || null,
        refType,
        costCenterId: costCenterId || null,
        narration,
        lines: {
          create: lines.map((l) => ({
            accountId: Number(l.accountId),
            debit: Number(l.debit || 0),
            credit: Number(l.credit || 0),
          })),
        },
      },
      include: { lines: true },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "JOURNAL_CREATE",
      entity: "Journal",
      entityId: journal.id,
      payload: { refType, debit, credit },
    });
    res.status(201).json(journal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTrialBalance = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.journalLine.groupBy({
      by: ["accountId"],
      _sum: { debit: true, credit: true },
      where: { journal: { branchId } },
    });
    const accounts = await prisma.account.findMany({ where: { branchId } });
    const map = new Map(accounts.map((a) => [a.id, a]));
    const result = rows.map((r) => ({
      accountId: r.accountId,
      code: map.get(r.accountId)?.code,
      name: map.get(r.accountId)?.name,
      debit: r._sum.debit || 0,
      credit: r._sum.credit || 0,
      balance: (r._sum.debit || 0) - (r._sum.credit || 0),
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProfitAndLoss = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lines = await prisma.journalLine.findMany({
      where: { journal: { branchId } },
      include: { account: true },
    });
    let revenue = 0;
    let expense = 0;
    for (const line of lines) {
      if (line.account.type === "Revenue") revenue += Number(line.credit) - Number(line.debit);
      if (line.account.type === "Expense") expense += Number(line.debit) - Number(line.credit);
    }
    res.json({ revenue, expense, netProfit: revenue - expense });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBalanceSheet = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lines = await prisma.journalLine.findMany({
      where: { journal: { branchId } },
      include: { account: true },
    });
    const totals = { assets: 0, liabilities: 0, equity: 0 };
    for (const line of lines) {
      const amount = Number(line.debit) - Number(line.credit);
      if (line.account.type === "Asset") totals.assets += amount;
      if (line.account.type === "Liability") totals.liabilities -= amount;
      if (line.account.type === "Equity") totals.equity -= amount;
    }
    res.json(totals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getFiscalPeriods = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.fiscalPeriod.findMany({
      where: { branchId },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      take: 60,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.closeFiscalPeriod = async (req, res) => {
  try {
    const branchId = req.branchId;
    const periodId = Number(req.params.id);
    if (!Number.isFinite(periodId)) return res.status(400).json({ error: "Invalid period id" });
    const period = await prisma.fiscalPeriod.findFirst({ where: { id: periodId, branchId } });
    if (!period) return res.status(404).json({ error: "Fiscal period not found" });
    if (period.isClosed) return res.status(400).json({ error: "Fiscal period is already closed" });
    const updated = await prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: { isClosed: true },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FISCAL_PERIOD_CLOSE",
      entity: "FiscalPeriod",
      entityId: periodId,
      payload: {
        branchId,
        reason: String(req.body?.reason || "").slice(0, 300),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reopenFiscalPeriod = async (req, res) => {
  try {
    const branchId = req.branchId;
    const periodId = Number(req.params.id);
    if (!Number.isFinite(periodId)) return res.status(400).json({ error: "Invalid period id" });
    const period = await prisma.fiscalPeriod.findFirst({ where: { id: periodId, branchId } });
    if (!period) return res.status(404).json({ error: "Fiscal period not found" });
    if (!period.isClosed) return res.status(400).json({ error: "Fiscal period is already open" });
    const updated = await prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: { isClosed: false },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FISCAL_PERIOD_REOPEN",
      entity: "FiscalPeriod",
      entityId: periodId,
      payload: {
        branchId,
        reason: String(req.body?.reason || "").slice(0, 300),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createFiscalPeriod = async (req, res) => {
  try {
    const branchId = req.branchId;
    const name = String(req.body?.name || "").trim();
    const startDate = parseDateInput(req.body?.startDate);
    const endDate = parseDateInput(req.body?.endDate);
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!startDate || !endDate) return res.status(400).json({ error: "valid startDate and endDate are required" });
    if (startDate > endDate) return res.status(400).json({ error: "startDate must be before endDate" });

    const overlap = await prisma.fiscalPeriod.findFirst({
      where: {
        branchId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      return res.status(409).json({
        error: `Date range overlaps existing period "${overlap.name}" (${overlap.startDate.toISOString().slice(0, 10)} to ${overlap.endDate.toISOString().slice(0, 10)})`,
      });
    }

    const created = await prisma.fiscalPeriod.create({
      data: {
        branchId,
        name,
        startDate,
        endDate,
        isClosed: false,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FISCAL_PERIOD_CREATE",
      entity: "FiscalPeriod",
      entityId: created.id,
      payload: {
        branchId,
        name,
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
      },
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.closeCurrentMonthFiscalPeriod = async (req, res) => {
  try {
    const branchId = req.branchId;
    const now = new Date();
    const period = await prisma.fiscalPeriod.findFirst({
      where: {
        branchId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { startDate: "desc" },
    });
    if (!period) return res.status(404).json({ error: "No active fiscal period found for current month" });
    if (period.isClosed) return res.status(400).json({ error: "Current month fiscal period is already closed" });
    const updated = await prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: { isClosed: true },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FISCAL_PERIOD_CLOSE_CURRENT_MONTH",
      entity: "FiscalPeriod",
      entityId: period.id,
      payload: {
        branchId,
        reason: String(req.body?.reason || "").slice(0, 300),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
