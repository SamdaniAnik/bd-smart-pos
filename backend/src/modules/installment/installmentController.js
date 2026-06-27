const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const {
  sendBulkSms,
  renderSmsTemplate,
  isSmsConfigured,
  getProviderName,
} = require("../../utils/smsGateway");

const FREQUENCIES = ["WEEKLY", "MONTHLY"];

const DEFAULT_INSTALLMENT_REMINDER_TEMPLATE =
  "প্রিয় {name}, {store} এ আপনার কিস্তি ৳{amount} এর শেষ তারিখ {dueDate}। অনুগ্রহ করে সময়মতো পরিশোধ করুন। ধন্যবাদ।";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function addPeriod(date, frequency, count) {
  const d = new Date(date);
  if (frequency === "WEEKLY") {
    d.setDate(d.getDate() + 7 * count);
  } else {
    d.setMonth(d.getMonth() + count);
  }
  return d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Build the due schedule for a plan. Last row absorbs rounding remainder. */
function buildSchedule({ totalPayable, installmentCount, frequency, startDate }) {
  const rows = [];
  const base = round2(totalPayable / installmentCount);
  let allocated = 0;
  for (let i = 0; i < installmentCount; i += 1) {
    const isLast = i === installmentCount - 1;
    const amount = isLast ? round2(totalPayable - allocated) : base;
    allocated = round2(allocated + amount);
    rows.push({
      seqNo: i + 1,
      dueDate: addPeriod(startDate, frequency, i),
      amountDue: amount,
    });
  }
  return rows;
}

/** Decorate a payment row with a derived "OVERDUE" view status without mutating storage. */
function decoratePayment(row, today) {
  const remaining = round2(Number(row.amountDue || 0) - Number(row.amountPaid || 0));
  const isPaid = row.status === "PAID" || remaining <= 0;
  const overdue = !isPaid && new Date(row.dueDate) < today;
  return {
    ...row,
    remaining,
    displayStatus: isPaid ? "PAID" : overdue ? "OVERDUE" : row.status,
  };
}

function summarizePlan(plan, today) {
  const payments = (plan.payments || []).map((p) => decoratePayment(p, today));
  const paidAmount = round2(payments.reduce((s, p) => s + Number(p.amountPaid || 0), 0));
  const outstanding = round2(Number(plan.totalPayable || 0) - paidAmount);
  const overdueAmount = round2(
    payments
      .filter((p) => p.displayStatus === "OVERDUE")
      .reduce((s, p) => s + p.remaining, 0)
  );
  const nextDue = payments.find((p) => p.displayStatus !== "PAID") || null;
  return {
    ...plan,
    payments,
    paidAmount,
    outstanding,
    overdueAmount,
    nextDueDate: nextDue?.dueDate || null,
    nextDueAmount: nextDue ? nextDue.remaining : 0,
  };
}

exports.listPlans = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query.status || "").trim().toUpperCase();
    const customerId = Number(req.query.customerId) || null;
    const where = { branchId };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    const plans = await prisma.installmentPlan.findMany({
      where,
      include: { customer: true, payments: { orderBy: { seqNo: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const today = startOfToday();
    res.json(plans.map((p) => summarizePlan(p, today)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPlan = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid plan id" });
    const plan = await prisma.installmentPlan.findFirst({
      where: { id, branchId },
      include: { customer: true, payments: { orderBy: { seqNo: "asc" } } },
    });
    if (!plan) return res.status(404).json({ error: "Installment plan not found" });
    res.json(summarizePlan(plan, startOfToday()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const branchId = req.branchId;
    const body = req.body || {};
    const customerId = Number(body.customerId);
    if (!customerId) return res.status(400).json({ error: "Customer is required" });

    const customer = await prisma.customer.findFirst({ where: { id: customerId, branchId } });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const principalAmount = Math.max(0, Number(body.principalAmount || 0));
    const downPayment = Math.max(0, Number(body.downPayment || 0));
    if (!(principalAmount > 0)) return res.status(400).json({ error: "Principal amount must be greater than zero" });
    if (downPayment > principalAmount) {
      return res.status(400).json({ error: "Down payment cannot exceed the principal amount" });
    }
    const installmentCount = Math.max(1, Math.min(120, Math.floor(Number(body.installmentCount || 0))));
    if (!(installmentCount >= 1)) return res.status(400).json({ error: "Installment count must be at least 1" });
    const interestRate = Math.max(0, Math.min(200, Number(body.interestRate || 0)));
    const frequency = FREQUENCIES.includes(String(body.frequency || "").toUpperCase())
      ? String(body.frequency).toUpperCase()
      : "MONTHLY";
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: "Invalid start date" });

    const financedAmount = round2(principalAmount - downPayment);
    const interestAmount = round2((financedAmount * interestRate) / 100);
    const totalPayable = round2(financedAmount + interestAmount);
    if (!(totalPayable > 0)) {
      return res.status(400).json({ error: "Financed amount must be greater than zero" });
    }
    const schedule = buildSchedule({ totalPayable, installmentCount, frequency, startDate });
    const installmentAmount = schedule[0]?.amountDue || 0;

    const created = await prisma.installmentPlan.create({
      data: {
        branchId,
        customerId,
        saleId: body.saleId != null && !Number.isNaN(Number(body.saleId)) ? Number(body.saleId) : null,
        reference: body.reference ? String(body.reference).trim().slice(0, 191) : null,
        principalAmount,
        downPayment,
        financedAmount,
        interestRate,
        interestAmount,
        totalPayable,
        installmentCount,
        installmentAmount,
        frequency,
        startDate,
        note: body.note ? String(body.note).trim().slice(0, 191) : null,
        createdById: req.user?.id || null,
        payments: {
          create: schedule.map((row) => ({
            branchId,
            seqNo: row.seqNo,
            dueDate: row.dueDate,
            amountDue: row.amountDue,
          })),
        },
      },
      include: { customer: true, payments: { orderBy: { seqNo: "asc" } } },
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INSTALLMENT_PLAN_CREATE",
      entity: "InstallmentPlan",
      entityId: created.id,
      payload: { customerId, totalPayable, installmentCount, frequency },
    });

    res.status(201).json(summarizePlan(created, startOfToday()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.recordPayment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid plan id" });
    const amount = round2(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: "Payment amount must be greater than zero" });
    const method = String(req.body?.method || "Cash").trim() || "Cash";

    const result = await prisma.$transaction(async (tx) => {
      const plan = await tx.installmentPlan.findFirst({
        where: { id, branchId },
        include: { payments: { orderBy: { seqNo: "asc" } } },
      });
      if (!plan) throw Object.assign(new Error("Installment plan not found"), { httpStatus: 404 });
      if (plan.status === "CANCELLED") throw Object.assign(new Error("Plan is cancelled"), { httpStatus: 400 });

      const outstanding = round2(
        Number(plan.totalPayable || 0) -
          plan.payments.reduce((s, p) => s + Number(p.amountPaid || 0), 0)
      );
      if (amount > outstanding + 0.01) {
        throw Object.assign(new Error(`Payment exceeds outstanding balance ৳${outstanding.toFixed(2)}`), {
          httpStatus: 400,
        });
      }

      const voucher = await tx.receiptVoucher.create({
        data: {
          branchId,
          customerId: plan.customerId,
          amount,
          method,
          note: `Installment ${plan.reference || `#${plan.id}`}`,
        },
      });

      // Apply payment to oldest unpaid rows first.
      let remaining = amount;
      const unpaid = plan.payments
        .filter((p) => round2(p.amountDue - p.amountPaid) > 0)
        .sort((a, b) => a.seqNo - b.seqNo);
      for (const row of unpaid) {
        if (remaining <= 0) break;
        const due = round2(row.amountDue - row.amountPaid);
        const applied = Math.min(remaining, due);
        const newPaid = round2(row.amountPaid + applied);
        const fullyPaid = newPaid >= round2(row.amountDue) - 0.01;
        await tx.installmentPayment.update({
          where: { id: row.id },
          data: {
            amountPaid: newPaid,
            status: fullyPaid ? "PAID" : "PARTIAL",
            paidAt: fullyPaid ? new Date() : row.paidAt,
            receiptVoucherId: row.receiptVoucherId || voucher.id,
          },
        });
        remaining = round2(remaining - applied);
      }

      const refreshed = await tx.installmentPayment.findMany({ where: { planId: plan.id } });
      const allPaid = refreshed.every((p) => p.status === "PAID");
      const nextStatus = allPaid ? "COMPLETED" : "ACTIVE";
      if (nextStatus !== plan.status) {
        await tx.installmentPlan.update({ where: { id: plan.id }, data: { status: nextStatus } });
      }
      return { voucherId: voucher.id, status: nextStatus };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INSTALLMENT_PAYMENT",
      entity: "InstallmentPlan",
      entityId: id,
      payload: { amount, method, voucherId: result.voucherId },
    });

    const plan = await prisma.installmentPlan.findFirst({
      where: { id, branchId },
      include: { customer: true, payments: { orderBy: { seqNo: "asc" } } },
    });
    res.status(201).json(summarizePlan(plan, startOfToday()));
  } catch (error) {
    res.status(error.httpStatus || 500).json({ error: error.message });
  }
};

exports.cancelPlan = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid plan id" });
    const plan = await prisma.installmentPlan.findFirst({ where: { id, branchId } });
    if (!plan) return res.status(404).json({ error: "Installment plan not found" });
    if (plan.status === "COMPLETED") return res.status(400).json({ error: "Completed plans cannot be cancelled" });
    const updated = await prisma.installmentPlan.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INSTALLMENT_PLAN_CANCEL",
      entity: "InstallmentPlan",
      entityId: id,
      payload: {},
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Upcoming + overdue installments, for the dashboard and reminder picker. */
exports.listDueInstallments = async (req, res) => {
  try {
    const branchId = req.branchId;
    const withinDays = Math.max(0, Math.min(120, Number(req.query.withinDays || 7)));
    const today = startOfToday();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + withinDays);

    const rows = await prisma.installmentPayment.findMany({
      where: {
        branchId,
        status: { in: ["PENDING", "PARTIAL"] },
        dueDate: { lte: horizon },
        plan: { status: "ACTIVE" },
      },
      include: { plan: { include: { customer: true } } },
      orderBy: { dueDate: "asc" },
      take: 500,
    });
    res.json(
      rows.map((row) => {
        const decorated = decoratePayment(row, today);
        return {
          paymentId: row.id,
          planId: row.planId,
          seqNo: row.seqNo,
          dueDate: row.dueDate,
          amountDue: row.amountDue,
          amountPaid: row.amountPaid,
          remaining: decorated.remaining,
          displayStatus: decorated.displayStatus,
          customerId: row.plan?.customerId || null,
          customerName: row.plan?.customer?.name || "",
          customerPhone: row.plan?.customer?.phone || "",
          reference: row.plan?.reference || `#${row.planId}`,
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.sendReminders = async (req, res) => {
  try {
    const branchId = req.branchId;
    const withinDays = Math.max(0, Math.min(120, Number(req.body?.withinDays || 7)));
    const planIds = Array.isArray(req.body?.planIds)
      ? req.body.planIds.map(Number).filter((x) => !Number.isNaN(x))
      : [];
    const customTemplate = String(req.body?.messageTemplate || "").trim();
    const today = startOfToday();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + withinDays);

    const rows = await prisma.installmentPayment.findMany({
      where: {
        branchId,
        status: { in: ["PENDING", "PARTIAL"] },
        dueDate: { lte: horizon },
        plan: { status: "ACTIVE", ...(planIds.length ? { id: { in: planIds } } : {}) },
      },
      include: { plan: { include: { customer: true } } },
      orderBy: { dueDate: "asc" },
      take: 500,
    });

    // Keep the earliest due installment per customer to avoid spamming.
    const byCustomer = new Map();
    for (const row of rows) {
      const cid = row.plan?.customerId;
      const phone = String(row.plan?.customer?.phone || "").trim();
      if (!cid || !phone) continue;
      if (!byCustomer.has(cid)) byCustomer.set(cid, row);
    }
    if (!byCustomer.size) {
      return res.status(400).json({ error: "No due installments with customer phone numbers matched" });
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    const storeName = branch?.name || "আমাদের দোকান";
    const template = customTemplate || DEFAULT_INSTALLMENT_REMINDER_TEMPLATE;

    const recipients = [...byCustomer.values()].map((row) => {
      const remaining = round2(row.amountDue - row.amountPaid);
      return {
        customerId: row.plan.customerId,
        to: row.plan.customer.phone,
        message: renderSmsTemplate(template, {
          name: row.plan.customer.name || "গ্রাহক",
          store: storeName,
          amount: remaining.toFixed(2),
          dueDate: new Date(row.dueDate).toLocaleDateString("en-GB"),
        }),
      };
    });

    const { results, summary } = await sendBulkSms(recipients, { branchId, purpose: "INSTALLMENT_REMINDER" });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INSTALLMENT_REMINDER_SMS",
      entity: "InstallmentPlan",
      entityId: null,
      payload: { branchId, provider: getProviderName(), simulated: !isSmsConfigured(), summary },
    });

    res.json({
      message: isSmsConfigured()
        ? "Installment reminder SMS dispatched"
        : "Installment reminder SMS simulated (configure SMS_PROVIDER to send for real)",
      provider: getProviderName(),
      summary,
      results: results.map((x) => ({
        customerId: x.customerId,
        msisdn: x.msisdn,
        status: x.status,
        error: x.error || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
