const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const PDFDocument = require("pdfkit");

function clean(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizePeriodKey(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  return raw;
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

async function buildCostCenterBudgetVsActualPayload(branchId, query = {}) {
  const periodKey =
    normalizePeriodKey(query.periodKey) ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const thresholdPctRaw = Number(query.thresholdPct || 10);
  const thresholdPct = Number.isFinite(thresholdPctRaw) && thresholdPctRaw >= 0 ? thresholdPctRaw : 10;
  const periodStart = new Date(`${periodKey}-01T00:00:00.000Z`);
  const periodEnd = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );

  const [costCenters, budgets, lines] = await Promise.all([
    prisma.costCenter.findMany({
      where: { branchId },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      take: 1000,
    }),
    prisma.costCenterBudget.findMany({
      where: { branchId, periodKey },
    }),
    prisma.journalLine.findMany({
      where: {
        journal: {
          branchId,
          createdAt: { gte: periodStart, lte: periodEnd },
          costCenterId: { not: null },
        },
      },
      include: {
        journal: {
          select: { costCenterId: true },
        },
        account: { select: { type: true } },
      },
      take: 20000,
    }),
  ]);

  const budgetByCc = new Map(budgets.map((b) => [Number(b.costCenterId), b]));
  const actualByCc = new Map();
  for (const line of lines) {
    const ccId = Number(line.journal?.costCenterId || 0);
    if (!ccId) continue;
    if (!actualByCc.has(ccId)) {
      actualByCc.set(ccId, { expenseActual: 0, revenueActual: 0 });
    }
    const current = actualByCc.get(ccId);
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (line.account?.type === "Expense") current.expenseActual += debit - credit;
    if (line.account?.type === "Revenue") current.revenueActual += credit - debit;
    actualByCc.set(ccId, current);
  }

  const rows = costCenters.map((cc) => {
    const budget = budgetByCc.get(cc.id);
    const actual = actualByCc.get(cc.id) || { expenseActual: 0, revenueActual: 0 };
    const expenseBudget = Number(budget?.expenseBudget || 0);
    const revenueBudget = Number(budget?.revenueBudget || 0);
    const expenseActual = Number(actual.expenseActual || 0);
    const revenueActual = Number(actual.revenueActual || 0);
    const expenseVariance = expenseActual - expenseBudget;
    const revenueVariance = revenueActual - revenueBudget;
    const expenseVariancePct = expenseBudget > 0 ? (expenseVariance / expenseBudget) * 100 : 0;
    const revenueVariancePct = revenueBudget > 0 ? (revenueVariance / revenueBudget) * 100 : 0;
    const expenseAlert = expenseBudget > 0 && expenseVariancePct >= thresholdPct;
    const revenueAlert = revenueBudget > 0 && revenueVariancePct <= -thresholdPct;
    return {
      costCenterId: cc.id,
      code: cc.code,
      name: cc.name,
      isActive: cc.isActive,
      periodKey,
      expenseBudget: Number(expenseBudget.toFixed(2)),
      expenseActual: Number(expenseActual.toFixed(2)),
      expenseVariance: Number(expenseVariance.toFixed(2)),
      expenseVariancePct: Number(expenseVariancePct.toFixed(2)),
      expenseAlert,
      revenueBudget: Number(revenueBudget.toFixed(2)),
      revenueActual: Number(revenueActual.toFixed(2)),
      revenueVariance: Number(revenueVariance.toFixed(2)),
      revenueVariancePct: Number(revenueVariancePct.toFixed(2)),
      revenueAlert,
      hasAlert: Boolean(expenseAlert || revenueAlert),
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      if (row.expenseAlert) acc.expenseAlerts += 1;
      if (row.revenueAlert) acc.revenueAlerts += 1;
      if (row.hasAlert) acc.totalAlertedCostCenters += 1;
      return acc;
    },
    { totalAlertedCostCenters: 0, expenseAlerts: 0, revenueAlerts: 0 }
  );

  return { periodKey, thresholdPct, summary, rows };
}

exports.listCostCenters = async (req, res) => {
  try {
    const branchId = req.branchId;
    const active = String(req.query?.active || "").trim();
    const rows = await prisma.costCenter.findMany({
      where: {
        branchId,
        ...(active === "1" ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      take: 500,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createCostCenter = async (req, res) => {
  try {
    const branchId = req.branchId;
    const code = clean(req.body?.code, 60).toUpperCase();
    const name = clean(req.body?.name, 120);
    if (!code) return res.status(400).json({ error: "code is required" });
    if (!name) return res.status(400).json({ error: "name is required" });
    const created = await prisma.costCenter.create({
      data: {
        branchId,
        code,
        name,
        isActive: req.body?.isActive !== false,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "COST_CENTER_CREATE",
      entity: "CostCenter",
      entityId: created.id,
      payload: { branchId, code, name },
    });
    res.status(201).json(created);
  } catch (error) {
    if (String(error?.code) === "P2002") {
      return res.status(409).json({ error: "Cost center code already exists in this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.updateCostCenter = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.costCenter.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Cost center not found" });
    const code = req.body?.code != null ? clean(req.body.code, 60).toUpperCase() : existing.code;
    const name = req.body?.name != null ? clean(req.body.name, 120) : existing.name;
    const isActive = req.body?.isActive != null ? Boolean(req.body.isActive) : existing.isActive;
    if (!code) return res.status(400).json({ error: "code is required" });
    if (!name) return res.status(400).json({ error: "name is required" });
    const updated = await prisma.costCenter.update({
      where: { id },
      data: { code, name, isActive },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "COST_CENTER_UPDATE",
      entity: "CostCenter",
      entityId: id,
      payload: { branchId, code, name, isActive },
    });
    res.json(updated);
  } catch (error) {
    if (String(error?.code) === "P2002") {
      return res.status(409).json({ error: "Cost center code already exists in this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.getCostCenterSummary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query?.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query?.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const rows = await prisma.journalLine.findMany({
      where: {
        journal: {
          branchId,
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
      },
      include: {
        journal: {
          select: {
            id: true,
            createdAt: true,
            refType: true,
            costCenterId: true,
            costCenter: { select: { id: true, code: true, name: true } },
          },
        },
        account: { select: { id: true, code: true, name: true, type: true } },
      },
      take: 10000,
      orderBy: { id: "desc" },
    });
    const grouped = new Map();
    for (const row of rows) {
      if (!row.journal?.costCenterId) continue;
      const cc = row.journal.costCenter;
      if (!cc) continue;
      const key = String(cc.id);
      if (!grouped.has(key)) {
        grouped.set(key, {
          costCenterId: cc.id,
          code: cc.code,
          name: cc.name,
          totalDebit: 0,
          totalCredit: 0,
          expenseDebit: 0,
          revenueCredit: 0,
          lineCount: 0,
        });
      }
      const item = grouped.get(key);
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      item.totalDebit += debit;
      item.totalCredit += credit;
      if (row.account?.type === "Expense") item.expenseDebit += debit - credit;
      if (row.account?.type === "Revenue") item.revenueCredit += credit - debit;
      item.lineCount += 1;
      grouped.set(key, item);
    }
    const summary = [...grouped.values()]
      .map((x) => ({
        ...x,
        totalDebit: Number(x.totalDebit.toFixed(2)),
        totalCredit: Number(x.totalCredit.toFixed(2)),
        expenseDebit: Number(x.expenseDebit.toFixed(2)),
        revenueCredit: Number(x.revenueCredit.toFixed(2)),
      }))
      .sort((a, b) => Number(b.expenseDebit || 0) - Number(a.expenseDebit || 0));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listCostCenterBudgets = async (req, res) => {
  try {
    const branchId = req.branchId;
    const periodKey = normalizePeriodKey(req.query?.periodKey);
    const rows = await prisma.costCenterBudget.findMany({
      where: {
        branchId,
        ...(periodKey ? { periodKey } : {}),
      },
      include: {
        costCenter: { select: { id: true, code: true, name: true, isActive: true } },
      },
      orderBy: [{ periodKey: "desc" }, { id: "desc" }],
      take: 1000,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertCostCenterBudget = async (req, res) => {
  try {
    const branchId = req.branchId;
    const costCenterId = Number(req.body?.costCenterId);
    const periodKey = normalizePeriodKey(req.body?.periodKey);
    const expenseBudget = Number(req.body?.expenseBudget || 0);
    const revenueBudget = Number(req.body?.revenueBudget || 0);
    const note = clean(req.body?.note, 191) || null;

    if (!Number.isFinite(costCenterId) || costCenterId <= 0) {
      return res.status(400).json({ error: "valid costCenterId is required" });
    }
    if (!periodKey) {
      return res.status(400).json({ error: "periodKey is required in YYYY-MM format" });
    }
    if (expenseBudget < 0 || revenueBudget < 0) {
      return res.status(400).json({ error: "expenseBudget/revenueBudget cannot be negative" });
    }
    const cc = await prisma.costCenter.findFirst({ where: { id: costCenterId, branchId } });
    if (!cc) return res.status(404).json({ error: "Cost center not found in branch" });

    const row = await prisma.costCenterBudget.upsert({
      where: { costCenterId_periodKey: { costCenterId, periodKey } },
      update: { expenseBudget, revenueBudget, note, branchId },
      create: { branchId, costCenterId, periodKey, expenseBudget, revenueBudget, note },
      include: { costCenter: { select: { id: true, code: true, name: true } } },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "COST_CENTER_BUDGET_UPSERT",
      entity: "CostCenterBudget",
      entityId: row.id,
      payload: { branchId, costCenterId, periodKey, expenseBudget, revenueBudget },
    });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCostCenterBudgetVsActual = async (req, res) => {
  try {
    const payload = await buildCostCenterBudgetVsActualPayload(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCostCenterBudgetVsActualCSV = async (req, res) => {
  try {
    const payload = await buildCostCenterBudgetVsActualPayload(req.branchId, req.query || {});
    const rows = (payload.rows || []).map((r) => ({
      period: payload.periodKey,
      cost_center_code: r.code,
      cost_center_name: r.name,
      expense_budget: Number(r.expenseBudget || 0).toFixed(2),
      expense_actual: Number(r.expenseActual || 0).toFixed(2),
      expense_variance: Number(r.expenseVariance || 0).toFixed(2),
      expense_variance_pct: Number(r.expenseVariancePct || 0).toFixed(2),
      expense_alert: r.expenseAlert ? "YES" : "NO",
      revenue_budget: Number(r.revenueBudget || 0).toFixed(2),
      revenue_actual: Number(r.revenueActual || 0).toFixed(2),
      revenue_variance: Number(r.revenueVariance || 0).toFixed(2),
      revenue_variance_pct: Number(r.revenueVariancePct || 0).toFixed(2),
      revenue_alert: r.revenueAlert ? "YES" : "NO",
      has_alert: r.hasAlert ? "YES" : "NO",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="cost-center-budget-vs-actual.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCostCenterBudgetVsActualPDF = async (req, res) => {
  try {
    const payload = await buildCostCenterBudgetVsActualPayload(req.branchId, req.query || {});
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="cost-center-budget-vs-actual.pdf"');
    doc.pipe(res);

    doc.fontSize(16).font("Helvetica-Bold").text("Cost Center Budget vs Actual", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").text(`Period: ${payload.periodKey}`);
    doc.text(`Alert threshold: ${Number(payload.thresholdPct || 0).toFixed(2)}%`);
    doc.text(
      `Alerted cost centers: ${payload.summary?.totalAlertedCostCenters || 0} | Expense alerts: ${payload.summary?.expenseAlerts || 0} | Revenue alerts: ${payload.summary?.revenueAlerts || 0}`
    );
    doc.moveDown(0.8);

    for (const r of payload.rows || []) {
      const flags = [];
      if (r.expenseAlert) flags.push("Expense Alert");
      if (r.revenueAlert) flags.push("Revenue Alert");
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`${r.code} - ${r.name}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Exp Budget: ${Number(r.expenseBudget || 0).toFixed(2)} | Exp Actual: ${Number(r.expenseActual || 0).toFixed(2)} | Exp Var: ${Number(r.expenseVariance || 0).toFixed(2)} (${Number(r.expenseVariancePct || 0).toFixed(2)}%)`
        );
      doc.text(
        `Rev Budget: ${Number(r.revenueBudget || 0).toFixed(2)} | Rev Actual: ${Number(r.revenueActual || 0).toFixed(2)} | Rev Var: ${Number(r.revenueVariance || 0).toFixed(2)} (${Number(r.revenueVariancePct || 0).toFixed(2)}%)`
      );
      doc.moveDown(0.45);
      if (doc.y > 760) doc.addPage();
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
