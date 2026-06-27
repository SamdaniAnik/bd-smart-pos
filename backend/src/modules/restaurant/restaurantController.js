const prisma = require("../../utils/prisma");
const crypto = require("crypto");

const TABLE_STATUSES = new Set(["FREE", "OCCUPIED", "BILLING"]);
const KOT_STATUSES = new Set(["OPEN", "PREPARING", "READY", "SERVED", "CANCELLED"]);
const OPEN_KOT_STATUSES = ["OPEN", "PREPARING", "READY"];

function generateTicketNo() {
  return `KOT-${Date.now().toString(36).toUpperCase()}`;
}

async function openKotCountForTable(branchId, tableId, tx = prisma) {
  return tx.kitchenTicket.count({
    where: { branchId, tableId, status: { in: OPEN_KOT_STATUSES } },
  });
}

async function syncTableAfterKotChange(branchId, tableId, tx = prisma) {
  if (!tableId) return null;
  const table = await tx.restaurantTable.findFirst({ where: { id: tableId, branchId } });
  if (!table) return null;
  const openCount = await openKotCountForTable(branchId, tableId, tx);
  if (openCount > 0 && table.status === "FREE") {
    return tx.restaurantTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
  }
  if (openCount === 0 && table.status === "OCCUPIED") {
    return tx.restaurantTable.update({ where: { id: tableId }, data: { status: "BILLING" } });
  }
  return table;
}

async function attachTableKotMeta(branchId, tables) {
  if (!tables.length) return tables;
  const ids = tables.map((t) => t.id);
  const openKots = await prisma.kitchenTicket.findMany({
    where: { branchId, tableId: { in: ids }, status: { in: OPEN_KOT_STATUSES } },
    select: { id: true, tableId: true, ticketNo: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const countByTable = new Map();
  const ticketsByTable = new Map();
  for (const kot of openKots) {
    countByTable.set(kot.tableId, (countByTable.get(kot.tableId) || 0) + 1);
    if (!ticketsByTable.has(kot.tableId)) ticketsByTable.set(kot.tableId, []);
    ticketsByTable.get(kot.tableId).push({ id: kot.id, ticketNo: kot.ticketNo, status: kot.status });
  }
  return tables.map((table) => ({
    ...table,
    openKotCount: countByTable.get(table.id) || 0,
    openKots: ticketsByTable.get(table.id) || [],
  }));
}

exports.listTables = async (req, res) => {
  try {
    const rows = await prisma.restaurantTable.findMany({
      where: { branchId: req.branchId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    res.json(await attachTableKotMeta(req.branchId, rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createTable = async (req, res) => {
  try {
    const branchId = req.branchId;
    const code = String(req.body?.code || "").trim();
    const name = String(req.body?.name || code).trim();
    if (!code) return res.status(400).json({ error: "Table code is required" });
    const row = await prisma.restaurantTable.create({
      data: {
        branchId,
        code,
        name,
        capacity: Math.max(1, Number(req.body?.capacity || 4)),
        sortOrder: Number(req.body?.sortOrder || 0),
      },
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateTable = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Table not found" });
    const status = req.body?.status != null ? String(req.body.status).toUpperCase() : existing.status;
    if (!TABLE_STATUSES.has(status)) return res.status(400).json({ error: "Invalid table status" });
    const row = await prisma.restaurantTable.update({
      where: { id },
      data: {
        name: req.body?.name != null ? String(req.body.name).trim() : existing.name,
        capacity: req.body?.capacity != null ? Math.max(1, Number(req.body.capacity)) : existing.capacity,
        status,
        sortOrder: req.body?.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
      },
    });
    const [enriched] = await attachTableKotMeta(branchId, [row]);
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function transitionTable(branchId, id, nextStatus, { allowFrom = null } = {}) {
  const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
  if (!existing) return { error: "Table not found", status: 404 };
  if (!TABLE_STATUSES.has(nextStatus)) return { error: "Invalid table status", status: 400 };
  if (allowFrom && !allowFrom.includes(existing.status)) {
    return {
      error: `Table is ${existing.status}; cannot set to ${nextStatus}`,
      status: 409,
    };
  }
  const row = await prisma.restaurantTable.update({
    where: { id },
    data: { status: nextStatus },
  });
  const [enriched] = await attachTableKotMeta(branchId, [row]);
  return { row: enriched };
}

exports.seatTable = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const result = await transitionTable(branchId, id, "OCCUPIED", { allowFrom: ["FREE"] });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.requestTableBill = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Table not found" });
    const result = await transitionTable(branchId, id, "BILLING", {
      allowFrom: ["OCCUPIED", "FREE"],
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.clearTable = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Table not found" });
    const openCount = await openKotCountForTable(branchId, id);
    if (openCount > 0 && !req.body?.force) {
      return res.status(409).json({
        error: "Table has open kitchen tickets. Serve or cancel them first, or pass force=true.",
        openKotCount: openCount,
      });
    }
    const result = await transitionTable(branchId, id, "FREE");
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTablePosCart = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const table = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
    if (!table) return res.status(404).json({ error: "Table not found" });

    const kots = await prisma.kitchenTicket.findMany({
      where: { branchId, tableId: id, status: { in: OPEN_KOT_STATUSES }, saleId: null },
      orderBy: { createdAt: "asc" },
    });
    if (!kots.length) {
      return res.json({ tableId: id, tableName: table.name || table.code, kotIds: [], cart: [] });
    }

    // Merge quantities per product across all open KOTs for this table.
    const qtyByProduct = new Map();
    const notesByProduct = new Map();
    for (const kot of kots) {
      let items = [];
      try {
        items = JSON.parse(kot.itemsJson || "[]");
      } catch {
        items = [];
      }
      for (const item of items) {
        const pid = Number(item.productId);
        if (!pid) continue;
        qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + Number(item.qty || 1));
        if (item.notes) {
          const prev = notesByProduct.get(pid);
          notesByProduct.set(pid, prev ? `${prev}; ${item.notes}` : String(item.notes));
        }
      }
    }

    const productIds = [...qtyByProduct.keys()];
    const products = await prisma.product.findMany({
      where: { branchId, id: { in: productIds } },
      select: {
        id: true,
        name: true,
        price: true,
        vatRate: true,
        stock: true,
        sellByWeight: true,
        hasVariants: true,
        batchTracked: true,
        category: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const cart = [];
    const missing = [];
    for (const [pid, qty] of qtyByProduct) {
      const prod = productMap.get(pid);
      if (!prod) {
        missing.push(pid);
        continue;
      }
      cart.push({
        id: prod.id,
        name: prod.name,
        qty,
        price: Number(prod.price || 0),
        vatRate: Number(prod.vatRate || 0),
        sellByWeight: Boolean(prod.sellByWeight),
        hasVariants: Boolean(prod.hasVariants),
        batchTracked: Boolean(prod.batchTracked),
        category: prod.category || "",
        notes: notesByProduct.get(pid) || "",
      });
    }

    res.json({
      tableId: id,
      tableName: table.name || table.code,
      tableStatus: table.status,
      kotIds: kots.map((k) => k.id),
      kotNos: kots.map((k) => k.ticketNo),
      cart,
      missingProductIds: missing,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.billCollected = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Table not found" });
    const result = await transitionTable(branchId, id, "FREE", {
      allowFrom: ["BILLING", "OCCUPIED", "FREE"],
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ ...result.row, message: "Bill collected — table is free" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.seedDefaultTables = async (req, res) => {
  try {
    const branchId = req.branchId;
    const count = Math.min(20, Math.max(1, Number(req.body?.count || 8)));
    const existing = await prisma.restaurantTable.count({ where: { branchId } });
    if (existing > 0) return res.status(409).json({ error: "Tables already exist for this branch" });
    const rows = [];
    for (let i = 1; i <= count; i += 1) {
      rows.push(
        await prisma.restaurantTable.create({
          data: {
            branchId,
            code: `T${i}`,
            name: `Table ${i}`,
            capacity: 4,
            sortOrder: i,
          },
        })
      );
    }
    res.status(201).json({ message: "Default tables created", tables: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createKitchenTicket = async (req, res) => {
  try {
    const branchId = req.branchId;
    const tableId = req.body?.tableId != null ? Number(req.body.tableId) : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "At least one KOT item is required" });

    if (tableId) {
      const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, branchId } });
      if (!table) return res.status(404).json({ error: "Table not found" });
      await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
    }

    const ticket = await prisma.kitchenTicket.create({
      data: {
        branchId,
        tableId,
        ticketNo: generateTicketNo(),
        status: "OPEN",
        itemsJson: JSON.stringify(items),
        notes: req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null,
      },
      include: { table: true },
    });
    if (tableId) await syncTableAfterKotChange(branchId, tableId);
    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listKitchenTickets = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const rows = await prisma.kitchenTicket.findMany({
      where: {
        branchId,
        ...(status && KOT_STATUSES.has(status) ? { status } : {}),
        ...(status ? {} : { status: { in: ["OPEN", "PREPARING", "READY"] } }),
      },
      include: { table: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    res.json(
      rows.map((r) => ({
        ...r,
        items: JSON.parse(r.itemsJson || "[]"),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateKitchenTicketStatus = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const status = String(req.body?.status || "").toUpperCase();
    if (!KOT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid KOT status" });
    const existing = await prisma.kitchenTicket.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Kitchen ticket not found" });
    const ticket = await prisma.kitchenTicket.update({
      where: { id },
      data: { status },
      include: { table: true },
    });
    if (ticket.tableId) {
      if (status === "SERVED") {
        await syncTableAfterKotChange(branchId, ticket.tableId);
      } else if (status === "CANCELLED") {
        const openCount = await openKotCountForTable(branchId, ticket.tableId);
        if (openCount === 0) {
          const table = await prisma.restaurantTable.findFirst({
            where: { id: ticket.tableId, branchId },
          });
          if (table?.status === "OCCUPIED") {
            await prisma.restaurantTable.update({
              where: { id: ticket.tableId },
              data: { status: "FREE" },
            });
          }
        }
      }
    }
    res.json({ ...ticket, items: JSON.parse(ticket.itemsJson || "[]") });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.buildKotPrintLines = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const ticket = await prisma.kitchenTicket.findFirst({
      where: { id, branchId },
      include: { table: true },
    });
    if (!ticket) return res.status(404).json({ error: "Kitchen ticket not found" });
    const items = JSON.parse(ticket.itemsJson || "[]");
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    const lines = [
      String(branch?.name || "Kitchen").toUpperCase(),
      "--------------------------------",
      `KOT: ${ticket.ticketNo}`,
      ticket.table ? `Table: ${ticket.table.name || ticket.table.code}` : "Takeaway",
      `Time: ${new Date(ticket.createdAt).toLocaleString()}`,
      "--------------------------------",
    ];
    for (const item of items) {
      lines.push(`${item.qty || 1}x ${item.name || item.productName || "Item"}`);
      if (item.notes) lines.push(`  * ${item.notes}`);
    }
    if (ticket.notes) lines.push(`Note: ${ticket.notes}`);
    lines.push("--------------------------------");
    res.json({ lines, ticketNo: ticket.ticketNo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseRestaurantFromNotes(notes) {
  if (!notes) return null;
  try {
    const payload = JSON.parse(notes);
    const r = payload?.restaurant;
    if (!r || typeof r !== "object") return null;
    return {
      serviceMode: r.serviceMode ? String(r.serviceMode) : null,
      tableId: r.tableId != null ? Number(r.tableId) : null,
      tableName: r.tableName ? String(r.tableName) : null,
    };
  } catch {
    return null;
  }
}

exports.getRestaurantSummary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query.from ? startOfDay(new Date(req.query.from)) : startOfDay();
    const to = req.query.to ? endOfDay(new Date(req.query.to)) : endOfDay();

    const [tables, kots, sales] = await Promise.all([
      prisma.restaurantTable.findMany({
        where: { branchId },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      }),
      prisma.kitchenTicket.findMany({
        where: { branchId, createdAt: { gte: from, lte: to } },
        include: { table: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.sale.findMany({
        where: {
          branchId,
          createdAt: { gte: from, lte: to },
          OR: [{ orderSource: "RESTAURANT" }, { orderSource: "RESTAURANT_TA" }],
        },
        select: {
          id: true,
          invoiceNo: true,
          total: true,
          paidAmount: true,
          dueAmount: true,
          paymentMethod: true,
          fulfillmentType: true,
          orderSource: true,
          notes: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const kotByStatus = { OPEN: 0, PREPARING: 0, READY: 0, SERVED: 0, CANCELLED: 0 };
    for (const kot of kots) {
      const st = String(kot.status || "OPEN").toUpperCase();
      if (kotByStatus[st] != null) kotByStatus[st] += 1;
    }

    const tableByStatus = { FREE: 0, OCCUPIED: 0, BILLING: 0 };
    for (const table of tables) {
      const st = String(table.status || "FREE").toUpperCase();
      if (tableByStatus[st] != null) tableByStatus[st] += 1;
    }

    let grossTotal = 0;
    let paidTotal = 0;
    let dueTotal = 0;
    let billCount = 0;
    let dineInBills = 0;
    let takeawayBills = 0;
    const byTableMap = new Map();
    const byPayment = {};

    const recentBills = sales.map((sale) => {
      const rest = parseRestaurantFromNotes(sale.notes);
      const total = Number(sale.total || 0);
      const paid = Number(sale.paidAmount || 0);
      const due = Number(sale.dueAmount || 0);
      grossTotal += total;
      paidTotal += paid;
      dueTotal += due;
      billCount += 1;
      const mode =
        rest?.serviceMode ||
        (String(sale.fulfillmentType || "").toUpperCase() === "DINE_IN" ? "DINE_IN" : "TAKEAWAY");
      if (mode === "DINE_IN") dineInBills += 1;
      else takeawayBills += 1;

      const payKey = String(sale.paymentMethod || "Other");
      byPayment[payKey] = (byPayment[payKey] || 0) + paid;

      const tableKey = rest?.tableId || rest?.tableName || (mode === "DINE_IN" ? "unknown" : "takeaway");
      const tableLabel =
        rest?.tableName ||
        (rest?.tableId ? `Table #${rest.tableId}` : mode === "DINE_IN" ? "Dine-in" : "Takeaway");
      if (!byTableMap.has(tableKey)) {
        byTableMap.set(tableKey, {
          tableId: rest?.tableId || null,
          tableName: tableLabel,
          bills: 0,
          gross: 0,
          paid: 0,
          due: 0,
        });
      }
      const row = byTableMap.get(tableKey);
      row.bills += 1;
      row.gross += total;
      row.paid += paid;
      row.due += due;

      return {
        id: sale.id,
        invoiceNo: sale.invoiceNo,
        total,
        paidAmount: paid,
        dueAmount: due,
        paymentMethod: sale.paymentMethod,
        serviceMode: mode,
        tableName: rest?.tableName || (mode === "DINE_IN" ? "—" : null),
        createdAt: sale.createdAt,
      };
    });

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      tables: {
        total: tables.length,
        ...tableByStatus,
      },
      kot: {
        total: kots.length,
        ...kotByStatus,
      },
      billing: {
        billCount,
        dineInBills,
        takeawayBills,
        grossTotal: Math.round(grossTotal * 100) / 100,
        paidTotal: Math.round(paidTotal * 100) / 100,
        dueTotal: Math.round(dueTotal * 100) / 100,
        byPayment: Object.entries(byPayment).map(([method, amount]) => ({
          method,
          amount: Math.round(amount * 100) / 100,
        })),
        byTable: [...byTableMap.values()].sort((a, b) => b.gross - a.gross),
        recentBills,
      },
      openKots: kots
        .filter((k) => ["OPEN", "PREPARING", "READY"].includes(String(k.status || "").toUpperCase()))
        .slice(0, 20)
        .map((k) => ({
          id: k.id,
          ticketNo: k.ticketNo,
          status: k.status,
          tableName: k.table?.name || k.table?.code || null,
          items: JSON.parse(k.itemsJson || "[]"),
          createdAt: k.createdAt,
        })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStorefrontToken = async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.branchId },
      select: { storefrontToken: true },
    });
    res.json({ storefrontToken: branch?.storefrontToken || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.generateStorefrontToken = async (req, res) => {
  try {
    const branchId = req.branchId;
    const token = crypto.randomBytes(24).toString("hex");
    await prisma.branch.update({ where: { id: branchId }, data: { storefrontToken: token } });
    res.json({ storefrontToken: token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
