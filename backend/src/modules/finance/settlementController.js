const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");

exports.importSettlement = async (req, res) => {
  try {
    const branchId = req.branchId;
    const provider = String(req.body?.provider || "MFS").trim() || "MFS";
    const periodStart = req.body?.periodStart ? new Date(req.body.periodStart) : new Date();
    const periodEnd = req.body?.periodEnd ? new Date(req.body.periodEnd) : new Date();
    const grossAmount = Number(req.body?.grossAmount || 0);
    const feeAmount = Number(req.body?.feeAmount || 0);
    const netAmount = Number(req.body?.netAmount ?? grossAmount - feeAmount);
    const externalRef = req.body?.externalRef ? String(req.body.externalRef).slice(0, 120) : null;
    const transactions = Array.isArray(req.body?.transactions) ? req.body.transactions : [];

    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      return res.status(400).json({ error: "Invalid period dates" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const settlement = await tx.paymentSettlement.create({
        data: {
          branchId,
          provider,
          periodStart,
          periodEnd,
          grossAmount,
          feeAmount,
          netAmount,
          externalRef,
          meta: { transactionCount: transactions.length },
        },
      });
      let matched = 0;
      const now = new Date();
      for (const t of transactions) {
        const channel = String(t?.channel || t?.trxId || t?.reference || "")
          .trim();
        if (!channel) continue;
        const payRows = await tx.salePayment.findMany({
          where: {
            channel,
            settlementId: null,
            sale: { branchId },
          },
          select: { id: true },
        });
        if (!payRows.length) continue;
        await tx.salePayment.updateMany({
          where: { id: { in: payRows.map((p) => p.id) } },
          data: { settlementId: settlement.id, reconciledAt: now },
        });
        matched += payRows.length;
      }
      return { settlement, matched };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SETTLEMENT_IMPORT",
      entity: "PaymentSettlement",
      entityId: result.settlement.id,
      payload: { branchId, matched: result.matched, provider },
    });

    res.status(201).json({
      settlement: result.settlement,
      matchedPayments: result.matched,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listSettlements = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.paymentSettlement.findMany({
      where: { branchId },
      orderBy: { id: "desc" },
      take: 200,
      include: { _count: { select: { payments: true } } },
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listUnmatchedPayments = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.salePayment.findMany({
      where: {
        settlementId: null,
        channel: { not: null },
        NOT: { method: { in: ["GIFTCARD", "WALLET"] } },
        sale: { branchId },
      },
      include: {
        sale: { select: { id: true, invoiceNo: true, createdAt: true, total: true } },
      },
      orderBy: { id: "desc" },
      take: 500,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createDigitalCashOut = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fromMethod = String(req.body?.fromMethod || "").trim();
    const toMethod = String(req.body?.toMethod || "Cash").trim() || "Cash";
    const amount = Number(req.body?.amount || 0);
    const note = String(req.body?.note || "").slice(0, 200) || null;
    if (!fromMethod) return res.status(400).json({ error: "fromMethod is required" });
    if (!toMethod) return res.status(400).json({ error: "toMethod is required" });
    if (fromMethod.toLowerCase() === toMethod.toLowerCase()) {
      return res.status(400).json({ error: "fromMethod and toMethod cannot be same" });
    }
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be positive" });

    await ensureOpenFiscalPeriod(branchId);

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "DIGITAL_CASH_TRANSFER",
      entity: "Branch",
      entityId: branchId,
      payload: {
        branchId,
        fromMethod,
        toMethod,
        amount,
        note,
      },
    });

    res.status(201).json({
      ok: true,
      fromMethod,
      toMethod,
      amount,
      note,
    });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.listDigitalCashOuts = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fromRaw = String(req.query?.from || "").trim();
    const toRaw = String(req.query?.to || "").trim();
    const where = {
      action: { in: ["DIGITAL_CASH_TRANSFER", "DIGITAL_CASH_OUT"] },
      entity: "Branch",
      entityId: branchId,
    };
    if (fromRaw || toRaw) {
      where.createdAt = {};
      if (fromRaw) where.createdAt.gte = new Date(`${fromRaw}T00:00:00.000Z`);
      if (toRaw) where.createdAt.lt = new Date(new Date(`${toRaw}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
