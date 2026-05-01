const prisma = require("../../utils/prisma");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

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
    createdAt: log.createdAt,
  };
}

async function getApprovalRows(req) {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  const action = req.query.action ? String(req.query.action) : "";
  const status = req.query.status ? String(req.query.status) : "";
  const where = {
    action: { startsWith: "APPROVAL_" },
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  if (action) where.action = action;
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
        return acc;
      },
      { count: 0, totalAmount: 0, pending: 0, approved: 0, rejected: 0, reviewed: 0 }
    );
    res.json({ rows, summary });
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
    const review = {
      byUserId: req.user?.id || null,
      remark: String(req.body.remark || "").trim(),
      reviewedAt: new Date().toISOString(),
    };
    const updated = await prisma.auditLog.update({
      where: { id },
      data: { payload: { ...payload, review, status: "REVIEWED" } },
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
