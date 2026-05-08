const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

const TXN_TYPES = new Set(["TOPUP", "SPEND", "REPLENISH"]);

function clean(value, max = 191) {
  return String(value || "").trim().slice(0, max);
}

function parseDate(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getSystemAccountMap(tx, branchId) {
  const accounts = await tx.account.findMany({ where: { branchId } });
  return new Map(accounts.map((a) => [a.code, a]));
}

async function createJournalForTxn(tx, { branchId, type, amount, fundName, refId, userId }) {
  const accounts = await getSystemAccountMap(tx, branchId);
  const cash = accounts.get("1100");
  const pettyCash = accounts.get("1120");
  const expense = accounts.get("5200");
  if (!cash || !pettyCash || !expense) {
    throw new Error("Required accounts missing: 1100 Cash In Hand, 1120 Petty Cash, 5200 Operating Expense");
  }
  if (type === "SPEND") {
    const journal = await tx.journal.create({
      data: {
        branchId,
        createdBy: userId || null,
        refType: "PETTY_CASH_SPEND",
        refId,
        narration: `Petty cash spend from ${fundName}`,
        lines: {
          create: [
            { accountId: expense.id, debit: amount, credit: 0 },
            { accountId: pettyCash.id, debit: 0, credit: amount },
          ],
        },
      },
    });
    return journal.id;
  }
  const refType = type === "TOPUP" ? "PETTY_CASH_TOPUP" : "PETTY_CASH_REPLENISH";
  const journal = await tx.journal.create({
    data: {
      branchId,
      createdBy: userId || null,
      refType,
      refId,
      narration: `Petty cash ${type.toLowerCase()} for ${fundName}`,
      lines: {
        create: [
          { accountId: pettyCash.id, debit: amount, credit: 0 },
          { accountId: cash.id, debit: 0, credit: amount },
        ],
      },
    },
  });
  return journal.id;
}

exports.listFunds = async (req, res) => {
  try {
    const branchId = req.branchId;
    const active = String(req.query?.active || "").trim();
    const rows = await prisma.pettyCashFund.findMany({
      where: {
        branchId,
        ...(active === "1" ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: "desc" }, { id: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createFund = async (req, res) => {
  try {
    const branchId = req.branchId;
    const name = clean(req.body?.name, 120);
    const custodianName = clean(req.body?.custodianName, 120) || null;
    const imprestAmount = Number(req.body?.imprestAmount || 0);
    const startingBalance = req.body?.currentBalance ?? imprestAmount;
    const currentBalance = Number(startingBalance || 0);
    const note = clean(req.body?.note, 191) || null;
    if (!name) return res.status(400).json({ error: "name is required" });
    if (imprestAmount < 0 || currentBalance < 0) {
      return res.status(400).json({ error: "imprestAmount/currentBalance cannot be negative" });
    }
    const created = await prisma.pettyCashFund.create({
      data: {
        branchId,
        name,
        custodianName,
        imprestAmount,
        currentBalance,
        note,
        isActive: req.body?.isActive !== false,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PETTY_CASH_FUND_CREATE",
      entity: "PettyCashFund",
      entityId: created.id,
      payload: { branchId, name, custodianName, imprestAmount, currentBalance },
    });
    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateFund = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.pettyCashFund.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Fund not found" });

    const data = {};
    if (req.body?.name != null) {
      const name = clean(req.body.name, 120);
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      data.name = name;
    }
    if (req.body?.custodianName != null) data.custodianName = clean(req.body.custodianName, 120) || null;
    if (req.body?.imprestAmount != null) {
      const amount = Number(req.body.imprestAmount);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Invalid imprestAmount" });
      data.imprestAmount = amount;
    }
    if (req.body?.isActive != null) data.isActive = Boolean(req.body.isActive);
    if (req.body?.note != null) data.note = clean(req.body.note, 191) || null;

    const updated = await prisma.pettyCashFund.update({ where: { id }, data });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PETTY_CASH_FUND_UPDATE",
      entity: "PettyCashFund",
      entityId: updated.id,
      payload: data,
    });
    res.json(updated);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.listTransactions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fundId = req.query?.fundId != null && req.query?.fundId !== "" ? Number(req.query.fundId) : null;
    const rows = await prisma.pettyCashTxn.findMany({
      where: {
        branchId,
        ...(fundId && Number.isFinite(fundId) ? { fundId } : {}),
      },
      include: {
        fund: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ txnDate: "desc" }, { id: "desc" }],
      take: 1000,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.postTransaction = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fundId = Number(req.body?.fundId);
    const type = String(req.body?.type || "").trim().toUpperCase();
    const amount = Number(req.body?.amount || 0);
    const txnDate = parseDate(req.body?.txnDate);
    const description = clean(req.body?.description, 191) || null;

    if (!Number.isFinite(fundId) || fundId <= 0) return res.status(400).json({ error: "valid fundId is required" });
    if (!TXN_TYPES.has(type)) return res.status(400).json({ error: "type must be TOPUP/SPEND/REPLENISH" });
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be greater than 0" });
    if (!txnDate) return res.status(400).json({ error: "valid txnDate is required" });
    await ensureOpenFiscalPeriod(branchId, txnDate);

    const result = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.findFirst({ where: { id: fundId, branchId } });
      if (!fund) throw new Error("Fund not found");
      if (!fund.isActive) throw new Error("Fund is inactive");
      const currentBalance = Number(fund.currentBalance || 0);
      if (type === "SPEND" && amount > currentBalance) {
        throw new Error("Spend amount exceeds current fund balance");
      }
      const created = await tx.pettyCashTxn.create({
        data: {
          branchId,
          fundId,
          type,
          amount,
          txnDate,
          description,
          createdById: req.user?.id || null,
        },
      });
      const journalId = await createJournalForTxn(tx, {
        branchId,
        type,
        amount,
        fundName: fund.name,
        refId: created.id,
        userId: req.user?.id || null,
      });
      const nextBalance = type === "SPEND" ? currentBalance - amount : currentBalance + amount;
      await tx.pettyCashFund.update({
        where: { id: fundId },
        data: { currentBalance: Number(nextBalance.toFixed(2)) },
      });
      const updated = await tx.pettyCashTxn.update({
        where: { id: created.id },
        data: { journalId },
        include: {
          fund: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      return { ...updated, nextBalance: Number(nextBalance.toFixed(2)) };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: `PETTY_CASH_${type}`,
      entity: "PettyCashTxn",
      entityId: result.id,
      payload: { branchId, fundId, amount, txnDate: txnDate.toISOString(), journalId: result.journalId },
    });
    res.status(201).json(result);
  } catch (error) {
    const message = error.message || "Failed to post petty cash transaction";
    const status = /not found|inactive|exceeds/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
};

exports.listClaims = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "").trim().toUpperCase();
    const fundId = req.query?.fundId != null && req.query?.fundId !== "" ? Number(req.query.fundId) : null;
    const rows = await prisma.pettyCashClaim.findMany({
      where: {
        branchId,
        ...(status ? { status } : {}),
        ...(fundId && Number.isFinite(fundId) ? { fundId } : {}),
      },
      include: {
        fund: { select: { id: true, name: true } },
        txn: { select: { id: true, type: true, amount: true, txnDate: true, description: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ claimDate: "desc" }, { id: "desc" }],
      take: 1000,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createClaim = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fundId = Number(req.body?.fundId);
    const txnId = req.body?.txnId != null && req.body?.txnId !== "" ? Number(req.body.txnId) : null;
    const amount = Number(req.body?.amount || 0);
    const claimDate = parseDate(req.body?.claimDate);
    const description = clean(req.body?.description, 191) || null;
    const attachmentNote = clean(req.body?.attachmentNote, 191) || null;
    if (!Number.isFinite(fundId) || fundId <= 0) return res.status(400).json({ error: "valid fundId is required" });
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be > 0" });
    if (!claimDate) return res.status(400).json({ error: "valid claimDate is required" });
    await ensureOpenFiscalPeriod(branchId, claimDate);
    const created = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.findFirst({ where: { id: fundId, branchId } });
      if (!fund) throw new Error("Fund not found");
      if (txnId) {
        const txn = await tx.pettyCashTxn.findFirst({ where: { id: txnId, branchId, fundId } });
        if (!txn) throw new Error("Referenced petty cash transaction not found");
      }
      const claim = await tx.pettyCashClaim.create({
        data: {
          branchId,
          fundId,
          txnId,
          amount,
          claimDate,
          description,
          attachmentNote,
          status: "PENDING",
          createdById: req.user?.id || null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user?.id || null,
          action: "APPROVAL_PETTY_CASH_CLAIM",
          entity: "PettyCashClaim",
          entityId: claim.id,
          payload: {
            status: "PENDING",
            amount,
            reason: description || "Petty cash reimbursement claim",
            branchId,
            fundId,
          },
        },
      });
      return claim;
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PETTY_CASH_CLAIM_CREATE",
      entity: "PettyCashClaim",
      entityId: created.id,
      payload: { branchId, fundId, txnId, amount },
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.approveClaim = async (req, res) => {
  try {
    const branchId = req.branchId;
    const roleName = String(req.user?.role?.name || "").toLowerCase();
    if (!["admin", "manager"].includes(roleName)) {
      return res.status(403).json({ error: "Only Manager/Admin can approve claims" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid claim id" });
    const remark = clean(req.body?.remark, 191) || null;

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.pettyCashClaim.findFirst({
        where: { id, branchId },
        include: { fund: { select: { id: true, name: true } } },
      });
      if (!claim) throw new Error("Claim not found");
      if (claim.status !== "PENDING") throw new Error("Only pending claim can be approved");
      await ensureOpenFiscalPeriod(branchId, claim.claimDate || new Date());
      const accounts = await getSystemAccountMap(tx, branchId);
      const expense = accounts.get("5200");
      const cash = accounts.get("1100");
      if (!expense || !cash) throw new Error("Required accounts missing: 5200 and 1100");
      const journal = await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "PETTY_CASH_CLAIM_REIMBURSE",
          refId: claim.id,
          narration: `Petty cash claim reimbursement (${claim.fund?.name || `Fund#${claim.fundId}`})`,
          lines: {
            create: [
              { accountId: expense.id, debit: Number(claim.amount || 0), credit: 0 },
              { accountId: cash.id, debit: 0, credit: Number(claim.amount || 0) },
            ],
          },
        },
      });
      const updated = await tx.pettyCashClaim.update({
        where: { id: claim.id },
        data: {
          status: "APPROVED",
          reviewedById: req.user?.id || null,
          reviewedAt: new Date(),
          reviewRemark: remark,
          journalId: journal.id,
        },
      });
      await tx.auditLog.updateMany({
        where: { action: "APPROVAL_PETTY_CASH_CLAIM", entity: "PettyCashClaim", entityId: claim.id },
        data: {
          payload: {
            status: "APPROVED",
            amount: Number(claim.amount || 0),
            reason: claim.description || "Petty cash reimbursement claim",
            reviewedBy: req.user?.id || null,
            reviewedAt: new Date().toISOString(),
            reviewRemark: remark || "",
          },
        },
      });
      return { ...updated, journalId: journal.id };
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PETTY_CASH_CLAIM_APPROVE",
      entity: "PettyCashClaim",
      entityId: id,
      payload: { journalId: result.journalId, remark: remark || "" },
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.rejectClaim = async (req, res) => {
  try {
    const branchId = req.branchId;
    const roleName = String(req.user?.role?.name || "").toLowerCase();
    if (!["admin", "manager"].includes(roleName)) {
      return res.status(403).json({ error: "Only Manager/Admin can reject claims" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid claim id" });
    const remark = clean(req.body?.remark, 191) || null;
    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.pettyCashClaim.findFirst({ where: { id, branchId } });
      if (!claim) throw new Error("Claim not found");
      if (claim.status !== "PENDING") throw new Error("Only pending claim can be rejected");
      const row = await tx.pettyCashClaim.update({
        where: { id: claim.id },
        data: {
          status: "REJECTED",
          reviewedById: req.user?.id || null,
          reviewedAt: new Date(),
          reviewRemark: remark,
        },
      });
      await tx.auditLog.updateMany({
        where: { action: "APPROVAL_PETTY_CASH_CLAIM", entity: "PettyCashClaim", entityId: claim.id },
        data: {
          payload: {
            status: "REJECTED",
            amount: Number(claim.amount || 0),
            reason: claim.description || "Petty cash reimbursement claim",
            reviewedBy: req.user?.id || null,
            reviewedAt: new Date().toISOString(),
            reviewRemark: remark || "",
          },
        },
      });
      return row;
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PETTY_CASH_CLAIM_REJECT",
      entity: "PettyCashClaim",
      entityId: id,
      payload: { remark: remark || "" },
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
