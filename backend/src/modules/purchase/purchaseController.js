const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const { resolveFundingAccountCode } = require("../../utils/fundingAccount");
const PDFDocument = require("pdfkit");

async function getSystemAccount(branchId, code, tx = null) {
  const db = tx || prisma;
  return db.account.findFirst({ where: { branchId, code } });
}

async function ensureBankLoanPayableAccount(tx, branchId) {
  return tx.account.upsert({
    where: { branchId_code: { branchId, code: "2320" } },
    update: {},
    create: {
      branchId,
      code: "2320",
      name: "Bank Loans Payable",
      type: "Liability",
      isSystem: true,
    },
  });
}

async function ensurePurchaseExtraCostAccounts(tx, branchId) {
  const transportation = await tx.account.upsert({
    where: { branchId_code: { branchId, code: "5211" } },
    update: {},
    create: {
      branchId,
      code: "5211",
      name: "Transportation Expense",
      type: "Expense",
      isSystem: true,
    },
  });
  const bribes = await tx.account.upsert({
    where: { branchId_code: { branchId, code: "5212" } },
    update: {},
    create: {
      branchId,
      code: "5212",
      name: "Bribes / Compliance Risk Cost",
      type: "Expense",
      isSystem: true,
    },
  });
  const extraOther = await tx.account.upsert({
    where: { branchId_code: { branchId, code: "5213" } },
    update: {},
    create: {
      branchId,
      code: "5213",
      name: "Other Purchase-related Expense",
      type: "Expense",
      isSystem: true,
    },
  });
  return { transportation, bribes, extraOther };
}

function getManagerApprovalPin() {
  return String(process.env.MANAGER_APPROVAL_PIN || "1234");
}

function normalizeVendorBillAttachments(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: String(item?.name || "").trim().slice(0, 160),
      url: String(item?.url || "").trim().slice(0, 500),
      mimeType: String(item?.mimeType || "").trim().slice(0, 80),
      size: Number(item?.size || 0),
      note: String(item?.note || "").trim().slice(0, 200),
    }))
    .filter((x) => x.name && x.url)
    .slice(0, 20);
}

function normalizeVendorBillPayload(payload = {}, fallback = {}) {
  const current = payload || {};
  return {
    branchId: Number(current.branchId || fallback.branchId || 0),
    purchaseId: Number(current.purchaseId || fallback.purchaseId || 0),
    billNo: String(current.billNo || "").trim(),
    dueDate: current.dueDate || null,
    note: String(current.note || "").trim(),
    status: String(current.status || fallback.status || "DRAFT").toUpperCase(),
    attachments: normalizeVendorBillAttachments(current.attachments || []),
    submittedAt: current.submittedAt || null,
    submittedByUserId: Number(current.submittedByUserId || 0) || null,
    approvedAt: current.approvedAt || null,
    approvedByUserId: Number(current.approvedByUserId || 0) || null,
    rejectedAt: current.rejectedAt || null,
    rejectedByUserId: Number(current.rejectedByUserId || 0) || null,
    rejectionReason: String(current.rejectionReason || "").trim(),
    linkedApprovalEventId: Number(current.linkedApprovalEventId || 0) || null,
    updatedAt: current.updatedAt || null,
  };
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(value) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function buildAutoScheduleEntries({ purchase, installmentCount = 3, startAt = null, endAt = null }) {
  const due = Number(purchase?.dueAmount || 0);
  if (!(due > 0)) return [];
  const count = Math.max(1, Math.min(24, Number(installmentCount || 1)));
  const anchor = startAt ? startOfDay(startAt) : startOfDay(new Date());
  let dates = [];
  if (endAt) {
    const end = startOfDay(endAt);
    const totalMonths = Math.max(1, (end.getFullYear() - anchor.getFullYear()) * 12 + (end.getMonth() - anchor.getMonth()));
    for (let i = 0; i < count; i += 1) {
      const d = new Date(anchor);
      const addMonths = Math.round((totalMonths * i) / Math.max(1, count - 1));
      d.setMonth(d.getMonth() + addMonths);
      dates.push(toIsoDate(d));
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const d = new Date(anchor);
      d.setMonth(d.getMonth() + i);
      dates.push(toIsoDate(d));
    }
  }
  const base = Number((due / count).toFixed(2));
  let remaining = Number(due.toFixed(2));
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const amount = i === count - 1 ? Number(remaining.toFixed(2)) : base;
    remaining = Number((remaining - amount).toFixed(2));
    entries.push({
      key: `SCH-${Date.now()}-${i + 1}`,
      dueDate: dates[i],
      amount,
      paidAmount: 0,
      status: "PENDING",
      reminderCount: 0,
      remindedAt: null,
      note: "",
    });
  }
  return entries;
}

function computeAgingBuckets(rows = []) {
  const today = startOfDay(new Date());
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const row of rows) {
    const outstanding = Number(row.outstanding || 0);
    if (!(outstanding > 0)) continue;
    const due = startOfDay(row.dueDate || new Date());
    const days = Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 0) buckets.current += outstanding;
    else if (days <= 30) buckets.d1_30 += outstanding;
    else if (days <= 60) buckets.d31_60 += outstanding;
    else if (days <= 90) buckets.d61_90 += outstanding;
    else buckets.d90_plus += outstanding;
  }
  return {
    current: Number(buckets.current.toFixed(2)),
    d1_30: Number(buckets.d1_30.toFixed(2)),
    d31_60: Number(buckets.d31_60.toFixed(2)),
    d61_90: Number(buckets.d61_90.toFixed(2)),
    d90_plus: Number(buckets.d90_plus.toFixed(2)),
  };
}

async function readLatestScheduleLogByPurchaseIds(branchId, purchaseIds = []) {
  const ids = [...new Set((purchaseIds || []).map((x) => Number(x)).filter(Boolean))];
  if (!ids.length) return new Map();
  const logs = await prisma.auditLog.findMany({
    where: {
      action: "PURCHASE_PAYMENT_SCHEDULE",
      entity: "Purchase",
      entityId: { in: ids },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, entityId: true, payload: true, createdAt: true },
  });
  const map = new Map();
  for (const log of logs) {
    const purchaseId = Number(log.entityId || 0);
    if (!purchaseId || map.has(purchaseId)) continue;
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) continue;
    map.set(purchaseId, { id: log.id, createdAt: log.createdAt, payload });
  }
  return map;
}

async function writeScheduleLog({ branchId, purchaseId, userId, schedule }) {
  return prisma.auditLog.create({
    data: {
      userId: userId || null,
      action: "PURCHASE_PAYMENT_SCHEDULE",
      entity: "Purchase",
      entityId: purchaseId,
      payload: {
        branchId,
        purchaseId,
        ...schedule,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

async function buildPurchaseSchedulePayload(branchId, query = {}) {
  const includeClosed = String(query.includeClosed || "").toLowerCase() === "true";
  const purchases = await prisma.purchase.findMany({
    where: {
      branchId,
      ...(includeClosed ? {} : { dueAmount: { gt: 0 } }),
    },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const byScheduleLog = await readLatestScheduleLogByPurchaseIds(
    branchId,
    purchases.map((x) => x.id)
  );
  const rows = [];
  for (const purchase of purchases) {
    const existing = byScheduleLog.get(Number(purchase.id))?.payload || null;
    let entries = Array.isArray(existing?.entries) ? existing.entries : [];
    if (!entries.length && Number(purchase.dueAmount || 0) > 0) {
      const installmentCount =
        String(purchase.financingSource || "").toUpperCase() === "BANK_LOAN" ? 6 : 3;
      entries = buildAutoScheduleEntries({
        purchase,
        installmentCount,
        startAt: new Date(),
        endAt: purchase.loanMaturityDate || null,
      });
      await writeScheduleLog({
        branchId,
        purchaseId: purchase.id,
        userId: null,
        schedule: {
          status: "ACTIVE",
          autoGenerated: true,
          entries,
        },
      });
    }
    for (const entry of entries) {
      const amount = Number(entry.amount || 0);
      const paidAmount = Number(entry.paidAmount || 0);
      const outstanding = Math.max(0, Number((amount - paidAmount).toFixed(2)));
      const dueDate = entry.dueDate || toIsoDate(new Date());
      const today = startOfDay(new Date());
      const due = startOfDay(dueDate);
      const daysPastDue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)));
      rows.push({
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplier?.name || `Supplier #${purchase.supplierId}`,
        financingSource: purchase.financingSource,
        entryKey: String(entry.key || `${purchase.id}-${dueDate}`),
        dueDate,
        amount: Number(amount.toFixed(2)),
        paidAmount: Number(paidAmount.toFixed(2)),
        outstanding,
        status: String(entry.status || (outstanding > 0 ? "PENDING" : "PAID")).toUpperCase(),
        daysPastDue,
        reminderCount: Number(entry.reminderCount || 0),
        remindedAt: entry.remindedAt || null,
      });
    }
  }
  const openRows = rows.filter((x) => Number(x.outstanding || 0) > 0);
  const aging = computeAgingBuckets(openRows);
  return {
    summary: {
      purchaseCount: [...new Set(rows.map((x) => Number(x.purchaseId)))].length,
      lineCount: rows.length,
      openLineCount: openRows.length,
      outstandingTotal: Number(openRows.reduce((sum, x) => sum + Number(x.outstanding || 0), 0).toFixed(2)),
      overdueCount: openRows.filter((x) => Number(x.daysPastDue || 0) > 0).length,
      remindersDue: openRows.filter((x) => Number(x.daysPastDue || 0) > 0 && Number(x.reminderCount || 0) === 0).length,
      aging,
    },
    rows: rows.sort((a, b) => {
      if (Number(b.daysPastDue || 0) !== Number(a.daysPastDue || 0)) return Number(b.daysPastDue || 0) - Number(a.daysPastDue || 0);
      return Number(a.purchaseId || 0) - Number(b.purchaseId || 0);
    }),
  };
}

async function runPurchaseScheduleReminderAutomationInternal({ branchId, userId = null }) {
  const payload = await buildPurchaseSchedulePayload(branchId, { includeClosed: false });
  const overduePending = (payload.rows || []).filter(
    (row) => Number(row.outstanding || 0) > 0 && Number(row.daysPastDue || 0) > 0 && Number(row.reminderCount || 0) === 0
  );
  const grouped = new Map();
  for (const row of overduePending) {
    if (!grouped.has(Number(row.purchaseId))) grouped.set(Number(row.purchaseId), []);
    grouped.get(Number(row.purchaseId)).push(row);
  }
  let updatedEntries = 0;
  for (const [purchaseId, dueRows] of grouped.entries()) {
    const existing = (await readLatestScheduleLogByPurchaseIds(branchId, [purchaseId])).get(purchaseId)?.payload || null;
    if (!existing) continue;
    const dueKeys = new Set(dueRows.map((x) => String(x.entryKey)));
    const entries = (Array.isArray(existing.entries) ? existing.entries : []).map((entry) => {
      if (!dueKeys.has(String(entry.key || ""))) return entry;
      updatedEntries += 1;
      return {
        ...entry,
        reminderCount: Number(entry.reminderCount || 0) + 1,
        remindedAt: new Date().toISOString(),
      };
    });
    await writeScheduleLog({
      branchId,
      purchaseId,
      userId,
      schedule: {
        ...existing,
        entries,
        status: existing.status || "ACTIVE",
        autoReminderRunAt: new Date().toISOString(),
      },
    });
  }
  return {
    remindedEntries: updatedEntries,
    overdueEntries: overduePending.length,
    affectedPurchases: grouped.size,
  };
}

async function applyPurchaseDuePayment({ tx, branchId, purchaseId, amount, method, note, actorUserId }) {
  const purchase = await tx.purchase.findFirst({
    where: { id: purchaseId, branchId },
    include: { supplier: true },
  });
  if (!purchase) throw new Error("Purchase not found");
  const due = Number(purchase.dueAmount || 0);
  if (due <= 0) throw new Error("No outstanding amount for this purchase");
  const parsedAmount = Number(amount || 0);
  if (!(parsedAmount > 0)) throw new Error("Amount must be greater than zero");
  if (parsedAmount > due + 0.005) throw new Error("Payment exceeds outstanding amount");
  const fundingCode = resolveFundingAccountCode(method, null);
  const fundingAcc = await getSystemAccount(branchId, fundingCode, tx);
  if (!fundingAcc) throw new Error(`Funding account ${fundingCode} not found`);
  const financing = String(purchase.financingSource || "SUPPLIER_CREDIT").toUpperCase();
  const liabilityAccountCode = financing === "BANK_LOAN" ? "2320" : "2100";
  const liabilityAccount =
    financing === "BANK_LOAN"
      ? await ensureBankLoanPayableAccount(tx, branchId)
      : await getSystemAccount(branchId, liabilityAccountCode, tx);
  if (!liabilityAccount) throw new Error(`Liability account ${liabilityAccountCode} not found`);
  const updated = await tx.purchase.update({
    where: { id: purchaseId },
    data: {
      paidAmount: { increment: parsedAmount },
      dueAmount: { decrement: parsedAmount },
    },
  });
  if (financing !== "BANK_LOAN" && purchase.supplierId) {
    await tx.supplier.update({
      where: { id: purchase.supplierId },
      data: { payableBalance: { decrement: parsedAmount } },
    });
  }
  await tx.journal.create({
    data: {
      branchId,
      purchaseId,
      createdBy: actorUserId || null,
      refType: "PURCHASE_DUE_PAYMENT",
      refId: purchaseId,
      narration: `Purchase due payment #${purchaseId}${purchase.supplier?.name ? ` (${purchase.supplier.name})` : ""}${note ? ` — ${note}` : ""}`,
      lines: {
        create: [
          { accountId: liabilityAccount.id, debit: parsedAmount, credit: 0 },
          { accountId: fundingAcc.id, debit: 0, credit: parsedAmount },
        ],
      },
    },
  });
  return { purchase: updated, fundingCode };
}

async function getVendorBillLogsByPurchaseIds(branchId, purchaseIds = []) {
  const ids = [...new Set((purchaseIds || []).map((x) => Number(x)).filter(Boolean))];
  if (!ids.length) return new Map();
  const logs = await prisma.auditLog.findMany({
    where: {
      action: "VENDOR_BILL_RECORD",
      entity: "Purchase",
      entityId: { in: ids },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, entityId: true, payload: true, createdAt: true },
  });
  const map = new Map();
  for (const log of logs) {
    const purchaseId = Number(log.entityId || 0);
    if (!purchaseId || map.has(purchaseId)) continue;
    const payload = normalizeVendorBillPayload(log.payload || {}, { branchId, purchaseId, status: "DRAFT" });
    if (Number(payload.branchId || 0) !== Number(branchId)) continue;
    map.set(purchaseId, { ...payload, logId: log.id, logCreatedAt: log.createdAt });
  }
  return map;
}

async function buildPurchaseReceivingMap(branchId, purchaseIds = []) {
  const ids = [...new Set((purchaseIds || []).map((x) => Number(x)).filter(Boolean))];
  if (!ids.length) return new Map();
  const ledgers = await prisma.stockLedger.findMany({
    where: {
      branchId,
      refId: { in: ids },
      refType: { in: ["PURCHASE", "PURCHASE_GRN"] },
    },
    select: { refId: true, productId: true, inQty: true },
  });
  const map = new Map();
  for (const row of ledgers) {
    const pid = Number(row.refId || 0);
    const productId = Number(row.productId || 0);
    if (!pid || !productId) continue;
    if (!map.has(pid)) map.set(pid, new Map());
    const inner = map.get(pid);
    inner.set(productId, Number(inner.get(productId) || 0) + Number(row.inQty || 0));
    map.set(pid, inner);
  }
  return map;
}

function summarizePurchaseReceiving(items = [], receivedByProduct = new Map()) {
  const rows = (items || []).map((item) => {
    const orderedQty = Number(item.qty || 0);
    const receivedQty = Number(receivedByProduct.get(Number(item.productId)) || 0);
    const remainingQty = Math.max(0, orderedQty - receivedQty);
    return {
      productId: Number(item.productId || 0),
      orderedQty,
      receivedQty,
      remainingQty,
      isComplete: remainingQty <= 0,
    };
  });
  const orderedQtyTotal = rows.reduce((sum, x) => sum + Number(x.orderedQty || 0), 0);
  const receivedQtyTotal = rows.reduce((sum, x) => sum + Number(x.receivedQty || 0), 0);
  const remainingQtyTotal = rows.reduce((sum, x) => sum + Number(x.remainingQty || 0), 0);
  return {
    rows,
    orderedQtyTotal,
    receivedQtyTotal,
    remainingQtyTotal,
    status: remainingQtyTotal <= 0 ? "RECEIVED" : receivedQtyTotal > 0 ? "PARTIAL" : "PENDING",
  };
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function buildLandedCostAllocation(items = [], extraCostsTotal = 0) {
  const lines = (items || []).map((item) => {
    const productId = Number(item.productId || 0);
    const qty = Number(item.qty || 0);
    const baseUnitCost = Number(item.cost || 0);
    const lineBase = qty * baseUnitCost;
    return {
      productId,
      qty,
      baseUnitCost,
      lineBase,
      allocatedExtraCost: 0,
      landedLineTotal: lineBase,
      landedUnitCost: qty > 0 ? baseUnitCost : 0,
    };
  });
  const baseTotal = lines.reduce((sum, line) => sum + Number(line.lineBase || 0), 0);
  if (!(extraCostsTotal > 0) || !(baseTotal > 0) || !lines.length) {
    return {
      baseTotal: Number(baseTotal.toFixed(2)),
      extraCostsTotal: Number(extraCostsTotal.toFixed(2)),
      landedTotal: Number((baseTotal + extraCostsTotal).toFixed(2)),
      lines: lines.map((line) => ({
        ...line,
        lineBase: Number(line.lineBase.toFixed(2)),
        allocatedExtraCost: Number(line.allocatedExtraCost.toFixed(2)),
        landedLineTotal: Number(line.landedLineTotal.toFixed(2)),
        landedUnitCost: Number(line.landedUnitCost.toFixed(4)),
      })),
    };
  }

  let allocatedSum = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let allocated = 0;
    if (i === lines.length - 1) {
      allocated = Number((extraCostsTotal - allocatedSum).toFixed(2));
    } else {
      allocated = Number(((line.lineBase / baseTotal) * extraCostsTotal).toFixed(2));
      allocatedSum += allocated;
    }
    line.allocatedExtraCost = allocated;
    line.landedLineTotal = Number((line.lineBase + allocated).toFixed(2));
    line.landedUnitCost =
      line.qty > 0 ? Number((line.landedLineTotal / line.qty).toFixed(4)) : Number(line.baseUnitCost.toFixed(4));
  }

  return {
    baseTotal: Number(baseTotal.toFixed(2)),
    extraCostsTotal: Number(extraCostsTotal.toFixed(2)),
    landedTotal: Number((baseTotal + extraCostsTotal).toFixed(2)),
    lines: lines.map((line) => ({
      ...line,
      lineBase: Number(line.lineBase.toFixed(2)),
      allocatedExtraCost: Number(line.allocatedExtraCost.toFixed(2)),
      landedLineTotal: Number(line.landedLineTotal.toFixed(2)),
      landedUnitCost: Number(line.landedUnitCost.toFixed(4)),
    })),
  };
}

exports.createPurchase = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { supplierId, invoiceNo, items, paidAmount = 0 } = req.body;
    const transportationCost = Number(req.body?.transportationCost || 0);
    const bribesCost = Number(req.body?.bribesCost || 0);
    const extraOtherCost = Number(req.body?.extraOtherCost || 0);
    const deferStockPosting = Boolean(req.body?.deferStockPosting);
    const financingRaw = String(req.body?.financingSource || "SUPPLIER_CREDIT").toUpperCase();
    const financingSource = financingRaw === "BANK_LOAN" ? "BANK_LOAN" : "SUPPLIER_CREDIT";
    const isBankLoan = financingSource === "BANK_LOAN";

    let loanReference = null;
    let loanNote = null;
    let loanMaturityDate = null;
    if (isBankLoan) {
      loanReference =
        req.body.loanReference != null && String(req.body.loanReference).trim()
          ? String(req.body.loanReference).trim().slice(0, 190)
          : null;
      loanNote =
        req.body.loanNote != null && String(req.body.loanNote).trim()
          ? String(req.body.loanNote).trim().slice(0, 500)
          : null;
      if (req.body.loanMaturityDate) {
        const d = new Date(req.body.loanMaturityDate);
        if (!Number.isNaN(d.getTime())) loanMaturityDate = d;
      }
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Purchase items required" });
    }
    if (transportationCost < 0 || bribesCost < 0 || extraOtherCost < 0) {
      return res.status(400).json({ error: "Transportation, bribes, and other costs must be non-negative" });
    }
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.create",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });

    let inputVatTotal = 0;
    const purchase = await prisma.$transaction(async (tx) => {
      let goodsTotal = 0;
      for (const item of items) {
        const qty = Number(item.qty || 0);
        const cost = Number(item.cost || 0);
        const vatRate = Number(item.vatRate || 0);
        const vatType = String(item.vatType || "EXCLUSIVE").toUpperCase();
        const lineBase = qty * cost;
        goodsTotal += lineBase;
        if (vatRate > 0 && lineBase > 0) {
          if (vatType === "INCLUSIVE") {
            inputVatTotal += lineBase - lineBase / (1 + vatRate / 100);
          } else {
            inputVatTotal += (lineBase * vatRate) / 100;
          }
        }
      }
      const extraCostsTotal = transportationCost + bribesCost + extraOtherCost;
      const landed = buildLandedCostAllocation(items, extraCostsTotal);
      const total = goodsTotal + extraCostsTotal;
      const dueAmount = Math.max(0, total - Number(paidAmount));
      const created = await tx.purchase.create({
        data: {
          branchId,
          supplierId: Number(supplierId),
          invoiceNo: invoiceNo || null,
          transportationCost,
          bribesCost,
          extraOtherCost,
          total,
          paidAmount: Number(paidAmount),
          dueAmount,
          financingSource,
          loanReference,
          loanNote,
          loanMaturityDate,
          items: {
            create: items.map((i) => ({
              productId: Number(i.productId),
              qty: Number(i.qty),
              cost: Number(i.cost),
            })),
          },
        },
      });

      if (!deferStockPosting) {
        const landedByProduct = new Map(
          (landed.lines || []).map((line) => [Number(line.productId), Number(line.landedUnitCost || 0)])
        );
        for (const item of items) {
          const productId = Number(item.productId);
          if (Number(item.qty) <= 0 || Number(item.cost) < 0) {
            throw new Error("Invalid purchase qty/cost");
          }
          await tx.product.update({
            where: { id: productId },
            data: {
              stock: { increment: Number(item.qty) },
              price: Number(landedByProduct.get(productId) || Number(item.cost)),
            },
          });
          await tx.stockLedger.create({
            data: {
              branchId,
              productId,
              refType: "PURCHASE",
              refId: created.id,
              inQty: Number(item.qty),
              unitCost: Number(landedByProduct.get(productId) || Number(item.cost)),
            },
          });
        }
      }

      if (!isBankLoan && dueAmount > 0) {
        await tx.supplier.update({
          where: { id: Number(supplierId) },
          data: { payableBalance: { increment: dueAmount } },
        });
      }

      const inventory = await getSystemAccount(branchId, "1300", tx);
      const cash = await getSystemAccount(branchId, "1100", tx);
      let liabilityAccount = null;
      if (dueAmount > 0) {
        liabilityAccount = isBankLoan
          ? await ensureBankLoanPayableAccount(tx, branchId)
          : await getSystemAccount(branchId, "2100", tx);
      }
      if (!inventory || !cash) {
        throw new Error("Required GL accounts missing (1300 Inventory, 1100 Cash)");
      }
      if (dueAmount > 0 && !liabilityAccount) {
        throw new Error(isBankLoan ? "Could not resolve Bank Loans Payable (2320)" : "Accounts Payable (2100) missing");
      }

      const journalLineCreates = [{ accountId: inventory.id, debit: Number(goodsTotal.toFixed(2)), credit: 0 }];
      if (transportationCost > 0 || bribesCost > 0 || extraOtherCost > 0) {
        const expenseAccounts = await ensurePurchaseExtraCostAccounts(tx, branchId);
        if (transportationCost > 0) {
          journalLineCreates.push({
            accountId: expenseAccounts.transportation.id,
            debit: Number(transportationCost.toFixed(2)),
            credit: 0,
          });
        }
        if (bribesCost > 0) {
          journalLineCreates.push({
            accountId: expenseAccounts.bribes.id,
            debit: Number(bribesCost.toFixed(2)),
            credit: 0,
          });
        }
        if (extraOtherCost > 0) {
          journalLineCreates.push({
            accountId: expenseAccounts.extraOther.id,
            debit: Number(extraOtherCost.toFixed(2)),
            credit: 0,
          });
        }
      }
      if (dueAmount > 0) {
        journalLineCreates.push({ accountId: liabilityAccount.id, debit: 0, credit: dueAmount });
      }
      journalLineCreates.push({ accountId: cash.id, debit: 0, credit: Number(paidAmount) });

      const journal = await tx.journal.create({
        data: {
          branchId,
          purchaseId: created.id,
          createdBy: req.user?.id || null,
          refType: "PURCHASE",
          refId: created.id,
          narration: `Purchase ${created.id}${isBankLoan ? " (bank loan)" : ""}`,
          lines: {
            create: journalLineCreates,
          },
        },
      });
      return { ...created, journalId: journal.id };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: purchase.id,
      payload: {
        branchId,
        supplierId: Number(supplierId),
        transportationCost,
        bribesCost,
        extraOtherCost,
        total: Number(purchase.total || 0),
        deferStockPosting,
        financingSource,
        loanReference,
        loanNote,
        loanMaturityDate: loanMaturityDate ? loanMaturityDate.toISOString() : null,
        inputVat: Number(inputVatTotal.toFixed(2)),
        vatLines: (items || []).map((item) => ({
          productId: Number(item.productId),
          qty: Number(item.qty || 0),
          cost: Number(item.cost || 0),
          vatRate: Number(item.vatRate || 0),
          vatType: String(item.vatType || "EXCLUSIVE").toUpperCase(),
          vatAmount: Number(
            (() => {
              const qty = Number(item.qty || 0);
              const cost = Number(item.cost || 0);
              const vatRate = Number(item.vatRate || 0);
              const vatType = String(item.vatType || "EXCLUSIVE").toUpperCase();
              const lineBase = qty * cost;
              if (vatRate <= 0 || lineBase <= 0) return 0;
              if (vatType === "INCLUSIVE") {
                return lineBase - lineBase / (1 + vatRate / 100);
              }
              return (lineBase * vatRate) / 100;
            })().toFixed(2)
          ),
        })),
        landedCostAllocation: buildLandedCostAllocation(items, transportationCost + bribesCost + extraOtherCost),
      },
    });
    res.status(201).json(purchase);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchases = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchases = await prisma.purchase.findMany({
      where: { branchId },
      include: { supplier: true, items: true },
      orderBy: { createdAt: "desc" },
    });
    const purchaseIds = purchases.map((p) => p.id);
    const logs = purchaseIds.length
      ? await prisma.auditLog.findMany({
          where: {
            action: "PURCHASE_CREATE",
            entity: "Purchase",
            entityId: { in: purchaseIds },
          },
          select: { entityId: true, payload: true },
        })
      : [];
    const logByPurchaseId = new Map(
      logs
        .filter((x) => x.entityId != null)
        .map((x) => [Number(x.entityId), x.payload || {}])
    );
    const vendorBillByPurchase = await getVendorBillLogsByPurchaseIds(branchId, purchaseIds);
    const receivingByPurchase = await buildPurchaseReceivingMap(branchId, purchaseIds);
    const withVat = purchases.map((purchase) => {
      const payload = logByPurchaseId.get(Number(purchase.id)) || {};
      const inputVat = Number(payload.inputVat || 0);
      const grossAmount = Number(purchase.total || 0);
      const taxableAmount = Math.max(0, grossAmount - inputVat);
      const receiving = summarizePurchaseReceiving(
        purchase.items || [],
        receivingByPurchase.get(Number(purchase.id)) || new Map()
      );
      return {
        ...purchase,
        vatBreakdown: {
          taxableAmount: Number(taxableAmount.toFixed(2)),
          inputVat: Number(inputVat.toFixed(2)),
          grossAmount: Number(grossAmount.toFixed(2)),
          vatSource: payload.inputVat != null ? "LOG" : "ESTIMATED_ZERO",
        },
        receiving,
        vendorBill: vendorBillByPurchase.get(Number(purchase.id)) || {
          branchId,
          purchaseId: Number(purchase.id),
          status: "DRAFT",
          attachments: [],
        },
      };
    });
    res.json(withVat);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchaseDetails = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid purchase id" });
    }
    const purchase = await prisma.purchase.findFirst({
      where: { id, branchId },
      include: {
        supplier: true,
        items: {
          include: {
            product: { select: { id: true, name: true, vatRate: true } },
          },
        },
      },
    });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    const log = await prisma.auditLog.findFirst({
      where: {
        action: "PURCHASE_CREATE",
        entity: "Purchase",
        entityId: id,
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const payload = log?.payload || {};
    const vatLinesFromLog = Array.isArray(payload.vatLines) ? payload.vatLines : [];
    const vatLineByProduct = new Map(
      vatLinesFromLog.map((line) => [Number(line.productId), line])
    );
    const lines = (purchase.items || []).map((item) => {
      const lineBase = Number(item.qty || 0) * Number(item.cost || 0);
      const landedMap = new Map(
        (Array.isArray(payload.landedCostAllocation?.lines) ? payload.landedCostAllocation.lines : []).map((line) => [
          Number(line.productId),
          line,
        ])
      );
      const landedLine = landedMap.get(Number(item.productId));
      const fromLog = vatLineByProduct.get(Number(item.productId));
      const vatRate = Number(fromLog?.vatRate ?? item.product?.vatRate ?? 0);
      const vatType = String(fromLog?.vatType || "EXCLUSIVE").toUpperCase();
      const vatAmount =
        fromLog?.vatAmount != null
          ? Number(fromLog.vatAmount || 0)
          : vatRate > 0
            ? vatType === "INCLUSIVE"
              ? lineBase - lineBase / (1 + vatRate / 100)
              : (lineBase * vatRate) / 100
            : 0;
      const taxableAmount =
        vatType === "INCLUSIVE" ? Math.max(0, lineBase - vatAmount) : Math.max(0, lineBase);
      return {
        productId: Number(item.productId),
        productName: item.product?.name || `Product #${item.productId}`,
        qty: Number(item.qty || 0),
        cost: Number(item.cost || 0),
        vatRate: Number(vatRate.toFixed(2)),
        vatType,
        taxableAmount: Number(taxableAmount.toFixed(2)),
        vatAmount: Number(vatAmount.toFixed(2)),
        grossAmount: Number(lineBase.toFixed(2)),
        allocatedExtraCost: Number(Number(landedLine?.allocatedExtraCost || 0).toFixed(2)),
        landedUnitCost: Number(Number(landedLine?.landedUnitCost || item.cost || 0).toFixed(4)),
        landedLineTotal: Number(
          Number(landedLine?.landedLineTotal != null ? landedLine.landedLineTotal : lineBase).toFixed(2)
        ),
      };
    });
    const totals = lines.reduce(
      (acc, line) => {
        acc.taxable += Number(line.taxableAmount || 0);
        acc.vat += Number(line.vatAmount || 0);
        acc.gross += Number(line.grossAmount || 0);
        return acc;
      },
      { taxable: 0, vat: 0, gross: 0 }
    );
    const receivingMap = await buildPurchaseReceivingMap(branchId, [id]);
    const receivingSummary = summarizePurchaseReceiving(
      purchase.items || [],
      receivingMap.get(Number(id)) || new Map()
    );
    const grnLogs = await prisma.auditLog.findMany({
      where: {
        action: "PURCHASE_GRN_RECEIVE",
        entity: "Purchase",
        entityId: id,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, payload: true },
    });
    const vendorBillByPurchase = await getVendorBillLogsByPurchaseIds(branchId, [id]);
    res.json({
      ...purchase,
      vatBreakdown: {
        taxableAmount: Number(totals.taxable.toFixed(2)),
        inputVat: Number(totals.vat.toFixed(2)),
        grossAmount: Number(totals.gross.toFixed(2)),
        vatSource: vatLinesFromLog.length ? "LOG" : "ESTIMATED",
      },
      vatLines: lines,
      landedCostAllocation: payload.landedCostAllocation || buildLandedCostAllocation(purchase.items || [], Number(purchase.transportationCost || 0) + Number(purchase.bribesCost || 0) + Number(purchase.extraOtherCost || 0)),
      receiving: receivingSummary,
      vendorBill: vendorBillByPurchase.get(Number(id)) || {
        branchId,
        purchaseId: Number(id),
        status: "DRAFT",
        attachments: [],
      },
      grnHistory: (grnLogs || []).map((x) => ({
        id: x.id,
        createdAt: x.createdAt,
        lines: Array.isArray(x.payload?.items) ? x.payload.items : [],
      })),
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.upsertVendorBillRecord = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const purchase = await prisma.purchase.findFirst({ where: { id: purchaseId, branchId }, select: { id: true } });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    const existing = (await getVendorBillLogsByPurchaseIds(branchId, [purchaseId])).get(purchaseId);
    const next = normalizeVendorBillPayload(
      {
        ...(existing || {}),
        billNo: req.body?.billNo,
        dueDate: req.body?.dueDate || null,
        note: req.body?.note || "",
        attachments: req.body?.attachments || [],
        status: existing?.status && existing.status !== "REJECTED" ? existing.status : "DRAFT",
        rejectionReason: "",
        rejectedAt: null,
        rejectedByUserId: null,
        updatedAt: new Date().toISOString(),
      },
      { branchId, purchaseId, status: "DRAFT" }
    );
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "VENDOR_BILL_RECORD",
        entity: "Purchase",
        entityId: purchaseId,
        payload: next,
      },
    });
    res.json({ id: created.id, ...next });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.submitVendorBillApproval = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const purchase = await prisma.purchase.findFirst({ where: { id: purchaseId, branchId }, select: { id: true, total: true } });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    const existing = (await getVendorBillLogsByPurchaseIds(branchId, [purchaseId])).get(purchaseId);
    if (!existing) return res.status(400).json({ error: "Save vendor bill first" });
    if (!existing.attachments?.length) return res.status(400).json({ error: "At least one attachment is required" });
    const openApproval = await prisma.auditLog.findFirst({
      where: {
        action: "APPROVAL_VENDOR_BILL",
        entity: "Purchase",
        entityId: purchaseId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, payload: true },
    });
    const latestStatus = String(openApproval?.payload?.status || "").toUpperCase();
    if (latestStatus === "PENDING") {
      return res.status(400).json({ error: "Vendor bill approval already pending" });
    }
    const approval = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "APPROVAL_VENDOR_BILL",
        entity: "Purchase",
        entityId: purchaseId,
        payload: {
          branchId,
          status: "PENDING",
          reason: "Vendor bill approval required",
          amount: Number(purchase.total || 0),
          request: {
            purchaseId,
            billNo: existing.billNo || null,
            dueDate: existing.dueDate || null,
            note: existing.note || "",
            attachments: existing.attachments || [],
          },
        },
      },
    });
    const next = normalizeVendorBillPayload(
      {
        ...existing,
        status: "SUBMITTED",
        submittedAt: new Date().toISOString(),
        submittedByUserId: req.user?.id || null,
        linkedApprovalEventId: approval.id,
        updatedAt: new Date().toISOString(),
      },
      { branchId, purchaseId, status: "SUBMITTED" }
    );
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "VENDOR_BILL_RECORD",
        entity: "Purchase",
        entityId: purchaseId,
        payload: next,
      },
    });
    res.status(201).json({ message: "Vendor bill submitted for approval", approvalEventId: approval.id, vendorBill: next });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.receivePurchaseInStages = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    if (!items.length) return res.status(400).json({ error: "Receiving items required" });
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.receive",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });
    const purchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, branchId },
      include: { items: true },
    });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    const receivingMap = await buildPurchaseReceivingMap(branchId, [purchaseId]);
    const receivedByProduct = receivingMap.get(Number(purchaseId)) || new Map();
    const requested = items
      .map((x) => ({ productId: Number(x.productId || 0), qty: Number(x.qty || 0) }))
      .filter((x) => x.productId > 0 && Number.isInteger(x.qty) && x.qty > 0);
    if (!requested.length) return res.status(400).json({ error: "No valid receiving line found" });
    const itemByProduct = new Map((purchase.items || []).map((x) => [Number(x.productId), x]));
    for (const line of requested) {
      const ordered = itemByProduct.get(Number(line.productId));
      if (!ordered) return res.status(400).json({ error: `Product ${line.productId} is not part of this purchase` });
      const remainingQty = Math.max(0, Number(ordered.qty || 0) - Number(receivedByProduct.get(Number(line.productId)) || 0));
      if (line.qty > remainingQty) {
        return res.status(400).json({ error: `Receiving qty exceeds remaining for product ${line.productId}` });
      }
    }
    const purchaseCreateLog = await prisma.auditLog.findFirst({
      where: {
        action: "PURCHASE_CREATE",
        entity: "Purchase",
        entityId: purchaseId,
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const landedLines = Array.isArray(purchaseCreateLog?.payload?.landedCostAllocation?.lines)
      ? purchaseCreateLog.payload.landedCostAllocation.lines
      : [];
    const landedByProduct = new Map(
      landedLines.map((line) => [Number(line.productId), Number(line.landedUnitCost || 0)])
    );
    await prisma.$transaction(async (tx) => {
      for (const line of requested) {
        const ordered = itemByProduct.get(Number(line.productId));
        const landedUnitCost = Number(landedByProduct.get(Number(line.productId)) || ordered?.cost || 0);
        await tx.product.update({
          where: { id: Number(line.productId) },
          data: { stock: { increment: Number(line.qty || 0) }, price: landedUnitCost },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: Number(line.productId),
            refType: "PURCHASE_GRN",
            refId: purchaseId,
            inQty: Number(line.qty || 0),
            unitCost: landedUnitCost,
          },
        });
      }
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_GRN_RECEIVE",
      entity: "Purchase",
      entityId: purchaseId,
      payload: {
        branchId,
        purchaseId,
        items: requested,
      },
    });
    const latestMap = await buildPurchaseReceivingMap(branchId, [purchaseId]);
    const receiving = summarizePurchaseReceiving(
      purchase.items || [],
      latestMap.get(Number(purchaseId)) || new Map()
    );
    res.status(201).json({
      message: "GRN receiving posted",
      receiving,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

async function getPurchaseGrnHistoryRows(branchId, purchaseId) {
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, branchId },
    include: { items: { include: { product: { select: { id: true, name: true } } } } },
  });
  if (!purchase) throw new Error("Purchase not found");
  const productNameById = new Map((purchase.items || []).map((x) => [Number(x.productId), x.product?.name || `Product #${x.productId}`]));
  const logs = await prisma.auditLog.findMany({
    where: {
      action: "PURCHASE_GRN_RECEIVE",
      entity: "Purchase",
      entityId: purchaseId,
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, createdAt: true, payload: true },
  });
  return logs.flatMap((log) =>
    (Array.isArray(log.payload?.items) ? log.payload.items : []).map((line) => ({
      grn_event_id: log.id,
      received_at: new Date(log.createdAt).toISOString(),
      product_id: Number(line?.productId || 0),
      product_name: productNameById.get(Number(line?.productId || 0)) || `Product #${line?.productId}`,
      qty_received: Number(line?.qty || 0),
    }))
  );
}

exports.exportPurchaseGrnHistoryCSV = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const rows = await getPurchaseGrnHistoryRows(branchId, purchaseId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="purchase-${purchaseId}-grn-history.csv"`);
    res.send(toCSV(rows));
  } catch (error) {
    if (String(error.message).includes("Purchase not found")) return res.status(404).json({ error: "Purchase not found" });
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchaseGrnHistoryPDF = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const rows = await getPurchaseGrnHistoryRows(branchId, purchaseId);
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="purchase-${purchaseId}-grn-history.pdf"`);
    doc.pipe(res);
    doc.fontSize(14).font("Helvetica-Bold").text(`GRN History - Purchase #${purchaseId}`, { align: "center" });
    doc.moveDown(1);
    const cols = ["Event", "Received At", "Product", "Qty"];
    const keys = ["grn_event_id", "received_at", "product_name", "qty_received"];
    const startX = 40;
    const width = 515;
    const colW = width / cols.length;
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold");
    cols.forEach((c, i) => doc.text(c, startX + i * colW, y, { width: colW }));
    y += 16;
    doc.font("Helvetica");
    rows.forEach((r) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      keys.forEach((k, i) => doc.text(String(r[k] ?? ""), startX + i * colW, y, { width: colW }));
      y += 16;
    });
    doc.end();
  } catch (error) {
    if (String(error.message).includes("Purchase not found")) return res.status(404).json({ error: "Purchase not found" });
    res.status(500).json({ error: error.message });
  }
};

exports.createPurchaseReturn = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const { items, reason } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Return items required" });
    }

    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.return",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });

    const purchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, branchId },
      include: { items: true, supplier: true },
    });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    const totalReturnAmount = items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0),
      0
    );
    if (!(totalReturnAmount > 0)) return res.status(400).json({ error: "Invalid return amount" });

    const created = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const productId = Number(item.productId);
        const qty = Number(item.qty);
        const cost = Number(item.cost);
        if (!Number.isInteger(qty) || qty <= 0 || cost < 0) {
          throw new Error("Invalid return qty/cost");
        }
        const purchasedItem = purchase.items.find((x) => x.productId === productId);
        if (!purchasedItem) throw new Error(`Product ${productId} not found in purchase`);

        const returnedLedgers = await tx.stockLedger.findMany({
          where: { branchId, refType: "PURCHASE_RETURN", refId: purchaseId, productId },
        });
        const alreadyReturnedQty = returnedLedgers.reduce((sum, l) => sum + Number(l.outQty || 0), 0);
        if (qty > Number(purchasedItem.qty) - alreadyReturnedQty) {
          throw new Error(`Return qty exceeds remaining purchased qty for product ${productId}`);
        }

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.stock < qty) {
          throw new Error(`Insufficient stock for return product ${productId}`);
        }

        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: qty } },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId,
            refType: "PURCHASE_RETURN",
            refId: purchaseId,
            outQty: qty,
            unitCost: cost,
          },
        });
      }

      const returnRecord = await tx.purchaseReturn.create({
        data: {
          purchaseId,
          amount: totalReturnAmount,
          reason: reason || null,
        },
      });

      const payableReduction = Math.min(Number(purchase.dueAmount || 0), totalReturnAmount);
      const paidRefund = Math.max(0, totalReturnAmount - payableReduction);
      const financingSource = String(purchase.financingSource || "SUPPLIER_CREDIT").toUpperCase();
      const isBankLoanPurchase = financingSource === "BANK_LOAN";

      if (!isBankLoanPurchase && payableReduction > 0) {
        await tx.supplier.update({
          where: { id: purchase.supplierId },
          data: { payableBalance: { decrement: payableReduction } },
        });
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          total: { decrement: totalReturnAmount },
          dueAmount: { decrement: payableReduction },
          paidAmount: { decrement: paidRefund },
        },
      });

      const inventory = await getSystemAccount(branchId, "1300", tx);
      let liabilityAccount = null;
      if (payableReduction > 0) {
        liabilityAccount = isBankLoanPurchase
          ? await ensureBankLoanPayableAccount(tx, branchId)
          : await getSystemAccount(branchId, "2100", tx);
      }
      const cash = await getSystemAccount(branchId, "1100", tx);
      if (inventory && cash && (!payableReduction || liabilityAccount)) {
        const lines = [];
        if (payableReduction > 0 && liabilityAccount) {
          lines.push({ accountId: liabilityAccount.id, debit: payableReduction, credit: 0 });
        }
        lines.push({ accountId: cash.id, debit: paidRefund, credit: 0 });
        lines.push({ accountId: inventory.id, debit: 0, credit: totalReturnAmount });
        await tx.journal.create({
          data: {
            branchId,
            purchaseId,
            createdBy: req.user?.id || null,
            refType: "PURCHASE_RETURN",
            refId: returnRecord.id,
            narration: `Purchase return ${returnRecord.id}`,
            lines: {
              create: lines,
            },
          },
        });
      }

      return returnRecord;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_RETURN_CREATE",
      entity: "PurchaseReturn",
      entityId: created.id,
      payload: { purchaseId, amount: created.amount },
    });
    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchaseReturns = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: {
        purchase: {
          include: {
            supplier: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(returns);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function writeReturnsPdf(res, rows) {
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="purchase-returns.pdf"');
  doc.pipe(res);
  doc.fontSize(14).font("Helvetica-Bold").text("Purchase Return Report", { align: "center" });
  doc.moveDown(1);
  const cols = ["ID", "Purchase", "Invoice", "Supplier", "Amount", "Reason", "Date"];
  const keys = ["id", "purchaseId", "invoiceNo", "supplierName", "amount", "reason", "date"];
  const startX = 40;
  const width = 515;
  const colW = width / cols.length;
  let y = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  cols.forEach((c, i) => doc.text(c, startX + i * colW, y, { width: colW }));
  y += 16;
  doc.font("Helvetica");
  rows.forEach((r) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    keys.forEach((k, i) => doc.text(String(r[k] ?? ""), startX + i * colW, y, { width: colW }));
    y += 16;
  });
  doc.end();
}

exports.exportPurchaseReturnsCSV = async (req, res) => {
  try {
    req.query = req.query || {};
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: { purchase: { include: { supplier: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = returns.map((r) => ({
      id: r.id,
      purchase_id: r.purchaseId,
      invoice_no: r.purchase?.invoiceNo || "",
      supplier: r.purchase?.supplier?.name || "",
      amount: Number(r.amount).toFixed(2),
      reason: r.reason || "",
      date: new Date(r.createdAt).toISOString(),
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-returns.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchaseReturnsPDF = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: { purchase: { include: { supplier: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = returns.map((r) => ({
      id: r.id,
      purchaseId: r.purchaseId,
      invoiceNo: r.purchase?.invoiceNo || "-",
      supplierName: r.purchase?.supplier?.name || "-",
      amount: Number(r.amount).toFixed(2),
      reason: r.reason || "-",
      date: new Date(r.createdAt).toLocaleString(),
    }));
    writeReturnsPdf(res, rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchaseOptimization = async (req, res) => {
  try {
    const branchId = req.branchId;
    const days = Math.max(7, Number(req.query.days || 30));
    const leadDays = Math.max(1, Number(req.query.leadDays || 7));
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const products = await prisma.product.findMany({
      where: { branchId },
      select: { id: true, name: true, sku: true, stock: true, reorderLevel: true, price: true },
      take: 2000,
    });
    const productIds = products.map((p) => p.id);
    if (!productIds.length) {
      return res.json({ params: { days, leadDays }, rows: [] });
    }

    const sales = await prisma.saleItem.findMany({
      where: {
        productId: { in: productIds },
        sale: { branchId, createdAt: { gte: from } },
      },
      select: { productId: true, qty: true },
    });
    const soldMap = new Map();
    sales.forEach((row) => {
      soldMap.set(row.productId, (soldMap.get(row.productId) || 0) + Number(row.qty || 0));
    });

    const purchases = await prisma.purchase.findMany({
      where: { branchId },
      include: { supplier: true, items: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const byProductSupplier = new Map();
    for (const purchase of purchases) {
      const supplierId = Number(purchase.supplierId || 0);
      if (!supplierId) continue;
      for (const item of purchase.items || []) {
        const productId = Number(item.productId || 0);
        if (!productId) continue;
        const key = `${productId}:${supplierId}`;
        const prev = byProductSupplier.get(key) || {
          productId,
          supplierId,
          supplierName: purchase.supplier?.name || `Supplier #${supplierId}`,
          costs: [],
          qtys: [],
          lastPurchaseAt: null,
        };
        prev.costs.push(Number(item.cost || 0));
        prev.qtys.push(Number(item.qty || 0));
        if (!prev.lastPurchaseAt) prev.lastPurchaseAt = purchase.createdAt;
        byProductSupplier.set(key, prev);
      }
    }

    const supplierStatsByProduct = new Map();
    for (const row of byProductSupplier.values()) {
      const avgCost =
        row.costs.length > 0 ? row.costs.reduce((s, c) => s + Number(c || 0), 0) / row.costs.length : 0;
      const minCost = row.costs.length > 0 ? Math.min(...row.costs) : 0;
      const maxCost = row.costs.length > 0 ? Math.max(...row.costs) : 0;
      const moq = row.qtys.length > 0 ? Math.max(1, Math.min(...row.qtys.map((x) => Math.max(1, Number(x || 1))))) : 1;
      const stat = {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        avgCost: Number(avgCost.toFixed(2)),
        minCost: Number(minCost.toFixed(2)),
        maxCost: Number(maxCost.toFixed(2)),
        moq,
        lastPurchaseAt: row.lastPurchaseAt,
      };
      if (!supplierStatsByProduct.has(row.productId)) supplierStatsByProduct.set(row.productId, []);
      supplierStatsByProduct.get(row.productId).push(stat);
    }

    const rows = products.map((p) => {
      const soldQty = Number(soldMap.get(p.id) || 0);
      const avgDailySold = soldQty / days;
      const recommendedQty = Math.max(
        0,
        Math.ceil(Math.max(Number(p.reorderLevel || 0), avgDailySold * leadDays) - Number(p.stock || 0))
      );
      const supplierOptions = (supplierStatsByProduct.get(p.id) || []).sort(
        (a, b) => Number(a.avgCost || 0) - Number(b.avgCost || 0)
      );
      const bestSupplier = supplierOptions[0] || null;
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        stock: Number(p.stock || 0),
        reorderLevel: Number(p.reorderLevel || 0),
        soldQty,
        avgDailySold: Number(avgDailySold.toFixed(2)),
        recommendedQty,
        bestSupplier,
        supplierOptions,
      };
    });

    res.json({ params: { days, leadDays }, rows });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

async function buildPurchasePlanSuggestion(branchId, query = {}) {
  const days = Math.max(7, Number(query.days || 30));
  const leadDays = Math.max(1, Number(query.leadDays || 7));
  const budget = Math.max(0, Number(query.budget || 0));
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const products = await prisma.product.findMany({
    where: { branchId },
    select: { id: true, name: true, sku: true, stock: true, reorderLevel: true, price: true },
    take: 2000,
  });
  const productIds = products.map((p) => p.id);
  if (!productIds.length) {
    return {
      params: { days, leadDays, budget },
      summary: { lineCount: 0, supplierCount: 0, totalEstimatedCost: 0, remainingBudget: 0 },
      supplierGroups: [],
      rows: [],
    };
  }

  const sales = await prisma.saleItem.findMany({
    where: {
      productId: { in: productIds },
      sale: { branchId, createdAt: { gte: from } },
    },
    select: { productId: true, qty: true },
  });
  const soldMap = new Map();
  sales.forEach((row) => {
    soldMap.set(row.productId, (soldMap.get(row.productId) || 0) + Number(row.qty || 0));
  });

  const purchases = await prisma.purchase.findMany({
    where: { branchId },
    include: { supplier: true, items: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const byProductSupplier = new Map();
  for (const purchase of purchases) {
    const supplierId = Number(purchase.supplierId || 0);
    if (!supplierId) continue;
    for (const item of purchase.items || []) {
      const productId = Number(item.productId || 0);
      if (!productId) continue;
      const key = `${productId}:${supplierId}`;
      const prev = byProductSupplier.get(key) || {
        productId,
        supplierId,
        supplierName: purchase.supplier?.name || `Supplier #${supplierId}`,
        costs: [],
        qtys: [],
      };
      prev.costs.push(Number(item.cost || 0));
      prev.qtys.push(Number(item.qty || 0));
      byProductSupplier.set(key, prev);
    }
  }
  const supplierStatsByProduct = new Map();
  for (const row of byProductSupplier.values()) {
    const avgCost =
      row.costs.length > 0 ? row.costs.reduce((s, c) => s + Number(c || 0), 0) / row.costs.length : 0;
    const moq = row.qtys.length > 0 ? Math.max(1, Math.min(...row.qtys.map((x) => Math.max(1, Number(x || 1))))) : 1;
    const stat = {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      avgCost: Number(avgCost.toFixed(2)),
      moq,
    };
    if (!supplierStatsByProduct.has(row.productId)) supplierStatsByProduct.set(row.productId, []);
    supplierStatsByProduct.get(row.productId).push(stat);
  }

  let remainingBudget = budget;
  const candidateRows = products
    .map((p) => {
      const soldQty = Number(soldMap.get(p.id) || 0);
      const avgDailySold = soldQty / days;
      const recommendedQty = Math.max(
        0,
        Math.ceil(Math.max(Number(p.reorderLevel || 0), avgDailySold * leadDays) - Number(p.stock || 0))
      );
      const supplierOptions = (supplierStatsByProduct.get(p.id) || []).sort(
        (a, b) => Number(a.avgCost || 0) - Number(b.avgCost || 0)
      );
      const bestSupplier = supplierOptions[0] || null;
      if (!bestSupplier || recommendedQty <= 0) return null;
      const minQtyWithMoq = Math.max(recommendedQty, Number(bestSupplier.moq || 1));
      const estimatedCost = Number(minQtyWithMoq) * Number(bestSupplier.avgCost || 0);
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        stock: Number(p.stock || 0),
        reorderLevel: Number(p.reorderLevel || 0),
        avgDailySold: Number(avgDailySold.toFixed(2)),
        recommendedQty,
        plannedQty: minQtyWithMoq,
        estimatedCost: Number(estimatedCost.toFixed(2)),
        supplierId: bestSupplier.supplierId,
        supplierName: bestSupplier.supplierName,
        unitCost: Number(bestSupplier.avgCost || 0),
        moq: Number(bestSupplier.moq || 1),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.recommendedQty || 0) - Number(a.recommendedQty || 0));

  const rows = [];
  for (const row of candidateRows) {
    if (remainingBudget > 0 && Number(row.estimatedCost || 0) > remainingBudget) continue;
    rows.push(row);
    if (remainingBudget > 0) remainingBudget -= Number(row.estimatedCost || 0);
  }

  const bySupplier = new Map();
  for (const row of rows) {
    const key = Number(row.supplierId || 0);
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplierId: key,
        supplierName: row.supplierName || `Supplier #${key}`,
        lineCount: 0,
        estimatedCost: 0,
      });
    }
    const s = bySupplier.get(key);
    s.lineCount += 1;
    s.estimatedCost += Number(row.estimatedCost || 0);
    bySupplier.set(key, s);
  }

  return {
    params: { days, leadDays, budget },
    summary: {
      lineCount: rows.length,
      supplierCount: bySupplier.size,
      totalEstimatedCost: Number(rows.reduce((sum, x) => sum + Number(x.estimatedCost || 0), 0).toFixed(2)),
      remainingBudget: Number(Math.max(0, remainingBudget).toFixed(2)),
    },
    supplierGroups: [...bySupplier.values()].map((x) => ({
      ...x,
      estimatedCost: Number(Number(x.estimatedCost || 0).toFixed(2)),
    })),
    rows,
  };
}

exports.getPurchasePlanSuggestion = async (req, res) => {
  try {
    const payload = await buildPurchasePlanSuggestion(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchasePlanCSV = async (req, res) => {
  try {
    const payload = await buildPurchasePlanSuggestion(req.branchId, req.query || {});
    const rows = (payload.rows || []).map((row) => ({
      product_id: row.productId,
      product_name: row.productName,
      sku: row.sku || "",
      supplier: row.supplierName,
      recommended_qty: row.recommendedQty,
      planned_qty: row.plannedQty,
      unit_cost: Number(row.unitCost || 0).toFixed(2),
      estimated_cost: Number(row.estimatedCost || 0).toFixed(2),
      moq: row.moq,
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-plan.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchasePlanPDF = async (req, res) => {
  try {
    const payload = await buildPurchasePlanSuggestion(req.branchId, req.query || {});
    const rows = (payload.rows || []).map((row) => ({
      product: row.productName,
      supplier: row.supplierName,
      qty: row.plannedQty,
      unitCost: Number(row.unitCost || 0).toFixed(2),
      total: Number(row.estimatedCost || 0).toFixed(2),
    }));
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-plan.pdf"');
    doc.pipe(res);
    doc.fontSize(14).font("Helvetica-Bold").text("Purchase Plan Suggestion", { align: "center" });
    doc.moveDown(1);
    const cols = ["Product", "Supplier", "Qty", "Unit", "Total"];
    const keys = ["product", "supplier", "qty", "unitCost", "total"];
    const startX = 40;
    const width = 515;
    const colW = width / cols.length;
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold");
    cols.forEach((c, i) => doc.text(c, startX + i * colW, y, { width: colW }));
    y += 16;
    doc.font("Helvetica");
    rows.forEach((r) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      keys.forEach((k, i) => doc.text(String(r[k] ?? ""), startX + i * colW, y, { width: colW }));
      y += 16;
    });
    doc.end();
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createSplitPurchasesFromPlan = async (req, res) => {
  try {
    const branchId = req.branchId;
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.plan.split_execute",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });
    const payload = await buildPurchasePlanSuggestion(branchId, req.body || req.query || {});
    const reviewedRows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    const rows = reviewedRows
      ? reviewedRows
          .filter((row) => row && row.include !== false)
          .map((row) => ({
            productId: Number(row.productId || 0),
            productName: String(row.productName || ""),
            sku: row.sku || "",
            supplierId: Number(row.supplierId || 0),
            supplierName: String(row.supplierName || ""),
            plannedQty: Math.max(0, Number(row.plannedQty || 0)),
            unitCost: Math.max(0, Number(row.unitCost || 0)),
            estimatedCost: Number((Math.max(0, Number(row.plannedQty || 0)) * Math.max(0, Number(row.unitCost || 0))).toFixed(2)),
          }))
          .filter((row) => row.productId > 0 && row.supplierId > 0 && row.plannedQty > 0)
      : Array.isArray(payload.rows)
        ? payload.rows
        : [];
    if (!rows.length) return res.status(400).json({ error: "No planned lines to create purchases" });
    const createdPurchaseIds = await createPurchasesFromPlanRows({
      branchId,
      rows,
      actorUserId: req.user?.id || null,
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_PLAN_CREATE",
      entity: "PurchasePlan",
      entityId: null,
      payload: {
        createdPurchaseIds,
        supplierCount: new Set(rows.map((r) => Number(r.supplierId || 0)).filter(Boolean)).size,
        lineCount: rows.length,
        totalEstimatedCost: payload.summary?.totalEstimatedCost || 0,
      },
    });
    res.status(201).json({
      message: "Split purchases created from plan",
      createdPurchaseIds,
      supplierCount: new Set(rows.map((r) => Number(r.supplierId || 0)).filter(Boolean)).size,
      lineCount: rows.length,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

async function createPurchasesFromPlanRows({ branchId, rows, actorUserId }) {
    const grouped = new Map();
    for (const row of rows) {
      const sid = Number(row.supplierId || 0);
      if (!sid) continue;
      if (!grouped.has(sid)) grouped.set(sid, []);
      grouped.get(sid).push(row);
    }
    if (!grouped.size) throw new Error("No supplier-linked planned lines found");

    const createdPurchaseIds = [];
    for (const [supplierId, lines] of grouped.entries()) {
      const created = await prisma.$transaction(async (tx) => {
        let total = 0;
        for (const line of lines) total += Number(line.estimatedCost || 0);
        const purchase = await tx.purchase.create({
          data: {
            branchId,
            supplierId: Number(supplierId),
            invoiceNo: null,
            total: Number(total.toFixed(2)),
            paidAmount: 0,
            dueAmount: Number(total.toFixed(2)),
            financingSource: "SUPPLIER_CREDIT",
            items: {
              create: lines.map((line) => ({
                productId: Number(line.productId),
                qty: Number(line.plannedQty || 0),
                cost: Number(line.unitCost || 0),
              })),
            },
          },
        });
        for (const line of lines) {
          await tx.product.update({
            where: { id: Number(line.productId) },
            data: { stock: { increment: Number(line.plannedQty || 0) }, price: Number(line.unitCost || 0) },
          });
          await tx.stockLedger.create({
            data: {
              branchId,
              productId: Number(line.productId),
              refType: "PURCHASE",
              refId: purchase.id,
              inQty: Number(line.plannedQty || 0),
              unitCost: Number(line.unitCost || 0),
            },
          });
        }
        await tx.supplier.update({
          where: { id: Number(supplierId) },
          data: { payableBalance: { increment: Number(total.toFixed(2)) } },
        });
        const inventory = await getSystemAccount(branchId, "1300", tx);
        const payable = await getSystemAccount(branchId, "2100", tx);
        const cash = await getSystemAccount(branchId, "1100", tx);
        if (inventory && payable && cash) {
          await tx.journal.create({
            data: {
              branchId,
              purchaseId: purchase.id,
              createdBy: actorUserId || null,
              refType: "PURCHASE",
              refId: purchase.id,
              narration: `Purchase plan auto-created ${purchase.id}`,
              lines: {
                create: [
                  { accountId: inventory.id, debit: Number(total.toFixed(2)), credit: 0 },
                  { accountId: payable.id, debit: 0, credit: Number(total.toFixed(2)) },
                  { accountId: cash.id, debit: 0, credit: 0 },
                ],
              },
            },
          });
        }
        return purchase;
      });
      createdPurchaseIds.push(created.id);
    }
    return createdPurchaseIds;
}

exports.submitPurchasePlanApproval = async (req, res) => {
  try {
    const branchId = req.branchId;
    const reviewedRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const note = String(req.body?.note || "").trim();
    const rows = reviewedRows
      .filter((row) => row && row.include !== false)
      .map((row) => ({
        productId: Number(row.productId || 0),
        productName: String(row.productName || ""),
        sku: row.sku || "",
        supplierId: Number(row.supplierId || 0),
        supplierName: String(row.supplierName || ""),
        plannedQty: Math.max(0, Number(row.plannedQty || 0)),
        unitCost: Math.max(0, Number(row.unitCost || 0)),
        estimatedCost: Number((Math.max(0, Number(row.plannedQty || 0)) * Math.max(0, Number(row.unitCost || 0))).toFixed(2)),
      }))
      .filter((row) => row.productId > 0 && row.supplierId > 0 && row.plannedQty > 0);
    if (!rows.length) return res.status(400).json({ error: "No valid reviewed rows to submit for approval" });
    const totalEstimatedCost = Number(rows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0).toFixed(2));
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "PURCHASE_PLAN_APPROVAL",
        entity: "PurchasePlanApproval",
        payload: {
          branchId,
          status: "PENDING",
          note,
          submittedByUserId: req.user?.id || null,
          submittedAt: new Date().toISOString(),
          totalEstimatedCost,
          rows,
        },
      },
    });
    res.status(201).json({ id: created.id, status: "PENDING", totalEstimatedCost, lineCount: rows.length });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchasePlanApprovals = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query.status || "").toUpperCase();
    const logs = await prisma.auditLog.findMany({
      where: { action: "PURCHASE_PLAN_APPROVAL", entity: "PurchasePlanApproval" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const rows = logs
      .filter((x) => Number(x.payload?.branchId || 0) === Number(branchId))
      .map((x) => ({
        id: x.id,
        status: String(x.payload?.status || "PENDING"),
        note: String(x.payload?.note || ""),
        submittedAt: x.payload?.submittedAt || x.createdAt,
        submittedBy: x.user?.name || x.user?.email || "",
        approvedAt: x.payload?.approvedAt || null,
        approvedByUserId: x.payload?.approvedByUserId || null,
        rejectedAt: x.payload?.rejectedAt || null,
        rejectedByUserId: x.payload?.rejectedByUserId || null,
        lineCount: Array.isArray(x.payload?.rows) ? x.payload.rows.length : 0,
        totalEstimatedCost: Number(x.payload?.totalEstimatedCost || 0),
      }))
      .filter((x) => (status ? x.status === status : true));
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.approvePurchasePlanApproval = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid approval request id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "PURCHASE_PLAN_APPROVAL" || row.entity !== "PurchasePlanApproval") {
      return res.status(404).json({ error: "Approval request not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Approval request not found" });
    if (String(row.payload?.status || "PENDING") !== "PENDING") {
      return res.status(400).json({ error: "Only pending request can be approved" });
    }
    if (String(req.body?.managerApprovalPin || "") !== getManagerApprovalPin()) {
      return res.status(403).json({ error: "Manager approval PIN required" });
    }
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.plan.approval_execute",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });
    const rows = Array.isArray(row.payload?.rows) ? row.payload.rows : [];
    if (!rows.length) return res.status(400).json({ error: "No rows found in approval request" });
    const createdPurchaseIds = await createPurchasesFromPlanRows({
      branchId,
      rows,
      actorUserId: req.user?.id || null,
    });
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          status: "APPROVED",
          approvedAt: new Date().toISOString(),
          approvedByUserId: req.user?.id || null,
          createdPurchaseIds,
        },
      },
    });
    res.json({ message: "Purchase plan approved and executed", createdPurchaseIds });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.rejectPurchasePlanApproval = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid approval request id" });
    if (!reason) return res.status(400).json({ error: "Rejection reason is required" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "PURCHASE_PLAN_APPROVAL" || row.entity !== "PurchasePlanApproval") {
      return res.status(404).json({ error: "Approval request not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Approval request not found" });
    if (String(row.payload?.status || "PENDING") !== "PENDING") {
      return res.status(400).json({ error: "Only pending request can be rejected" });
    }
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          status: "REJECTED",
          rejectedAt: new Date().toISOString(),
          rejectedByUserId: req.user?.id || null,
          rejectionReason: reason,
        },
      },
    });
    res.json({ message: "Purchase plan rejected" });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getSupplierScorecards = async (req, res) => {
  try {
    const branchId = req.branchId;
    const days = Math.max(7, Number(req.query?.days || 60));
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const purchases = await prisma.purchase.findMany({
      where: { branchId, createdAt: { gte: fromDate } },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { select: { productId: true, qty: true, cost: true } },
        returns: { select: { amount: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const grouped = new Map();
    for (const purchase of purchases) {
      const supplierId = Number(purchase.supplierId || 0);
      if (!supplierId) continue;
      if (!grouped.has(supplierId)) {
        grouped.set(supplierId, {
          supplierId,
          supplierName: purchase.supplier?.name || `Supplier #${supplierId}`,
          purchaseCount: 0,
          totalSpend: 0,
          totalDue: 0,
          returnAmount: 0,
          itemCount: 0,
          totalQty: 0,
          totalUnitCost: 0,
          costValues: [],
          purchaseDates: [],
        });
      }
      const row = grouped.get(supplierId);
      row.purchaseCount += 1;
      row.totalSpend += Number(purchase.total || 0);
      row.totalDue += Number(purchase.dueAmount || 0);
      row.returnAmount += Number((purchase.returns || []).reduce((sum, r) => sum + Number(r.amount || 0), 0).toFixed(2));
      row.purchaseDates.push(new Date(purchase.createdAt).getTime());
      for (const item of purchase.items || []) {
        const qty = Number(item.qty || 0);
        const cost = Number(item.cost || 0);
        if (qty <= 0 || cost < 0) continue;
        row.itemCount += 1;
        row.totalQty += qty;
        row.totalUnitCost += cost;
        row.costValues.push(cost);
      }
      grouped.set(supplierId, row);
    }
    const scorecards = [...grouped.values()].map((row) => {
      const avgUnitCost = row.itemCount ? row.totalUnitCost / row.itemCount : 0;
      const mean = row.costValues.length ? row.costValues.reduce((sum, x) => sum + x, 0) / row.costValues.length : 0;
      const variance = row.costValues.length
        ? row.costValues.reduce((sum, x) => sum + (x - mean) ** 2, 0) / row.costValues.length
        : 0;
      const stdDev = Math.sqrt(variance);
      const priceVolatilityPct = mean > 0 ? (stdDev / mean) * 100 : 0;
      const returnRatePct = row.totalSpend > 0 ? (row.returnAmount / row.totalSpend) * 100 : 0;
      const dueRatioPct = row.totalSpend > 0 ? (row.totalDue / row.totalSpend) * 100 : 0;
      let avgCycleDays = 0;
      if (row.purchaseDates.length > 1) {
        const sorted = [...row.purchaseDates].sort((a, b) => a - b);
        let totalGap = 0;
        for (let i = 1; i < sorted.length; i += 1) {
          totalGap += (sorted[i] - sorted[i - 1]) / (24 * 60 * 60 * 1000);
        }
        avgCycleDays = totalGap / (sorted.length - 1);
      }
      const penaltyPoints = Number(
        (
          Math.min(40, returnRatePct * 2) +
          Math.min(30, priceVolatilityPct * 1.2) +
          Math.min(30, dueRatioPct * 0.7)
        ).toFixed(2)
      );
      const score = Number(Math.max(0, 100 - penaltyPoints).toFixed(2));
      const riskBand = score >= 80 ? "LOW" : score >= 60 ? "MEDIUM" : "HIGH";
      return {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        purchaseCount: row.purchaseCount,
        totalSpend: Number(row.totalSpend.toFixed(2)),
        totalDue: Number(row.totalDue.toFixed(2)),
        returnAmount: Number(row.returnAmount.toFixed(2)),
        returnRatePct: Number(returnRatePct.toFixed(2)),
        avgUnitCost: Number(avgUnitCost.toFixed(2)),
        priceVolatilityPct: Number(priceVolatilityPct.toFixed(2)),
        avgCycleDays: Number(avgCycleDays.toFixed(2)),
        penaltyPoints,
        score,
        riskBand,
      };
    });
    const sorted = scorecards.sort((a, b) => a.score - b.score);
    const summary = {
      supplierCount: sorted.length,
      avgScore: Number((sorted.reduce((sum, x) => sum + Number(x.score || 0), 0) / (sorted.length || 1)).toFixed(2)),
      highRiskSuppliers: sorted.filter((x) => x.riskBand === "HIGH").length,
      totalSpend: Number(sorted.reduce((sum, x) => sum + Number(x.totalSpend || 0), 0).toFixed(2)),
    };
    res.json({
      params: { days },
      summary,
      rows: sorted,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

/** Purchases financed via bank loan (2320) with remaining principal. */
exports.getOutstandingPurchaseLoans = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.purchase.findMany({
      where: {
        branchId,
        financingSource: "BANK_LOAN",
        dueAmount: { gt: 0 },
      },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const totalOutstanding = rows.reduce((s, p) => s + Number(p.dueAmount || 0), 0);
    res.json({
      purchases: rows,
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

/**
 * Repay purchase bank loan: Dr Bank Loans Payable, Cr Cash or Bank account.
 * Reduces Purchase.dueAmount and increases paidAmount.
 */
exports.payPurchaseLoan = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const parsedAmount = Number(req.body?.amount);
    if (!(parsedAmount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

    const method = req.body?.method != null ? String(req.body.method) : "Cash";
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;
    const fundingCode = resolveFundingAccountCode(method, req.body?.fundingAccountCode);

    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.loan.payment",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id: purchaseId, branchId },
        include: { supplier: true },
      });
      if (!purchase) throw new Error("Purchase not found");
      if (String(purchase.financingSource || "").toUpperCase() !== "BANK_LOAN") {
        throw new Error("This purchase is not financed as a bank loan");
      }
      const due = Number(purchase.dueAmount || 0);
      if (due <= 0) throw new Error("No outstanding loan balance for this purchase");
      if (parsedAmount > due + 0.005) throw new Error("Payment exceeds outstanding loan for this purchase");

      const loanPayable = await ensureBankLoanPayableAccount(tx, branchId);
      const fundingAcc = await getSystemAccount(branchId, fundingCode, tx);
      if (!fundingAcc) {
        throw new Error(`Funding account ${fundingCode} not found — run DB migration or add the account in Chart of Accounts`);
      }

      const updated = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          paidAmount: { increment: parsedAmount },
          dueAmount: { decrement: parsedAmount },
        },
      });

      await tx.journal.create({
        data: {
          branchId,
          purchaseId,
          createdBy: req.user?.id || null,
          refType: "PURCHASE_LOAN_PAYMENT",
          refId: purchaseId,
          narration: `Bank loan repayment purchase #${purchaseId}${purchase.supplier?.name ? ` (${purchase.supplier.name})` : ""}${note ? ` — ${note}` : ""}`,
          lines: {
            create: [
              { accountId: loanPayable.id, debit: parsedAmount, credit: 0 },
              { accountId: fundingAcc.id, debit: 0, credit: parsedAmount },
            ],
          },
        },
      });

      return { purchase: updated, fundingAccountCode: fundingCode, method };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_LOAN_PAYMENT",
      entity: "Purchase",
      entityId: purchaseId,
      payload: {
        branchId,
        amount: parsedAmount,
        fundingAccountCode: result.fundingAccountCode,
        method: result.method,
        note: note || null,
        remainingDue: Number(result.purchase.dueAmount || 0),
      },
    });

    res.status(201).json(result.purchase);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchasePaymentSchedule = async (req, res) => {
  try {
    const payload = await buildPurchaseSchedulePayload(req.branchId, req.query || {});
    res.json(payload);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.runPurchaseScheduleAutomation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const result = await runPurchaseScheduleReminderAutomationInternal({
      branchId,
      userId: req.user?.id || null,
    });
    res.json({
      message: "Purchase payment schedule automation completed",
      ...result,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.runPurchaseScheduleAutomationCron = async (req, res) => {
  try {
    const token = String(req.headers["x-automation-token"] || req.query?.token || "").trim();
    const expected = String(process.env.PURCHASE_SCHEDULE_AUTOMATION_TOKEN || "").trim();
    if (!expected) return res.status(503).json({ error: "PURCHASE_SCHEDULE_AUTOMATION_TOKEN is not configured" });
    if (!token || token !== expected) return res.status(401).json({ error: "Invalid automation token" });
    const branchIdRaw = Number(req.query?.branchId || req.body?.branchId || 0);
    if (!Number.isFinite(branchIdRaw) || branchIdRaw <= 0) {
      return res.status(400).json({ error: "branchId is required for cron automation" });
    }
    const result = await runPurchaseScheduleReminderAutomationInternal({
      branchId: branchIdRaw,
      userId: null,
    });
    res.json({
      message: "Purchase schedule cron automation completed",
      branchId: branchIdRaw,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchasePaymentScheduleCSV = async (req, res) => {
  try {
    const payload = await buildPurchaseSchedulePayload(req.branchId, req.query || {});
    const rows = (payload.rows || []).map((row) => ({
      purchase_id: row.purchaseId,
      supplier: row.supplierName,
      financing_source: row.financingSource,
      schedule_key: row.entryKey,
      due_date: row.dueDate,
      amount: Number(row.amount || 0).toFixed(2),
      paid_amount: Number(row.paidAmount || 0).toFixed(2),
      outstanding: Number(row.outstanding || 0).toFixed(2),
      days_past_due: Number(row.daysPastDue || 0),
      reminder_count: Number(row.reminderCount || 0),
      status: row.status,
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-payment-schedule.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchasePaymentSchedulePDF = async (req, res) => {
  try {
    const payload = await buildPurchaseSchedulePayload(req.branchId, req.query || {});
    const rows = (payload.rows || []).map((row) => ({
      purchaseId: row.purchaseId,
      supplierName: row.supplierName,
      dueDate: row.dueDate,
      outstanding: Number(row.outstanding || 0).toFixed(2),
      daysPastDue: Number(row.daysPastDue || 0),
      status: row.status,
    }));
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-payment-schedule.pdf"');
    doc.pipe(res);
    doc.fontSize(14).font("Helvetica-Bold").text("Purchase Payment Schedule & Aging", { align: "center" });
    doc.moveDown(0.8);
    doc.fontSize(9).font("Helvetica");
    const s = payload.summary || {};
    doc.text(
      `Open Lines: ${Number(s.openLineCount || 0)} | Outstanding: ${Number(s.outstandingTotal || 0).toFixed(2)} | Overdue: ${Number(
        s.overdueCount || 0
      )}`
    );
    doc.text(
      `Aging -> Current: ${Number(s?.aging?.current || 0).toFixed(2)} | 1-30: ${Number(s?.aging?.d1_30 || 0).toFixed(2)} | 31-60: ${Number(
        s?.aging?.d31_60 || 0
      ).toFixed(2)} | 61-90: ${Number(s?.aging?.d61_90 || 0).toFixed(2)} | 90+: ${Number(s?.aging?.d90_plus || 0).toFixed(2)}`
    );
    doc.moveDown(0.8);
    const cols = ["Purchase", "Supplier", "Due", "Outstanding", "DPD", "Status"];
    const keys = ["purchaseId", "supplierName", "dueDate", "outstanding", "daysPastDue", "status"];
    const startX = 40;
    const width = 515;
    const colW = width / cols.length;
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold");
    cols.forEach((c, i) => doc.text(c, startX + i * colW, y, { width: colW }));
    y += 14;
    doc.font("Helvetica");
    rows.forEach((r) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      keys.forEach((k, i) => doc.text(String(r[k] ?? ""), startX + i * colW, y, { width: colW }));
      y += 14;
    });
    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.payPurchaseScheduleEntry = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    const entryKey = String(req.params.entryKey || "").trim();
    const amount = Number(req.body?.amount || 0);
    const method = req.body?.method != null ? String(req.body.method) : "Cash";
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    if (!entryKey) return res.status(400).json({ error: "Invalid schedule entry key" });
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      roleName: req.user?.role?.name || "",
      actionName: "purchase.schedule.payment",
      overrideReason: req.body?.overrideReason,
      overrideRefNo: req.body?.overrideRefNo,
    });
    const existing = (await readLatestScheduleLogByPurchaseIds(branchId, [purchaseId])).get(purchaseId)?.payload || null;
    if (!existing) return res.status(404).json({ error: "Payment schedule not found" });
    const entries = Array.isArray(existing.entries) ? existing.entries : [];
    const idx = entries.findIndex((x) => String(x.key || "") === entryKey);
    if (idx < 0) return res.status(404).json({ error: "Schedule entry not found" });
    const entry = entries[idx];
    const outstanding = Math.max(0, Number(entry.amount || 0) - Number(entry.paidAmount || 0));
    if (!(outstanding > 0)) return res.status(400).json({ error: "Schedule entry already settled" });
    if (amount > outstanding + 0.005) return res.status(400).json({ error: "Payment exceeds schedule outstanding amount" });
    const result = await prisma.$transaction(async (tx) =>
      applyPurchaseDuePayment({
        tx,
        branchId,
        purchaseId,
        amount,
        method,
        note,
        actorUserId: req.user?.id || null,
      })
    );
    const nextEntries = [...entries];
    const nextPaid = Number((Number(entry.paidAmount || 0) + amount).toFixed(2));
    const nextOutstanding = Math.max(0, Number((Number(entry.amount || 0) - nextPaid).toFixed(2)));
    nextEntries[idx] = {
      ...entry,
      paidAmount: nextPaid,
      status: nextOutstanding <= 0 ? "PAID" : "PARTIAL",
      paidAt: nextOutstanding <= 0 ? new Date().toISOString() : entry.paidAt || null,
    };
    await writeScheduleLog({
      branchId,
      purchaseId,
      userId: req.user?.id || null,
      schedule: {
        ...existing,
        entries: nextEntries,
        status: nextEntries.every((x) => Number(x.amount || 0) <= Number(x.paidAmount || 0)) ? "CLOSED" : "ACTIVE",
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_SCHEDULE_PAYMENT",
      entity: "Purchase",
      entityId: purchaseId,
      payload: {
        branchId,
        entryKey,
        amount,
        method,
        note: note || null,
        fundingAccountCode: result.fundingCode,
        remainingDue: Number(result.purchase.dueAmount || 0),
      },
    });
    res.status(201).json(result.purchase);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};
