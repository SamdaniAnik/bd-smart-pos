const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");

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

function getManagerPin() {
  return String(process.env.MANAGER_APPROVAL_PIN || "1234");
}

function getShiftVarianceApprovalThreshold() {
  return Math.max(0, Number(process.env.SHIFT_VARIANCE_APPROVAL_AMOUNT || 100));
}

function getShiftAnomalyThresholds() {
  return {
    discountPct: Math.max(1, Number(process.env.SHIFT_ALERT_DISCOUNT_PCT || 15)),
    returnPct: Math.max(1, Number(process.env.SHIFT_ALERT_RETURN_PCT || 8)),
    overrideCount: Math.max(1, Number(process.env.SHIFT_ALERT_OVERRIDE_COUNT || 3)),
    approvalCount: Math.max(1, Number(process.env.SHIFT_ALERT_APPROVAL_COUNT || 4)),
  };
}

async function buildShiftAnomalyMetrics({ branchId, userId, openedAt, closedAt = null }) {
  const thresholds = getShiftAnomalyThresholds();
  const periodWhere = {
    branchId,
    createdAt: {
      gte: openedAt,
      ...(closedAt ? { lte: closedAt } : {}),
    },
  };
  const sales = await prisma.sale.findMany({
    where: {
      ...periodWhere,
      cashierId: userId || undefined,
    },
    select: { id: true, total: true, discount: true },
  });
  const saleIds = sales.map((x) => Number(x.id)).filter(Boolean);
  const saleReturns = saleIds.length
    ? await prisma.saleReturn.findMany({
        where: {
          saleId: { in: saleIds },
          createdAt: {
            gte: openedAt,
            ...(closedAt ? { lte: closedAt } : {}),
          },
        },
        select: { amount: true },
      })
    : [];
  const approvalLogs = await prisma.auditLog.findMany({
    where: {
      userId: userId || null,
      createdAt: {
        gte: openedAt,
        ...(closedAt ? { lte: closedAt } : {}),
      },
      action: {
        in: [
          "APPROVAL_DISCOUNT",
          "APPROVAL_PRICE_OVERRIDE",
          "APPROVAL_RETURN",
          "APPROVAL_REDEMPTION",
          "APPROVAL_CREDIT_LIMIT",
        ],
      },
    },
    select: { action: true, payload: true },
  });

  const grossSales = Number(sales.reduce((sum, row) => sum + Number(row.total || 0), 0).toFixed(2));
  const discountAmount = Number(sales.reduce((sum, row) => sum + Number(row.discount || 0), 0).toFixed(2));
  const returnAmount = Number(saleReturns.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
  const discountPct = grossSales > 0 ? (discountAmount / grossSales) * 100 : 0;
  const returnPct = grossSales > 0 ? (returnAmount / grossSales) * 100 : 0;
  const overrideApprovals = approvalLogs.filter((x) => String(x.action) === "APPROVAL_PRICE_OVERRIDE");
  const approvalCount = approvalLogs.filter((x) => String(x.payload?.status || "").toUpperCase() === "APPROVED").length;
  const rejectedApprovalCount = approvalLogs.filter((x) => String(x.payload?.status || "").toUpperCase() === "REJECTED").length;
  const flags = {
    highDiscountRate: discountPct >= thresholds.discountPct,
    highReturnRate: returnPct >= thresholds.returnPct,
    highOverrideCount: overrideApprovals.length >= thresholds.overrideCount,
    frequentManagerApprovals: approvalCount >= thresholds.approvalCount,
  };
  const anomalyScore = Number(
    Math.min(
      100,
      (flags.highDiscountRate ? 30 : Math.max(0, (discountPct / thresholds.discountPct) * 20)) +
        (flags.highReturnRate ? 30 : Math.max(0, (returnPct / thresholds.returnPct) * 20)) +
        (flags.highOverrideCount ? 20 : Math.max(0, (overrideApprovals.length / thresholds.overrideCount) * 15)) +
        (flags.frequentManagerApprovals ? 20 : Math.max(0, (approvalCount / thresholds.approvalCount) * 15))
    ).toFixed(2)
  );
  const riskBand = anomalyScore >= 70 ? "HIGH" : anomalyScore >= 45 ? "MEDIUM" : "LOW";
  return {
    thresholds,
    grossSales,
    discountAmount,
    discountPct: Number(discountPct.toFixed(2)),
    returnAmount,
    returnPct: Number(returnPct.toFixed(2)),
    overrideApprovalCount: overrideApprovals.length,
    approvalCount,
    rejectedApprovalCount,
    flags,
    anomalyScore,
    riskBand,
  };
}

async function calculateCashSales(branchId, openedAt, closedAt = null) {
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
  let cashSales = 0;
  for (const sale of sales) {
    if (sale.paymentMethod === "Cash") {
      cashSales += Number(sale.paidAmount || 0);
      continue;
    }
    if (sale.paymentMethod === "Split") {
      const splits = parsePaymentBreakdown(sale.notes);
      cashSales += splits
        .filter((x) => x.method === "Cash")
        .reduce((sum, x) => sum + Number(x.amount || 0), 0);
    }
  }
  return cashSales;
}

async function getShiftMovementSummary(shiftId) {
  const movements = await prisma.drawerMovement.findMany({
    where: { shiftId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const cashIn = movements
    .filter((row) => row.type === "IN")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const cashOut = movements
    .filter((row) => row.type === "OUT")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return { movements, cashIn, cashOut };
}

async function buildShiftCashMetrics(shift, closedAt = null) {
  const cashSales = await calculateCashSales(shift.branchId, shift.openedAt, closedAt);
  const movementSummary = await getShiftMovementSummary(shift.id);
  const expectedCash =
    Number(shift.openingCash || 0) + cashSales + movementSummary.cashIn - movementSummary.cashOut;
  return {
    cashSales,
    cashIn: movementSummary.cashIn,
    cashOut: movementSummary.cashOut,
    expectedCash,
    movements: movementSummary.movements,
  };
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
    const metrics = await buildShiftCashMetrics(shift);
    const anomalies = await buildShiftAnomalyMetrics({
      branchId,
      userId,
      openedAt: shift.openedAt,
      closedAt: null,
    });
    res.json({
      ...shift,
      expectedCash: metrics.expectedCash,
      cashSales: metrics.cashSales,
      cashIn: metrics.cashIn,
      cashOut: metrics.cashOut,
      movements: metrics.movements,
      variance: shift.closingCash == null ? null : Number(shift.closingCash || 0) - metrics.expectedCash,
      anomalies,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.recordDrawerMovement = async (req, res) => {
  try {
    const branchId = req.branchId;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const type = String(req.body.type || "").toUpperCase();
    const amount = Number(req.body.amount || 0);
    const reason = String(req.body.reason || "").trim();
    if (!["IN", "OUT"].includes(type)) {
      return res.status(400).json({ error: "Movement type must be IN or OUT" });
    }
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
    if (!reason) return res.status(400).json({ error: "Reason is required" });
    const shift = await prisma.shift.findFirst({
      where: { branchId, userId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
    if (!shift) return res.status(404).json({ error: "No open shift found" });
    const movement = await prisma.drawerMovement.create({
      data: {
        shiftId: shift.id,
        branchId,
        userId,
        type,
        amount,
        reason: reason.slice(0, 191),
      },
    });
    res.status(201).json(movement);
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
    const varianceReason = String(req.body.varianceReason || "").trim();
    const managerApprovalPin = String(req.body.managerApprovalPin || "");
    const metrics = await buildShiftCashMetrics(shift);
    const expectedCash = metrics.expectedCash;
    const closedAt = new Date();
    const variance = closingCash - expectedCash;
    const absVariance = Math.abs(variance);
    if (absVariance > 0 && !varianceReason) {
      return res.status(400).json({ error: "Variance reason is required when counted cash differs" });
    }
    if (absVariance >= getShiftVarianceApprovalThreshold()) {
      if (managerApprovalPin !== getManagerPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_SHIFT_VARIANCE",
          entity: "Shift",
          entityId: shift.id,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for large shift variance",
            amount: absVariance,
            meta: { variance, threshold: getShiftVarianceApprovalThreshold() },
          },
        });
        return res.status(403).json({ error: "Manager approval PIN required for large shift variance" });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_SHIFT_VARIANCE",
        entity: "Shift",
        entityId: shift.id,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved shift variance",
          amount: absVariance,
          meta: { variance, threshold: getShiftVarianceApprovalThreshold() },
        },
      });
    }
    const updated = await prisma.shift.update({
      where: { id: shift.id },
      data: {
        closingCash,
        closedAt,
        varianceReason: absVariance > 0 ? varianceReason.slice(0, 191) : null,
      },
    });
    res.json({
      ...updated,
      expectedCash,
      cashSales: metrics.cashSales,
      cashIn: metrics.cashIn,
      cashOut: metrics.cashOut,
      variance,
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
        const metrics = await buildShiftCashMetrics(shift, shift.closedAt || new Date());
        const anomalies = await buildShiftAnomalyMetrics({
          branchId,
          userId,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt || new Date(),
        });
        return {
          ...shift,
          expectedCash: metrics.expectedCash,
          cashSales: metrics.cashSales,
          cashIn: metrics.cashIn,
          cashOut: metrics.cashOut,
          variance: Number(shift.closingCash || 0) - metrics.expectedCash,
          anomalyScore: anomalies.anomalyScore,
          anomalyRiskBand: anomalies.riskBand,
          anomalyFlags: anomalies.flags,
        };
      })
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
