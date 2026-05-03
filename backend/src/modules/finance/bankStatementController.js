const prisma = require("../../utils/prisma");

function parseDateFlexible(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
      select: { id: true, label: true, importedAt: true },
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
      },
    });
    res.json({ import: parent, lines });
  } catch (error) {
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

    const lineRow = await prisma.bankStatementLine.findFirst({
      where: { id: lineId },
      include: { import: true },
    });
    if (!lineRow || lineRow.import.branchId !== branchId) {
      return res.status(404).json({ error: "Bank line not found" });
    }
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
    const lineRow = await prisma.bankStatementLine.findFirst({
      where: { id: lineId },
      include: { import: true },
    });
    if (!lineRow || lineRow.import.branchId !== branchId) {
      return res.status(404).json({ error: "Bank line not found" });
    }
    const updated = await prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { matchedSalePaymentId: null, matchedAt: null, matchNote: null },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
