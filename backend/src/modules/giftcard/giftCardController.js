const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");

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
    const lq = parseListQuery(req, {
      searchableFields: ["code"],
      sortableFields: ["id", "code", "balance", "status", "expiresAt", "createdAt"],
      defaultSort: "id",
      defaultSortDir: "desc",
    });
    const where = {
      branchId,
      ...(status ? { status } : {}),
    };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [rows, total] = await prisma.$transaction([
        prisma.giftCard.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.giftCard.count({ where }),
      ]);
      return res.json(pagedResult({ data: rows, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const rows = await prisma.giftCard.findMany({
      where,
      orderBy: lq.orderBy || { id: "desc" },
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
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.listWalletBalances = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.customer.findMany({
      where: { branchId, storedValueBalance: { gt: 0 } },
      select: {
        id: true,
        name: true,
        phone: true,
        storedValueBalance: true,
      },
      orderBy: [{ storedValueBalance: "desc" }, { id: "asc" }],
      take: 1000,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cashOutCustomerWallet = async (req, res) => {
  try {
    const branchId = req.branchId;
    const customerId = Number(req.body?.customerId);
    const amount = Number(req.body?.amount || 0);
    const note = String(req.body?.note || "Wallet cash out to cash in hand").slice(0, 200);
    if (!customerId || Number.isNaN(customerId)) {
      return res.status(400).json({ error: "customerId required" });
    }
    if (!(amount > 0)) {
      return res.status(400).json({ error: "amount must be positive" });
    }

    await ensureOpenFiscalPeriod(branchId);

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, branchId } });
      if (!customer) throw new Error("Customer not found");
      if (Number(customer.storedValueBalance || 0) < amount) {
        throw new Error("Cash out amount exceeds wallet balance");
      }

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const cash = map.get("1100");
      const walletLiability = map.get("2130") || map.get("2100");
      if (!cash || !walletLiability) {
        throw new Error("Required accounts missing (1100 cash, 2130/2100 wallet liability)");
      }

      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { storedValueBalance: { decrement: amount } },
      });
      await tx.storedValueTxn.create({
        data: {
          customerId,
          type: "WALLET_CASH_OUT",
          amount,
          note,
        },
      });
      await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "WALLET_CASH_OUT",
          refId: customerId,
          narration: `Wallet cash out: ${customer.name}`,
          lines: {
            create: [
              { accountId: cash.id, debit: amount, credit: 0 },
              { accountId: walletLiability.id, debit: 0, credit: amount },
            ],
          },
        },
      });

      return updated;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "WALLET_CASH_OUT",
      entity: "Customer",
      entityId: customerId,
      payload: { branchId, amount, note },
    });

    res.json({ customer: result });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    const msg = String(err?.message || "");
    if (msg.includes("exceeds wallet balance")) return res.status(400).json({ error: msg });
    if (msg.includes("Customer not found")) return res.status(404).json({ error: msg });
    res.status(500).json({ error: msg || "Cash out failed" });
  }
};

exports.listWalletTransactions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fromRaw = String(req.query?.from || "").trim();
    const toRaw = String(req.query?.to || "").trim();
    const typeRaw = String(req.query?.type || "").trim().toUpperCase();
    const where = {
      customer: { branchId },
    };
    if (typeRaw && typeRaw !== "ALL") where.type = typeRaw;
    if (fromRaw || toRaw) {
      where.createdAt = {};
      if (fromRaw) where.createdAt.gte = new Date(`${fromRaw}T00:00:00.000Z`);
      if (toRaw) where.createdAt.lt = new Date(new Date(`${toRaw}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    const rows = await prisma.storedValueTxn.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportWalletTransactionsCsv = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fromRaw = String(req.query?.from || "").trim();
    const toRaw = String(req.query?.to || "").trim();
    const typeRaw = String(req.query?.type || "").trim().toUpperCase();
    const where = {
      customer: { branchId },
    };
    if (typeRaw && typeRaw !== "ALL") where.type = typeRaw;
    if (fromRaw || toRaw) {
      where.createdAt = {};
      if (fromRaw) where.createdAt.gte = new Date(`${fromRaw}T00:00:00.000Z`);
      if (toRaw) where.createdAt.lt = new Date(new Date(`${toRaw}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    const rows = await prisma.storedValueTxn.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const csvRows = rows.map((r) => ({
      id: r.id,
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : "",
      customer_id: r.customer?.id || "",
      customer_name: r.customer?.name || "",
      customer_phone: r.customer?.phone || "",
      type: r.type || "",
      amount: Number(r.amount || 0).toFixed(2),
      note: r.note || "",
    }));
    const headers = Object.keys(csvRows[0] || {
      id: "",
      created_at: "",
      customer_id: "",
      customer_name: "",
      customer_phone: "",
      type: "",
      amount: "",
      note: "",
    });
    const csv = [headers.join(",")]
      .concat(
        csvRows.map((row) =>
          headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(",")
        )
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="wallet-transactions.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
