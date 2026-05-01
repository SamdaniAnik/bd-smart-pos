const prisma = require("../../utils/prisma");

function parsePaymentBreakdown(notes) {
  if (!notes) return [];
  try {
    const payload = JSON.parse(notes);
    if (!Array.isArray(payload?.paymentBreakdown)) return [];
    return payload.paymentBreakdown
      .map((x) => ({
        method: String(x?.method || "").trim(),
        amount: Number(x?.amount || 0),
      }))
      .filter((x) => x.method && x.amount > 0);
  } catch {
    return [];
  }
}

async function calculateExpectedCash(branchId, openedAt, closedAt = null) {
  const sales = await prisma.sale.findMany({
    where: {
      branchId,
      createdAt: {
        gte: openedAt,
        ...(closedAt ? { lte: closedAt } : {}),
      },
    },
    select: { paidAmount: true, paymentMethod: true, notes: true },
  });
  let expectedCash = 0;
  for (const sale of sales) {
    if (sale.paymentMethod === "Cash") {
      expectedCash += Number(sale.paidAmount || 0);
      continue;
    }
    if (sale.paymentMethod === "Split") {
      const splits = parsePaymentBreakdown(sale.notes);
      expectedCash += splits
        .filter((x) => x.method === "Cash")
        .reduce((sum, x) => sum + Number(x.amount || 0), 0);
    }
  }
  return expectedCash;
}

exports.openShift = async (req, res) => {
  try {
    const branchId = req.branchId;
    const userId = req.user?.id;
    const openingCash = Number(req.body.openingCash || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const existing = await prisma.shift.findFirst({
      where: { branchId, userId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
    if (existing) return res.status(400).json({ error: "You already have an open shift" });
    let register = await prisma.cashRegister.findFirst({ where: { branchId }, orderBy: { id: "asc" } });
    if (!register) {
      register = await prisma.cashRegister.create({ data: { branchId, name: "Main Register" } });
    }
    const shift = await prisma.shift.create({
      data: { branchId, userId, registerId: register.id, openingCash },
    });
    res.status(201).json(shift);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCurrentShift = async (req, res) => {
  try {
    const branchId = req.branchId;
    const userId = req.user?.id;
    const shift = await prisma.shift.findFirst({
      where: { branchId, userId, closedAt: null },
      orderBy: { openedAt: "desc" },
      include: { register: true },
    });
    if (!shift) return res.json(null);
    const expectedCash = await calculateExpectedCash(branchId, shift.openedAt);
    res.json({
      ...shift,
      expectedCash,
      variance: Number(shift.closingCash || 0) - expectedCash,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.closeShift = async (req, res) => {
  try {
    const branchId = req.branchId;
    const userId = req.user?.id;
    const closingCash = Number(req.body.closingCash || 0);
    const shift = await prisma.shift.findFirst({
      where: { branchId, userId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
    if (!shift) return res.status(404).json({ error: "No open shift found" });
    const expectedCash = await calculateExpectedCash(branchId, shift.openedAt);
    const closedAt = new Date();
    const updated = await prisma.shift.update({
      where: { id: shift.id },
      data: { closingCash, closedAt },
    });
    res.json({
      ...updated,
      expectedCash,
      variance: closingCash - expectedCash,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getShiftHistory = async (req, res) => {
  try {
    const branchId = req.branchId;
    const userId = req.user?.id;
    const shifts = await prisma.shift.findMany({
      where: { branchId, userId },
      include: { register: true },
      orderBy: { openedAt: "desc" },
      take: 30,
    });
    const rows = await Promise.all(
      shifts.map(async (shift) => {
        const expectedCash = await calculateExpectedCash(branchId, shift.openedAt, shift.closedAt || new Date());
        return {
          ...shift,
          expectedCash,
          variance: Number(shift.closingCash || 0) - expectedCash,
        };
      })
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
