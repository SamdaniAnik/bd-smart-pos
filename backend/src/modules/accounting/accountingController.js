const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const PDFDocument = require("pdfkit");
const HIGH_VALUE_JOURNAL_THRESHOLD = Number(process.env.FINANCIAL_HIGH_VALUE_JOURNAL_THRESHOLD || 100000);

async function submitFinancialApprovalEvent({
  userId = null,
  action,
  entity,
  entityId = null,
  reason = "",
  amount = 0,
  request = {},
}) {
  const log = await prisma.auditLog.create({
    data: {
      userId: userId || null,
      action,
      entity,
      entityId,
      payload: {
        status: "PENDING",
        reason: String(reason || "").trim(),
        amount: Number(amount || 0),
        request,
      },
    },
  });
  return log;
}

function parseDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function isCashEquivalentAccount(account) {
  const code = String(account?.code || "");
  const name = String(account?.name || "").toLowerCase();
  if (/^(101|102|103|104|105|111)/.test(code)) return true;
  if (name.includes("cash")) return true;
  if (name.includes("bank")) return true;
  if (name.includes("bkash") || name.includes("nagad") || name.includes("rocket")) return true;
  if (name.includes("mobile")) return true;
  return false;
}

function lineSignedEffect(line) {
  const debit = Number(line?.debit || 0);
  const credit = Number(line?.credit || 0);
  const type = String(line?.account?.type || "");
  if (type === "Asset" || type === "Expense") return debit - credit;
  return credit - debit;
}

async function buildCashFlowPayload(branchId, query = {}) {
  const from = parseDateInput(query.from);
  const toStart = parseDateInput(query.to);
  let to = null;
  if (toStart) {
    to = new Date(toStart.getTime());
    to.setHours(23, 59, 59, 999);
  }

  const accounts = await prisma.account.findMany({ where: { branchId } });
  const cashAccounts = accounts.filter(isCashEquivalentAccount);
  const cashAccountIds = new Set(cashAccounts.map((a) => Number(a.id)));

  const periodFilter = {};
  if (from || to) {
    periodFilter.createdAt = {};
    if (from) periodFilter.createdAt.gte = from;
    if (to) periodFilter.createdAt.lte = to;
  }

  const journals = await prisma.journal.findMany({
    where: {
      branchId,
      ...periodFilter,
    },
    include: {
      lines: {
        include: { account: true },
      },
    },
    orderBy: { id: "asc" },
    take: 30000,
  });

  const sectionTotals = {
    operating: 0,
    investing: 0,
    financing: 0,
  };

  for (const journal of journals) {
    const lines = Array.isArray(journal.lines) ? journal.lines : [];
    let cashDelta = 0;
    const weights = { operating: 0, investing: 0, financing: 0 };

    for (const line of lines) {
      const signed = lineSignedEffect(line);
      if (cashAccountIds.has(Number(line.accountId))) {
        cashDelta += signed;
        continue;
      }
      const amount = Math.abs(signed);
      const type = String(line?.account?.type || "");
      if (type === "Revenue" || type === "Expense") weights.operating += amount;
      else if (type === "Asset") weights.investing += amount;
      else if (type === "Liability" || type === "Equity") weights.financing += amount;
    }

    if (Math.abs(cashDelta) < 1e-9) continue;
    const denom = weights.operating + weights.investing + weights.financing;
    if (denom < 1e-9) {
      sectionTotals.operating += cashDelta;
      continue;
    }

    sectionTotals.operating += cashDelta * (weights.operating / denom);
    sectionTotals.investing += cashDelta * (weights.investing / denom);
    sectionTotals.financing += cashDelta * (weights.financing / denom);
  }

  const prePeriodLines = from
    ? await prisma.journalLine.findMany({
        where: {
          accountId: { in: [...cashAccountIds] },
          journal: { branchId, createdAt: { lt: from } },
        },
        include: { account: true },
        take: 50000,
      })
    : [];
  const openingCash = prePeriodLines.reduce((sum, line) => sum + lineSignedEffect(line), 0);

  const netOperating = Number(sectionTotals.operating.toFixed(2));
  const netInvesting = Number(sectionTotals.investing.toFixed(2));
  const netFinancing = Number(sectionTotals.financing.toFixed(2));
  const netIncrease = Number((netOperating + netInvesting + netFinancing).toFixed(2));
  const openingCashRounded = Number(openingCash.toFixed(2));
  const closingCash = Number((openingCashRounded + netIncrease).toFixed(2));

  return {
    period: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
    openingCash: openingCashRounded,
    operating: netOperating,
    investing: netInvesting,
    financing: netFinancing,
    netIncrease,
    closingCash,
    cashAccounts: cashAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
    })),
  };
}

async function buildCashFlowTrendPayload(branchId, query = {}) {
  const monthsRaw = Number(query.months || 12);
  const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.min(Math.floor(monthsRaw), 36) : 12;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const rows = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - i, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const periodKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const cf = await buildCashFlowPayload(branchId, {
      from: start.toISOString(),
      to: end.toISOString(),
    });
    rows.push({
      periodKey,
      openingCash: Number(cf.openingCash || 0),
      operating: Number(cf.operating || 0),
      investing: Number(cf.investing || 0),
      financing: Number(cf.financing || 0),
      netIncrease: Number(cf.netIncrease || 0),
      closingCash: Number(cf.closingCash || 0),
    });
  }
  return { months, rows };
}

async function buildProfitAndLossPayload(branchId, query = {}) {
  const from = parseDateInput(query.from);
  const toStart = parseDateInput(query.to);
  let to = null;
  if (toStart) {
    to = new Date(toStart.getTime());
    to.setHours(23, 59, 59, 999);
  }

  const journalWhere = { branchId };
  if (from || to) {
    journalWhere.createdAt = {};
    if (from) journalWhere.createdAt.gte = from;
    if (to) journalWhere.createdAt.lte = to;
  }

  const ccRaw = query.costCenterId;
  if (ccRaw != null && String(ccRaw).trim() !== "") {
    const cc = Number(ccRaw);
    if (Number.isFinite(cc)) journalWhere.costCenterId = cc;
  }

  const agg = await prisma.journalLine.groupBy({
    by: ["accountId"],
    _sum: { debit: true, credit: true },
    where: { journal: journalWhere },
  });

  const accounts = await prisma.account.findMany({ where: { branchId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let revenue = 0;
  let cogs = 0;
  let operatingExpense = 0;
  const revenueAccounts = [];
  const cogsAccounts = [];
  const operatingAccounts = [];

  for (const row of agg) {
    const acc = byId.get(row.accountId);
    if (!acc) continue;
    const d = Number(row._sum.debit || 0);
    const c = Number(row._sum.credit || 0);
    const line = {
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      debit: d,
      credit: c,
    };

    if (acc.type === "Revenue") {
      const amt = c - d;
      if (Math.abs(amt) < 1e-9) continue;
      revenue += amt;
      revenueAccounts.push({ ...line, amount: amt });
    } else if (acc.type === "Expense") {
      const amt = d - c;
      if (Math.abs(amt) < 1e-9) continue;
      line.amount = amt;
      if (isCogsAccount(acc.code)) {
        cogs += amt;
        cogsAccounts.push(line);
      } else {
        operatingExpense += amt;
        operatingAccounts.push(line);
      }
    }
  }

  const sortAmt = (a, b) => Math.abs(b.amount) - Math.abs(a.amount);
  revenueAccounts.sort(sortAmt);
  cogsAccounts.sort(sortAmt);
  operatingAccounts.sort(sortAmt);

  const grossProfit = revenue - cogs;
  const totalExpense = cogs + operatingExpense;
  const netProfit = revenue - totalExpense;

  return {
    period: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
    revenue,
    cogs,
    grossProfit,
    operatingExpense,
    totalExpense,
    expense: totalExpense,
    netProfit,
    revenueAccounts,
    cogsAccounts,
    operatingExpenseAccounts: operatingAccounts,
  };
}

exports.getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { branchId: req.branchId },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });
    res.json(accounts);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
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
    const totalAmount = Number(debit || 0);
    if (
      String(refType || "MANUAL").toUpperCase() === "MANUAL" &&
      totalAmount >= HIGH_VALUE_JOURNAL_THRESHOLD &&
      String(req.body?.forcePost || "").toLowerCase() !== "true"
    ) {
      const approval = await submitFinancialApprovalEvent({
        userId: req.user?.id || null,
        action: "APPROVAL_MANUAL_JOURNAL_HIGH_VALUE",
        entity: "Journal",
        entityId: null,
        reason: String(req.body?.approvalReason || "High value manual journal requires maker-checker"),
        amount: totalAmount,
        request: {
          branchId,
          refType,
          narration,
          costCenterId: costCenterId || null,
          lines: lines.map((l) => ({
            accountId: Number(l.accountId),
            debit: Number(l.debit || 0),
            credit: Number(l.credit || 0),
          })),
        },
      });
      return res.status(202).json({
        requiresApproval: true,
        approvalId: approval.id,
        message: "Manual journal submitted for approval (maker-checker).",
      });
    }
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      actionName: "accounting.journal.create",
    });
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
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

/** COGS: default 5100; also 5101–5109 if you split COGS sub-accounts (4-digit codes). */
function isCogsAccount(code) {
  const c = String(code || "");
  return c.length === 4 && c.startsWith("510");
}

exports.getProfitAndLoss = async (req, res) => {
  try {
    const payload = await buildProfitAndLossPayload(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportProfitAndLossCSV = async (req, res) => {
  try {
    const payload = await buildProfitAndLossPayload(req.branchId, req.query || {});
    const rows = [
      { section: "Revenue", account_code: "", account_name: "", amount: Number(payload.revenue || 0).toFixed(2) },
      ...(payload.revenueAccounts || []).map((r) => ({
        section: "Revenue Account",
        account_code: r.code || "",
        account_name: r.name || "",
        amount: Number(r.amount || 0).toFixed(2),
      })),
      { section: "COGS", account_code: "", account_name: "", amount: Number(payload.cogs || 0).toFixed(2) },
      ...(payload.cogsAccounts || []).map((r) => ({
        section: "COGS Account",
        account_code: r.code || "",
        account_name: r.name || "",
        amount: Number(r.amount || 0).toFixed(2),
      })),
      { section: "Gross Profit", account_code: "", account_name: "", amount: Number(payload.grossProfit || 0).toFixed(2) },
      { section: "Operating Expense", account_code: "", account_name: "", amount: Number(payload.operatingExpense || 0).toFixed(2) },
      ...(payload.operatingExpenseAccounts || []).map((r) => ({
        section: "Operating Expense Account",
        account_code: r.code || "",
        account_name: r.name || "",
        amount: Number(r.amount || 0).toFixed(2),
      })),
      { section: "Total Expense", account_code: "", account_name: "", amount: Number(payload.totalExpense || 0).toFixed(2) },
      { section: "Net Profit / (Loss)", account_code: "", account_name: "", amount: Number(payload.netProfit || 0).toFixed(2) },
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="profit-loss-statement.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportProfitAndLossPDF = async (req, res) => {
  try {
    const payload = await buildProfitAndLossPayload(req.branchId, req.query || {});
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="profit-loss-statement.pdf"');
    doc.pipe(res);
    doc.fontSize(16).font("Helvetica-Bold").text("Profit & Loss Statement", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(11).font("Helvetica-Bold").text(`Revenue: ${Number(payload.revenue || 0).toFixed(2)}`);
    doc.fontSize(11).font("Helvetica").text(`COGS: ${Number(payload.cogs || 0).toFixed(2)}`);
    doc.text(`Gross Profit: ${Number(payload.grossProfit || 0).toFixed(2)}`);
    doc.text(`Operating Expense: ${Number(payload.operatingExpense || 0).toFixed(2)}`);
    doc.text(`Total Expense: ${Number(payload.totalExpense || 0).toFixed(2)}`);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text(`Net Profit / (Loss): ${Number(payload.netProfit || 0).toFixed(2)}`);
    doc.end();
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getCashFlowStatement = async (req, res) => {
  try {
    const payload = await buildCashFlowPayload(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportCashFlowCSV = async (req, res) => {
  try {
    const payload = await buildCashFlowPayload(req.branchId, req.query || {});
    const rows = [
      { line: "Opening Cash & Cash Equivalents", amount: Number(payload.openingCash || 0).toFixed(2) },
      { line: "Net Cash from Operating Activities", amount: Number(payload.operating || 0).toFixed(2) },
      { line: "Net Cash from Investing Activities", amount: Number(payload.investing || 0).toFixed(2) },
      { line: "Net Cash from Financing Activities", amount: Number(payload.financing || 0).toFixed(2) },
      { line: "Net Increase / (Decrease) in Cash", amount: Number(payload.netIncrease || 0).toFixed(2) },
      { line: "Closing Cash & Cash Equivalents", amount: Number(payload.closingCash || 0).toFixed(2) },
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="cash-flow-statement.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportCashFlowPDF = async (req, res) => {
  try {
    const payload = await buildCashFlowPayload(req.branchId, req.query || {});
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="cash-flow-statement.pdf"');
    doc.pipe(res);
    doc.fontSize(16).font("Helvetica-Bold").text("Cash Flow Statement", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(11).font("Helvetica").text(`Opening Cash & Cash Equivalents: ${Number(payload.openingCash || 0).toFixed(2)}`);
    doc.text(`Net Cash from Operating Activities: ${Number(payload.operating || 0).toFixed(2)}`);
    doc.text(`Net Cash from Investing Activities: ${Number(payload.investing || 0).toFixed(2)}`);
    doc.text(`Net Cash from Financing Activities: ${Number(payload.financing || 0).toFixed(2)}`);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text(`Net Increase / (Decrease): ${Number(payload.netIncrease || 0).toFixed(2)}`);
    doc.text(`Closing Cash & Cash Equivalents: ${Number(payload.closingCash || 0).toFixed(2)}`);
    doc.end();
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getCashFlowTrend = async (req, res) => {
  try {
    const payload = await buildCashFlowTrendPayload(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
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
    if (String(req.body?.forceReopen || "").toLowerCase() !== "true") {
      const approval = await submitFinancialApprovalEvent({
        userId: req.user?.id || null,
        action: "APPROVAL_FINANCIAL_PERIOD_REOPEN",
        entity: "FiscalPeriod",
        entityId: periodId,
        reason: String(req.body?.reason || "Fiscal period reopen requires maker-checker"),
        amount: 0,
        request: {
          branchId,
          periodId,
          reason: String(req.body?.reason || "").slice(0, 300),
        },
      });
      return res.status(202).json({
        requiresApproval: true,
        approvalId: approval.id,
        message: "Fiscal period reopen submitted for approval.",
      });
    }
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
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getFiscalPeriodCloseChecklist = async (req, res) => {
  try {
    const branchId = req.branchId;
    const periodId = Number(req.params.id);
    if (!Number.isFinite(periodId)) return res.status(400).json({ error: "Invalid period id" });
    const period = await prisma.fiscalPeriod.findFirst({ where: { id: periodId, branchId } });
    if (!period) return res.status(404).json({ error: "Fiscal period not found" });
    const from = period.startDate;
    const to = period.endDate;
    const [pendingApprovals, pendingVoucherApprovals, unresolvedVendorBills] = await Promise.all([
      prisma.auditLog.count({
        where: {
          action: { startsWith: "APPROVAL_" },
          createdAt: { gte: from, lte: to },
          payload: { path: ["status"], equals: "PENDING" },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: { in: ["APPROVAL_PAYMENT_VOUCHER", "APPROVAL_RECEIPT_VOUCHER"] },
          createdAt: { gte: from, lte: to },
          payload: { path: ["status"], equals: "PENDING" },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: "VENDOR_BILL_RECORD",
          createdAt: { gte: from, lte: to },
          payload: { path: ["status"], equals: "SUBMITTED" },
        },
      }),
    ]);
    const blockers = [
      { key: "pendingApprovals", count: pendingApprovals, blocked: pendingApprovals > 0 },
      { key: "pendingVoucherApprovals", count: pendingVoucherApprovals, blocked: pendingVoucherApprovals > 0 },
      { key: "unresolvedVendorBills", count: unresolvedVendorBills, blocked: unresolvedVendorBills > 0 },
    ];
    res.json({
      period: {
        id: period.id,
        name: period.name || `#${period.id}`,
        startDate: period.startDate,
        endDate: period.endDate,
        isClosed: Boolean(period.isClosed),
      },
      checklist: blockers,
      canClose: blockers.every((b) => !b.blocked),
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
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
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};
