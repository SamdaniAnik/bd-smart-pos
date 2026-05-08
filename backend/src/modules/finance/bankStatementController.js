const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const VALID_TARGET_TYPES = ["SALE_PAYMENT", "CHEQUE"];

function parseDateFlexible(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => {
      const value = row[h] == null ? "" : String(row[h]).replaceAll('"', '""');
      return `"${value}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

async function getAccountMap(branchId, tx = prisma) {
  const rows = await tx.account.findMany({ where: { branchId } });
  return new Map(rows.map((a) => [a.code, a]));
}

async function ensureImportOpenByImportId(branchId, importId) {
  const parent = await prisma.bankStatementImport.findFirst({
    where: { id: importId, branchId },
    select: { id: true, status: true },
  });
  if (!parent) {
    const err = new Error("Import batch not found");
    err.httpStatus = 404;
    throw err;
  }
  if (String(parent.status || "OPEN").toUpperCase() === "CLOSED") {
    const err = new Error("Import batch is CLOSED and cannot be modified");
    err.httpStatus = 409;
    throw err;
  }
  return parent;
}

async function ensureImportOpenByLineId(branchId, lineId) {
  const row = await prisma.bankStatementLine.findFirst({
    where: { id: lineId },
    include: { import: { select: { branchId: true, status: true } } },
  });
  if (!row || row.import?.branchId !== branchId) {
    const err = new Error("Bank line not found");
    err.httpStatus = 404;
    throw err;
  }
  if (String(row.import.status || "OPEN").toUpperCase() === "CLOSED") {
    const err = new Error("Import batch is CLOSED and cannot be modified");
    err.httpStatus = 409;
    throw err;
  }
  return row;
}

exports.listBankImports = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.bankStatementImport.findMany({
      where: { branchId },
      orderBy: { importedAt: "desc" },
      take: 80,
      include: {
        _count: { select: { lines: true } },
      },
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createBankImport = async (req, res) => {
  try {
    const branchId = req.branchId;
    const body = req.body || {};
    const label = body.label ? String(body.label).slice(0, 120) : null;
    const rawLines = Array.isArray(body.lines) ? body.lines : [];

    const normalized = [];
    for (const raw of rawLines.slice(0, 2000)) {
      const txnDate = parseDateFlexible(raw.txnDate || raw.date || raw.TxDate || raw.TransactionDate);
      if (!txnDate) continue;
      const amountRaw = Number(raw.amount ?? raw.Amount ?? raw.value ?? raw.Value);
      const debit = Number(raw.debit ?? raw.Debit ?? 0);
      const credit = Number(raw.credit ?? raw.Credit ?? 0);
      let amount = Number.isFinite(amountRaw) ? Math.abs(amountRaw) : 0;
      let direction = String(raw.direction || "").toUpperCase();
      if (!amount && debit > 0) {
        amount = Math.abs(debit);
        direction = "DEBIT";
      }
      if (!amount && credit > 0) {
        amount = Math.abs(credit);
        direction = "CREDIT";
      }
      if (!amount || amount <= 0) continue;
      if (!["DEBIT", "CREDIT"].includes(direction)) {
        direction = amountRaw < 0 ? "DEBIT" : "CREDIT";
      }
      normalized.push({
        txnDate,
        description: raw.description ? String(raw.description).slice(0, 240) : null,
        reference: raw.reference ? String(raw.reference).slice(0, 120) : null,
        amount,
        direction,
      });
    }

    if (!normalized.length) {
      return res.status(400).json({
        error: "No valid lines — send { lines: [{ txnDate, amount, direction?: CREDIT|DEBIT, description?, reference? }] }",
      });
    }

    const created = await prisma.bankStatementImport.create({
      data: {
        branchId,
        label,
        rowCount: normalized.length,
        meta: body.meta || null,
        status: "OPEN",
        lines: {
          create: normalized.map((line) => ({
            txnDate: line.txnDate,
            description: line.description,
            reference: line.reference,
            amount: line.amount,
            direction: line.direction,
          })),
        },
      },
      include: { lines: { orderBy: { txnDate: "asc" } } },
    });
    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getBankImportLines = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    if (Number.isNaN(importId)) return res.status(400).json({ error: "Invalid import id" });
    const parent = await prisma.bankStatementImport.findFirst({
      where: { id: importId, branchId },
      select: { id: true, label: true, importedAt: true, status: true, closedAt: true, closingNote: true },
    });
    if (!parent) return res.status(404).json({ error: "Import batch not found" });
    const status = String(req.query.status || "ALL").toUpperCase();
    const lines = await prisma.bankStatementLine.findMany({
      where: {
        importId,
        ...(status === "UNMATCHED" ? { matchedSalePaymentId: null } : {}),
      },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
      include: {
        matchedSalePayment: {
          include: {
            sale: { select: { id: true, invoiceNo: true, branchId: true, total: true, createdAt: true } },
          },
        },
        matchedCheque: {
          select: {
            id: true,
            chequeNo: true,
            bankName: true,
            amount: true,
            direction: true,
            status: true,
            chequeDate: true,
          },
        },
        allocations: {
          orderBy: { id: "desc" },
          include: {
            salePayment: { include: { sale: { select: { id: true, invoiceNo: true } } } },
            cheque: { select: { id: true, chequeNo: true, bankName: true, amount: true, status: true } },
          },
        },
        exceptionResolvedBy: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({ import: parent, lines });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getChequeReconcileWorkspace = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    if (Number.isNaN(importId)) return res.status(400).json({ error: "Invalid import id" });
    const parent = await prisma.bankStatementImport.findFirst({
      where: { id: importId, branchId },
      select: { id: true, label: true, importedAt: true, status: true, closedAt: true, closingNote: true },
    });
    if (!parent) return res.status(404).json({ error: "Import batch not found" });
    const lines = await prisma.bankStatementLine.findMany({
      where: { importId },
      include: {
        matchedCheque: {
          select: { id: true, chequeNo: true, bankName: true, amount: true, direction: true, status: true, chequeDate: true },
        },
        allocations: {
          orderBy: { id: "desc" },
          include: {
            salePayment: { include: { sale: { select: { id: true, invoiceNo: true } } } },
            cheque: { select: { id: true, chequeNo: true, bankName: true, amount: true, status: true } },
          },
        },
        exceptionResolvedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
      take: 2000,
    });
    const now = Date.now();
    const exceptionThresholdHours = Math.max(1, Number(req.query?.exceptionSlaHours || 24));
    const enrichedLines = lines.map((line) => {
      const raisedAtMs = line.exceptionRaisedAt ? new Date(line.exceptionRaisedAt).getTime() : null;
      const ageHours = raisedAtMs ? (now - raisedAtMs) / (1000 * 60 * 60) : 0;
      const isExceptionOverdue = String(line.exceptionStatus || "NONE") === "OPEN" && ageHours >= exceptionThresholdHours;
      return {
        ...line,
        exceptionAgeHours: raisedAtMs ? Number(ageHours.toFixed(2)) : 0,
        isExceptionOverdue,
      };
    });
    const openCheques = await prisma.cheque.findMany({
      where: {
        branchId,
        status: { in: ["PENDING", "DEPOSITED", "CLEARED"] },
      },
      orderBy: [{ chequeDate: "desc" }, { id: "desc" }],
      take: 500,
    });
    const suggestions = lines
      .filter((line) => !line.matchedChequeId)
      .map((line) => {
        const best = openCheques.find((c) => {
          const amountMatch = Math.abs(Number(c.amount || 0) - Number(line.amount || 0)) <= 0.01;
          if (!amountMatch) return false;
          const ref = String(line.reference || "").toLowerCase();
          const desc = String(line.description || "").toLowerCase();
          const byChequeNo = ref && String(c.chequeNo || "").toLowerCase().includes(ref);
          const byBank = desc && String(c.bankName || "").toLowerCase().includes(desc);
          return byChequeNo || byBank || amountMatch;
        });
        return {
          lineId: line.id,
          suggestedChequeId: best?.id || null,
        };
      });
    const credits = enrichedLines
      .filter((l) => String(l.direction || "").toUpperCase() === "CREDIT")
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const debits = enrichedLines
      .filter((l) => String(l.direction || "").toUpperCase() === "DEBIT")
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const netBank = Number((credits - debits).toFixed(2));

    const matchedSales = enrichedLines.reduce((sum, l) => {
      const allocated = (l.allocations || [])
        .filter((a) => a.targetType === "SALE_PAYMENT")
        .reduce((s, a) => s + Number(a.amount || 0), 0);
      if (allocated > 0) return sum + allocated;
      return l.matchedSalePaymentId ? sum + Number(l.amount || 0) : sum;
    }, 0);
    const matchedCheques = enrichedLines.reduce((sum, l) => {
      const allocated = (l.allocations || [])
        .filter((a) => a.targetType === "CHEQUE")
        .reduce((s, a) => s + Number(a.amount || 0), 0);
      if (allocated > 0) return sum + allocated;
      return l.matchedChequeId ? sum + Number(l.amount || 0) : sum;
    }, 0);
    const matchedKnown = Number((matchedSales + matchedCheques).toFixed(2));
    const unmatchedNet = Number((netBank - matchedKnown).toFixed(2));

    let suggestedJournal = null;
    const absDiff = Math.abs(unmatchedNet);
    if (absDiff >= 0.01) {
      const accountMap = await getAccountMap(branchId);
      const cash = accountMap.get("1100");
      const expense = accountMap.get("5200");
      const revenue = accountMap.get("4100");
      if (cash && expense && revenue) {
        suggestedJournal = {
          refType: "BANK_RECON_ADJUST",
          narration: `Bank reconciliation adjustment for import #${importId}`,
          amount: absDiff,
          direction: unmatchedNet > 0 ? "GAIN" : "LOSS",
          lines:
            unmatchedNet > 0
              ? [
                  { accountId: cash.id, accountCode: cash.code, accountName: cash.name, debit: absDiff, credit: 0 },
                  { accountId: revenue.id, accountCode: revenue.code, accountName: revenue.name, debit: 0, credit: absDiff },
                ]
              : [
                  { accountId: expense.id, accountCode: expense.code, accountName: expense.name, debit: absDiff, credit: 0 },
                  { accountId: cash.id, accountCode: cash.code, accountName: cash.name, debit: 0, credit: absDiff },
                ],
        };
      }
    }

    res.json({
      import: parent,
      lines: enrichedLines,
      cheques: openCheques,
      suggestions,
      summary: {
        credits: Number(credits.toFixed(2)),
        debits: Number(debits.toFixed(2)),
        netBank,
        matchedSales,
        matchedCheques,
        matchedKnown,
        unmatchedNet,
        openExceptionCount: enrichedLines.filter((l) => String(l.exceptionStatus || "NONE") === "OPEN").length,
        overdueExceptionCount: enrichedLines.filter((l) => l.isExceptionOverdue).length,
      },
      suggestedJournal,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.runAutoMatchForImport = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    const amountTolerance = Math.max(0, Number(req.body?.amountTolerance || 0.01));
    if (!Number.isFinite(importId)) return res.status(400).json({ error: "Invalid import id" });
    await ensureImportOpenByImportId(branchId, importId);

    const lines = await prisma.bankStatementLine.findMany({
      where: {
        importId,
        direction: "CREDIT",
        matchedSalePaymentId: null,
        matchedChequeId: null,
      },
      include: { allocations: true },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
    });

    const chequePool = await prisma.cheque.findMany({
      where: { branchId, status: { in: ["PENDING", "DEPOSITED", "CLEARED"] } },
      orderBy: [{ chequeDate: "desc" }, { id: "desc" }],
      take: 2000,
    });
    const paymentPool = await prisma.salePayment.findMany({
      where: { sale: { branchId } },
      include: { sale: { select: { id: true, invoiceNo: true, createdAt: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3000,
    });

    const usedCheques = new Set();
    const usedPayments = new Set();
    const report = {
      scannedLines: lines.length,
      matchedCheque: 0,
      matchedSalePayment: 0,
      skippedWithAllocations: 0,
      noCandidate: 0,
      details: [],
    };

    for (const line of lines) {
      if ((line.allocations || []).length > 0) {
        report.skippedWithAllocations += 1;
        continue;
      }
      const ref = String(line.reference || "").trim().toLowerCase();
      const desc = String(line.description || "").trim().toLowerCase();
      const amount = Number(line.amount || 0);

      const chequeCandidate = chequePool.find((c) => {
        if (usedCheques.has(c.id)) return false;
        if (Math.abs(Number(c.amount || 0) - amount) > amountTolerance) return false;
        const chq = String(c.chequeNo || "").toLowerCase();
        const bank = String(c.bankName || "").toLowerCase();
        return (ref && (chq.includes(ref) || ref.includes(chq))) || (desc && bank && desc.includes(bank));
      });
      if (chequeCandidate) {
        await prisma.bankStatementLine.update({
          where: { id: line.id },
          data: {
            matchedChequeId: chequeCandidate.id,
            matchedAt: new Date(),
            matchNote: `AUTO_MATCH amount<=${amountTolerance}`,
          },
        });
        usedCheques.add(chequeCandidate.id);
        report.matchedCheque += 1;
        report.details.push({ lineId: line.id, type: "CHEQUE", targetId: chequeCandidate.id });
        continue;
      }

      const paymentCandidate = paymentPool.find((p) => {
        if (usedPayments.has(p.id)) return false;
        if (Math.abs(Number(p.amount || 0) - amount) > amountTolerance) return false;
        const channel = String(p.channel || "").toLowerCase();
        const invoiceNo = String(p.sale?.invoiceNo || "").toLowerCase();
        return (ref && (channel === ref || invoiceNo === ref || channel.includes(ref))) || (desc && channel && desc.includes(channel));
      });
      if (paymentCandidate) {
        await prisma.bankStatementLine.update({
          where: { id: line.id },
          data: {
            matchedSalePaymentId: paymentCandidate.id,
            matchedAt: new Date(),
            matchNote: `AUTO_MATCH amount<=${amountTolerance}`,
          },
        });
        usedPayments.add(paymentCandidate.id);
        report.matchedSalePayment += 1;
        report.details.push({ lineId: line.id, type: "SALE_PAYMENT", targetId: paymentCandidate.id });
        continue;
      }

      report.noCandidate += 1;
    }

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_IMPORT_AUTO_MATCH",
      entity: "BankStatementImport",
      entityId: importId,
      payload: { branchId, amountTolerance, report: { ...report, details: report.details.slice(0, 100) } },
    });
    res.json(report);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

function scoreChequeCandidate(line, cheque, amountTolerance) {
  const amount = Number(line.amount || 0);
  const cAmount = Number(cheque.amount || 0);
  const diff = Math.abs(cAmount - amount);
  if (diff > amountTolerance) return 0;
  const ref = String(line.reference || "").trim().toLowerCase();
  const desc = String(line.description || "").trim().toLowerCase();
  const chq = String(cheque.chequeNo || "").toLowerCase();
  const bank = String(cheque.bankName || "").toLowerCase();
  let score = 40;
  if (diff <= 0.001) score += 30;
  if (ref && (chq.includes(ref) || ref.includes(chq))) score += 25;
  if (desc && bank && desc.includes(bank)) score += 10;
  return Math.min(100, score);
}

function scorePaymentCandidate(line, payment, amountTolerance) {
  const amount = Number(line.amount || 0);
  const pAmount = Number(payment.amount || 0);
  const diff = Math.abs(pAmount - amount);
  if (diff > amountTolerance) return 0;
  const ref = String(line.reference || "").trim().toLowerCase();
  const desc = String(line.description || "").trim().toLowerCase();
  const channel = String(payment.channel || "").toLowerCase();
  const invoiceNo = String(payment.sale?.invoiceNo || "").toLowerCase();
  let score = 35;
  if (diff <= 0.001) score += 30;
  if (ref && (channel === ref || invoiceNo === ref || channel.includes(ref))) score += 25;
  if (desc && channel && desc.includes(channel)) score += 10;
  return Math.min(100, score);
}

exports.previewAutoMatchForImport = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    const amountTolerance = Math.max(0, Number(req.body?.amountTolerance || req.query?.amountTolerance || 0.01));
    if (!Number.isFinite(importId)) return res.status(400).json({ error: "Invalid import id" });
    await ensureImportOpenByImportId(branchId, importId);

    const lines = await prisma.bankStatementLine.findMany({
      where: {
        importId,
        direction: "CREDIT",
        matchedSalePaymentId: null,
        matchedChequeId: null,
      },
      include: { allocations: true },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
      take: 1500,
    });
    const chequePool = await prisma.cheque.findMany({
      where: { branchId, status: { in: ["PENDING", "DEPOSITED", "CLEARED"] } },
      orderBy: [{ chequeDate: "desc" }, { id: "desc" }],
      take: 3000,
    });
    const paymentPool = await prisma.salePayment.findMany({
      where: { sale: { branchId } },
      include: { sale: { select: { id: true, invoiceNo: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4000,
    });

    const previewRows = [];
    for (const line of lines) {
      if ((line.allocations || []).length > 0) continue;
      let best = null;
      for (const c of chequePool) {
        const score = scoreChequeCandidate(line, c, amountTolerance);
        if (score <= 0) continue;
        if (!best || score > best.confidence) {
          best = {
            lineId: line.id,
            lineAmount: Number(line.amount || 0),
            lineReference: line.reference || null,
            type: "CHEQUE",
            targetId: c.id,
            targetLabel: `CHQ#${c.chequeNo} (${c.bankName})`,
            confidence: score,
          };
        }
      }
      for (const p of paymentPool) {
        const score = scorePaymentCandidate(line, p, amountTolerance);
        if (score <= 0) continue;
        if (!best || score > best.confidence) {
          best = {
            lineId: line.id,
            lineAmount: Number(line.amount || 0),
            lineReference: line.reference || null,
            type: "SALE_PAYMENT",
            targetId: p.id,
            targetLabel: `PAY#${p.id}${p.sale?.invoiceNo ? ` (${p.sale.invoiceNo})` : ""}`,
            confidence: score,
          };
        }
      }
      if (best) previewRows.push(best);
    }
    previewRows.sort((a, b) => b.confidence - a.confidence || a.lineId - b.lineId);
    res.json({ amountTolerance, rows: previewRows.slice(0, 500) });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.applyAutoMatchSelections = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
    if (!Number.isFinite(importId)) return res.status(400).json({ error: "Invalid import id" });
    await ensureImportOpenByImportId(branchId, importId);
    if (!selections.length) return res.status(400).json({ error: "selections required" });

    let applied = 0;
    let skipped = 0;
    const details = [];
    for (const sel of selections.slice(0, 500)) {
      const lineId = Number(sel?.lineId);
      const targetId = Number(sel?.targetId);
      const type = String(sel?.type || "").toUpperCase();
      if (!Number.isFinite(lineId) || !Number.isFinite(targetId) || !["CHEQUE", "SALE_PAYMENT"].includes(type)) {
        skipped += 1;
        continue;
      }
      const line = await prisma.bankStatementLine.findFirst({
        where: { id: lineId, importId },
        include: { allocations: true },
      });
      if (!line || line.matchedChequeId || line.matchedSalePaymentId || (line.allocations || []).length > 0) {
        skipped += 1;
        continue;
      }

      if (type === "CHEQUE") {
        const cheque = await prisma.cheque.findFirst({ where: { id: targetId, branchId } });
        if (!cheque) {
          skipped += 1;
          continue;
        }
        const existing = await prisma.bankStatementLine.findFirst({ where: { matchedChequeId: targetId } });
        if (existing) {
          skipped += 1;
          continue;
        }
        await prisma.bankStatementLine.update({
          where: { id: lineId },
          data: { matchedChequeId: targetId, matchedAt: new Date(), matchNote: "AUTO_PREVIEW_APPLY" },
        });
        applied += 1;
        details.push({ lineId, type, targetId });
      } else {
        const pay = await prisma.salePayment.findFirst({ where: { id: targetId }, include: { sale: true } });
        if (!pay || pay.sale?.branchId !== branchId) {
          skipped += 1;
          continue;
        }
        const existing = await prisma.bankStatementLine.findFirst({ where: { matchedSalePaymentId: targetId } });
        if (existing) {
          skipped += 1;
          continue;
        }
        await prisma.bankStatementLine.update({
          where: { id: lineId },
          data: { matchedSalePaymentId: targetId, matchedAt: new Date(), matchNote: "AUTO_PREVIEW_APPLY" },
        });
        applied += 1;
        details.push({ lineId, type, targetId });
      }
    }

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_IMPORT_AUTO_MATCH_APPLY_SELECTED",
      entity: "BankStatementImport",
      entityId: importId,
      payload: { branchId, applied, skipped, details: details.slice(0, 100) },
    });
    res.json({ applied, skipped, details: details.slice(0, 200) });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.matchBankLineToCheque = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    const chequeId = Number(req.body?.chequeId);
    const matchNote = req.body?.matchNote ? String(req.body.matchNote).slice(0, 240) : null;
    if (Number.isNaN(lineId)) return res.status(400).json({ error: "Invalid line id" });
    if (Number.isNaN(chequeId)) return res.status(400).json({ error: "chequeId required" });
    const lineRow = await ensureImportOpenByLineId(branchId, lineId);
    const chequeRow = await prisma.cheque.findFirst({ where: { id: chequeId, branchId } });
    if (!chequeRow) return res.status(404).json({ error: "Cheque not found in this branch" });
    const existing = await prisma.bankStatementLine.findFirst({ where: { matchedChequeId: chequeId } });
    if (existing && existing.id !== lineId) return res.status(409).json({ error: "Cheque already linked to another bank line" });
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        matchedChequeId: chequeId,
        matchedAt: new Date(),
        matchNote,
      },
      include: {
        matchedCheque: { select: { id: true, chequeNo: true, bankName: true, amount: true, direction: true, status: true } },
      },
    });
    res.json(updated);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    if (error.code === "P2002") return res.status(409).json({ error: "Cheque already linked" });
    res.status(500).json({ error: error.message });
  }
};

exports.unmatchBankLineCheque = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    if (Number.isNaN(lineId)) return res.status(400).json({ error: "Invalid line id" });
    await ensureImportOpenByLineId(branchId, lineId);
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { matchedChequeId: null, matchedAt: null, matchNote: null },
    });
    res.json(updated);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.createBankLineAllocation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    const targetType = String(req.body?.targetType || "").toUpperCase();
    const amount = Number(req.body?.amount || 0);
    const note = req.body?.note ? String(req.body.note).slice(0, 190) : null;
    const salePaymentId = req.body?.salePaymentId != null ? Number(req.body.salePaymentId) : null;
    const chequeId = req.body?.chequeId != null ? Number(req.body.chequeId) : null;
    if (!Number.isFinite(lineId)) return res.status(400).json({ error: "Invalid line id" });
    if (!VALID_TARGET_TYPES.includes(targetType)) return res.status(400).json({ error: "targetType must be SALE_PAYMENT or CHEQUE" });
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be > 0" });

    const line = await prisma.bankStatementLine.findFirst({
      where: { id: lineId },
      include: { import: true, allocations: true },
    });
    if (!line || line.import.branchId !== branchId) return res.status(404).json({ error: "Bank line not found" });
    if (String(line.import?.status || "OPEN").toUpperCase() === "CLOSED") {
      return res.status(409).json({ error: "Import batch is CLOSED and cannot be modified" });
    }
    const allocated = (line.allocations || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const remaining = Number((Number(line.amount || 0) - allocated).toFixed(2));
    if (amount - remaining > 0.001) {
      return res.status(400).json({ error: `Allocation exceeds remaining amount (${remaining.toFixed(2)})` });
    }

    let finalSalePaymentId = null;
    let finalChequeId = null;
    if (targetType === "SALE_PAYMENT") {
      if (!Number.isFinite(salePaymentId)) return res.status(400).json({ error: "salePaymentId required for SALE_PAYMENT" });
      const pay = await prisma.salePayment.findFirst({ where: { id: salePaymentId }, include: { sale: true } });
      if (!pay || pay.sale?.branchId !== branchId) return res.status(404).json({ error: "Sale payment not found in this branch" });
      finalSalePaymentId = salePaymentId;
    } else if (targetType === "CHEQUE") {
      if (!Number.isFinite(chequeId)) return res.status(400).json({ error: "chequeId required for CHEQUE" });
      const cheque = await prisma.cheque.findFirst({ where: { id: chequeId, branchId } });
      if (!cheque) return res.status(404).json({ error: "Cheque not found in this branch" });
      finalChequeId = chequeId;
    }

    const created = await prisma.bankStatementAllocation.create({
      data: {
        branchId,
        lineId,
        targetType,
        salePaymentId: finalSalePaymentId,
        chequeId: finalChequeId,
        amount,
        note,
        createdById: req.user?.id || null,
      },
      include: {
        salePayment: { include: { sale: { select: { id: true, invoiceNo: true } } } },
        cheque: { select: { id: true, chequeNo: true, bankName: true, amount: true, status: true } },
      },
    });
    res.status(201).json(created);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.deleteBankLineAllocation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const allocId = Number(req.params.allocId);
    if (!Number.isFinite(allocId)) return res.status(400).json({ error: "Invalid allocation id" });
    const row = await prisma.bankStatementAllocation.findFirst({
      where: { id: allocId },
      include: { line: { include: { import: true } } },
    });
    if (!row || row.line?.import?.branchId !== branchId) return res.status(404).json({ error: "Allocation not found" });
    if (String(row.line?.import?.status || "OPEN").toUpperCase() === "CLOSED") {
      return res.status(409).json({ error: "Import batch is CLOSED and cannot be modified" });
    }
    await prisma.bankStatementAllocation.delete({ where: { id: allocId } });
    res.json({ ok: true });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.postReconcileAdjustmentJournal = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    if (Number.isNaN(importId)) return res.status(400).json({ error: "Invalid import id" });
    await ensureImportOpenByImportId(branchId, importId);

    const lines = await prisma.bankStatementLine.findMany({
      where: { importId },
      select: { amount: true, direction: true, matchedSalePaymentId: true, matchedChequeId: true },
    });
    const credits = lines
      .filter((l) => String(l.direction || "").toUpperCase() === "CREDIT")
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const debits = lines
      .filter((l) => String(l.direction || "").toUpperCase() === "DEBIT")
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const netBank = credits - debits;
    const matchedKnown = lines
      .filter((l) => l.matchedSalePaymentId || l.matchedChequeId)
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const unmatchedNet = Number((netBank - matchedKnown).toFixed(2));
    const amount = Math.abs(unmatchedNet);
    if (amount < 0.01) {
      return res.status(400).json({ error: "No adjustment needed (difference is zero)" });
    }

    const narration = String(req.body?.narration || `Bank reconciliation adjustment for import #${importId}`).slice(0, 300);
    await ensureOpenFiscalPeriod(branchId);
    const created = await prisma.$transaction(async (tx) => {
      const accountMap = await getAccountMap(branchId, tx);
      const cash = accountMap.get("1100");
      const expense = accountMap.get("5200");
      const revenue = accountMap.get("4100");
      if (!cash || !expense || !revenue) {
        throw new Error("Required accounts missing: 1100/4100/5200");
      }
      const jLines =
        unmatchedNet > 0
          ? [
              { accountId: cash.id, debit: amount, credit: 0 },
              { accountId: revenue.id, debit: 0, credit: amount },
            ]
          : [
              { accountId: expense.id, debit: amount, credit: 0 },
              { accountId: cash.id, debit: 0, credit: amount },
            ];
      return tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "BANK_RECON_ADJUST",
          refId: importId,
          narration,
          lines: { create: jLines },
        },
        include: { lines: true },
      });
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_RECON_ADJUST_JOURNAL_CREATE",
      entity: "Journal",
      entityId: created.id,
      payload: {
        branchId,
        importId,
        difference: unmatchedNet,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.matchBankLineToPayment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    const salePaymentId = Number(req.body?.salePaymentId);
    const matchNote = req.body?.matchNote ? String(req.body.matchNote).slice(0, 240) : null;
    if (Number.isNaN(lineId)) return res.status(400).json({ error: "Invalid line id" });
    if (Number.isNaN(salePaymentId)) return res.status(400).json({ error: "salePaymentId required" });

    const lineRow = await ensureImportOpenByLineId(branchId, lineId);
    const payRow = await prisma.salePayment.findFirst({
      where: { id: salePaymentId },
      include: { sale: true },
    });
    if (!payRow || payRow.sale.branchId !== branchId) {
      return res.status(404).json({ error: "Sale payment not found in this branch" });
    }

    const existing = await prisma.bankStatementLine.findFirst({
      where: { matchedSalePaymentId: salePaymentId },
    });
    if (existing && existing.id !== lineRow.id) {
      return res.status(409).json({ error: "This SalePayment is already linked to another bank line" });
    }

    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        matchedSalePaymentId: salePaymentId,
        matchedAt: new Date(),
        matchNote,
      },
      include: {
        matchedSalePayment: {
          include: { sale: { select: { id: true, invoiceNo: true, branchId: true } } },
        },
      },
    });
    res.json(updated);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Payment already linked" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.unmatchBankLine = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    if (Number.isNaN(lineId)) return res.status(400).json({ error: "Invalid line id" });
    await ensureImportOpenByLineId(branchId, lineId);
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { matchedSalePaymentId: null, matchedAt: null, matchNote: null },
    });
    res.json(updated);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.closeBankImport = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    if (!Number.isFinite(importId)) return res.status(400).json({ error: "Invalid import id" });
    const existing = await prisma.bankStatementImport.findFirst({ where: { id: importId, branchId } });
    if (!existing) return res.status(404).json({ error: "Import batch not found" });
    if (String(existing.status || "OPEN").toUpperCase() === "CLOSED") {
      return res.status(400).json({ error: "Import is already CLOSED" });
    }
    const updated = await prisma.bankStatementImport.update({
      where: { id: importId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedById: req.user?.id || null,
        closingNote: String(req.body?.closingNote || "").slice(0, 190) || null,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_IMPORT_CLOSE",
      entity: "BankStatementImport",
      entityId: importId,
      payload: { branchId },
    });
    res.json(updated);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.reopenBankImport = async (req, res) => {
  try {
    const branchId = req.branchId;
    const importId = Number(req.params.importId);
    if (!Number.isFinite(importId)) return res.status(400).json({ error: "Invalid import id" });
    const existing = await prisma.bankStatementImport.findFirst({ where: { id: importId, branchId } });
    if (!existing) return res.status(404).json({ error: "Import batch not found" });
    if (String(existing.status || "OPEN").toUpperCase() !== "CLOSED") {
      return res.status(400).json({ error: "Import is already OPEN" });
    }
    const updated = await prisma.bankStatementImport.update({
      where: { id: importId },
      data: { status: "OPEN", closedAt: null, closedById: null, closingNote: null },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_IMPORT_REOPEN",
      entity: "BankStatementImport",
      entityId: importId,
      payload: { branchId },
    });
    res.json(updated);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getBankReconciliationSnapshot = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "ALL").toUpperCase();
    const from = req.query?.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query?.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const overdueOnly =
      String(req.query?.overdueOnly || "").toLowerCase() === "true" || String(req.query?.overdueOnly || "") === "1";
    const exceptionSlaHours = Math.max(1, Number(req.query?.exceptionSlaHours || 24));
    const imports = await prisma.bankStatementImport.findMany({
      where: {
        branchId,
        ...(status === "ALL" ? {} : { status }),
        ...(from || to
          ? {
              importedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ importedAt: "desc" }, { id: "desc" }],
      take: 200,
      include: {
        lines: {
          include: { allocations: true },
        },
      },
    });
    const importIds = imports.map((x) => x.id);
    const adjustments = importIds.length
      ? await prisma.journal.findMany({
          where: {
            branchId,
            refType: "BANK_RECON_ADJUST",
            refId: { in: importIds },
          },
          select: { id: true, refId: true, createdAt: true, narration: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const latestAdjustmentByImport = new Map();
    for (const j of adjustments) {
      const key = Number(j.refId || 0);
      if (!latestAdjustmentByImport.has(key)) latestAdjustmentByImport.set(key, j);
    }

    const rows = imports.map((imp) => {
      const lines = imp.lines || [];
      const creditLines = lines.filter((l) => String(l.direction || "").toUpperCase() === "CREDIT");
      const totalCredits = creditLines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
      const totalDebits = lines
        .filter((l) => String(l.direction || "").toUpperCase() === "DEBIT")
        .reduce((sum, l) => sum + Number(l.amount || 0), 0);
      const matchedEquivalent = creditLines.reduce((sum, l) => {
        const alloc = (l.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0);
        if (alloc > 0) return sum + Math.min(Number(l.amount || 0), alloc);
        if (l.matchedChequeId || l.matchedSalePaymentId) return sum + Number(l.amount || 0);
        return sum;
      }, 0);
      const matchedLinesCount = creditLines.filter((l) => {
        const alloc = (l.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0);
        return alloc > 0 || l.matchedChequeId || l.matchedSalePaymentId;
      }).length;
      const unmatchedAmount = Number((totalCredits - matchedEquivalent).toFixed(2));
      const matchedPct = totalCredits > 0 ? (matchedEquivalent / totalCredits) * 100 : 0;
      const adjustment = latestAdjustmentByImport.get(Number(imp.id));
      const now = Date.now();
      const openExceptions = lines.filter((l) => String(l.exceptionStatus || "NONE") === "OPEN");
      const overdueExceptions = openExceptions.filter((l) => {
        const raisedAt = l.exceptionRaisedAt ? new Date(l.exceptionRaisedAt).getTime() : null;
        if (!raisedAt) return false;
        const ageHours = (now - raisedAt) / (1000 * 60 * 60);
        return ageHours >= exceptionSlaHours;
      });
      return {
        importId: imp.id,
        label: imp.label || "",
        status: imp.status || "OPEN",
        importedAt: imp.importedAt,
        lineCount: lines.length,
        creditLineCount: creditLines.length,
        matchedLineCount: matchedLinesCount,
        totalCredits: Number(totalCredits.toFixed(2)),
        totalDebits: Number(totalDebits.toFixed(2)),
        matchedAmount: Number(matchedEquivalent.toFixed(2)),
        unmatchedAmount,
        matchedPct: Number(matchedPct.toFixed(2)),
        adjustmentPosted: Boolean(adjustment),
        adjustmentJournalId: adjustment?.id || null,
        openExceptionCount: openExceptions.length,
        overdueExceptionCount: overdueExceptions.length,
      };
    }).filter((row) => (overdueOnly ? Number(row.overdueExceptionCount || 0) > 0 : true));
    const summary = rows.reduce(
      (acc, row) => {
        acc.importCount += 1;
        acc.totalCredits += Number(row.totalCredits || 0);
        acc.totalMatched += Number(row.matchedAmount || 0);
        acc.totalUnmatched += Number(row.unmatchedAmount || 0);
        acc.openExceptionCount += Number(row.openExceptionCount || 0);
        acc.overdueExceptionCount += Number(row.overdueExceptionCount || 0);
        if (row.status === "CLOSED") acc.closedCount += 1;
        if (row.adjustmentPosted) acc.adjustedCount += 1;
        return acc;
      },
      {
        importCount: 0,
        closedCount: 0,
        adjustedCount: 0,
        totalCredits: 0,
        totalMatched: 0,
        totalUnmatched: 0,
        openExceptionCount: 0,
        overdueExceptionCount: 0,
      }
    );
    summary.totalCredits = Number(summary.totalCredits.toFixed(2));
    summary.totalMatched = Number(summary.totalMatched.toFixed(2));
    summary.totalUnmatched = Number(summary.totalUnmatched.toFixed(2));
    summary.matchedPct = summary.totalCredits > 0 ? Number(((summary.totalMatched / summary.totalCredits) * 100).toFixed(2)) : 0;
    res.json({ summary, rows });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportBankReconciliationSnapshotCSV = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "ALL").toUpperCase();
    const from = req.query?.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query?.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const overdueOnly =
      String(req.query?.overdueOnly || "").toLowerCase() === "true" || String(req.query?.overdueOnly || "") === "1";
    const exceptionSlaHours = Math.max(1, Number(req.query?.exceptionSlaHours || 24));
    const imports = await prisma.bankStatementImport.findMany({
      where: {
        branchId,
        ...(status === "ALL" ? {} : { status }),
        ...(from || to
          ? {
              importedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ importedAt: "desc" }, { id: "desc" }],
      take: 200,
      include: { lines: { include: { allocations: true } } },
    });
    const importIds = imports.map((x) => x.id);
    const adjustments = importIds.length
      ? await prisma.journal.findMany({
          where: { branchId, refType: "BANK_RECON_ADJUST", refId: { in: importIds } },
          select: { id: true, refId: true },
        })
      : [];
    const adjustedSet = new Set(adjustments.map((j) => Number(j.refId || 0)));
    const rows = imports.map((imp) => {
      const lines = imp.lines || [];
      const creditLines = lines.filter((l) => String(l.direction || "").toUpperCase() === "CREDIT");
      const totalCredits = creditLines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
      const matchedEquivalent = creditLines.reduce((sum, l) => {
        const alloc = (l.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0);
        if (alloc > 0) return sum + Math.min(Number(l.amount || 0), alloc);
        if (l.matchedChequeId || l.matchedSalePaymentId) return sum + Number(l.amount || 0);
        return sum;
      }, 0);
      const unmatchedAmount = Number((totalCredits - matchedEquivalent).toFixed(2));
      const matchedPct = totalCredits > 0 ? (matchedEquivalent / totalCredits) * 100 : 0;
      const now = Date.now();
      const openExceptions = lines.filter((l) => String(l.exceptionStatus || "NONE") === "OPEN");
      const overdueExceptions = openExceptions.filter((l) => {
        const raisedAt = l.exceptionRaisedAt ? new Date(l.exceptionRaisedAt).getTime() : null;
        if (!raisedAt) return false;
        const ageHours = (now - raisedAt) / (1000 * 60 * 60);
        return ageHours >= exceptionSlaHours;
      });
      return {
        import_id: imp.id,
        label: imp.label || "",
        status: imp.status || "OPEN",
        imported_at: imp.importedAt ? imp.importedAt.toISOString() : "",
        line_count: lines.length,
        credit_line_count: creditLines.length,
        total_credits: Number(totalCredits.toFixed(2)),
        matched_amount: Number(matchedEquivalent.toFixed(2)),
        unmatched_amount: unmatchedAmount,
        matched_pct: Number(matchedPct.toFixed(2)),
        adjustment_posted: adjustedSet.has(Number(imp.id)) ? "YES" : "NO",
        open_exceptions: openExceptions.length,
        overdue_exceptions: overdueExceptions.length,
      };
    }).filter((row) => (overdueOnly ? Number(row.overdue_exceptions || 0) > 0 : true));
    const csv = toCSV(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="bank-reconciliation-snapshot.csv"');
    res.send(csv);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.flagBankLineException = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    const reason = String(req.body?.reason || "").trim().slice(0, 120);
    const note = String(req.body?.note || "").trim().slice(0, 180) || null;
    if (!Number.isFinite(lineId)) return res.status(400).json({ error: "Invalid line id" });
    if (!reason) return res.status(400).json({ error: "reason is required" });
    const line = await prisma.bankStatementLine.findFirst({
      where: { id: lineId },
      include: { import: true },
    });
    if (!line || line.import?.branchId !== branchId) return res.status(404).json({ error: "Bank line not found" });
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        exceptionStatus: "OPEN",
        exceptionReason: reason,
        exceptionNote: note,
        exceptionRaisedAt: new Date(),
      },
      include: { exceptionResolvedBy: { select: { id: true, name: true, email: true } } },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_LINE_EXCEPTION_FLAG",
      entity: "BankStatementLine",
      entityId: lineId,
      payload: { branchId, reason, note },
    });
    res.json(updated);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.resolveBankLineException = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lineId = Number(req.params.lineId);
    const note = String(req.body?.note || "").trim().slice(0, 180) || null;
    if (!Number.isFinite(lineId)) return res.status(400).json({ error: "Invalid line id" });
    const line = await prisma.bankStatementLine.findFirst({
      where: { id: lineId },
      include: { import: true },
    });
    if (!line || line.import?.branchId !== branchId) return res.status(404).json({ error: "Bank line not found" });
    if (String(line.exceptionStatus || "NONE").toUpperCase() !== "OPEN") {
      return res.status(400).json({ error: "No open exception on this line" });
    }
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        exceptionStatus: "RESOLVED",
        exceptionNote: note || line.exceptionNote,
        exceptionResolvedAt: new Date(),
        exceptionResolvedById: req.user?.id || null,
      },
      include: { exceptionResolvedBy: { select: { id: true, name: true, email: true } } },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BANK_LINE_EXCEPTION_RESOLVE",
      entity: "BankStatementLine",
      entityId: lineId,
      payload: { branchId, note },
    });
    res.json(updated);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};
