const prisma = require("../../utils/prisma");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");
const { formatProductStock } = require("../../utils/saleUnitFormat");
const { getLatestLandedCostByProduct } = require("../../utils/costingUtil");
const { writeAuditLog } = require("../../utils/audit");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
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

function sendXlsx(res, rows, filename, sheetName = "StockCount") {
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

function getManagerPin() {
  return String(process.env.MANAGER_APPROVAL_PIN || "1234");
}

function getStockCountVarianceThreshold() {
  return Number(process.env.STOCK_COUNT_APPROVAL_QTY || 20);
}

function getInventoryWriteOffApprovalThreshold() {
  return Number(process.env.INVENTORY_WRITEOFF_APPROVAL_AMOUNT || 5000);
}

function getNextDueAt(fromDate, frequency) {
  const date = new Date(fromDate);
  const f = String(frequency || "daily").toLowerCase();
  if (f === "weekly") date.setDate(date.getDate() + 7);
  else if (f === "monthly") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + 1);
  return date;
}

function clean(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function calcMarginPct(sellingPrice, unitCost) {
  const selling = Number(sellingPrice || 0);
  const cost = Number(unitCost || 0);
  if (!(selling > 0)) return 0;
  return ((selling - cost) / selling) * 100;
}

async function getReasonMap(tx, branchId) {
  const rows = await tx.inventoryAdjustReason.findMany({ where: { branchId } });
  return new Map(rows.map((x) => [String(x.code).toUpperCase(), x]));
}

async function upsertAdjustmentJournal(tx, { adjustmentId, branchId, qty, unitPrice, productName, reason }) {
  const impact = String(reason?.accountingImpact || "NONE").toUpperCase();
  if (impact === "NONE") return null;
  const amount = Number((Math.abs(Number(qty || 0)) * Number(unitPrice || 0)).toFixed(2));
  if (!(amount > 0)) return null;
  const accountCode = String(reason?.accountCode || (qty < 0 ? "5200" : "4100")).trim();
  const accounts = await tx.account.findMany({ where: { branchId } });
  const map = new Map(accounts.map((a) => [a.code, a]));
  const inventoryAcc = map.get("1300");
  const impactAcc = map.get(accountCode);
  if (!inventoryAcc || !impactAcc) {
    throw new Error(`Required accounts missing for stock adjustment journal: 1300 and ${accountCode}`);
  }
  const journalPayload =
    qty < 0
      ? {
          narration: `Inventory write-off ${productName} (${reason?.code || "UNSPECIFIED"})`,
          lines: [
            { accountId: impactAcc.id, debit: amount, credit: 0 },
            { accountId: inventoryAcc.id, debit: 0, credit: amount },
          ],
        }
      : {
          narration: `Inventory gain ${productName} (${reason?.code || "UNSPECIFIED"})`,
          lines: [
            { accountId: inventoryAcc.id, debit: amount, credit: 0 },
            { accountId: impactAcc.id, debit: 0, credit: amount },
          ],
        };
  const existing = await tx.stockAdjustment.findUnique({ where: { id: adjustmentId }, select: { journalId: true } });
  if (existing?.journalId) {
    await tx.journalLine.deleteMany({ where: { journalId: existing.journalId } });
    await tx.journal.update({
      where: { id: existing.journalId },
      data: {
        narration: journalPayload.narration,
        lines: { create: journalPayload.lines },
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
      narration: journalPayload.narration,
      lines: { create: journalPayload.lines },
    },
  });
  return created.id;
}

function requiresWriteOffApproval({ reasonRule, qty, unitPrice }) {
  if (!reasonRule) return false;
  if (String(reasonRule.accountingImpact || "").toUpperCase() !== "WRITE_OFF") return false;
  if (!(Number(qty) < 0)) return false;
  const amount = Math.abs(Number(qty || 0)) * Number(unitPrice || 0);
  return amount >= getInventoryWriteOffApprovalThreshold();
}

async function buildStockCountSnapshotItems(branchId) {
  const products = await prisma.product.findMany({
    where: { branchId },
    select: { id: true, name: true, stock: true },
    orderBy: { name: "asc" },
  });
  return products.map((p) => ({
    productId: p.id,
    productName: p.name,
    expectedQty: Number(p.stock || 0),
    countedQty: Number(p.stock || 0),
    variance: 0,
    varianceReason: "",
    recountRound: 0,
  }));
}

async function createStockCountSessionLog({ branchId, userId, warehouseId, note, blindMode, assignedToUserId = null }) {
  const items = await buildStockCountSnapshotItems(branchId);
  const assignedUser =
    assignedToUserId
      ? await prisma.user.findFirst({
          where: { id: Number(assignedToUserId), branchId },
          select: { id: true, name: true, email: true },
        })
      : null;
  if (assignedToUserId && !assignedUser) {
    throw new Error("Assigned user not found in branch");
  }
  return prisma.auditLog.create({
    data: {
      userId: userId || null,
      action: "STOCK_COUNT_SESSION",
      entity: "StockCountSession",
      payload: {
        branchId,
        warehouseId: warehouseId || null,
        status: "OPEN",
        note: note || "",
        blindMode: Boolean(blindMode),
        assignedToUserId: assignedUser?.id || null,
        assignedToName: assignedUser ? assignedUser.name || assignedUser.email || `User#${assignedUser.id}` : "",
        recountRound: 0,
        items,
      },
    },
  });
}

function normalizeStockCountLog(log, productMap = new Map(), warehouseMap = new Map()) {
  const payload = log.payload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const totalVariance = items.reduce((sum, item) => sum + Number(item.variance || 0), 0);
  const totalAbsVariance = items.reduce((sum, item) => sum + Math.abs(Number(item.variance || 0)), 0);
  return {
    id: log.id,
    status: payload.status || "OPEN",
    warehouseId: payload.warehouseId || null,
    warehouseName: payload.warehouseId ? warehouseMap.get(payload.warehouseId) || `#${payload.warehouseId}` : "-",
    note: payload.note || "",
    assignedToUserId: payload.assignedToUserId || null,
    assignedToName: payload.assignedToName || "",
    blindMode: Boolean(payload.blindMode),
    items: items.map((item) => ({
      ...item,
      productName: productMap.get(item.productId) || `#${item.productId}`,
      varianceReason: item.varianceReason || "",
      recountRound: Number(item.recountRound || 0),
    })),
    totalItems: items.length,
    totalVariance,
    totalAbsVariance,
    createdBy: log.userId,
    createdAt: log.createdAt,
    finalizedAt: payload.finalizedAt || null,
    recountRound: Number(payload.recountRound || 0),
    approvalEventId: payload.approvalEventId || null,
  };
}

async function getStockCountSessions(req) {
  const branchId = req.branchId;
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  const status = req.query.status ? String(req.query.status) : "";
  const where = {
    action: "STOCK_COUNT_SESSION",
    entity: "StockCountSession",
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const filteredLogs = logs.filter((log) => {
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return false;
    if (status && String(payload.status || "") !== status) return false;
    return true;
  });
  const allProductIds = [...new Set(filteredLogs.flatMap((log) => (log.payload?.items || []).map((x) => x.productId)).filter(Boolean))];
  const products = allProductIds.length
    ? await prisma.product.findMany({ where: { branchId, id: { in: allProductIds } }, select: { id: true, name: true } })
    : [];
  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const warehouses = await prisma.warehouse.findMany({ where: { branchId }, select: { id: true, name: true } });
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));
  return filteredLogs.map((log) => normalizeStockCountLog(log, productMap, warehouseMap));
}

exports.getStockLedger = async (req, res) => {
  try {
    const branchId = req.branchId;
    const lq = parseListQuery(req, {
      searchableFields: ["refType"],
      relationSearch: {
        productName: { relation: "product", field: "name" },
        warehouseName: { relation: "warehouse", field: "name" },
      },
      filterableFields: ["refType"],
      sortableFields: ["id", "inQty", "outQty", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const where = { branchId };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [items, total] = await prisma.$transaction([
        prisma.stockLedger.findMany({
          where,
          include: { product: true, warehouse: true },
          orderBy: lq.orderBy,
          skip: lq.skip,
          take: lq.take,
        }),
        prisma.stockLedger.count({ where }),
      ]);
      return res.json(pagedResult({ data: items, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const items = await prisma.stockLedger.findMany({
      where,
      include: { product: true, warehouse: true },
      orderBy: lq.orderBy || { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.adjustStock = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { productId, qtyChange, reason, reasonCode, warehouseId } = req.body;
    const managerApprovalPin = String(req.body?.managerApprovalPin || "");
    const qty = Number(qtyChange);
    const normalizedReasonCode = clean(reasonCode, 40).toUpperCase() || null;
    const reasonText = clean(reason, 160);
    const parsedWarehouseId = warehouseId ? Number(warehouseId) : null;
    if (!Number.isInteger(qty) || qty === 0) {
      return res.status(400).json({ error: "qtyChange must be non-zero integer" });
    }
    if (parsedWarehouseId && Number.isNaN(parsedWarehouseId)) {
      return res.status(400).json({ error: "Invalid warehouse id" });
    }
    const product = await prisma.product.findFirst({ where: { id: Number(productId), branchId } });
    if (!product) return res.status(404).json({ error: "Product not found in branch" });
    if (product.stock + qty < 0) return res.status(400).json({ error: "Negative stock not allowed" });
    if (parsedWarehouseId) {
      const warehouse = await prisma.warehouse.findFirst({
        where: { id: parsedWarehouseId, branchId },
      });
      if (!warehouse) return res.status(404).json({ error: "Warehouse not found in branch" });
    }

    await ensureOpenFiscalPeriod(branchId, new Date());
    await prisma.$transaction(async (tx) => {
      const reasonMap = await getReasonMap(tx, branchId);
      const reasonRule = normalizedReasonCode ? reasonMap.get(normalizedReasonCode) : null;
      if (normalizedReasonCode && !reasonRule) {
        throw new Error("Invalid reasonCode");
      }
      if (reasonRule?.direction === "IN" && qty < 0) throw new Error("Selected reason only supports positive adjustment");
      if (reasonRule?.direction === "OUT" && qty > 0) throw new Error("Selected reason only supports negative adjustment");
      if (
        requiresWriteOffApproval({
          reasonRule,
          qty,
          unitPrice: Number(product.price || 0),
        }) &&
        managerApprovalPin !== getManagerPin()
      ) {
        const requiredAmount = Number((Math.abs(qty) * Number(product.price || 0)).toFixed(2));
        const approvalEvent = await tx.auditLog.create({
          data: {
            userId: req.user?.id || null,
            action: "APPROVAL_STOCK_ADJUSTMENT",
            entity: "StockAdjustment",
            payload: {
              status: "PENDING",
              reason: "Manager PIN required for high-value write-off",
              amount: requiredAmount,
              threshold: getInventoryWriteOffApprovalThreshold(),
              productId: product.id,
              reasonCode: reasonRule?.code || null,
              qtyChange: qty,
              branchId,
              request: {
                mode: "CREATE",
                productId: product.id,
                qtyChange: qty,
                reason: reasonText || reasonRule?.label || "manual_adjustment",
                reasonCode: reasonRule?.code || null,
                warehouseId: parsedWarehouseId || null,
              },
            },
          },
        });
        const error = new Error("Manager approval PIN required for high-value write-off");
        error.httpStatus = 403;
        error.meta = { approvalEventId: approvalEvent.id, requiredAmount };
        throw error;
      }
      await tx.product.update({ where: { id: product.id }, data: { stock: { increment: qty } } });
      const adjustment = await tx.stockAdjustment.create({
        data: {
          branchId,
          productId: product.id,
          qtyChange: qty,
          reason: reasonText || reasonRule?.label || "manual_adjustment",
          reasonCode: reasonRule?.code || null,
        },
      });
      const journalId = reasonRule
        ? await upsertAdjustmentJournal(tx, {
            adjustmentId: adjustment.id,
            branchId,
            qty,
            unitPrice: Number(product.price || 0),
            productName: product.name,
            reason: reasonRule,
          })
        : null;
      if (journalId) {
        await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { journalId } });
      }
      await tx.stockLedger.create({
        data: {
          branchId,
          warehouseId: parsedWarehouseId,
          productId: product.id,
          refType: "STOCK_ADJUSTMENT",
          refId: adjustment.id,
          inQty: qty > 0 ? qty : 0,
          outQty: qty < 0 ? Math.abs(qty) : 0,
          unitCost: product.price,
        },
      });
    });

    res.json({ message: "Stock adjusted" });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "STOCK_ADJUST",
      entity: "Product",
      entityId: product.id,
      payload: { qtyChange: qty, reason: reasonText || "manual_adjustment", reasonCode: normalizedReasonCode },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(error.httpStatus || 400).json({
      error: error.message,
      ...(error.meta || {}),
    });
  }
};

exports.getStockAdjustments = async (req, res) => {
  try {
    const branchId = req.branchId;
    const items = await prisma.stockAdjustment.findMany({
      where: { branchId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const reasons = await prisma.inventoryAdjustReason.findMany({
      where: { branchId },
      select: { code: true, label: true },
    });
    const reasonMap = new Map(reasons.map((x) => [x.code, x.label]));
    const productIds = [...new Set(items.map((x) => x.productId))];
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { branchId, id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p.name]));
    const adjustmentIds = items.map((x) => x.id);
    const ledgers = adjustmentIds.length
      ? await prisma.stockLedger.findMany({
          where: { branchId, refType: "STOCK_ADJUSTMENT", refId: { in: adjustmentIds } },
          select: { refId: true, warehouseId: true, warehouse: { select: { name: true } } },
        })
      : [];
    const ledgerMap = new Map(ledgers.map((l) => [l.refId, l]));
    const approvalLogs = await prisma.auditLog.findMany({
      where: { action: "APPROVAL_STOCK_ADJUSTMENT", entity: "StockAdjustment" },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const approvalByAdjustmentId = new Map();
    for (const log of approvalLogs) {
      const payload = log.payload || {};
      if (Number(payload.branchId || 0) !== Number(branchId)) continue;
      const candidateIds = [
        Number(log.entityId || 0),
        Number(payload?.resolvedEntityId || 0),
        Number(payload?.request?.adjustmentId || 0),
      ].filter(Boolean);
      const status = String(payload.status || "PENDING").toUpperCase();
      for (const adjId of candidateIds) {
        if (!adjustmentIds.includes(adjId)) continue;
        if (!approvalByAdjustmentId.has(adjId)) {
          approvalByAdjustmentId.set(adjId, {
            approvalStatus: status,
            approvalEventId: log.id,
            approvalRemark: payload?.review?.remark || "",
          });
        }
      }
    }

    res.json(
      items.map((x) => ({
        ...x,
        productName: productMap.get(x.productId) || `#${x.productId}`,
        reasonLabel: x.reasonCode ? reasonMap.get(x.reasonCode) || x.reason : x.reason,
        warehouseId: ledgerMap.get(x.id)?.warehouseId || null,
        warehouseName: ledgerMap.get(x.id)?.warehouse?.name || "-",
        approvalStatus: approvalByAdjustmentId.get(x.id)?.approvalStatus || null,
        approvalEventId: approvalByAdjustmentId.get(x.id)?.approvalEventId || null,
        approvalRemark: approvalByAdjustmentId.get(x.id)?.approvalRemark || "",
      }))
    );
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockAdjustment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const adjustmentId = Number(req.params.id);
    const nextQty = Number(req.body.qtyChange);
    const nextReason = String(req.body.reason || "manual_adjustment");
    const nextReasonCode = clean(req.body.reasonCode, 40).toUpperCase() || null;
    const managerApprovalPin = String(req.body?.managerApprovalPin || "");
    const nextWarehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : null;
    if (Number.isNaN(adjustmentId) || !Number.isInteger(nextQty) || nextQty === 0) {
      return res.status(400).json({ error: "Invalid adjustment update payload" });
    }
    if (nextWarehouseId && Number.isNaN(nextWarehouseId)) {
      return res.status(400).json({ error: "Invalid warehouse id" });
    }

    const existing = await prisma.stockAdjustment.findFirst({
      where: { id: adjustmentId, branchId },
    });
    if (!existing) return res.status(404).json({ error: "Adjustment not found" });

    const delta = nextQty - existing.qtyChange;
    await ensureOpenFiscalPeriod(branchId, new Date());
    await prisma.$transaction(async (tx) => {
      const reasonMap = await getReasonMap(tx, branchId);
      const reasonRule = nextReasonCode ? reasonMap.get(nextReasonCode) : null;
      if (nextReasonCode && !reasonRule) throw new Error("Invalid reasonCode");
      if (reasonRule?.direction === "IN" && nextQty < 0) throw new Error("Selected reason only supports positive adjustment");
      if (reasonRule?.direction === "OUT" && nextQty > 0) throw new Error("Selected reason only supports negative adjustment");
      if (nextWarehouseId) {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: nextWarehouseId, branchId },
        });
        if (!warehouse) throw new Error("Warehouse not found in branch");
      }
      const product = await tx.product.findFirst({
        where: { id: existing.productId, branchId },
      });
      if (!product) throw new Error("Product not found");
      if (product.stock + delta < 0) throw new Error("Negative stock not allowed");
      if (
        requiresWriteOffApproval({
          reasonRule,
          qty: nextQty,
          unitPrice: Number(product.price || 0),
        }) &&
        managerApprovalPin !== getManagerPin()
      ) {
        const requiredAmount = Number((Math.abs(nextQty) * Number(product.price || 0)).toFixed(2));
        const approvalEvent = await tx.auditLog.create({
          data: {
            userId: req.user?.id || null,
            action: "APPROVAL_STOCK_ADJUSTMENT",
            entity: "StockAdjustment",
            entityId: adjustmentId,
            payload: {
              status: "PENDING",
              reason: "Manager PIN required for high-value write-off update",
              amount: requiredAmount,
              threshold: getInventoryWriteOffApprovalThreshold(),
              productId: product.id,
              reasonCode: reasonRule?.code || null,
              qtyChange: nextQty,
              branchId,
              request: {
                mode: "UPDATE",
                adjustmentId,
                qtyChange: nextQty,
                reason: nextReason || reasonRule?.label || "manual_adjustment",
                reasonCode: reasonRule?.code || null,
                warehouseId: nextWarehouseId || null,
              },
            },
          },
        });
        const err = new Error("Manager approval PIN required for high-value write-off");
        err.httpStatus = 403;
        err.meta = { approvalEventId: approvalEvent.id, requiredAmount };
        throw err;
      }

      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: delta } },
      });
      await tx.stockAdjustment.update({
        where: { id: adjustmentId },
        data: {
          qtyChange: nextQty,
          reason: nextReason || reasonRule?.label || "manual_adjustment",
          reasonCode: reasonRule?.code || null,
        },
      });
      const journalId = reasonRule
        ? await upsertAdjustmentJournal(tx, {
            adjustmentId,
            branchId,
            qty: nextQty,
            unitPrice: Number(product.price || 0),
            productName: product.name,
            reason: reasonRule,
          })
        : null;
      if (!reasonRule && existing.journalId) {
        await tx.journalLine.deleteMany({ where: { journalId: existing.journalId } });
        await tx.journal.delete({ where: { id: existing.journalId } });
      }
      await tx.stockAdjustment.update({
        where: { id: adjustmentId },
        data: { journalId: journalId || null },
      });
      await tx.stockLedger.updateMany({
        where: { branchId, refType: "STOCK_ADJUSTMENT", refId: adjustmentId },
        data: {
          productId: existing.productId,
          warehouseId: nextWarehouseId,
          inQty: nextQty > 0 ? nextQty : 0,
          outQty: nextQty < 0 ? Math.abs(nextQty) : 0,
        },
      });
    });

    res.json({ message: "Stock adjustment updated" });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(error.httpStatus || 400).json({
      error: error.message,
      ...(error.meta || {}),
    });
  }
};

exports.deleteStockAdjustment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const adjustmentId = Number(req.params.id);
    if (Number.isNaN(adjustmentId)) return res.status(400).json({ error: "Invalid adjustment id" });

    const existing = await prisma.stockAdjustment.findFirst({
      where: { id: adjustmentId, branchId },
    });
    if (!existing) return res.status(404).json({ error: "Adjustment not found" });

    await ensureOpenFiscalPeriod(branchId, new Date());
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: existing.productId, branchId },
      });
      if (!product) throw new Error("Product not found");
      if (product.stock - existing.qtyChange < 0) throw new Error("Negative stock not allowed");

      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: -existing.qtyChange } },
      });
      await tx.stockLedger.deleteMany({
        where: { branchId, refType: "STOCK_ADJUSTMENT", refId: adjustmentId },
      });
      if (existing.journalId) {
        await tx.journalLine.deleteMany({ where: { journalId: existing.journalId } });
        await tx.journal.delete({ where: { id: existing.journalId } });
      }
      await tx.stockAdjustment.delete({ where: { id: adjustmentId } });
    });

    res.json({ message: "Stock adjustment deleted" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.listInventoryAdjustReasons = async (req, res) => {
  try {
    const branchId = req.branchId;
    const active = String(req.query?.active || "").trim();
    const rows = await prisma.inventoryAdjustReason.findMany({
      where: {
        branchId,
        ...(active === "1" ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      take: 500,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createInventoryAdjustReason = async (req, res) => {
  try {
    const branchId = req.branchId;
    const code = clean(req.body?.code, 40).toUpperCase();
    const label = clean(req.body?.label, 120);
    const direction = clean(req.body?.direction, 10).toUpperCase() || "BOTH";
    const accountingImpact = clean(req.body?.accountingImpact, 20).toUpperCase() || "NONE";
    const accountCode = clean(req.body?.accountCode, 20) || null;
    if (!code || !label) return res.status(400).json({ error: "code and label are required" });
    if (!["IN", "OUT", "BOTH"].includes(direction)) return res.status(400).json({ error: "direction must be IN/OUT/BOTH" });
    if (!["NONE", "WRITE_OFF", "GAIN"].includes(accountingImpact)) {
      return res.status(400).json({ error: "accountingImpact must be NONE/WRITE_OFF/GAIN" });
    }
    const row = await prisma.inventoryAdjustReason.create({
      data: {
        branchId,
        code,
        label,
        direction,
        accountingImpact,
        accountCode,
        isActive: req.body?.isActive !== false,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    if (String(error?.code) === "P2002") return res.status(409).json({ error: "Reason code already exists" });
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateInventoryAdjustReason = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid reason id" });
    const existing = await prisma.inventoryAdjustReason.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Reason not found" });
    const nextCode = req.body?.code != null ? clean(req.body.code, 40).toUpperCase() : existing.code;
    const nextLabel = req.body?.label != null ? clean(req.body.label, 120) : existing.label;
    const nextDirection = req.body?.direction != null ? clean(req.body.direction, 10).toUpperCase() : existing.direction;
    const nextImpact =
      req.body?.accountingImpact != null
        ? clean(req.body.accountingImpact, 20).toUpperCase()
        : existing.accountingImpact;
    const nextAccountCode =
      req.body?.accountCode != null ? clean(req.body.accountCode, 20) || null : existing.accountCode;
    const nextIsActive = req.body?.isActive != null ? Boolean(req.body.isActive) : existing.isActive;

    if (!nextCode || !nextLabel) return res.status(400).json({ error: "code and label are required" });
    if (!["IN", "OUT", "BOTH"].includes(nextDirection)) return res.status(400).json({ error: "direction must be IN/OUT/BOTH" });
    if (!["NONE", "WRITE_OFF", "GAIN"].includes(nextImpact)) {
      return res.status(400).json({ error: "accountingImpact must be NONE/WRITE_OFF/GAIN" });
    }
    const row = await prisma.inventoryAdjustReason.update({
      where: { id },
      data: {
        code: nextCode,
        label: nextLabel,
        direction: nextDirection,
        accountingImpact: nextImpact,
        accountCode: nextAccountCode,
        isActive: nextIsActive,
      },
    });
    res.json(row);
  } catch (error) {
    if (String(error?.code) === "P2002") return res.status(409).json({ error: "Reason code already exists" });
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.transferStock = async (req, res) => {
  try {
    const fromBranchId = req.branchId;
    const { toBranchId, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Transfer items are required" });
    }
    if (Number(toBranchId) === Number(fromBranchId)) {
      return res.status(400).json({ error: "Transfer branch must be different" });
    }

    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: { fromBranchId, toBranchId: Number(toBranchId), status: "pending" },
      });

      for (const item of items) {
        const qty = Number(item.qty);
        if (!Number.isInteger(qty) || qty <= 0) {
          throw new Error("Invalid transfer qty");
        }
        const fromProduct = await tx.product.findFirst({
          where: { id: Number(item.fromProductId), branchId: fromBranchId },
        });
        const toProduct = await tx.product.findFirst({
          where: { id: Number(item.toProductId), branchId: Number(toBranchId) },
        });
        if (!fromProduct || !toProduct) throw new Error("Transfer product mapping invalid");
        if (fromProduct.stock < qty) throw new Error(`Insufficient stock for ${fromProduct.name}`);

        await tx.stockTransferItem.create({
          data: {
            transferId: created.id,
            fromProductId: fromProduct.id,
            toProductId: toProduct.id,
            qty,
          },
        });
      }
      return created;
    });

    res.status(201).json(transfer);
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "STOCK_TRANSFER_REQUEST",
      entity: "StockTransfer",
      entityId: transfer.id,
      payload: { fromBranchId, toBranchId: Number(toBranchId), itemsCount: items.length, status: "PENDING" },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.approveStockTransfer = async (req, res) => {
  try {
    const branchId = req.branchId;
    const transferId = Number(req.params.id);
    const managerApprovalPin = String(req.body?.managerApprovalPin || "");
    if (Number.isNaN(transferId)) return res.status(400).json({ error: "Invalid transfer id" });
    if (managerApprovalPin !== getManagerPin()) {
      return res.status(403).json({ error: "Manager approval PIN required" });
    }
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: transferId },
      include: { items: true },
    });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (String(transfer.status || "").toLowerCase() !== "pending") {
      return res.status(400).json({ error: "Only pending transfer can be approved" });
    }
    if (Number(transfer.toBranchId) !== Number(branchId) && Number(transfer.fromBranchId) !== Number(branchId)) {
      return res.status(403).json({ error: "Not allowed to approve this transfer" });
    }

    const completed = await prisma.$transaction(async (tx) => {
      for (const item of transfer.items || []) {
        const qty = Number(item.qty || 0);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error("Invalid transfer qty");
        const fromProduct = await tx.product.findUnique({ where: { id: Number(item.fromProductId) } });
        const toProduct = await tx.product.findUnique({ where: { id: Number(item.toProductId) } });
        if (!fromProduct || !toProduct) throw new Error("Transfer product mapping invalid");
        if (Number(fromProduct.branchId) !== Number(transfer.fromBranchId) || Number(toProduct.branchId) !== Number(transfer.toBranchId)) {
          throw new Error("Transfer product branch mismatch");
        }
        if (Number(fromProduct.stock || 0) < qty) throw new Error(`Insufficient stock for ${fromProduct.name}`);
        await tx.product.update({ where: { id: fromProduct.id }, data: { stock: { decrement: qty } } });
        await tx.product.update({ where: { id: toProduct.id }, data: { stock: { increment: qty } } });
        await tx.stockLedger.createMany({
          data: [
            {
              branchId: Number(transfer.fromBranchId),
              productId: fromProduct.id,
              refType: "STOCK_TRANSFER_OUT",
              refId: transfer.id,
              outQty: qty,
              unitCost: fromProduct.price,
            },
            {
              branchId: Number(transfer.toBranchId),
              productId: toProduct.id,
              refType: "STOCK_TRANSFER_IN",
              refId: transfer.id,
              inQty: qty,
              unitCost: toProduct.price,
            },
          ],
        });
      }
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "completed" },
      });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "STOCK_TRANSFER_APPROVE",
      entity: "StockTransfer",
      entityId: transfer.id,
      payload: { status: "APPROVED" },
    });
    res.json(completed);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.rejectStockTransfer = async (req, res) => {
  try {
    const branchId = req.branchId;
    const transferId = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (Number.isNaN(transferId)) return res.status(400).json({ error: "Invalid transfer id" });
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (String(transfer.status || "").toLowerCase() !== "pending") {
      return res.status(400).json({ error: "Only pending transfer can be rejected" });
    }
    if (Number(transfer.toBranchId) !== Number(branchId) && Number(transfer.fromBranchId) !== Number(branchId)) {
      return res.status(403).json({ error: "Not allowed to reject this transfer" });
    }
    const rejected = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "rejected" },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "STOCK_TRANSFER_REJECT",
      entity: "StockTransfer",
      entityId: transfer.id,
      payload: { status: "REJECTED", reason: reason || "" },
    });
    res.json(rejected);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getStockTransfers = async (req, res) => {
  try {
    const branchId = req.branchId;
    const logs = await prisma.stockTransfer.findMany({
      where: {
        OR: [{ fromBranchId: branchId }, { toBranchId: branchId }],
      },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        items: {
          include: {
            fromProduct: { select: { id: true, name: true, sku: true } },
            toProduct: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(logs);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getLowStockAlerts = async (req, res) => {
  try {
    const branchId = req.branchId;
    const q = String(req.query.q || "").trim();
    const onlyCritical = String(req.query.onlyCritical || "").toLowerCase() === "true";
    const landedByProduct = await getLatestLandedCostByProduct(branchId);
    const products = await prisma.product.findMany({
      where: {
        branchId,
        reorderLevel: { gt: 0 },
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { sku: { contains: q } },
                { category: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ stock: "asc" }, { name: "asc" }],
      take: 300,
    });

    const rows = products
      .filter((p) => !p.hasVariants)
      .map((p) => {
        const reorderLevel = Number(p.reorderLevel || 0);
        const stock = p.sellByWeight ? Number(p.stockKg || 0) : Number(p.stock || 0);
        const shortageQty = Math.max(0, reorderLevel - stock);
        const status = stock <= 0 ? "OUT" : stock <= reorderLevel ? "LOW" : "OK";
        const landedInfo = landedByProduct.get(Number(p.id)) || null;
        const baseUnitCost = Number(landedInfo?.baseUnitCost || p.unitPrice || 0);
        const landedUnitCost = Number(landedInfo?.landedUnitCost || baseUnitCost);
        const sellingPrice = Number(p.price || 0);
        const baseMarginPct = calcMarginPct(sellingPrice, baseUnitCost);
        const landedMarginPct = calcMarginPct(sellingPrice, landedUnitCost);
        return {
          ...p,
          kind: p.sellByWeight ? "WEIGHT" : "SIMPLE",
          stockDisplay: formatProductStock(p),
          status,
          shortageQty,
          severityScore: reorderLevel > 0 ? shortageQty / reorderLevel : 0,
          baseUnitCost: Number(baseUnitCost.toFixed(4)),
          landedUnitCost: Number(landedUnitCost.toFixed(4)),
          baseMarginPct: Number(baseMarginPct.toFixed(2)),
          landedMarginPct: Number(landedMarginPct.toFixed(2)),
          marginImpactPct: Number((landedMarginPct - baseMarginPct).toFixed(2)),
        };
      })
      .filter((p) => (onlyCritical ? p.status !== "OK" : true));

    let variantAlertRows = [];
    const variantsForAlert = await prisma.productVariant.findMany({
      where: {
        branchId,
        product: { hasVariants: true, reorderLevel: { gt: 0 } },
      },
      include: {
        product: { select: { id: true, name: true, sku: true, reorderLevel: true, price: true, unitPrice: true, category: true } },
      },
      orderBy: [{ stock: "asc" }, { id: "asc" }],
      take: 500,
    });
    variantAlertRows = variantsForAlert
      .map((v) => {
        const reorderLevel = Number(v.product?.reorderLevel || 0);
        const stock = Number(v.stock || 0);
        const shortageQty = Math.max(0, reorderLevel - stock);
        const status = stock <= 0 ? "OUT" : stock <= reorderLevel ? "LOW" : "OK";
        const landedInfo = landedByProduct.get(Number(v.productId)) || null;
        const baseUnitCost = Number(landedInfo?.baseUnitCost || v.product?.unitPrice || 0);
        const landedUnitCost = Number(landedInfo?.landedUnitCost || baseUnitCost);
        const sellingPrice = Number(v.product?.price || 0);
        const baseMarginPct = calcMarginPct(sellingPrice, baseUnitCost);
        const landedMarginPct = calcMarginPct(sellingPrice, landedUnitCost);
        const baseName = String(v.product?.name || "").trim() || "Product";
        const vlabel = String(v.label || "").trim();
        return {
          id: `var-${v.id}`,
          variantId: v.id,
          productId: v.productId,
          kind: "VARIANT",
          name: vlabel ? `${baseName} (${vlabel})` : baseName,
          sku: v.sku || v.product?.sku || null,
          category: v.product?.category || "",
          price: Number(v.product?.price || 0),
          unitPrice: Number(v.product?.unitPrice || 0),
          stock,
          reorderLevel,
          status,
          shortageQty,
          severityScore: reorderLevel > 0 ? shortageQty / reorderLevel : 0,
          baseUnitCost: Number(baseUnitCost.toFixed(4)),
          landedUnitCost: Number(landedUnitCost.toFixed(4)),
          baseMarginPct: Number(baseMarginPct.toFixed(2)),
          landedMarginPct: Number(landedMarginPct.toFixed(2)),
          marginImpactPct: Number((landedMarginPct - baseMarginPct).toFixed(2)),
        };
      })
      .filter((p) => (onlyCritical ? p.status !== "OK" : true));

    const merged = [...rows, ...variantAlertRows].sort((a, b) => {
      if (a.status !== b.status) {
        const priority = { OUT: 0, LOW: 1, OK: 2 };
        return priority[a.status] - priority[b.status];
      }
      if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    res.json({
      rows: merged,
      summary: {
        totalTracked: merged.length,
        outOfStock: merged.filter((x) => x.status === "OUT").length,
        lowStock: merged.filter((x) => x.status === "LOW").length,
      },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getInventoryIntelligence = async (req, res) => {
  try {
    const branchId = req.branchId;
    const days = Math.max(7, Number(req.query.days || 30));
    const deadDays = Math.max(15, Number(req.query.deadDays || 60));
    const leadDays = Math.max(1, Number(req.query.leadDays || 7));
    const forecastDays = Math.max(1, Number(req.query.forecastDays || leadDays));
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const products = await prisma.product.findMany({
      where: { branchId },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        stock: true,
        reorderLevel: true,
        price: true,
        unitPrice: true,
      },
      orderBy: { name: "asc" },
      take: 2000,
    });
    const productIds = products.map((p) => p.id);
    const landedByProduct = await getLatestLandedCostByProduct(branchId);
    if (!productIds.length) {
      return res.json({
        summary: { fastMovingCount: 0, slowMovingCount: 0, deadStockCount: 0, suggestedReorderCount: 0 },
        rows: [],
      });
    }

    const periodSales = await prisma.saleItem.findMany({
      where: {
        productId: { in: productIds },
        sale: {
          branchId,
          createdAt: { gte: from, lte: now },
        },
      },
      select: {
        productId: true,
        qty: true,
        sale: { select: { createdAt: true } },
      },
    });

    const recentSales = await prisma.saleItem.findMany({
      where: {
        productId: { in: productIds },
        sale: { branchId },
      },
      select: {
        productId: true,
        qty: true,
        sale: { select: { createdAt: true } },
      },
      orderBy: { sale: { createdAt: "desc" } },
      take: 8000,
    });

    const soldQtyMap = new Map();
    const weekdayQtyByProduct = new Map();
    periodSales.forEach((row) => {
      soldQtyMap.set(row.productId, (soldQtyMap.get(row.productId) || 0) + Number(row.qty || 0));
      const createdAt = row.sale?.createdAt ? new Date(row.sale.createdAt) : null;
      const weekday = createdAt ? createdAt.getDay() : 0;
      if (!weekdayQtyByProduct.has(row.productId)) {
        weekdayQtyByProduct.set(row.productId, [0, 0, 0, 0, 0, 0, 0]);
      }
      const arr = weekdayQtyByProduct.get(row.productId);
      arr[weekday] += Number(row.qty || 0);
      weekdayQtyByProduct.set(row.productId, arr);
    });

    const lastSoldMap = new Map();
    recentSales.forEach((row) => {
      if (!lastSoldMap.has(row.productId)) {
        lastSoldMap.set(row.productId, row.sale?.createdAt || null);
      }
    });

    const rows = products.map((p) => {
      const soldQty = Number(soldQtyMap.get(p.id) || 0);
      const avgDailySold = soldQty / days;
      const projectedNeed = avgDailySold * leadDays;
      const weekdayPattern = weekdayQtyByProduct.get(p.id) || [0, 0, 0, 0, 0, 0, 0];
      const totalPatternQty = weekdayPattern.reduce((sum, qty) => sum + Number(qty || 0), 0);
      const expectedWeekdayAvg = totalPatternQty > 0 ? totalPatternQty / 7 : avgDailySold;
      let upcomingDemand = 0;
      for (let i = 0; i < forecastDays; i += 1) {
        const day = new Date(now.getTime() + i * 24 * 60 * 60 * 1000).getDay();
        const dayQty = Number(weekdayPattern[day] || 0);
        const normalizedDayDemand = totalPatternQty > 0 ? dayQty : expectedWeekdayAvg;
        upcomingDemand += normalizedDayDemand;
      }
      const forecastNeed = totalPatternQty > 0 ? upcomingDemand : avgDailySold * forecastDays;
      const seasonalityMultiplier = projectedNeed > 0 ? forecastNeed / projectedNeed : 1;
      const baseReorderSuggestionQty = Math.max(
        0,
        Math.ceil(Math.max(Number(p.reorderLevel || 0), projectedNeed) - Number(p.stock || 0))
      );
      const reorderSuggestionQty = Math.max(
        0,
        Math.ceil(Math.max(Number(p.reorderLevel || 0), forecastNeed) - Number(p.stock || 0))
      );
      const lastSoldAt = lastSoldMap.get(p.id) || null;
      const daysSinceLastSale = lastSoldAt
        ? Math.floor((now.getTime() - new Date(lastSoldAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const deadStock = daysSinceLastSale == null ? Number(p.stock || 0) > 0 : daysSinceLastSale >= deadDays;
      const landedInfo = landedByProduct.get(Number(p.id)) || null;
      const baseUnitCost = Number(landedInfo?.baseUnitCost || p.unitPrice || 0);
      const landedUnitCost = Number(landedInfo?.landedUnitCost || baseUnitCost);
      const sellingPrice = Number(p.price || 0);
      const baseMarginPct = calcMarginPct(sellingPrice, baseUnitCost);
      const landedMarginPct = calcMarginPct(sellingPrice, landedUnitCost);
      return {
        ...p,
        soldQty,
        avgDailySold,
        projectedNeed,
        forecastNeed,
        seasonalityMultiplier,
        baseReorderSuggestionQty,
        lastSoldAt,
        daysSinceLastSale,
        deadStock,
        reorderSuggestionQty,
        baseUnitCost: Number(baseUnitCost.toFixed(4)),
        landedUnitCost: Number(landedUnitCost.toFixed(4)),
        baseMarginPct: Number(baseMarginPct.toFixed(2)),
        landedMarginPct: Number(landedMarginPct.toFixed(2)),
        marginImpactPct: Number((landedMarginPct - baseMarginPct).toFixed(2)),
      };
    });

    const sortedByMovement = [...rows].sort((a, b) => b.soldQty - a.soldQty);
    const fastThreshold = sortedByMovement.length
      ? sortedByMovement[Math.max(0, Math.floor(sortedByMovement.length * 0.2) - 1)]?.soldQty || 0
      : 0;
    const slowThreshold = sortedByMovement.length
      ? sortedByMovement[Math.max(0, Math.floor(sortedByMovement.length * 0.8) - 1)]?.soldQty || 0
      : 0;

    const classified = rows.map((row) => {
      let movementClass = "MEDIUM";
      if (row.soldQty >= fastThreshold && row.soldQty > 0) movementClass = "FAST";
      else if (row.soldQty <= slowThreshold) movementClass = "SLOW";
      if (row.deadStock) movementClass = "DEAD";
      return { ...row, movementClass };
    });

    res.json({
      summary: {
        fastMovingCount: classified.filter((x) => x.movementClass === "FAST").length,
        slowMovingCount: classified.filter((x) => x.movementClass === "SLOW").length,
        deadStockCount: classified.filter((x) => x.movementClass === "DEAD").length,
        suggestedReorderCount: classified.filter((x) => Number(x.reorderSuggestionQty || 0) > 0).length,
        seasonalityAdjustedCount: classified.filter(
          (x) => Number(x.reorderSuggestionQty || 0) !== Number(x.baseReorderSuggestionQty || 0)
        ).length,
      },
      rows: classified.sort((a, b) => {
        const priority = { DEAD: 0, SLOW: 1, MEDIUM: 2, FAST: 3 };
        if (priority[a.movementClass] !== priority[b.movementClass]) {
          return priority[a.movementClass] - priority[b.movementClass];
        }
        return Number(b.soldQty || 0) - Number(a.soldQty || 0);
      }),
      params: { days, deadDays, leadDays, forecastDays },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getTransferBranchProducts = async (req, res) => {
  try {
    const branchId = Number(req.params.branchId);
    if (Number.isNaN(branchId)) {
      return res.status(400).json({ error: "Invalid branch id" });
    }
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, isActive: true },
    });
    if (!branch || !branch.isActive) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const products = await prisma.product.findMany({
      where: { branchId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, stock: true, price: true, reorderLevel: true },
    });
    res.json(products);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createStockCountSession = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { warehouseId, note, blindMode, assignedToUserId } = req.body || {};
    const parsedWarehouseId = warehouseId ? Number(warehouseId) : null;
    if (parsedWarehouseId) {
      const warehouse = await prisma.warehouse.findFirst({ where: { id: parsedWarehouseId, branchId } });
      if (!warehouse) return res.status(404).json({ error: "Warehouse not found in branch" });
    }
    const created = await createStockCountSessionLog({
      branchId,
      userId: req.user?.id || null,
      warehouseId: parsedWarehouseId,
      note,
      blindMode,
      assignedToUserId: assignedToUserId ? Number(assignedToUserId) : null,
    });
    const itemsCount = Array.isArray(created.payload?.items) ? created.payload.items.length : 0;
    res.status(201).json({ id: created.id, status: "OPEN", itemsCount });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createStockCountSchedule = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { name, warehouseId, frequency, isActive = true, blindMode = false, note, assignedToUserId } = req.body || {};
    const f = String(frequency || "daily").toLowerCase();
    if (!["daily", "weekly", "monthly"].includes(f)) {
      return res.status(400).json({ error: "frequency must be daily/weekly/monthly" });
    }
    const parsedWarehouseId = warehouseId ? Number(warehouseId) : null;
    if (parsedWarehouseId) {
      const warehouse = await prisma.warehouse.findFirst({ where: { id: parsedWarehouseId, branchId } });
      if (!warehouse) return res.status(404).json({ error: "Warehouse not found in branch" });
    }
    let assignedUser = null;
    if (assignedToUserId) {
      assignedUser = await prisma.user.findFirst({
        where: { id: Number(assignedToUserId), branchId },
        select: { id: true, name: true, email: true },
      });
      if (!assignedUser) return res.status(404).json({ error: "Assigned user not found in branch" });
    }
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "STOCK_COUNT_SCHEDULE",
        entity: "StockCountSchedule",
        payload: {
          branchId,
          name: String(name || `${f.toUpperCase()} Count`),
          warehouseId: parsedWarehouseId,
          frequency: f,
          isActive: Boolean(isActive),
          blindMode: Boolean(blindMode),
          assignedToUserId: assignedUser?.id || null,
          assignedToName: assignedUser ? assignedUser.name || assignedUser.email || `User#${assignedUser.id}` : "",
          note: String(note || ""),
          nextDueAt: new Date().toISOString(),
          lastRunAt: null,
        },
      },
    });
    res.status(201).json({ id: created.id, ...(created.payload || {}) });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getStockCountSchedules = async (req, res) => {
  try {
    const branchId = req.branchId;
    const logs = await prisma.auditLog.findMany({
      where: { action: "STOCK_COUNT_SCHEDULE", entity: "StockCountSchedule" },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const assigneeIds = [...new Set(logs.map((x) => Number(x.payload?.assignedToUserId || 0)).filter(Boolean))];
    const users = assigneeIds.length
      ? await prisma.user.findMany({
          where: { id: { in: assigneeIds }, branchId },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name || u.email || `User#${u.id}`]));
    const rows = logs
      .filter((x) => Number(x.payload?.branchId || 0) === Number(branchId))
      .map((x) => ({
        id: x.id,
        createdAt: x.createdAt,
        ...(x.payload || {}),
        assignedToName:
          x.payload?.assignedToUserId
            ? userMap.get(Number(x.payload.assignedToUserId)) || x.payload?.assignedToName || ""
            : "",
        isDue: x.payload?.isActive && x.payload?.nextDueAt ? new Date(x.payload.nextDueAt) <= new Date() : false,
      }));
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockCountSchedule = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid schedule id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "STOCK_COUNT_SCHEDULE" || row.entity !== "StockCountSchedule") {
      return res.status(404).json({ error: "Schedule not found" });
    }
    const payload = row.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Schedule not found" });

    const next = { ...payload };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) next.name = String(req.body.name || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) next.note = String(req.body.note || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) next.isActive = Boolean(req.body.isActive);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "blindMode")) next.blindMode = Boolean(req.body.blindMode);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "frequency")) {
      const f = String(req.body.frequency || "").toLowerCase();
      if (!["daily", "weekly", "monthly"].includes(f)) {
        return res.status(400).json({ error: "frequency must be daily/weekly/monthly" });
      }
      next.frequency = f;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "warehouseId")) {
      const parsedWarehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : null;
      if (parsedWarehouseId) {
        const warehouse = await prisma.warehouse.findFirst({ where: { id: parsedWarehouseId, branchId } });
        if (!warehouse) return res.status(404).json({ error: "Warehouse not found in branch" });
      }
      next.warehouseId = parsedWarehouseId;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "assignedToUserId")) {
      const assignedToUserId = req.body.assignedToUserId ? Number(req.body.assignedToUserId) : null;
      if (assignedToUserId) {
        const user = await prisma.user.findFirst({
          where: { id: assignedToUserId, branchId },
          select: { id: true, name: true, email: true },
        });
        if (!user) return res.status(404).json({ error: "Assigned user not found in branch" });
        next.assignedToUserId = user.id;
        next.assignedToName = user.name || user.email || `User#${user.id}`;
      } else {
        next.assignedToUserId = null;
        next.assignedToName = "";
      }
    }
    const updated = await prisma.auditLog.update({
      where: { id },
      data: { payload: next },
    });
    res.json({ id: updated.id, ...(updated.payload || {}) });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.deleteStockCountSchedule = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid schedule id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "STOCK_COUNT_SCHEDULE" || row.entity !== "StockCountSchedule") {
      return res.status(404).json({ error: "Schedule not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Schedule not found" });
    await prisma.auditLog.delete({ where: { id } });
    res.json({ message: "Schedule deleted" });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.toggleStockCountScheduleStatus = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid schedule id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "STOCK_COUNT_SCHEDULE" || row.entity !== "StockCountSchedule") {
      return res.status(404).json({ error: "Schedule not found" });
    }
    const payload = row.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Schedule not found" });
    const updated = await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...payload,
          isActive: !Boolean(payload.isActive),
        },
      },
    });
    res.json({ id: updated.id, ...(updated.payload || {}) });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

async function runSingleSchedule({ branchId, userId, schedule }) {
  const now = new Date();
  const payload = schedule.payload || {};
  const session = await createStockCountSessionLog({
    branchId,
    userId: userId || null,
    warehouseId: payload.warehouseId || null,
    note: payload.note || `Auto created from schedule #${schedule.id}`,
    blindMode: Boolean(payload.blindMode),
    assignedToUserId: payload.assignedToUserId ? Number(payload.assignedToUserId) : null,
  });
  await prisma.auditLog.update({
    where: { id: schedule.id },
    data: {
      payload: {
        ...payload,
        lastRunAt: now.toISOString(),
        nextDueAt: getNextDueAt(now, payload.frequency).toISOString(),
        lastSessionId: session.id,
      },
    },
  });
  return { sessionId: session.id, nextDueAt: getNextDueAt(now, payload.frequency).toISOString() };
}

exports.runStockCountScheduleNow = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid schedule id" });
    const schedule = await prisma.auditLog.findUnique({ where: { id } });
    if (!schedule || schedule.action !== "STOCK_COUNT_SCHEDULE" || schedule.entity !== "StockCountSchedule") {
      return res.status(404).json({ error: "Schedule not found" });
    }
    const payload = schedule.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Schedule not found" });
    if (!payload.isActive) return res.status(400).json({ error: "Cannot run inactive schedule. Resume first." });
    const result = await runSingleSchedule({ branchId, userId: req.user?.id || null, schedule });
    res.json({ message: "Schedule executed", scheduleId: id, createdSessionId: result.sessionId, nextDueAt: result.nextDueAt });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.runStockCountSchedules = async (req, res) => {
  try {
    const branchId = req.branchId;
    const logs = await prisma.auditLog.findMany({
      where: { action: "STOCK_COUNT_SCHEDULE", entity: "StockCountSchedule" },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const due = logs.filter((x) => {
      const payload = x.payload || {};
      if (Number(payload.branchId || 0) !== Number(branchId)) return false;
      if (!payload.isActive) return false;
      if (!payload.nextDueAt) return true;
      return new Date(payload.nextDueAt) <= new Date();
    });
    const createdSessionIds = [];
    for (const schedule of due) {
      const result = await runSingleSchedule({ branchId, userId: req.user?.id || null, schedule });
      createdSessionIds.push(result.sessionId);
    }
    res.json({
      message: "Due schedules executed",
      dueCount: due.length,
      createdSessions: createdSessionIds.length,
      createdSessionIds,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getStockCountSessions = async (req, res) => {
  try {
    const rows = await getStockCountSessions(req);
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getStockCountSessionDetails = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log || log.action !== "STOCK_COUNT_SESSION") return res.status(404).json({ error: "Session not found" });
    if (Number(log.payload?.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Session not found" });
    const productIds = (log.payload?.items || []).map((x) => x.productId).filter(Boolean);
    const products = productIds.length
      ? await prisma.product.findMany({ where: { branchId, id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p.name]));
    const warehouses = await prisma.warehouse.findMany({ where: { branchId }, select: { id: true, name: true } });
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));
    res.json(normalizeStockCountLog(log, productMap, warehouseMap));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockCountSessionItems = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log || log.action !== "STOCK_COUNT_SESSION") return res.status(404).json({ error: "Session not found" });
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Session not found" });
    if (payload.status !== "OPEN") return res.status(400).json({ error: "Only OPEN session can be edited" });
    const currentItems = Array.isArray(payload.items) ? payload.items : [];
    const byProduct = new Map(currentItems.map((item) => [Number(item.productId), item]));
    for (const incoming of itemsInput) {
      const productId = Number(incoming.productId);
      const countedQty = Number(incoming.countedQty);
      if (Number.isNaN(productId) || !Number.isFinite(countedQty)) continue;
      const found = byProduct.get(productId);
      if (!found) continue;
      found.countedQty = Math.max(0, Math.floor(countedQty));
      found.variance = Number(found.countedQty) - Number(found.expectedQty || 0);
      found.varianceReason = String(incoming.varianceReason || found.varianceReason || "").trim().slice(0, 200);
      byProduct.set(productId, found);
    }
    const items = [...byProduct.values()];
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...payload,
          items,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    res.json({ message: "Stock count items updated", itemsCount: items.length });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.recountStockCountSession = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds.map((x) => Number(x)).filter((x) => !Number.isNaN(x)) : [];
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log || log.action !== "STOCK_COUNT_SESSION") return res.status(404).json({ error: "Session not found" });
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Session not found" });
    if (payload.status !== "OPEN") return res.status(400).json({ error: "Only OPEN session can be recounted" });
    const currentItems = Array.isArray(payload.items) ? payload.items : [];
    const targetIds = productIds.length ? new Set(productIds) : new Set(currentItems.map((x) => Number(x.productId)));
    const latestProducts = await prisma.product.findMany({
      where: { branchId, id: { in: [...targetIds] } },
      select: { id: true, stock: true },
    });
    const latestMap = new Map(latestProducts.map((p) => [p.id, Number(p.stock || 0)]));
    const nextRecountRound = Number(payload.recountRound || 0) + 1;
    const nextItems = currentItems.map((item) => {
      const pid = Number(item.productId);
      if (!targetIds.has(pid)) return item;
      const expectedQty = latestMap.has(pid) ? latestMap.get(pid) : Number(item.expectedQty || 0);
      return {
        ...item,
        expectedQty,
        countedQty: expectedQty,
        variance: 0,
        varianceReason: "",
        recountRound: nextRecountRound,
      };
    });
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...payload,
          recountRound: nextRecountRound,
          items: nextItems,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    res.json({ message: "Recount round started", recountRound: nextRecountRound });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.finalizeStockCountSession = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const managerApprovalPin = String(req.body?.managerApprovalPin || "");
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log || log.action !== "STOCK_COUNT_SESSION") return res.status(404).json({ error: "Session not found" });
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Session not found" });
    if (payload.status !== "OPEN") return res.status(400).json({ error: "Session already finalized" });
    const items = Array.isArray(payload.items) ? payload.items : [];
    const maxAbsVariance = items.reduce((m, item) => Math.max(m, Math.abs(Number(item.variance || 0))), 0);
    const totalAbsVariance = items.reduce((sum, item) => sum + Math.abs(Number(item.variance || 0)), 0);
    const highVarianceRows = items.filter((item) => Math.abs(Number(item.variance || 0)) >= getStockCountVarianceThreshold());
    let approvalEventId = payload.approvalEventId || null;
    if (maxAbsVariance >= getStockCountVarianceThreshold()) {
      if (!approvalEventId) {
        const approvalEvent = await prisma.auditLog.create({
          data: {
            userId: req.user?.id || null,
            action: "APPROVAL_STOCK_COUNT",
            entity: "StockCountSession",
            entityId: id,
            payload: {
              status: "PENDING",
              reason: "High variance stock count needs manager verification",
              amount: maxAbsVariance,
              summary: {
                maxAbsVariance,
                totalAbsVariance,
                highVarianceProducts: highVarianceRows.length,
              },
            },
          },
        });
        approvalEventId = approvalEvent.id;
      }
      if (managerApprovalPin !== getManagerPin()) {
        await prisma.auditLog.update({
          where: { id: approvalEventId },
          data: {
            payload: {
              status: "PENDING",
              reason: "Manager PIN missing/invalid for high variance stock count",
              amount: maxAbsVariance,
              summary: {
                maxAbsVariance,
                totalAbsVariance,
                highVarianceProducts: highVarianceRows.length,
              },
            },
          },
        });
        await prisma.auditLog.update({
          where: { id },
          data: {
            payload: {
              ...payload,
              approvalEventId,
            },
          },
        });
        return res.status(403).json({ error: "Manager approval PIN required for high variance stock count" });
      }
      await prisma.auditLog.update({
        where: { id: approvalEventId },
        data: {
          payload: {
            status: "APPROVED",
            reason: "Manager PIN approved stock count finalization",
            amount: maxAbsVariance,
            approvedAt: new Date().toISOString(),
            summary: {
              maxAbsVariance,
              totalAbsVariance,
              highVarianceProducts: highVarianceRows.length,
            },
          },
        },
      });
    }

    const changed = items.filter((item) => Number(item.variance || 0) !== 0);
    await prisma.$transaction(async (tx) => {
      for (const item of changed) {
        const product = await tx.product.findFirst({
          where: { id: Number(item.productId), branchId },
        });
        if (!product) continue;
        const variance = Number(item.variance || 0);
        if (product.stock + variance < 0) throw new Error(`Negative stock not allowed for ${product.name}`);
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { increment: variance } },
        });
        const adjustment = await tx.stockAdjustment.create({
          data: {
            branchId,
            productId: product.id,
            qtyChange: variance,
            reason: `STOCK_COUNT_SESSION_${id}${item.varianceReason ? `:${String(item.varianceReason).slice(0, 80)}` : ""}`,
          },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            warehouseId: payload.warehouseId || null,
            productId: product.id,
            refType: "STOCK_COUNT",
            refId: adjustment.id,
            inQty: variance > 0 ? variance : 0,
            outQty: variance < 0 ? Math.abs(variance) : 0,
            unitCost: product.price,
          },
        });
      }
      await tx.auditLog.update({
        where: { id },
        data: {
          payload: {
            ...payload,
            status: "CLOSED",
            finalizedAt: new Date().toISOString(),
            approvalEventId,
            summary: {
              totalItems: items.length,
              changedItems: changed.length,
              totalVariance: items.reduce((sum, x) => sum + Number(x.variance || 0), 0),
              totalAbsVariance: items.reduce((sum, x) => sum + Math.abs(Number(x.variance || 0)), 0),
            },
          },
        },
      });
    });
    res.json({ message: "Stock count finalized", changedItems: changed.length });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportStockCountSessionsCSV = async (req, res) => {
  try {
    const rows = await getStockCountSessions(req);
    const data = rows.map((r) => ({
      session_id: r.id,
      status: r.status,
      warehouse: r.warehouseName || "",
      total_items: r.totalItems,
      total_variance: Number(r.totalVariance || 0).toFixed(2),
      total_abs_variance: Number(r.totalAbsVariance || 0).toFixed(2),
      note: r.note || "",
      created_at: new Date(r.createdAt).toISOString(),
      finalized_at: r.finalizedAt || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="stock-count-sessions.csv"');
    res.send(toCSV(data));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportStockCountSessionsPDF = async (req, res) => {
  try {
    const rows = await getStockCountSessions(req);
    const data = rows.map((r) => ({
      id: r.id,
      status: r.status,
      warehouse: r.warehouseName || "-",
      items: r.totalItems,
      variance: Number(r.totalVariance || 0).toFixed(2),
      date: new Date(r.createdAt).toLocaleString(),
    }));
    writePdfTable(
      res,
      "Stock Count Sessions",
      [
        { key: "id", label: "ID" },
        { key: "status", label: "Status" },
        { key: "warehouse", label: "Warehouse" },
        { key: "items", label: "Items" },
        { key: "variance", label: "Variance" },
        { key: "date", label: "Date" },
      ],
      data,
      "stock-count-sessions.pdf"
    );
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.exportStockCountSessionsXLSX = async (req, res) => {
  try {
    const rows = await getStockCountSessions(req);
    const data = rows.map((r) => ({
      SessionID: r.id,
      Status: r.status,
      Warehouse: r.warehouseName || "-",
      TotalItems: r.totalItems,
      TotalVariance: Number(r.totalVariance || 0).toFixed(2),
      TotalAbsVariance: Number(r.totalAbsVariance || 0).toFixed(2),
      Note: r.note || "",
      CreatedAt: new Date(r.createdAt).toISOString(),
      FinalizedAt: r.finalizedAt || "",
    }));
    sendXlsx(res, data, "stock-count-sessions.xlsx", "StockCount");
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

function normalizeBatchLog(log, productMap = new Map()) {
  const payload = log.payload || {};
  const qtyOnHand = Math.max(0, Number(payload.qtyOnHand || 0));
  const expiryDate = payload.expiryDate ? new Date(payload.expiryDate) : null;
  const now = new Date();
  const daysToExpiry =
    expiryDate != null ? Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const status = qtyOnHand <= 0 ? "DEPLETED" : daysToExpiry != null && daysToExpiry < 0 ? "EXPIRED" : "ACTIVE";
  return {
    id: log.id,
    branchId: Number(payload.branchId || 0),
    productId: Number(payload.productId || 0),
    productName: productMap.get(Number(payload.productId || 0)) || `#${payload.productId || "-"}`,
    batchCode: String(payload.batchCode || ""),
    expiryDate: payload.expiryDate || null,
    receivedAt: payload.receivedAt || log.createdAt,
    qtyOnHand,
    unitCost: Number(payload.unitCost || 0),
    note: String(payload.note || ""),
    status,
    daysToExpiry,
    createdAt: log.createdAt,
    updatedAt: payload.updatedAt || log.createdAt,
    source: "LEGACY_AUDIT",
  };
}

function normalizeBatchFromDb(b, productMap = new Map()) {
  const expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;
  const now = new Date();
  const daysToExpiry =
    expiryDate != null ? Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const qtyOnHand = Math.max(0, Number(b.qtyOnHand || 0));
  const status = qtyOnHand <= 0 ? "DEPLETED" : daysToExpiry != null && daysToExpiry < 0 ? "EXPIRED" : "ACTIVE";
  return {
    id: b.id,
    branchId: b.branchId,
    productId: b.productId,
    productName: productMap.get(b.productId) || `#${b.productId}`,
    batchCode: b.batchCode,
    expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
    receivedAt: b.createdAt.toISOString(),
    qtyOnHand,
    unitCost: Number(b.unitCost || 0),
    note: String(b.note || ""),
    status,
    daysToExpiry,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    source: "TABLE",
  };
}

async function getInventoryBatchesInternal(branchId, query = {}) {
  const productId = query.productId ? Number(query.productId) : null;
  const includeDepleted = String(query.includeDepleted || "").toLowerCase() === "true";
  const whereDb = {
    branchId,
    ...(productId ? { productId } : {}),
    ...(!includeDepleted ? { qtyOnHand: { gt: 0 } } : {}),
  };
  const dbRows = await prisma.inventoryBatch.findMany({
    where: whereDb,
    orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
    take: 2000,
  });
  const productIds = [...new Set(dbRows.map((x) => x.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { branchId, id: { in: productIds } },
        select: { id: true, name: true },
      })
    : [];
  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const fromDb = dbRows.map((row) => normalizeBatchFromDb(row, productMap));

  const legacyWhere = {
    action: "INVENTORY_BATCH",
    entity: "InventoryBatch",
  };
  const logs = await prisma.auditLog.findMany({
    where: legacyWhere,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const legacyFiltered = logs.filter((log) => {
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return false;
    if (productId && Number(payload.productId || 0) !== productId) return false;
    if (!includeDepleted && Number(payload.qtyOnHand || 0) <= 0) return false;
    return true;
  });
  const fromLegacy = legacyFiltered
    .filter((log) => {
      const p = log.payload || {};
      return !fromDb.some(
        (d) =>
          d.branchId === Number(p.branchId) &&
          d.productId === Number(p.productId) &&
          d.batchCode === String(p.batchCode || "")
      );
    })
    .map((log) => normalizeBatchLog(log, productMap));

  return [...fromDb, ...fromLegacy];
}

exports.getInventoryBatches = async (req, res) => {
  try {
    const rows = await getInventoryBatchesInternal(req.branchId, req.query || {});
    res.json(rows.sort((a, b) => {
      const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ea - eb;
    }));
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createInventoryBatch = async (req, res) => {
  try {
    const branchId = req.branchId;
    const productId = Number(req.body?.productId);
    const productVariantId = Number(req.body?.productVariantId || 0) || null;
    const batchCode = String(req.body?.batchCode || "").trim();
    const qtyOnHand = Math.max(0, Math.floor(Number(req.body?.qtyOnHand || 0)));
    const unitCost = Number(req.body?.unitCost || 0);
    const expiryDate = req.body?.expiryDate ? new Date(`${req.body.expiryDate}T00:00:00.000Z`) : null;
    const note = String(req.body?.note || "").trim();
    if (Number.isNaN(productId) || !productId) return res.status(400).json({ error: "Invalid productId" });
    if (!batchCode) return res.status(400).json({ error: "Batch code is required" });
    if (!Number.isFinite(unitCost) || unitCost < 0) return res.status(400).json({ error: "Invalid unit cost" });
    const product = await prisma.product.findFirst({
      where: { id: productId, branchId },
      select: { id: true, price: true, hasVariants: true, batchTracked: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found in branch" });
    if (product.hasVariants && !productVariantId) {
      return res.status(400).json({ error: "productVariantId required for variant products" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.create({
        data: {
          branchId,
          productId,
          productVariantId,
          batchCode,
          expiryDate,
          qtyOnHand,
          unitCost,
          note: note || null,
        },
      });
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "INVENTORY_BATCH_DB_CREATE",
        entity: "InventoryBatch",
        entityId: batch.id,
        payload: { branchId, productId, productVariantId, batchCode, qtyOnHand },
      });
      if (qtyOnHand > 0) {
        if (productVariantId) {
          await tx.productVariant.update({
            where: { id: productVariantId },
            data: { stock: { increment: qtyOnHand } },
          });
        } else {
          await tx.product.update({ where: { id: product.id }, data: { stock: { increment: qtyOnHand } } });
        }
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: product.id,
            refType: "BATCH_RECEIPT",
            refId: batch.id,
            inQty: qtyOnHand,
            outQty: 0,
            unitCost: unitCost || product.price,
          },
        });
      }
      return batch;
    });

    res.status(201).json({ id: created.id, message: "Batch created" });
  } catch (error) {
    if (error.code === "P2002") return res.status(400).json({ error: "Batch code already exists for this product" });
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.updateInventoryBatchQty = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const qtyChange = Math.floor(Number(req.body?.qtyChange || 0));
    const reason = String(req.body?.reason || "batch_adjustment").trim();
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid batch id" });
    if (!Number.isInteger(qtyChange) || qtyChange === 0) {
      return res.status(400).json({ error: "qtyChange must be non-zero integer" });
    }

    const tableRow = await prisma.inventoryBatch.findFirst({ where: { id, branchId } });
    if (tableRow) {
      const nextQty = Number(tableRow.qtyOnHand || 0) + qtyChange;
      if (nextQty < 0) return res.status(400).json({ error: "Batch quantity cannot be negative" });
      const product = await prisma.product.findFirst({
        where: { id: tableRow.productId, branchId },
        select: { id: true, price: true },
      });
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (Number(product.stock || 0) + qtyChange < 0) return res.status(400).json({ error: "Stock cannot become negative" });

      await prisma.$transaction(async (tx) => {
        await tx.inventoryBatch.update({
          where: { id: tableRow.id },
          data: { qtyOnHand: nextQty },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { increment: qtyChange } },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: product.id,
            refType: qtyChange > 0 ? "BATCH_ADJUST_IN" : "BATCH_CONSUME",
            refId: tableRow.id,
            inQty: qtyChange > 0 ? qtyChange : 0,
            outQty: qtyChange < 0 ? Math.abs(qtyChange) : 0,
            unitCost: Number(tableRow.unitCost || product.price || 0),
          },
        });
      });

      await writeAuditLog({
        userId: req.user?.id || null,
        action: "INVENTORY_BATCH_QTY_UPDATE",
        entity: "InventoryBatch",
        entityId: id,
        payload: { qtyChange, reason, source: "TABLE" },
      });
      return res.json({ message: "Batch quantity updated" });
    }

    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log || log.action !== "INVENTORY_BATCH" || log.entity !== "InventoryBatch") {
      return res.status(404).json({ error: "Batch not found" });
    }
    const payload = log.payload || {};
    if (Number(payload.branchId || 0) !== Number(branchId)) return res.status(404).json({ error: "Batch not found" });
    const nextQty = Number(payload.qtyOnHand || 0) + qtyChange;
    if (nextQty < 0) return res.status(400).json({ error: "Batch quantity cannot be negative" });
    const product = await prisma.product.findFirst({
      where: { id: Number(payload.productId || 0), branchId },
      select: { id: true, price: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (Number(product.stock || 0) + qtyChange < 0) return res.status(400).json({ error: "Stock cannot become negative" });

    await prisma.$transaction(async (tx) => {
      await tx.auditLog.update({
        where: { id },
        data: {
          payload: {
            ...payload,
            qtyOnHand: nextQty,
            note: payload.note || "",
            updatedAt: new Date().toISOString(),
          },
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: qtyChange } },
      });
      await tx.stockLedger.create({
        data: {
          branchId,
          productId: product.id,
          refType: qtyChange > 0 ? "BATCH_ADJUST_IN" : "BATCH_CONSUME",
          refId: id,
          inQty: qtyChange > 0 ? qtyChange : 0,
          outQty: qtyChange < 0 ? Math.abs(qtyChange) : 0,
          unitCost: Number(payload.unitCost || product.price || 0),
        },
      });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INVENTORY_BATCH_QTY_UPDATE",
      entity: "InventoryBatch",
      entityId: id,
      payload: { qtyChange, reason, source: "LEGACY_AUDIT" },
    });
    res.json({ message: "Batch quantity updated" });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.writeOffExpiredBatch = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const note = String(req.body?.note || "Expired batch spoilage").trim();
    const managerApprovalPin = String(req.body?.managerApprovalPin || "");
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid batch id" });

    const tableRow = await prisma.inventoryBatch.findFirst({ where: { id, branchId } });
    if (!tableRow) return res.status(404).json({ error: "Batch not found" });

    const qty = Math.floor(Number(tableRow.qtyOnHand || 0));
    if (qty <= 0) return res.status(400).json({ error: "Batch has no quantity to write off" });

    const product = await prisma.product.findFirst({
      where: { id: tableRow.productId, branchId },
      select: { id: true, name: true, price: true, stock: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (Number(product.stock || 0) < qty) {
      return res.status(400).json({ error: "Product stock is lower than batch quantity" });
    }

    await ensureOpenFiscalPeriod(branchId, new Date());

    await prisma.$transaction(async (tx) => {
      const reasonMap = await getReasonMap(tx, branchId);
      const reasonRule = reasonMap.get("EXPIRED") || null;
      const unitPrice = Number(tableRow.unitCost || product.price || 0);
      if (
        reasonRule &&
        requiresWriteOffApproval({ reasonRule, qty: -qty, unitPrice }) &&
        managerApprovalPin !== getManagerPin()
      ) {
        const error = new Error("Manager approval PIN required for high-value write-off");
        error.httpStatus = 403;
        throw error;
      }

      await tx.inventoryBatch.update({
        where: { id: tableRow.id },
        data: { qtyOnHand: 0, status: "DEPLETED" },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { decrement: qty } },
      });
      const adjustment = await tx.stockAdjustment.create({
        data: {
          branchId,
          productId: product.id,
          qtyChange: -qty,
          reason: note || reasonRule?.label || "Expired batch spoilage",
          reasonCode: reasonRule?.code || "EXPIRED",
        },
      });
      if (reasonRule) {
        const journalId = await upsertAdjustmentJournal(tx, {
          adjustmentId: adjustment.id,
          branchId,
          qty: -qty,
          unitPrice,
          productName: product.name,
          reason: reasonRule,
        });
        if (journalId) {
          await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { journalId } });
        }
      }
      await tx.stockLedger.create({
        data: {
          branchId,
          productId: product.id,
          refType: "BATCH_SPOILAGE",
          refId: tableRow.id,
          inQty: 0,
          outQty: qty,
          unitCost: unitPrice,
        },
      });
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "INVENTORY_BATCH_SPOILAGE",
      entity: "InventoryBatch",
      entityId: id,
      payload: { qty, note, batchCode: tableRow.batchCode },
    });
    res.json({ message: "Expired batch written off", qty });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(error.httpStatus || 400).json({ error: error.message });
  }
};

exports.getInventoryBatchAlerts = async (req, res) => {
  try {
    const branchId = req.branchId;
    const days = Math.max(1, Number(req.query.days || 30));
    const rows = await getInventoryBatchesInternal(branchId, { includeDepleted: false });
    const now = new Date();
    const nearRows = rows
      .filter((row) => row.expiryDate)
      .map((row) => {
        const daysToExpiry = Math.ceil((new Date(row.expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        const isExpired = daysToExpiry < 0;
        const isNear = !isExpired && daysToExpiry <= days;
        const suggestedMarkdownPct = isExpired ? 50 : daysToExpiry <= 3 ? 30 : daysToExpiry <= 7 ? 20 : 10;
        return { ...row, daysToExpiry, isExpired, isNear, suggestedMarkdownPct };
      })
      .filter((row) => row.isNear || row.isExpired)
      .sort((a, b) => Number(a.daysToExpiry || 0) - Number(b.daysToExpiry || 0));
    res.json({
      summary: {
        tracked: rows.length,
        nearExpiryCount: nearRows.filter((x) => x.isNear).length,
        expiredCount: nearRows.filter((x) => x.isExpired).length,
      },
      rows: nearRows,
      params: { days },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createExpiryMarkdownCampaign = async (req, res) => {
  try {
    const branchId = req.branchId;
    const days = Math.max(1, Number(req.body?.days || req.query?.days || 30));
    const validDays = Math.max(1, Number(req.body?.validDays || req.query?.validDays || 7));
    const maxProducts = Math.max(1, Number(req.body?.maxProducts || req.query?.maxProducts || 100));
    const now = new Date();
    const endsAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

    const rows = await getInventoryBatchesInternal(branchId, { includeDepleted: false });
    const nearRows = rows
      .filter((row) => row.expiryDate)
      .map((row) => {
        const daysToExpiry = Math.ceil((new Date(row.expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        const isExpired = daysToExpiry < 0;
        const isNear = !isExpired && daysToExpiry <= days;
        const suggestedMarkdownPct = isExpired ? 50 : daysToExpiry <= 3 ? 30 : daysToExpiry <= 7 ? 20 : 10;
        return { ...row, daysToExpiry, isExpired, isNear, suggestedMarkdownPct };
      })
      .filter((row) => row.isNear || row.isExpired)
      .sort((a, b) => Number(a.daysToExpiry || 0) - Number(b.daysToExpiry || 0));

    if (!nearRows.length) {
      return res.json({ message: "No near-expiry/expired batch found for markdown campaign", created: 0, rows: [] });
    }

    const byProduct = new Map();
    for (const row of nearRows) {
      const key = Number(row.productId || 0);
      if (!key) continue;
      const prev = byProduct.get(key);
      if (!prev || Number(row.suggestedMarkdownPct || 0) > Number(prev.suggestedMarkdownPct || 0)) {
        byProduct.set(key, row);
      }
    }
    const targets = [...byProduct.values()].slice(0, maxProducts);
    const createdRules = [];

    for (const row of targets) {
      const created = await prisma.promotionRule.create({
        data: {
          branchId,
          name: `[AUTO] Expiry markdown ${row.productName || `Product #${row.productId}`} (${row.batchCode || "-"})`,
          type: "PRODUCT_PERCENT",
          productId: Number(row.productId),
          discountValue: Math.max(1, Number(row.suggestedMarkdownPct || 0)),
          minBasketAmount: 0,
          isActive: true,
          startsAt: now,
          endsAt,
        },
      });
      createdRules.push(created);
    }

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "EXPIRY_MARKDOWN_CAMPAIGN_CREATE",
      entity: "PromotionRule",
      entityId: null,
      payload: {
        branchId,
        days,
        validDays,
        created: createdRules.length,
        ruleIds: createdRules.map((x) => x.id),
      },
    });

    res.status(201).json({
      message: `Created ${createdRules.length} markdown promotion rule(s)`,
      created: createdRules.length,
      validUntil: endsAt.toISOString(),
      rows: createdRules,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getTransferSuggestions = async (req, res) => {
  try {
    const fromBranchId = req.branchId;
    const minQty = Math.max(1, Number(req.query.minQty || 1));
    const products = await prisma.product.findMany({
      where: { branchId: fromBranchId },
      select: { id: true, name: true, sku: true, stock: true, reorderLevel: true },
      take: 2000,
      orderBy: { stock: "desc" },
    });
    const bySku = products.filter((p) => String(p.sku || "").trim()).map((p) => String(p.sku).trim());
    if (!bySku.length) return res.json({ rows: [], summary: { suggestions: 0 } });
    const targetProducts = await prisma.product.findMany({
      where: {
        sku: { in: bySku },
        branchId: { not: fromBranchId },
      },
      include: { branch: { select: { id: true, name: true, isActive: true } } },
      take: 8000,
    });
    const sourceBySku = new Map(products.map((p) => [String(p.sku || "").trim(), p]));
    const rows = targetProducts
      .filter((tp) => tp.branch?.isActive)
      .map((tp) => {
        const sku = String(tp.sku || "").trim();
        const source = sourceBySku.get(sku);
        if (!source) return null;
        const excessQty = Math.max(0, Number(source.stock || 0) - Number(source.reorderLevel || 0));
        const shortageQty = Math.max(0, Number(tp.reorderLevel || 0) - Number(tp.stock || 0));
        const suggestedQty = Math.min(excessQty, shortageQty);
        return {
          fromBranchId,
          fromProductId: source.id,
          fromProductName: source.name,
          fromSku: source.sku || "",
          fromStock: Number(source.stock || 0),
          fromReorderLevel: Number(source.reorderLevel || 0),
          toBranchId: tp.branch.id,
          toBranchName: tp.branch.name,
          toProductId: tp.id,
          toProductName: tp.name,
          toStock: Number(tp.stock || 0),
          toReorderLevel: Number(tp.reorderLevel || 0),
          excessQty,
          shortageQty,
          suggestedQty,
        };
      })
      .filter((x) => x && Number(x.suggestedQty || 0) >= minQty)
      .sort((a, b) => Number(b.suggestedQty || 0) - Number(a.suggestedQty || 0))
      .slice(0, 300);

    res.json({
      summary: {
        suggestions: rows.length,
        totalSuggestedQty: rows.reduce((sum, row) => sum + Number(row.suggestedQty || 0), 0),
      },
      rows,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getReorderSuggestions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const fmt = String(req.query.format || "json").toLowerCase();

    const products = await prisma.product.findMany({
      where: { branchId },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        stock: true,
        reorderLevel: true,
        price: true,
      },
      orderBy: { name: "asc" },
      take: 3500,
    });

    const rows = products
      .map((p) => {
        const stock = Number(p.stock || 0);
        const reorderLevel = Math.max(0, Number(p.reorderLevel || 0));
        if (reorderLevel <= 0 || stock > reorderLevel) return null;
        const shortage = Math.max(0, reorderLevel - stock);
        const targetStock = reorderLevel + reorderLevel;
        const suggestedReorderQty = Math.ceil(Math.max(targetStock - stock, reorderLevel));
        return {
          ...p,
          shortage,
          suggestedReorderQty,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.stock) - Number(b.stock));

    if (fmt === "csv") {
      const header =
        ["id", "sku", "name", "category", "stock", "reorderLevel", "shortage", "suggestedReorderQty", "price"].join(
          ","
        ) + "\n";
      const esc = (v) =>
        `"${String(v ?? "")
          .replace(/"/g, '""')
          .replace(/\n/g, " ")}"`;
      const cs = rows.map((r) =>
        [r.id, r.sku, r.name, r.category, r.stock, r.reorderLevel, r.shortage, r.suggestedReorderQty, r.price]
          .map(esc)
          .join(",")
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="reorder-suggestions-branch-${branchId}.csv"`);
      return res.send(header + cs.join("\n"));
    }

    res.json({
      summary: {
        skuCountNeedingReorder: rows.length,
      },
      rows,
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getPosExpiryWarnings = async (req, res) => {
  try {
    const branchId = req.branchId;
    const productIds = String(req.query.productIds || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => x > 0);
    const days = Math.max(1, Number(req.query.days || 7));
    if (!productIds.length) {
      return res.json({ warnings: [], params: { days } });
    }

    const batches = await prisma.inventoryBatch.findMany({
      where: {
        branchId,
        productId: { in: productIds },
        qtyOnHand: { gt: 0 },
        expiryDate: { not: null },
      },
      include: { product: { select: { id: true, name: true } } },
      orderBy: [{ expiryDate: "asc" }],
    });

    const now = Date.now();
    const nowDate = new Date();
    const byProduct = new Map();
    for (const batch of batches) {
      const daysToExpiry = Math.ceil(
        (new Date(batch.expiryDate).getTime() - now) / (24 * 60 * 60 * 1000)
      );
      if (daysToExpiry > days) continue;
      const pid = Number(batch.productId);
      const prev = byProduct.get(pid);
      if (prev && Number(prev.daysToExpiry) <= daysToExpiry) continue;
      const isExpired = daysToExpiry < 0;
      const suggestedMarkdownPct = isExpired ? 50 : daysToExpiry <= 3 ? 30 : daysToExpiry <= 7 ? 20 : 10;
      byProduct.set(pid, {
        productId: pid,
        productName: batch.product?.name || `Product #${pid}`,
        batchCode: batch.batchCode,
        expiryDate: batch.expiryDate,
        daysToExpiry,
        isExpired,
        severity: isExpired ? "expired" : daysToExpiry <= 3 ? "critical" : "warning",
        suggestedMarkdownPct,
        activeMarkdownPct: 0,
      });
    }

    if (byProduct.size) {
      const promoRows = await prisma.promotionRule.findMany({
        where: {
          branchId,
          isActive: true,
          type: "PRODUCT_PERCENT",
          productId: { in: [...byProduct.keys()] },
        },
        select: { productId: true, discountValue: true, startsAt: true, endsAt: true },
      });
      for (const promo of promoRows) {
        if (promo.startsAt && new Date(promo.startsAt) > nowDate) continue;
        if (promo.endsAt && new Date(promo.endsAt) < nowDate) continue;
        const pid = Number(promo.productId || 0);
        const row = byProduct.get(pid);
        if (!row) continue;
        row.activeMarkdownPct = Math.max(
          Number(row.activeMarkdownPct || 0),
          Number(promo.discountValue || 0)
        );
      }
    }

    res.json({ warnings: [...byProduct.values()], params: { days } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBatchTraceability = async (req, res) => {
  try {
    const branchId = req.branchId;
    const batchId = Number(req.query.batchId || 0);
    const batchCode = String(req.query.batchCode || "").trim();
    const productId = Number(req.query.productId || 0);

    let batch = null;
    if (batchId > 0) {
      batch = await prisma.inventoryBatch.findFirst({
        where: { id: batchId, branchId },
        include: { product: true, productVariant: true },
      });
    } else if (batchCode && productId > 0) {
      batch = await prisma.inventoryBatch.findFirst({
        where: { branchId, productId, batchCode },
        include: { product: true, productVariant: true },
      });
    }
    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    const saleLinks = await prisma.saleItemBatch.findMany({
      where: { batchId: batch.id },
      include: {
        saleItem: {
          include: {
            sale: {
              select: {
                id: true,
                invoiceNo: true,
                createdAt: true,
                total: true,
              },
            },
            product: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { id: "desc" },
      take: 500,
    });

    res.json({
      batch: {
        id: batch.id,
        batchCode: batch.batchCode,
        expiryDate: batch.expiryDate,
        qtyOnHand: batch.qtyOnHand,
        unitCost: batch.unitCost,
        productId: batch.productId,
        productName: batch.product?.name || null,
        variantLabel: batch.productVariant?.label || null,
        note: batch.note,
      },
      sales: saleLinks.map((link) => ({
        saleId: link.saleItem?.sale?.id,
        invoiceNo: link.saleItem?.sale?.invoiceNo,
        soldAt: link.saleItem?.sale?.createdAt,
        qty: link.qty,
        productName: link.saleItem?.product?.name,
        linePrice: link.saleItem?.price,
        lineCost: link.saleItem?.cost,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
