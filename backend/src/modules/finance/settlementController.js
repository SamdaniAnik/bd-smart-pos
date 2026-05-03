const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");

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
