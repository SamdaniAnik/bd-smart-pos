const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

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
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ error: "At least two journal lines required" });
    }
    const debit = lines.reduce((a, l) => a + Number(l.debit || 0), 0);
    const credit = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
    if (Math.abs(debit - credit) > 0.001) {
      return res.status(400).json({ error: "Journal not balanced" });
    }
    await ensureOpenFiscalPeriod(branchId);

    const journal = await prisma.journal.create({
      data: {
        branchId,
        createdBy: req.user?.id || null,
        refType,
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
