const prisma = require("../../utils/prisma");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

async function getAccountMap(tx, branchId) {
  const rows = await tx.account.findMany({ where: { branchId } });
  return new Map(rows.map((r) => [r.code, r]));
}

async function upsertStockAdjustmentJournal(tx, { adjustmentId, branchId, qty, unitPrice, productName, reasonRule }) {
  const impact = String(reasonRule?.accountingImpact || "NONE").toUpperCase();
  if (impact === "NONE") return null;
  const amount = Number((Math.abs(Number(qty || 0)) * Number(unitPrice || 0)).toFixed(2));
  if (!(amount > 0)) return null;
  const accountCode = String(reasonRule?.accountCode || (qty < 0 ? "5200" : "4100")).trim();
  const accounts = await getAccountMap(tx, branchId);
  const inventoryAcc = accounts.get("1300");
  const impactAcc = accounts.get(accountCode);
  if (!inventoryAcc || !impactAcc) {
    throw new Error(`Required accounts missing for stock adjustment journal: 1300 and ${accountCode}`);
  }
  const lines =
    qty < 0
      ? [
          { accountId: impactAcc.id, debit: amount, credit: 0 },
          { accountId: inventoryAcc.id, debit: 0, credit: amount },
        ]
      : [
          { accountId: inventoryAcc.id, debit: amount, credit: 0 },
          { accountId: impactAcc.id, debit: 0, credit: amount },
        ];
  const existing = await tx.stockAdjustment.findUnique({ where: { id: adjustmentId }, select: { journalId: true } });
  if (existing?.journalId) {
    await tx.journalLine.deleteMany({ where: { journalId: existing.journalId } });
    await tx.journal.update({
      where: { id: existing.journalId },
      data: {
        narration: `Inventory adjustment ${productName} (${reasonRule?.code || "UNSPECIFIED"})`,
        lines: { create: lines },
      },
    });
    return existing.journalId;
  }
  const created = await tx.journal.create({
    data: {
      branchId,
      createdBy: null,
      refType: "STOCK_ADJUSTMENT",
      refId: adjustmentId,
      narration: `Inventory adjustment ${productName} (${reasonRule?.code || "UNSPECIFIED"})`,
      lines: { create: lines },
    },
  });
  return created.id;
}

async function executePendingStockAdjustmentApproval(tx, approvalEvent) {
  const payload = approvalEvent.payload || {};
  const request = payload.request || {};
  const branchId = Number(payload.branchId || 0);
  const mode = String(request.mode || "").toUpperCase();
  if (!branchId || !["CREATE", "UPDATE"].includes(mode)) {
    throw new Error("Invalid stock adjustment approval request payload");
  }

  if (mode === "CREATE") {
    const productId = Number(request.productId);
    const qty = Number(request.qtyChange);
    const warehouseId = request.warehouseId ? Number(request.warehouseId) : null;
    const reasonCode = request.reasonCode ? String(request.reasonCode).trim().toUpperCase() : null;
    const reasonText = String(request.reason || "manual_adjustment");
    if (!Number.isInteger(qty) || qty === 0) throw new Error("Invalid pending qtyChange");
    const product = await tx.product.findFirst({ where: { id: productId, branchId } });
    if (!product) throw new Error("Product not found for approved adjustment");
    if (Number(product.stock || 0) + qty < 0) throw new Error("Negative stock not allowed");
    let reasonRule = null;
    if (reasonCode) {
      reasonRule = await tx.inventoryAdjustReason.findFirst({ where: { branchId, code: reasonCode } });
      if (!reasonRule) throw new Error("Reason code no longer valid");
    }
    await tx.product.update({ where: { id: product.id }, data: { stock: { increment: qty } } });
    const adjustment = await tx.stockAdjustment.create({
      data: {
        branchId,
        productId: product.id,
        qtyChange: qty,
        reason: reasonText,
        reasonCode,
      },
    });
    const journalId = reasonRule
      ? await upsertStockAdjustmentJournal(tx, {
          adjustmentId: adjustment.id,
          branchId,
          qty,
          unitPrice: Number(product.price || 0),
          productName: product.name,
          reasonRule,
        })
      : null;
    if (journalId) await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { journalId } });
    await tx.stockLedger.create({
      data: {
        branchId,
        warehouseId: warehouseId || null,
        productId: product.id,
        refType: "STOCK_ADJUSTMENT",
        refId: adjustment.id,
        inQty: qty > 0 ? qty : 0,
        outQty: qty < 0 ? Math.abs(qty) : 0,
        unitCost: Number(product.price || 0),
      },
    });
    return { adjustmentId: adjustment.id };
  }

  const adjustmentId = Number(request.adjustmentId);
  const nextQty = Number(request.qtyChange);
  const nextWarehouseId = request.warehouseId ? Number(request.warehouseId) : null;
  const reasonCode = request.reasonCode ? String(request.reasonCode).trim().toUpperCase() : null;
  const reasonText = String(request.reason || "manual_adjustment");
  if (!Number.isInteger(nextQty) || nextQty === 0) throw new Error("Invalid pending qtyChange");
  const existing = await tx.stockAdjustment.findFirst({ where: { id: adjustmentId, branchId } });
  if (!existing) throw new Error("Adjustment not found for approved update");
  const delta = nextQty - Number(existing.qtyChange || 0);
  const product = await tx.product.findFirst({ where: { id: existing.productId, branchId } });
  if (!product) throw new Error("Product not found for approved adjustment update");
  if (Number(product.stock || 0) + delta < 0) throw new Error("Negative stock not allowed");
  let reasonRule = null;
  if (reasonCode) {
    reasonRule = await tx.inventoryAdjustReason.findFirst({ where: { branchId, code: reasonCode } });
    if (!reasonRule) throw new Error("Reason code no longer valid");
  }
  await tx.product.update({ where: { id: product.id }, data: { stock: { increment: delta } } });
  await tx.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      qtyChange: nextQty,
      reason: reasonText,
      reasonCode,
    },
  });
  const journalId = reasonRule
    ? await upsertStockAdjustmentJournal(tx, {
        adjustmentId,
        branchId,
        qty: nextQty,
        unitPrice: Number(product.price || 0),
        productName: product.name,
        reasonRule,
      })
    : null;
  if (!reasonRule && existing.journalId) {
    await tx.journalLine.deleteMany({ where: { journalId: existing.journalId } });
    await tx.journal.delete({ where: { id: existing.journalId } });
  }
  await tx.stockAdjustment.update({ where: { id: adjustmentId }, data: { journalId: journalId || null } });
  await tx.stockLedger.updateMany({
    where: { branchId, refType: "STOCK_ADJUSTMENT", refId: adjustmentId },
    data: {
      warehouseId: nextWarehouseId || null,
      inQty: nextQty > 0 ? nextQty : 0,
      outQty: nextQty < 0 ? Math.abs(nextQty) : 0,
    },
  });
  return { adjustmentId };
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

function sendXlsx(res, rows, filename, sheetName = "Approvals") {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

function writePdfTable(res, title, columns, rows, filename) {
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.fontSize(14).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(1);
  const startX = 40;
  const width = 515;
  const colW = width / columns.length;
  let y = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  columns.forEach((col, idx) => doc.text(col.label, startX + idx * colW, y, { width: colW }));
  y += 16;
  doc.font("Helvetica").fontSize(9);
  rows.forEach((row) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    columns.forEach((col, idx) => doc.text(String(row[col.key] ?? ""), startX + idx * colW, y, { width: colW }));
    y += 14;
  });
  doc.end();
}

function normalizeApprovalLog(log, userMap = new Map()) {
  const payload = log.payload || {};
  const review = payload.review || null;
  const requestedBy = log.userId ? userMap.get(log.userId) || null : null;
  const reviewedByUserId = review?.byUserId || null;
  const reviewedBy = reviewedByUserId ? userMap.get(reviewedByUserId) || null : null;
  return {
    id: log.id,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    status: payload.status || (review ? "REVIEWED" : "PENDING"),
    reason: payload.reason || "",
    amount: Number(payload.amount || 0),
    userId: log.userId,
    requestedByName: requestedBy?.name || "",
    requestedByRole: requestedBy?.roleName || "",
    reviewedBy: reviewedByUserId,
    reviewedByName: reviewedBy?.name || "",
    reviewedByRole: reviewedBy?.roleName || "",
    reviewRemark: review?.remark || "",
    escalatedAt: payload.escalation?.escalatedAt || null,
    escalatedBy: payload.escalation?.byUserId || null,
    escalationReason: payload.escalation?.reason || "",
    createdAt: log.createdAt,
  };
}

async function getApprovalRows(req) {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  const action = req.query.action ? String(req.query.action) : "";
  const status = req.query.status ? String(req.query.status) : "";
  const id = req.query.id ? Number(req.query.id) : null;
  const overdueOnly = String(req.query.overdueOnly || "").toLowerCase() === "true";
  const where = {
    action: { startsWith: "APPROVAL_" },
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  if (action) where.action = action;
  if (id && Number.isFinite(id)) where.id = id;
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const userIds = new Set();
  logs.forEach((log) => {
    if (log.userId) userIds.add(log.userId);
    const byUserId = log.payload?.review?.byUserId;
    if (byUserId) userIds.add(byUserId);
  });
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true, email: true, role: { select: { name: true } } },
      })
    : [];
  const userMap = new Map(
    users.map((u) => [
      u.id,
      {
        name: u.name || u.email || `User#${u.id}`,
        roleName: u.role?.name || "",
      },
    ])
  );
  let rows = logs.map((log) => normalizeApprovalLog(log, userMap));
  if (status) rows = rows.filter((r) => r.status === status);
  rows = rows.map((row) => {
    const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 60000));
    let slaLevel = "ON_TIME";
    if (ageMinutes >= 24 * 60) slaLevel = "OVERDUE_24H";
    else if (ageMinutes >= 120) slaLevel = "OVERDUE_2H";
    else if (ageMinutes >= 30) slaLevel = "OVERDUE_30M";
    return {
      ...row,
      ageMinutes,
      slaLevel,
      isOverdue: slaLevel !== "ON_TIME",
    };
  });
  if (overdueOnly) {
    rows = rows.filter((r) => r.status === "PENDING" && r.isOverdue);
  }
  return rows;
}

exports.getApprovals = async (req, res) => {
  try {
    const rows = await getApprovalRows(req);
    const summary = rows.reduce(
      (acc, row) => {
        acc.count += 1;
        acc.totalAmount += Number(row.amount || 0);
        if (row.status === "PENDING") acc.pending += 1;
        if (row.status === "APPROVED") acc.approved += 1;
        if (row.status === "REJECTED") acc.rejected += 1;
        if (row.status === "REVIEWED") acc.reviewed += 1;
        if (row.status === "PENDING" && row.slaLevel === "OVERDUE_30M") acc.overdue30m += 1;
        if (row.status === "PENDING" && row.slaLevel === "OVERDUE_2H") acc.overdue2h += 1;
        if (row.status === "PENDING" && row.slaLevel === "OVERDUE_24H") acc.overdue24h += 1;
        return acc;
      },
      {
        count: 0,
        totalAmount: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        reviewed: 0,
        overdue30m: 0,
        overdue2h: 0,
        overdue24h: 0,
      }
    );
    res.json({ rows, summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.escalateApproval = async (req, res) => {
  try {
    const roleName = String(req.user?.role?.name || "").toLowerCase();
    if (!["admin", "manager"].includes(roleName)) {
      return res.status(403).json({ error: "Only Manager/Admin can escalate approvals" });
    }
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid approval id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Approval event not found" });
    const payload = row.payload || {};
    if (String(payload.status || "").toUpperCase() !== "PENDING") {
      return res.status(400).json({ error: "Only pending approvals can be escalated" });
    }
    const escalation = {
      byUserId: req.user?.id || null,
      reason: String(req.body?.reason || "").trim() || "Escalated by manager",
      escalatedAt: new Date().toISOString(),
    };
    const updated = await prisma.auditLog.update({
      where: { id },
      data: { payload: { ...payload, escalation } },
    });
    res.json(normalizeApprovalLog(updated));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reviewApproval = async (req, res) => {
  try {
    const roleName = String(req.user?.role?.name || "").toLowerCase();
    if (!["admin", "manager"].includes(roleName)) {
      return res.status(403).json({ error: "Only Manager/Admin can review approvals" });
    }
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid approval id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Approval event not found" });
    const payload = row.payload || {};
    const currentStatus = String(payload.status || "PENDING").toUpperCase();
    if (["APPROVED", "REJECTED"].includes(currentStatus)) {
      return res.status(400).json({ error: `Approval is already ${currentStatus}` });
    }
    const decision = String(req.body?.decision || "").trim().toUpperCase();
    const nextStatus = ["APPROVED", "REJECTED"].includes(decision) ? decision : "REVIEWED";
    const review = {
      byUserId: req.user?.id || null,
      remark: String(req.body.remark || "").trim(),
      decision: nextStatus,
      reviewedAt: new Date().toISOString(),
    };
    let resolvedEntityId = row.entityId || null;
    if (row.action === "APPROVAL_STOCK_ADJUSTMENT" && nextStatus === "APPROVED") {
      const result = await prisma.$transaction(async (tx) => executePendingStockAdjustmentApproval(tx, row));
      resolvedEntityId = result?.adjustmentId || resolvedEntityId;
    }
    const updated = await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...payload,
          review,
          status: nextStatus,
          resolvedEntityId: resolvedEntityId || null,
          resolvedAt: new Date().toISOString(),
        },
      },
    });
    const reviewerName = req.user?.name || req.user?.email || "";
    res.json({
      ...normalizeApprovalLog(updated),
      reviewedByName: reviewerName,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportApprovalsCSV = async (req, res) => {
  try {
    const rows = await getApprovalRows(req);
    const csvRows = rows.map((r) => ({
      id: r.id,
      action: r.action,
      status: r.status,
      entity: r.entity,
      entity_id: r.entityId ?? "",
      amount: Number(r.amount || 0).toFixed(2),
      reason: r.reason || "",
      user_id: r.userId ?? "",
      requested_by: r.requestedByName || "",
      requested_by_role: r.requestedByRole || "",
      reviewed_by: r.reviewedBy ?? "",
      reviewed_by_name: r.reviewedByName || "",
      reviewed_by_role: r.reviewedByRole || "",
      review_remark: r.reviewRemark || "",
      created_at: new Date(r.createdAt).toISOString(),
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="approval-queue.csv"');
    res.send(toCSV(csvRows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportApprovalsXLSX = async (req, res) => {
  try {
    const rows = await getApprovalRows(req);
    const data = rows.map((r) => ({
      ID: r.id,
      Action: r.action,
      Status: r.status,
      Entity: r.entity,
      EntityID: r.entityId ?? "",
      Amount: Number(r.amount || 0).toFixed(2),
      Reason: r.reason || "",
      UserID: r.userId ?? "",
      RequestedBy: r.requestedByName || "",
      RequestedByRole: r.requestedByRole || "",
      ReviewedBy: r.reviewedBy ?? "",
      ReviewedByName: r.reviewedByName || "",
      ReviewedByRole: r.reviewedByRole || "",
      ReviewRemark: r.reviewRemark || "",
      CreatedAt: new Date(r.createdAt).toISOString(),
    }));
    sendXlsx(res, data, "approval-queue.xlsx", "Approvals");
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportApprovalsPDF = async (req, res) => {
  try {
    const rows = await getApprovalRows(req);
    const data = rows.map((r) => ({
      id: r.id,
      action: r.action,
      status: r.status,
      amount: Number(r.amount || 0).toFixed(2),
      requestedBy: `${r.requestedByName || "-"}${r.requestedByRole ? ` (${r.requestedByRole})` : ""}`,
      reviewedBy: `${r.reviewedByName || "-"}${r.reviewedByRole ? ` (${r.reviewedByRole})` : ""}`,
      reason: r.reason || "-",
      createdAt: new Date(r.createdAt).toLocaleString(),
    }));
    writePdfTable(
      res,
      "Approval Queue",
      [
        { key: "id", label: "ID" },
        { key: "action", label: "Action" },
        { key: "status", label: "Status" },
        { key: "amount", label: "Amount" },
        { key: "requestedBy", label: "Requested By" },
        { key: "reviewedBy", label: "Reviewed By" },
        { key: "reason", label: "Reason" },
        { key: "createdAt", label: "Date" },
      ],
      data,
      "approval-queue.pdf"
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
