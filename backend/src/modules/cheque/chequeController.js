const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

const VALID_DIRECTIONS = ["ISSUED", "RECEIVED"];
const VALID_STATUSES = ["PENDING", "DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"];
const VALID_LINKED_TYPES = ["SALE", "PURCHASE", "EXPENSE", "RECEIPT", "PAYMENT", "OTHER"];

const ALLOWED_TRANSITIONS = {
  PENDING: ["DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"],
  DEPOSITED: ["CLEARED", "BOUNCED", "CANCELLED"],
  CLEARED: [],
  BOUNCED: [],
  CANCELLED: [],
};

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sanitizeString(value, maxLen = 200) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s.slice(0, maxLen) : null;
}

function buildChequePayload(body, branchId) {
  const direction = String(body?.direction || "").toUpperCase();
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw new Error("direction must be ISSUED or RECEIVED");
  }
  const chequeNo = sanitizeString(body?.chequeNo, 60);
  if (!chequeNo) throw new Error("chequeNo is required");
  const bankName = sanitizeString(body?.bankName, 120);
  if (!bankName) throw new Error("bankName is required");
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be positive");
  const chequeDate = parseDate(body?.chequeDate);
  if (!chequeDate) throw new Error("chequeDate is required (yyyy-mm-dd)");
  const linkedType = body?.linkedType ? String(body.linkedType).toUpperCase() : null;
  if (linkedType && !VALID_LINKED_TYPES.includes(linkedType)) {
    throw new Error(`linkedType must be one of ${VALID_LINKED_TYPES.join(", ")}`);
  }
  const linkedId = body?.linkedId != null && body?.linkedId !== "" ? Number(body.linkedId) : null;
  if (linkedId != null && !Number.isFinite(linkedId)) throw new Error("linkedId must be numeric");
  const customerId = body?.customerId != null && body?.customerId !== "" ? Number(body.customerId) : null;
  if (customerId != null && !Number.isFinite(customerId)) throw new Error("customerId must be numeric");
  const supplierId = body?.supplierId != null && body?.supplierId !== "" ? Number(body.supplierId) : null;
  if (supplierId != null && !Number.isFinite(supplierId)) throw new Error("supplierId must be numeric");

  return {
    branchId,
    direction,
    chequeNo,
    bankName,
    bankBranch: sanitizeString(body?.bankBranch, 120),
    accountName: sanitizeString(body?.accountName, 120),
    accountNo: sanitizeString(body?.accountNo, 60),
    drawerName: sanitizeString(body?.drawerName, 120),
    payeeName: sanitizeString(body?.payeeName, 120),
    amount,
    chequeDate,
    linkedType,
    linkedId,
    customerId,
    supplierId,
    notes: sanitizeString(body?.notes, 500),
  };
}

async function logEvent(tx, chequeId, eventType, { fromStatus = null, toStatus = null, notes = null, actorId = null }) {
  await tx.chequeEvent.create({
    data: {
      chequeId,
      eventType,
      fromStatus,
      toStatus,
      notes: notes ? String(notes).slice(0, 500) : null,
      actorId,
    },
  });
}

async function getSystemAccountMap(tx, branchId) {
  const accounts = await tx.account.findMany({ where: { branchId } });
  return new Map(accounts.map((a) => [a.code, a]));
}

async function createChequeJournal(tx, {
  branchId,
  createdBy,
  refType,
  refId,
  narration,
  lines,
}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const normalized = lines
    .map((line) => ({
      accountId: Number(line.accountId || 0),
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
    }))
    .filter((line) => line.accountId > 0 && (line.debit > 0 || line.credit > 0));
  if (!normalized.length) return null;
  const debit = normalized.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = normalized.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.001) {
    throw new Error("Cheque accounting entry is not balanced");
  }
  return tx.journal.create({
    data: {
      branchId,
      createdBy: createdBy || null,
      refType,
      refId,
      narration,
      lines: { create: normalized },
    },
  });
}

async function createClearJournal(tx, cheque, actorId) {
  const map = await getSystemAccountMap(tx, cheque.branchId);
  const cash = map.get("1100");
  const chequeInHand = map.get("1110");
  const chequeIssued = map.get("2110");
  if (!cash || !chequeInHand || !chequeIssued) {
    throw new Error("Required cheque accounts are missing (1100/1110/2110)");
  }
  const amount = Number(cheque.amount || 0);
  if (!(amount > 0)) return null;
  const lines =
    cheque.direction === "RECEIVED"
      ? [
          { accountId: cash.id, debit: amount, credit: 0 },
          { accountId: chequeInHand.id, debit: 0, credit: amount },
        ]
      : [
          { accountId: chequeIssued.id, debit: amount, credit: 0 },
          { accountId: cash.id, debit: 0, credit: amount },
        ];
  return createChequeJournal(tx, {
    branchId: cheque.branchId,
    createdBy: actorId,
    refType: "CHEQUE_CLEAR",
    refId: cheque.id,
    narration: `Cheque clear ${cheque.chequeNo}`,
    lines,
  });
}

async function createBounceJournal(tx, cheque, { previousStatus = "PENDING", bounceFee = 0 }, actorId) {
  const map = await getSystemAccountMap(tx, cheque.branchId);
  const cash = map.get("1100");
  const chequeInHand = map.get("1110");
  const expense = map.get("5200");
  if (!cash || !chequeInHand || !expense) {
    throw new Error("Required cheque accounts are missing (1100/1110/5200)");
  }
  const lines = [];
  const amount = Number(cheque.amount || 0);
  if (cheque.direction === "RECEIVED" && previousStatus === "DEPOSITED" && amount > 0) {
    // Reverse the temporary cash effect for a deposited cheque that bounced before clearing.
    lines.push({ accountId: chequeInHand.id, debit: amount, credit: 0 });
    lines.push({ accountId: cash.id, debit: 0, credit: amount });
  }
  if (Number(bounceFee || 0) > 0) {
    lines.push({ accountId: expense.id, debit: Number(bounceFee), credit: 0 });
    lines.push({ accountId: cash.id, debit: 0, credit: Number(bounceFee) });
  }
  return createChequeJournal(tx, {
    branchId: cheque.branchId,
    createdBy: actorId,
    refType: "CHEQUE_BOUNCE",
    refId: cheque.id,
    narration: `Cheque bounce ${cheque.chequeNo}`,
    lines,
  });
}

exports.listCheques = async (req, res) => {
  try {
    const branchId = req.branchId;
    const direction = req.query.direction ? String(req.query.direction).toUpperCase() : null;
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const q = String(req.query.q || "").trim();

    const where = { branchId };
    if (direction && VALID_DIRECTIONS.includes(direction)) where.direction = direction;
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (from || to) {
      where.chequeDate = {};
      if (from) where.chequeDate.gte = from;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.chequeDate.lte = end;
      }
    }
    if (q) {
      where.OR = [
        { chequeNo: { contains: q } },
        { bankName: { contains: q } },
        { drawerName: { contains: q } },
        { payeeName: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    const rows = await prisma.cheque.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: [{ chequeDate: "desc" }, { id: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.summary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const grouped = await prisma.cheque.groupBy({
      by: ["direction", "status"],
      where: { branchId },
      _count: { _all: true },
      _sum: { amount: true },
    });

    const upcoming = await prisma.cheque.findMany({
      where: {
        branchId,
        status: "PENDING",
        chequeDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { chequeDate: "asc" },
      take: 20,
      select: {
        id: true,
        direction: true,
        chequeNo: true,
        bankName: true,
        amount: true,
        chequeDate: true,
        drawerName: true,
        payeeName: true,
      },
    });

    const overdueDeposit = await prisma.cheque.findMany({
      where: {
        branchId,
        direction: "RECEIVED",
        status: "PENDING",
        chequeDate: { lt: new Date() },
      },
      orderBy: { chequeDate: "asc" },
      take: 20,
      select: {
        id: true,
        chequeNo: true,
        bankName: true,
        amount: true,
        chequeDate: true,
        drawerName: true,
      },
    });

    res.json({ grouped, upcoming, overdueDeposit });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.getCheque = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const cheque = await prisma.cheque.findFirst({
      where: { id, branchId: req.branchId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        creator: { select: { id: true, name: true } },
        events: {
          orderBy: { id: "desc" },
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    });
    if (!cheque) return res.status(404).json({ error: "Cheque not found" });
    res.json(cheque);
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.createCheque = async (req, res) => {
  try {
    const branchId = req.branchId;
    const data = buildChequePayload(req.body, branchId);

    if (data.customerId) {
      const cust = await prisma.customer.findFirst({ where: { id: data.customerId, branchId } });
      if (!cust) return res.status(404).json({ error: "Customer not found in branch" });
    }
    if (data.supplierId) {
      const sup = await prisma.supplier.findFirst({ where: { id: data.supplierId, branchId } });
      if (!sup) return res.status(404).json({ error: "Supplier not found in branch" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const cheque = await tx.cheque.create({
        data: {
          ...data,
          status: "PENDING",
          createdById: req.user?.id || null,
        },
      });
      await logEvent(tx, cheque.id, "CREATED", {
        toStatus: "PENDING",
        notes: data.notes,
        actorId: req.user?.id || null,
      });
      return cheque;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "CHEQUE_CREATE",
      entity: "Cheque",
      entityId: created.id,
      payload: {
        branchId,
        direction: created.direction,
        chequeNo: created.chequeNo,
        bankName: created.bankName,
        amount: created.amount,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ error: "Same cheque number already exists for this bank in this branch" });
    }
    res.status(400).json({ error: err.message });
  }
};

exports.updateCheque = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.cheque.findFirst({ where: { id, branchId: req.branchId } });
    if (!existing) return res.status(404).json({ error: "Cheque not found" });
    if (existing.status !== "PENDING") {
      return res.status(400).json({ error: "Only PENDING cheques can be edited" });
    }
    const next = buildChequePayload({ ...existing, ...req.body, direction: req.body?.direction || existing.direction }, req.branchId);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.cheque.update({ where: { id }, data: next });
      await logEvent(tx, id, "UPDATED", {
        fromStatus: existing.status,
        toStatus: existing.status,
        notes: sanitizeString(req.body?.eventNote, 200),
        actorId: req.user?.id || null,
      });
      return row;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "CHEQUE_UPDATE",
      entity: "Cheque",
      entityId: id,
      payload: { branchId: req.branchId },
    });
    res.json(updated);
  } catch (err) {
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ error: "Same cheque number already exists for this bank in this branch" });
    }
    res.status(400).json({ error: err.message });
  }
};

async function transitionStatus(req, res, targetStatus, eventType, mutate) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.cheque.findFirst({ where: { id, branchId: req.branchId } });
    if (!existing) return res.status(404).json({ error: "Cheque not found" });
    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(targetStatus)) {
      return res.status(400).json({
        error: `Cannot move ${existing.status} → ${targetStatus}`,
      });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const data = await mutate(tx, existing, req);
      const eventDate =
        targetStatus === "CLEARED"
          ? data?.clearedDate || new Date()
          : targetStatus === "BOUNCED"
            ? data?.bounceDate || new Date()
            : targetStatus === "DEPOSITED"
              ? data?.depositDate || new Date()
              : new Date();
      await ensureOpenFiscalPeriod(req.branchId, eventDate);
      const row = await tx.cheque.update({
        where: { id },
        data: { status: targetStatus, ...data },
      });
      if (targetStatus === "CLEARED") {
        await createClearJournal(tx, row, req.user?.id || null);
      } else if (targetStatus === "BOUNCED") {
        await createBounceJournal(
          tx,
          row,
          {
            previousStatus: existing.status,
            bounceFee: Number(data?.bounceFee || 0),
          },
          req.user?.id || null
        );
      }
      await logEvent(tx, id, eventType, {
        fromStatus: existing.status,
        toStatus: targetStatus,
        notes: sanitizeString(req.body?.notes, 200),
        actorId: req.user?.id || null,
      });
      return row;
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: `CHEQUE_${eventType}`,
      entity: "Cheque",
      entityId: id,
      payload: {
        branchId: req.branchId,
        from: existing.status,
        to: targetStatus,
      },
    });
    res.json(updated);
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(400).json({ error: err.message });
  }
}

exports.depositCheque = (req, res) =>
  transitionStatus(req, res, "DEPOSITED", "DEPOSITED", async (_tx, existing, r) => {
    if (existing.direction !== "RECEIVED") {
      throw new Error("Only RECEIVED cheques can be deposited");
    }
    return { depositDate: parseDate(r.body?.depositDate) || new Date() };
  });

exports.clearCheque = (req, res) =>
  transitionStatus(req, res, "CLEARED", "CLEARED", async (_tx, _existing, r) => ({
    clearedDate: parseDate(r.body?.clearedDate) || new Date(),
  }));

exports.bounceCheque = (req, res) =>
  transitionStatus(req, res, "BOUNCED", "BOUNCED", async (_tx, _existing, r) => {
    const fee = Number(r.body?.bounceFee || 0);
    return {
      bounceDate: parseDate(r.body?.bounceDate) || new Date(),
      bounceReason: sanitizeString(r.body?.bounceReason, 200),
      bounceFee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
    };
  });

exports.cancelCheque = (req, res) =>
  transitionStatus(req, res, "CANCELLED", "CANCELLED", async () => ({}));
