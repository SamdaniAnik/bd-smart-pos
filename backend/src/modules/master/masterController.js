const prisma = require("../../utils/prisma");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

function pointsFromAmount(amount) {
  const pointsPer100 = Number(process.env.LOYALTY_POINTS_PER_100 || 1);
  return Math.floor(Number(amount || 0) / 100) * pointsPer100;
}

function tierFromPoints(points) {
  const silverAt = Number(process.env.LOYALTY_SILVER_AT || 500);
  const goldAt = Number(process.env.LOYALTY_GOLD_AT || 2000);
  if (points >= goldAt) return "GOLD";
  if (points >= silverAt) return "SILVER";
  return "REGULAR";
}

function parseRedeemedPoints(notes) {
  if (!notes) return 0;
  try {
    const payload = JSON.parse(notes);
    return Number(payload?.loyalty?.redeemedPoints || 0);
  } catch {
    return 0;
  }
}

async function buildCustomerLoyaltySnapshot(branchId, customerId) {
  const sales = await prisma.sale.findMany({
    where: { branchId, customerId },
    select: { total: true, notes: true },
  });
  const totalSpent = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const earnedPoints = pointsFromAmount(totalSpent);
  const redeemedPoints = sales.reduce((sum, row) => sum + parseRedeemedPoints(row.notes), 0);
  const availablePoints = Math.max(0, earnedPoints - redeemedPoints);
  return {
    loyaltyPoints: availablePoints,
    loyaltyEarnedPoints: earnedPoints,
    loyaltyRedeemedPoints: redeemedPoints,
    loyaltyTier: tierFromPoints(earnedPoints),
    loyaltyTotalSpent: totalSpent,
    loyaltyOrders: sales.length,
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
  doc.fontSize(10).font("Helvetica-Bold");
  columns.forEach((col, idx) => doc.text(col.label, startX + idx * colW, y, { width: colW }));
  y += 18;
  doc.font("Helvetica");
  rows.forEach((row) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    columns.forEach((col, idx) => doc.text(String(row[col.key] ?? ""), startX + idx * colW, y, { width: colW }));
    y += 16;
  });
  doc.end();
}

function sendXlsx(res, rows, filename, sheetName = "Sheet1") {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

exports.createSupplier = async (req, res) => {
  try {
    const branchId = req.branchId;
    const supplier = await prisma.supplier.create({
      data: { branchId, ...req.body },
    });
    res.status(201).json(supplier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSuppliers = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSupplierDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id, branchId: req.branchId },
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    res.json(supplier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const existing = await prisma.supplier.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const { name, phone, address } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Supplier name must be at least 2 characters" });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: String(name).trim(),
        phone: phone || null,
        address: address || null,
      },
    });
    res.json(supplier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const existing = await prisma.supplier.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Supplier deleted" });
  } catch (error) {
    res.status(400).json({ error: "Supplier cannot be deleted while linked data exists" });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { name, phone, address, creditLimit } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name must be at least 2 characters" });
    }
    const customer = await prisma.customer.create({
      data: {
        branchId,
        name: String(name).trim(),
        phone: phone || null,
        address: address || null,
        creditLimit:
          creditLimit != null && creditLimit !== "" && !Number.isNaN(Number(creditLimit))
            ? Number(creditLimit)
            : 0,
      },
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    const customerIds = customers.map((c) => c.id);
    if (!customerIds.length) return res.json(customers);
    const salesAgg = await prisma.sale.groupBy({
      by: ["customerId"],
      where: { branchId: req.branchId, customerId: { in: customerIds } },
      _sum: { total: true },
      _count: { _all: true },
    });
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    res.json(
      customers.map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const earnedPoints = pointsFromAmount(stats.totalSpent);
        const loyaltyPoints = Math.max(0, earnedPoints);
        return {
          ...c,
          loyaltyPoints,
          loyaltyEarnedPoints: earnedPoints,
          loyaltyRedeemedPoints: 0,
          loyaltyTier: tierFromPoints(earnedPoints),
          loyaltyTotalSpent: stats.totalSpent,
          loyaltyOrders: stats.orders,
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id, branchId: req.branchId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const loyalty = await buildCustomerLoyaltySnapshot(req.branchId, id);
    res.json({
      ...customer,
      ...loyalty,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.lookupCustomerByPhone = async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "Phone is required" });
    const customer = await prisma.customer.findFirst({
      where: { branchId: req.branchId, phone },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const loyalty = await buildCustomerLoyaltySnapshot(req.branchId, customer.id);
    res.json({ ...customer, ...loyalty });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerLoyaltyRanking = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    const customerIds = customers.map((c) => c.id);
    if (!customerIds.length) return res.json([]);
    const salesAgg = await prisma.sale.groupBy({
      by: ["customerId"],
      where: { branchId: req.branchId, customerId: { in: customerIds } },
      _sum: { total: true },
      _count: { _all: true },
    });
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const loyaltyPoints = pointsFromAmount(stats.totalSpent);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          loyaltyPoints,
          loyaltyTier: tierFromPoints(loyaltyPoints),
          loyaltyTotalSpent: stats.totalSpent,
          loyaltyOrders: stats.orders,
        };
      })
      .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCustomerLoyaltyRankingCSV = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    const customerIds = customers.map((c) => c.id);
    if (!customerIds.length) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="loyalty-ranking.csv"');
      return res.send("");
    }
    const salesAgg = await prisma.sale.groupBy({
      by: ["customerId"],
      where: { branchId: req.branchId, customerId: { in: customerIds } },
      _sum: { total: true },
      _count: { _all: true },
    });
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const loyaltyPoints = pointsFromAmount(stats.totalSpent);
        return {
          customer_id: c.id,
          customer_name: c.name,
          phone: c.phone || "",
          tier: tierFromPoints(loyaltyPoints),
          points: loyaltyPoints,
          total_spent: stats.totalSpent.toFixed(2),
          orders: stats.orders,
        };
      })
      .sort((a, b) => b.points - a.points);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="loyalty-ranking.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCustomerLoyaltyRankingPDF = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    const customerIds = customers.map((c) => c.id);
    const salesAgg = customerIds.length
      ? await prisma.sale.groupBy({
          by: ["customerId"],
          where: { branchId: req.branchId, customerId: { in: customerIds } },
          _sum: { total: true },
          _count: { _all: true },
        })
      : [];
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const loyaltyPoints = pointsFromAmount(stats.totalSpent);
        return {
          name: c.name,
          phone: c.phone || "-",
          tier: tierFromPoints(loyaltyPoints),
          points: loyaltyPoints,
          spent: stats.totalSpent.toFixed(2),
        };
      })
      .sort((a, b) => b.points - a.points);
    writePdfTable(
      res,
      "Loyalty Ranking",
      [
        { key: "name", label: "Customer" },
        { key: "phone", label: "Phone" },
        { key: "tier", label: "Tier" },
        { key: "points", label: "Points" },
        { key: "spent", label: "Total Spent" },
      ],
      rows,
      "loyalty-ranking.pdf"
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCustomerLoyaltyRankingXLSX = async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
    });
    const customerIds = customers.map((c) => c.id);
    const salesAgg = customerIds.length
      ? await prisma.sale.groupBy({
          by: ["customerId"],
          where: { branchId: req.branchId, customerId: { in: customerIds } },
          _sum: { total: true },
          _count: { _all: true },
        })
      : [];
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const loyaltyPoints = pointsFromAmount(stats.totalSpent);
        return {
          CustomerID: c.id,
          Customer: c.name,
          Phone: c.phone || "",
          Tier: tierFromPoints(loyaltyPoints),
          AvailablePoints: loyaltyPoints,
          TotalSpent: Number(stats.totalSpent || 0).toFixed(2),
          Orders: stats.orders,
        };
      })
      .sort((a, b) => b.AvailablePoints - a.AvailablePoints);
    sendXlsx(res, rows, "loyalty-ranking.xlsx", "LoyaltyRanking");
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const existing = await prisma.customer.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const { name, phone, address, creditLimit } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name must be at least 2 characters" });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: String(name).trim(),
        phone: phone || null,
        address: address || null,
        creditLimit:
          creditLimit != null && creditLimit !== "" && !Number.isNaN(Number(creditLimit))
            ? Number(creditLimit)
            : 0,
      },
    });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
