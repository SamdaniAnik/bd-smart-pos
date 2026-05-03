const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");

function generateGiftCode() {
  return `GC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

exports.issueGiftCard = async (req, res) => {
  try {
    const branchId = req.branchId;
    const initialAmount = Math.max(0, Number(req.body?.initialAmount || req.body?.amount || 0));
    if (initialAmount <= 0) return res.status(400).json({ error: "initialAmount must be positive" });
    const code = String(req.body?.code || "")
      .trim()
      .toUpperCase();
    const finalCode = code || generateGiftCode();
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const customerId = req.body?.customerId != null ? Number(req.body.customerId) : null;
    if (customerId && Number.isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    const dup = await prisma.giftCard.findUnique({ where: { code: finalCode } });
    if (dup) return res.status(400).json({ error: "Gift card code already exists" });

    if (customerId) {
      const cust = await prisma.customer.findFirst({ where: { id: customerId, branchId } });
      if (!cust) return res.status(404).json({ error: "Customer not found in branch" });
    }

    const card = await prisma.$transaction(async (tx) => {
      const created = await tx.giftCard.create({
        data: {
          branchId,
          code: finalCode,
          balance: initialAmount,
          status: "ACTIVE",
          expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
          customerId: customerId || null,
        },
      });
      await tx.storedValueTxn.create({
        data: {
          giftCardId: created.id,
          customerId: customerId || null,
          type: "LOAD",
          amount: initialAmount,
          note: "Issue",
        },
      });
      return created;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "GIFT_CARD_ISSUE",
      entity: "GiftCard",
      entityId: card.id,
      payload: { branchId, code: finalCode, initialAmount },
    });
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listGiftCards = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query.status || "").trim();
    const where = {
      branchId,
      ...(status ? { status } : {}),
    };
    const rows = await prisma.giftCard.findMany({
      where,
      orderBy: { id: "desc" },
      take: 500,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.validateGiftCard = async (req, res) => {
  try {
    const branchId = req.branchId;
    const code = String(req.body?.code || req.query?.code || "")
      .trim()
      .toUpperCase();
    if (!code) return res.status(400).json({ error: "code is required" });
    const card = await prisma.giftCard.findFirst({
      where: { branchId, code, status: "ACTIVE" },
    });
    if (!card) return res.status(404).json({ error: "Gift card not found or inactive" });
    if (card.expiresAt && new Date(card.expiresAt) < new Date()) {
      return res.status(400).json({ error: "Gift card expired" });
    }
    res.json({ code: card.code, balance: card.balance, id: card.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.loadCustomerWallet = async (req, res) => {
  try {
    const branchId = req.branchId;
    const customerId = Number(req.body?.customerId);
    const amount = Number(req.body?.amount || 0);
    if (Number.isNaN(customerId) || !customerId) return res.status(400).json({ error: "customerId required" });
    if (amount <= 0) return res.status(400).json({ error: "amount must be positive" });
    const customer = await prisma.customer.findFirst({ where: { id: customerId, branchId } });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: { storedValueBalance: { increment: amount } },
      });
      await tx.storedValueTxn.create({
        data: {
          customerId,
          type: "WALLET_LOAD",
          amount,
          note: String(req.body?.note || "Manual load").slice(0, 200),
        },
      });
      return tx.customer.findUnique({ where: { id: customerId } });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "WALLET_LOAD",
      entity: "Customer",
      entityId: customerId,
      payload: { branchId, amount },
    });
    res.json({ customer: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
