const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
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

function getNextDueAt(fromDate, frequency) {
  const date = new Date(fromDate);
  const f = String(frequency || "daily").toLowerCase();
  if (f === "weekly") date.setDate(date.getDate() + 7);
  else if (f === "monthly") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + 1);
  return date;
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
    const items = await prisma.stockLedger.findMany({
      where: { branchId },
      include: { product: true, warehouse: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.adjustStock = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { productId, qtyChange, reason, warehouseId } = req.body;
    const qty = Number(qtyChange);
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

    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { stock: { increment: qty } } });
      const adjustment = await tx.stockAdjustment.create({
        data: { branchId, productId: product.id, qtyChange: qty, reason: reason || "manual_adjustment" },
      });
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
      payload: { qtyChange: qty, reason: reason || "manual_adjustment" },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    res.json(
      items.map((x) => ({
        ...x,
        productName: productMap.get(x.productId) || `#${x.productId}`,
        warehouseId: ledgerMap.get(x.id)?.warehouseId || null,
        warehouseName: ledgerMap.get(x.id)?.warehouse?.name || "-",
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockAdjustment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const adjustmentId = Number(req.params.id);
    const nextQty = Number(req.body.qtyChange);
    const nextReason = String(req.body.reason || "manual_adjustment");
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
    await prisma.$transaction(async (tx) => {
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

      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: delta } },
      });
      await tx.stockAdjustment.update({
        where: { id: adjustmentId },
        data: { qtyChange: nextQty, reason: nextReason },
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
    res.status(400).json({ error: error.message });
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
      await tx.stockAdjustment.delete({ where: { id: adjustmentId } });
    });

    res.json({ message: "Stock adjustment deleted" });
  } catch (error) {
    res.status(400).json({ error: error.message });
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
        data: { fromBranchId, toBranchId: Number(toBranchId), status: "completed" },
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
        await tx.product.update({ where: { id: fromProduct.id }, data: { stock: { decrement: qty } } });
        await tx.product.update({ where: { id: toProduct.id }, data: { stock: { increment: qty } } });
        await tx.stockLedger.createMany({
          data: [
            {
              branchId: fromBranchId,
              productId: fromProduct.id,
              refType: "STOCK_TRANSFER_OUT",
              refId: created.id,
              outQty: qty,
              unitCost: fromProduct.price,
            },
            {
              branchId: Number(toBranchId),
              productId: toProduct.id,
              refType: "STOCK_TRANSFER_IN",
              refId: created.id,
              inQty: qty,
              unitCost: toProduct.price,
            },
          ],
        });
      }
      return created;
    });

    res.status(201).json(transfer);
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "STOCK_TRANSFER",
      entity: "StockTransfer",
      entityId: transfer.id,
      payload: { fromBranchId, toBranchId: Number(toBranchId) },
    });
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
};

exports.getLowStockAlerts = async (req, res) => {
  try {
    const branchId = req.branchId;
    const q = String(req.query.q || "").trim();
    const onlyCritical = String(req.query.onlyCritical || "").toLowerCase() === "true";
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
      .map((p) => {
        const stock = Number(p.stock || 0);
        const reorderLevel = Number(p.reorderLevel || 0);
        const shortageQty = Math.max(0, reorderLevel - stock);
        const status = stock <= 0 ? "OUT" : stock <= reorderLevel ? "LOW" : "OK";
        return {
          ...p,
          status,
          shortageQty,
          severityScore: reorderLevel > 0 ? shortageQty / reorderLevel : 0,
        };
      })
      .filter((p) => (onlyCritical ? p.status !== "OK" : true))
      .sort((a, b) => {
        if (a.status !== b.status) {
          const priority = { OUT: 0, LOW: 1, OK: 2 };
          return priority[a.status] - priority[b.status];
        }
        if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
        return a.name.localeCompare(b.name);
      });

    res.json({
      rows,
      summary: {
        totalTracked: rows.length,
        outOfStock: rows.filter((x) => x.status === "OUT").length,
        lowStock: rows.filter((x) => x.status === "LOW").length,
      },
    });
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
};

exports.getStockCountSessions = async (req, res) => {
  try {
    const rows = await getStockCountSessions(req);
    res.json(rows);
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
};
