const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { executeTopup, inquireBill, reverseTopup, getProviderName } = require("../../utils/topupGateway");
const { sendSms, normalizeBdPhone, renderSmsTemplate } = require("../../utils/smsGateway");
const {
  MOBILE_OPERATORS,
  UTILITY_BILLERS,
  RECHARGE_TYPES,
  findOperator,
  findBiller,
  suggestRechargeCommission,
  suggestBillCommission,
} = require("../../constants/billers");

// Service ledger accounts (seeded by bootstrap). Float is an asset pre-loaded
// from the distributor; commission income is revenue earned per transaction.
const FLOAT_ACCOUNT = "1140";
const COMMISSION_ACCOUNT = "4150";
const CASH_ACCOUNT = "1100";
const BANK_ACCOUNT = "1130";
const RECEIVABLE_ACCOUNT = "1200";

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function resolvePayAccountCode(payMethod) {
  const method = String(payMethod || "Cash");
  if (method === "MFS") return BANK_ACCOUNT;
  if (method === "Due") return RECEIVABLE_ACCOUNT;
  return CASH_ACCOUNT;
}

async function buildAccountMap(tx, branchId) {
  const accounts = await tx.account.findMany({ where: { branchId } });
  return new Map(accounts.map((a) => [a.code, a]));
}

/**
 * Shared handler for both recharge and bill-pay. `type` is "RECHARGE" | "BILL".
 */
async function createTopupTransaction(req, res, type) {
  try {
    const branchId = req.branchId;
    const body = req.body || {};

    const operatorOrBiller = String(body.operatorOrBiller || "").trim().toUpperCase();
    const accountOrMsisdn = String(body.accountOrMsisdn || "").trim();
    const faceAmount = round2(body.faceAmount);
    const serviceCharge = Math.max(0, round2(body.serviceCharge));
    const payMethod = ["Cash", "MFS", "Due"].includes(String(body.payMethod))
      ? String(body.payMethod)
      : "Cash";
    const payChannel = body.payChannel ? String(body.payChannel).slice(0, 40) : null;
    const customerId = body.customerId != null && body.customerId !== "" ? Number(body.customerId) : null;
    const shiftId = body.shiftId != null && body.shiftId !== "" ? Number(body.shiftId) : null;
    const note = body.note ? String(body.note).slice(0, 200) : null;

    if (!operatorOrBiller) {
      return res.status(400).json({ error: type === "RECHARGE" ? "operator is required" : "biller is required" });
    }
    if (!accountOrMsisdn) {
      return res.status(400).json({ error: type === "RECHARGE" ? "mobile number is required" : "account/meter number is required" });
    }
    if (!(faceAmount > 0)) {
      return res.status(400).json({ error: "faceAmount must be positive" });
    }

    let category;
    let defaultCommission;
    if (type === "RECHARGE") {
      const operator = findOperator(operatorOrBiller);
      if (!operator) return res.status(400).json({ error: `Unknown operator: ${operatorOrBiller}` });
      const rechargeType = String(body.rechargeType || "PREPAID").toUpperCase();
      category = rechargeType === "SKITTO" ? "MOBILE" : "MOBILE";
      if (!RECHARGE_TYPES.includes(rechargeType)) {
        return res.status(400).json({ error: `Unknown recharge type: ${rechargeType}` });
      }
      defaultCommission = suggestRechargeCommission(operatorOrBiller, faceAmount);
    } else {
      const biller = findBiller(operatorOrBiller);
      if (!biller) return res.status(400).json({ error: `Unknown biller: ${operatorOrBiller}` });
      category = biller.category;
      defaultCommission = suggestBillCommission(operatorOrBiller, faceAmount);
    }

    const commission =
      body.commission != null && body.commission !== ""
        ? Math.max(0, round2(body.commission))
        : round2(defaultCommission);
    if (commission > faceAmount) {
      return res.status(400).json({ error: "commission cannot exceed faceAmount" });
    }
    if (customerId != null && Number.isNaN(customerId)) {
      return res.status(400).json({ error: "Invalid customerId" });
    }

    await ensureOpenFiscalPeriod(branchId, new Date(), {
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      permissions: req.permissions,
      actionName: "topup.create",
    });

    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, branchId } });
      if (!customer) return res.status(404).json({ error: "Customer not found in branch" });
    }

    // Call the provider first; only persist + post journals on a definitive result.
    const gatewayResult = await executeTopup({
      type,
      category,
      operatorOrBiller,
      accountOrMsisdn,
      faceAmount,
    });

    if (gatewayResult.status === "FAILED") {
      // Record the failed attempt for the audit trail (no journal, no float move).
      const failed = await prisma.utilityTransaction.create({
        data: {
          branchId,
          type,
          category,
          operatorOrBiller,
          accountOrMsisdn,
          faceAmount,
          serviceCharge,
          commission,
          payMethod,
          payChannel,
          status: "FAILED",
          providerRef: gatewayResult.providerRef || null,
          token: null,
          customerId: customerId || null,
          shiftId: shiftId || null,
          createdBy: req.user?.id || null,
          note: gatewayResult.error ? `Failed: ${gatewayResult.error}`.slice(0, 200) : note,
        },
      });
      return res.status(502).json({ error: gatewayResult.error || "Top-up failed", transaction: failed });
    }

    const payAccountCode = resolvePayAccountCode(payMethod);
    const floatConsumed = round2(faceAmount - commission);
    const incomeEarned = round2(commission + serviceCharge);
    const cashReceived = round2(faceAmount + serviceCharge);

    const txn = await prisma.$transaction(async (tx) => {
      const map = await buildAccountMap(tx, branchId);
      const floatAccount = map.get(FLOAT_ACCOUNT);
      const commissionAccount = map.get(COMMISSION_ACCOUNT);
      const payAccount = map.get(payAccountCode);
      if (!floatAccount || !commissionAccount || !payAccount) {
        throw new Error(
          `Required accounts missing (${FLOAT_ACCOUNT} float, ${COMMISSION_ACCOUNT} commission, ${payAccountCode} payment). Re-run bootstrap.`
        );
      }

      const created = await tx.utilityTransaction.create({
        data: {
          branchId,
          type,
          category,
          operatorOrBiller,
          accountOrMsisdn,
          faceAmount,
          serviceCharge,
          commission,
          payMethod,
          payChannel,
          status: "SUCCESS",
          providerRef: gatewayResult.providerRef || null,
          token: gatewayResult.token || null,
          customerId: customerId || null,
          shiftId: shiftId || null,
          createdBy: req.user?.id || null,
          note,
        },
      });

      await tx.branch.update({
        where: { id: branchId },
        data: { topupFloatBalance: { decrement: floatConsumed } },
      });

      const lines = [
        { accountId: payAccount.id, debit: cashReceived, credit: 0 },
        { accountId: floatAccount.id, debit: 0, credit: floatConsumed },
        { accountId: commissionAccount.id, debit: 0, credit: incomeEarned },
      ];

      await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: type === "RECHARGE" ? "TOPUP_RECHARGE" : "TOPUP_BILL",
          refId: created.id,
          narration:
            type === "RECHARGE"
              ? `Recharge ${operatorOrBiller} ${accountOrMsisdn} Tk ${faceAmount}`
              : `Bill ${operatorOrBiller} ${accountOrMsisdn} Tk ${faceAmount}`,
          lines: { create: lines },
        },
      });

      return created;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: type === "RECHARGE" ? "TOPUP_RECHARGE" : "TOPUP_BILL",
      entity: "UtilityTransaction",
      entityId: txn.id,
      payload: { branchId, operatorOrBiller, accountOrMsisdn, faceAmount, commission, payMethod },
    });

    // Fire-and-forget SMS confirmation to the customer's number when valid.
    const notifyTo = normalizeBdPhone(body.notifyPhone || accountOrMsisdn);
    if (notifyTo) {
      const template =
        type === "RECHARGE"
          ? "Recharge Tk {amount} to {number} successful. Ref: {ref}"
          : txn.token
            ? "Bill paid Tk {amount} for {number}. Token: {token} Ref: {ref}"
            : "Bill paid Tk {amount} for {number}. Ref: {ref}";
      const message = renderSmsTemplate(template, {
        amount: faceAmount,
        number: accountOrMsisdn,
        ref: txn.providerRef || "-",
        token: txn.token || "-",
      });
      sendSms({ to: notifyTo, message }).catch(() => {});
    }

    return res.status(201).json({ transaction: txn, provider: gatewayResult.provider });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    return res.status(500).json({ error: err.message });
  }
}

exports.createRecharge = (req, res) => createTopupTransaction(req, res, "RECHARGE");
exports.createBillPay = (req, res) => createTopupTransaction(req, res, "BILL");

/**
 * Validate a utility bill and fetch the amount due before paying. Inquiry-first
 * is the common BD counter flow (customer hands over a meter/account number).
 */
exports.billInquiry = async (req, res) => {
  try {
    const operatorOrBiller = String(req.body?.operatorOrBiller || "").trim().toUpperCase();
    const accountOrMsisdn = String(req.body?.accountOrMsisdn || "").trim();
    if (!operatorOrBiller) return res.status(400).json({ error: "biller is required" });
    if (!accountOrMsisdn) return res.status(400).json({ error: "account/meter number is required" });

    const biller = findBiller(operatorOrBiller);
    if (!biller) return res.status(400).json({ error: `Unknown biller: ${operatorOrBiller}` });

    const result = await inquireBill({
      category: biller.category,
      operatorOrBiller,
      accountOrMsisdn,
    });
    if (!result.valid) {
      return res.status(422).json({ error: result.error || "Bill could not be validated" });
    }
    const dueAmount = round2(result.dueAmount);
    res.json({
      provider: result.provider,
      biller: operatorOrBiller,
      category: biller.category,
      accountOrMsisdn,
      valid: true,
      dueAmount,
      customerName: result.customerName || null,
      billMonth: result.billMonth || null,
      suggestedCommission: round2(suggestBillCommission(operatorOrBiller, dueAmount)),
      simulated: Boolean(result.simulated),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Reverse/refund a previously successful top-up: reverse the GL journal, restore
 * the consumed float, and mark the transaction REVERSED. Idempotent per txn.
 */
exports.reverseTransaction = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid transaction id" });
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : "Customer reversal";

    const txn = await prisma.utilityTransaction.findFirst({ where: { id, branchId } });
    if (!txn) return res.status(404).json({ error: "Transaction not found" });
    if (txn.status === "REVERSED") return res.status(400).json({ error: "Transaction already reversed" });
    if (txn.status !== "SUCCESS") return res.status(400).json({ error: "Only successful transactions can be reversed" });

    await ensureOpenFiscalPeriod(branchId, new Date(), {
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      permissions: req.permissions,
      actionName: "topup.manage",
    });

    const gatewayResult = await reverseTopup({
      type: txn.type,
      category: txn.category,
      providerRef: txn.providerRef,
      amount: txn.faceAmount,
    });
    if (gatewayResult.status !== "REVERSED") {
      return res.status(502).json({ error: gatewayResult.error || "Provider reversal failed" });
    }

    const floatConsumed = round2(Number(txn.faceAmount) - Number(txn.commission));
    const incomeEarned = round2(Number(txn.commission) + Number(txn.serviceCharge));
    const cashReceived = round2(Number(txn.faceAmount) + Number(txn.serviceCharge));
    const payAccountCode = resolvePayAccountCode(txn.payMethod);

    const updated = await prisma.$transaction(async (tx) => {
      const map = await buildAccountMap(tx, branchId);
      const floatAccount = map.get(FLOAT_ACCOUNT);
      const commissionAccount = map.get(COMMISSION_ACCOUNT);
      const payAccount = map.get(payAccountCode);

      // Restore the float consumed by the original sale.
      await tx.branch.update({
        where: { id: branchId },
        data: { topupFloatBalance: { increment: floatConsumed } },
      });

      // Reverse the original journal (swap debit/credit sides).
      if (floatAccount && commissionAccount && payAccount) {
        await tx.journal.create({
          data: {
            branchId,
            createdBy: req.user?.id || null,
            refType: txn.type === "RECHARGE" ? "TOPUP_RECHARGE_REVERSAL" : "TOPUP_BILL_REVERSAL",
            refId: txn.id,
            narration: `Reversal of ${txn.type} ${txn.operatorOrBiller} ${txn.accountOrMsisdn} (${reason})`,
            lines: {
              create: [
                { accountId: payAccount.id, debit: 0, credit: cashReceived },
                { accountId: floatAccount.id, debit: floatConsumed, credit: 0 },
                { accountId: commissionAccount.id, debit: incomeEarned, credit: 0 },
              ],
            },
          },
        });
      }

      return tx.utilityTransaction.update({
        where: { id: txn.id },
        data: {
          status: "REVERSED",
          note: `${txn.note ? `${txn.note} | ` : ""}Reversed: ${reason} (ref ${gatewayResult.reversalRef})`.slice(0, 200),
        },
      });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "TOPUP_REVERSAL",
      entity: "UtilityTransaction",
      entityId: txn.id,
      payload: { branchId, reason, reversalRef: gatewayResult.reversalRef, simulated: Boolean(gatewayResult.simulated) },
    });

    res.json({ message: "Transaction reversed", transaction: updated, reversalRef: gatewayResult.reversalRef });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.listTransactions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const where = buildListWhere(branchId, req.query);
    const rows = await prisma.utilityTransaction.findMany({
      where,
      orderBy: { id: "desc" },
      take: 1000,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function buildListWhere(branchId, query) {
  const fromRaw = String(query?.from || "").trim();
  const toRaw = String(query?.to || "").trim();
  const typeRaw = String(query?.type || "").trim().toUpperCase();
  const statusRaw = String(query?.status || "").trim().toUpperCase();
  const where = { branchId };
  if (typeRaw && typeRaw !== "ALL") where.type = typeRaw;
  if (statusRaw && statusRaw !== "ALL") where.status = statusRaw;
  if (fromRaw || toRaw) {
    where.createdAt = {};
    if (fromRaw) where.createdAt.gte = new Date(`${fromRaw}T00:00:00.000Z`);
    if (toRaw) where.createdAt.lt = new Date(new Date(`${toRaw}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  }
  return where;
}

exports.summary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const [todayRows, branch] = await Promise.all([
      prisma.utilityTransaction.findMany({
        where: { branchId, status: "SUCCESS", createdAt: { gte: dayStart } },
        select: { type: true, faceAmount: true, commission: true, serviceCharge: true },
      }),
      prisma.branch.findUnique({ where: { id: branchId }, select: { topupFloatBalance: true } }),
    ]);

    const agg = todayRows.reduce(
      (acc, r) => {
        acc.count += 1;
        acc.faceTotal += Number(r.faceAmount || 0);
        acc.commissionTotal += Number(r.commission || 0) + Number(r.serviceCharge || 0);
        if (r.type === "RECHARGE") acc.rechargeCount += 1;
        else acc.billCount += 1;
        return acc;
      },
      { count: 0, faceTotal: 0, commissionTotal: 0, rechargeCount: 0, billCount: 0 }
    );

    res.json({
      provider: getProviderName(),
      floatBalance: round2(branch?.topupFloatBalance || 0),
      today: {
        count: agg.count,
        rechargeCount: agg.rechargeCount,
        billCount: agg.billCount,
        faceTotal: round2(agg.faceTotal),
        commissionTotal: round2(agg.commissionTotal),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listBillers = async (req, res) => {
  res.json({
    operators: MOBILE_OPERATORS,
    billers: UTILITY_BILLERS,
    rechargeTypes: RECHARGE_TYPES,
    provider: getProviderName(),
  });
};

exports.loadFloat = async (req, res) => {
  try {
    const branchId = req.branchId;
    const amount = round2(req.body?.amount);
    const source = String(req.body?.source || "Cash") === "Bank" ? "Bank" : "Cash";
    const note = req.body?.note ? String(req.body.note).slice(0, 200) : "Float top-up from distributor";
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be positive" });

    await ensureOpenFiscalPeriod(branchId, new Date(), {
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      permissions: req.permissions,
      actionName: "topup.float",
    });

    const result = await prisma.$transaction(async (tx) => {
      const map = await buildAccountMap(tx, branchId);
      const floatAccount = map.get(FLOAT_ACCOUNT);
      const sourceAccount = source === "Bank" ? map.get(BANK_ACCOUNT) : map.get(CASH_ACCOUNT);
      if (!floatAccount || !sourceAccount) {
        throw new Error(`Required accounts missing (${FLOAT_ACCOUNT} float, ${source === "Bank" ? BANK_ACCOUNT : CASH_ACCOUNT}). Re-run bootstrap.`);
      }
      const branch = await tx.branch.update({
        where: { id: branchId },
        data: { topupFloatBalance: { increment: amount } },
        select: { topupFloatBalance: true },
      });
      await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "TOPUP_FLOAT_LOAD",
          refId: null,
          narration: `Top-up float load (${source}) Tk ${amount}`,
          lines: {
            create: [
              { accountId: floatAccount.id, debit: amount, credit: 0 },
              { accountId: sourceAccount.id, debit: 0, credit: amount },
            ],
          },
        },
      });
      return branch;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "TOPUP_FLOAT_LOAD",
      entity: "Branch",
      entityId: branchId,
      payload: { branchId, amount, source, note },
    });

    res.json({ floatBalance: round2(result.topupFloatBalance || 0) });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    res.status(500).json({ error: err.message });
  }
};

exports.exportCsv = async (req, res) => {
  try {
    const branchId = req.branchId;
    const where = buildListWhere(branchId, req.query);
    const rows = await prisma.utilityTransaction.findMany({
      where,
      orderBy: { id: "desc" },
      take: 5000,
    });
    const csvRows = rows.map((r) => ({
      id: r.id,
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : "",
      type: r.type || "",
      category: r.category || "",
      operator_or_biller: r.operatorOrBiller || "",
      account_or_msisdn: r.accountOrMsisdn || "",
      face_amount: Number(r.faceAmount || 0).toFixed(2),
      service_charge: Number(r.serviceCharge || 0).toFixed(2),
      commission: Number(r.commission || 0).toFixed(2),
      pay_method: r.payMethod || "",
      pay_channel: r.payChannel || "",
      status: r.status || "",
      provider_ref: r.providerRef || "",
      token: r.token || "",
      note: r.note || "",
    }));
    const headers = Object.keys(
      csvRows[0] || {
        id: "",
        created_at: "",
        type: "",
        category: "",
        operator_or_biller: "",
        account_or_msisdn: "",
        face_amount: "",
        service_charge: "",
        commission: "",
        pay_method: "",
        pay_channel: "",
        status: "",
        provider_ref: "",
        token: "",
        note: "",
      }
    );
    const csv = [headers.join(",")]
      .concat(
        csvRows.map((row) => headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(","))
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="topup-transactions.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
