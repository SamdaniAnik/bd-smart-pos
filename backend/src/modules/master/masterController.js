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

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getRetentionThresholdDays() {
  return Math.max(7, Number(process.env.LOYALTY_AT_RISK_DAYS || 45));
}

function toYmd(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function calcDaysDiffFromToday(pastDate) {
  if (!pastDate) return null;
  const d = new Date(pastDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  return Math.floor((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));
}

function calcDaysUntilBirthday(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = startOfDay(new Date());
  const thisYearBirthday = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  const nextBirthday = thisYearBirthday >= today ? thisYearBirthday : new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.floor((nextBirthday.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
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

    const {
      name,
      phone,
      address,
      tinNumber,
      binNumber,
      taxCategory,
      withholdingExempt,
      withholdingNote,
    } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Supplier name must be at least 2 characters" });
    }

    const data = {
      name: String(name).trim(),
      phone: phone || null,
      address: address || null,
    };
    // Only set the BD-tax fields when present in the body so existing PUT
    // callers (without tax fields) don't accidentally null them out.
    if ("tinNumber" in req.body) data.tinNumber = tinNumber || null;
    if ("binNumber" in req.body) data.binNumber = binNumber || null;
    if ("taxCategory" in req.body) data.taxCategory = taxCategory || null;
    if ("withholdingExempt" in req.body) data.withholdingExempt = Boolean(withholdingExempt);
    if ("withholdingNote" in req.body) data.withholdingNote = withholdingNote || null;

    const supplier = await prisma.supplier.update({ where: { id }, data });
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
    const { name, phone, address, creditLimit, birthDate, marketingOptIn } = req.body;
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
        birthDate: birthDate ? new Date(birthDate) : null,
        marketingOptIn: marketingOptIn == null ? true : Boolean(marketingOptIn),
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
      _max: { createdAt: true },
    });
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [
          x.customerId,
          {
            totalSpent: Number(x._sum.total || 0),
            orders: Number(x._count._all || 0),
            lastPurchaseAt: x._max.createdAt || null,
          },
        ])
    );
    res.json(
      customers.map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
        const earnedPoints = pointsFromAmount(stats.totalSpent);
        const loyaltyPoints = Math.max(0, earnedPoints);
        const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
        const atRiskDays = getRetentionThresholdDays();
        const daysUntilBirthday = calcDaysUntilBirthday(c.birthDate);
        return {
          ...c,
          loyaltyPoints,
          loyaltyEarnedPoints: earnedPoints,
          loyaltyRedeemedPoints: 0,
          loyaltyTier: tierFromPoints(earnedPoints),
          loyaltyTotalSpent: stats.totalSpent,
          loyaltyOrders: stats.orders,
          lastPurchaseAt: stats.lastPurchaseAt,
          daysSinceLastPurchase,
          isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= atRiskDays : false,
          daysUntilBirthday,
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
    const salesAgg = await prisma.sale.aggregate({
      where: { branchId: req.branchId, customerId: id },
      _max: { createdAt: true },
    });
    const lastPurchaseAt = salesAgg?._max?.createdAt || null;
    const daysSinceLastPurchase = calcDaysDiffFromToday(lastPurchaseAt);
    const daysUntilBirthday = calcDaysUntilBirthday(customer.birthDate);
    res.json({
      ...customer,
      ...loyalty,
      lastPurchaseAt,
      daysSinceLastPurchase,
      isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= getRetentionThresholdDays() : false,
      daysUntilBirthday,
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
    const salesAgg = await prisma.sale.aggregate({
      where: { branchId: req.branchId, customerId: customer.id },
      _max: { createdAt: true },
    });
    const lastPurchaseAt = salesAgg?._max?.createdAt || null;
    const daysSinceLastPurchase = calcDaysDiffFromToday(lastPurchaseAt);
    const daysUntilBirthday = calcDaysUntilBirthday(customer.birthDate);
    res.json({
      ...customer,
      ...loyalty,
      lastPurchaseAt,
      daysSinceLastPurchase,
      isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= getRetentionThresholdDays() : false,
      daysUntilBirthday,
    });
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
      _max: { createdAt: true },
    });
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [
          x.customerId,
          {
            totalSpent: Number(x._sum.total || 0),
            orders: Number(x._count._all || 0),
            lastPurchaseAt: x._max.createdAt || null,
          },
        ])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
        const loyaltyPoints = pointsFromAmount(stats.totalSpent);
        const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          loyaltyPoints,
          loyaltyTier: tierFromPoints(loyaltyPoints),
          loyaltyTotalSpent: stats.totalSpent,
          loyaltyOrders: stats.orders,
          lastPurchaseAt: stats.lastPurchaseAt,
          daysSinceLastPurchase,
          daysUntilBirthday: calcDaysUntilBirthday(c.birthDate),
          marketingOptIn: Boolean(c.marketingOptIn),
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

    const { name, phone, address, creditLimit, birthDate, marketingOptIn } = req.body;
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
        birthDate: birthDate ? new Date(birthDate) : null,
        marketingOptIn: marketingOptIn == null ? true : Boolean(marketingOptIn),
      },
    });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerRetentionSummary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const atRiskDays = getRetentionThresholdDays();
    const birthdayWindowDays = Math.max(1, Number(req.query.birthdayWindowDays || 7));
    const customers = await prisma.customer.findMany({
      where: { branchId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const customerIds = customers.map((c) => c.id);
    const salesAgg = customerIds.length
      ? await prisma.sale.groupBy({
          by: ["customerId"],
          where: { branchId, customerId: { in: customerIds } },
          _sum: { total: true },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : [];
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [
          x.customerId,
          {
            totalSpent: Number(x._sum.total || 0),
            orders: Number(x._count._all || 0),
            lastPurchaseAt: x._max.createdAt || null,
          },
        ])
    );
    const rows = customers.map((c) => {
      const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
      const points = pointsFromAmount(stats.totalSpent);
      const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
      const daysUntilBirthday = calcDaysUntilBirthday(c.birthDate);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        marketingOptIn: Boolean(c.marketingOptIn),
        loyaltyPoints: Math.max(0, points),
        loyaltyTier: tierFromPoints(points),
        totalSpent: stats.totalSpent,
        orders: stats.orders,
        lastPurchaseAt: stats.lastPurchaseAt,
        daysSinceLastPurchase,
        daysUntilBirthday,
        isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= atRiskDays : false,
      };
    });
    const upcomingBirthdays = rows
      .filter((x) => x.daysUntilBirthday != null && x.daysUntilBirthday >= 0 && x.daysUntilBirthday <= birthdayWindowDays)
      .sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday)
      .slice(0, 50);
    const atRiskCustomers = rows
      .filter((x) => x.isAtRisk)
      .sort((a, b) => Number(b.daysSinceLastPurchase || 0) - Number(a.daysSinceLastPurchase || 0))
      .slice(0, 100);
    res.json({
      summary: {
        totalCustomers: rows.length,
        atRiskDays,
        birthdayWindowDays,
        atRiskCount: atRiskCustomers.length,
        upcomingBirthdayCount: upcomingBirthdays.length,
        marketingOptInCount: rows.filter((x) => x.marketingOptIn).length,
      },
      atRiskCustomers,
      upcomingBirthdays,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportCustomerRetentionCampaignCSV = async (req, res) => {
  try {
    const branchId = req.branchId;
    const atRiskDays = getRetentionThresholdDays();
    const birthdayWindowDays = Math.max(1, Number(req.query.birthdayWindowDays || 7));
    const segment = String(req.query.segment || "atRisk");
    const customers = await prisma.customer.findMany({
      where: { branchId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const customerIds = customers.map((c) => c.id);
    const salesAgg = customerIds.length
      ? await prisma.sale.groupBy({
          by: ["customerId"],
          where: { branchId, customerId: { in: customerIds } },
          _sum: { total: true },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : [];
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [
          x.customerId,
          {
            totalSpent: Number(x._sum.total || 0),
            orders: Number(x._count._all || 0),
            lastPurchaseAt: x._max.createdAt || null,
          },
        ])
    );
    const rows = customers.map((c) => {
      const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
      const points = pointsFromAmount(stats.totalSpent);
      const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
      const daysUntilBirthday = calcDaysUntilBirthday(c.birthDate);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        marketingOptIn: Boolean(c.marketingOptIn),
        loyaltyTier: tierFromPoints(points),
        loyaltyPoints: Math.max(0, points),
        totalSpent: Number(stats.totalSpent || 0),
        orders: Number(stats.orders || 0),
        lastPurchaseAt: stats.lastPurchaseAt,
        daysSinceLastPurchase,
        daysUntilBirthday,
        isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= atRiskDays : false,
      };
    });

    const campaignRows = (segment === "birthday"
      ? rows.filter(
          (x) =>
            x.marketingOptIn &&
            x.daysUntilBirthday != null &&
            x.daysUntilBirthday >= 0 &&
            x.daysUntilBirthday <= birthdayWindowDays
        )
      : rows.filter((x) => x.marketingOptIn && x.isAtRisk)
    ).map((x) => ({
      customer_id: x.id,
      customer_name: x.name,
      phone: x.phone || "",
      campaign_type: segment === "birthday" ? "BIRTHDAY_OFFER" : "AT_RISK_WINBACK",
      loyalty_tier: x.loyaltyTier,
      loyalty_points: x.loyaltyPoints,
      total_spent: x.totalSpent.toFixed(2),
      orders: x.orders,
      last_purchase_at: x.lastPurchaseAt ? new Date(x.lastPurchaseAt).toISOString() : "",
      days_since_last_purchase: x.daysSinceLastPurchase ?? "",
      days_until_birthday: x.daysUntilBirthday ?? "",
      suggested_offer:
        segment === "birthday" ? "Birthday voucher + points booster" : "Comeback discount + extra points",
    }));
    const filename =
      segment === "birthday" ? "retention-birthday-campaign.csv" : "retention-at-risk-campaign.csv";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(toCSV(campaignRows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function buildRetentionRows(branchId, { atRiskDaysOverride = null } = {}) {
  const atRiskDays = atRiskDaysOverride != null ? Math.max(7, Number(atRiskDaysOverride || 0)) : getRetentionThresholdDays();
  const customers = await prisma.customer.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const customerIds = customers.map((c) => c.id);
  const salesAgg = customerIds.length
    ? await prisma.sale.groupBy({
        by: ["customerId"],
        where: { branchId, customerId: { in: customerIds } },
        _sum: { total: true },
        _count: { _all: true },
        _max: { createdAt: true },
      })
    : [];
  const byCustomer = new Map(
    salesAgg
      .filter((x) => x.customerId != null)
      .map((x) => [
        x.customerId,
        {
          totalSpent: Number(x._sum.total || 0),
          orders: Number(x._count._all || 0),
          lastPurchaseAt: x._max.createdAt || null,
        },
      ])
  );
  const rows = customers.map((c) => {
    const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
    const points = pointsFromAmount(stats.totalSpent);
    const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
    const daysUntilBirthday = calcDaysUntilBirthday(c.birthDate);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      marketingOptIn: Boolean(c.marketingOptIn),
      loyaltyTier: tierFromPoints(points),
      loyaltyPoints: Math.max(0, points),
      totalSpent: Number(stats.totalSpent || 0),
      orders: Number(stats.orders || 0),
      lastPurchaseAt: stats.lastPurchaseAt,
      daysSinceLastPurchase,
      daysUntilBirthday,
      isAtRisk: daysSinceLastPurchase != null ? daysSinceLastPurchase >= atRiskDays : false,
    };
  });
  return { atRiskDays, rows };
}

exports.runCustomerRetentionAutomation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const segment = String(req.body?.segment || "atRisk");
    const birthdayWindowDays = Math.max(1, Number(req.body?.birthdayWindowDays || 7));
    const maxCustomers = Math.max(1, Number(req.body?.maxCustomers || 100));
    const channel = String(req.body?.channel || "SMS").toUpperCase();
    const dryRun = Boolean(req.body?.dryRun);
    const { atRiskDays, rows } = await buildRetentionRows(branchId, {
      atRiskDaysOverride: req.body?.atRiskDays,
    });
    const filtered = (segment === "birthday"
      ? rows.filter(
          (x) =>
            x.marketingOptIn &&
            x.daysUntilBirthday != null &&
            x.daysUntilBirthday >= 0 &&
            x.daysUntilBirthday <= birthdayWindowDays
        )
      : segment === "all"
        ? rows.filter(
            (x) =>
              x.marketingOptIn &&
              (x.isAtRisk ||
                (x.daysUntilBirthday != null && x.daysUntilBirthday >= 0 && x.daysUntilBirthday <= birthdayWindowDays))
          )
        : rows.filter((x) => x.marketingOptIn && x.isAtRisk)
    )
      .map((x) => {
        const isBirthday = x.daysUntilBirthday != null && x.daysUntilBirthday >= 0 && x.daysUntilBirthday <= birthdayWindowDays;
        const campaignType = isBirthday && !x.isAtRisk ? "BIRTHDAY_OFFER" : x.isAtRisk ? "AT_RISK_WINBACK" : "GENERIC_RETENTION";
        const urgencyScore = Number(
          (
            (x.isAtRisk ? Math.min(70, Number(x.daysSinceLastPurchase || 0) * 1.1) : 10) +
            (isBirthday ? 20 : 0) +
            (x.loyaltyTier === "GOLD" ? 10 : x.loyaltyTier === "SILVER" ? 6 : 2)
          ).toFixed(2)
        );
        return {
          customerId: x.id,
          customerName: x.name,
          phone: x.phone,
          campaignType,
          channel,
          loyaltyTier: x.loyaltyTier,
          loyaltyPoints: x.loyaltyPoints,
          daysSinceLastPurchase: x.daysSinceLastPurchase,
          daysUntilBirthday: x.daysUntilBirthday,
          urgencyScore,
          suggestedOffer:
            campaignType === "BIRTHDAY_OFFER"
              ? "Birthday voucher + points booster"
              : x.loyaltyTier === "GOLD"
                ? "VIP comeback offer + priority support"
                : "Comeback discount + bonus points",
          status: "PENDING",
        };
      })
      .sort((a, b) => Number(b.urgencyScore || 0) - Number(a.urgencyScore || 0))
      .slice(0, maxCustomers);

    const payload = {
      branchId,
      segment,
      channel,
      atRiskDays,
      birthdayWindowDays,
      maxCustomers,
      generatedAt: new Date().toISOString(),
      generatedByUserId: req.user?.id || null,
      queue: filtered,
      summary: {
        totalQueued: filtered.length,
        atRiskCount: filtered.filter((x) => x.campaignType === "AT_RISK_WINBACK").length,
        birthdayCount: filtered.filter((x) => x.campaignType === "BIRTHDAY_OFFER").length,
      },
    };

    let automationId = null;
    if (!dryRun) {
      const log = await prisma.auditLog.create({
        data: {
          userId: req.user?.id || null,
          action: "CUSTOMER_RETENTION_AUTOMATION",
          entity: "RetentionCampaign",
          entityId: null,
          payload,
        },
      });
      automationId = log.id;
    }
    res.status(201).json({
      message: dryRun ? "Retention automation preview generated" : "Retention automation queue generated",
      dryRun,
      automationId,
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerRetentionAutomationHistory = async (req, res) => {
  try {
    const branchId = req.branchId;
    const logs = await prisma.auditLog.findMany({
      where: { action: "CUSTOMER_RETENTION_AUTOMATION", entity: "RetentionCampaign" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const rows = logs
      .filter((x) => Number(x.payload?.branchId || 0) === Number(branchId))
      .map((x) => ({
        id: x.id,
        segment: String(x.payload?.segment || "atRisk"),
        channel: String(x.payload?.channel || "SMS"),
        atRiskDays: Number(x.payload?.atRiskDays || getRetentionThresholdDays()),
        birthdayWindowDays: Number(x.payload?.birthdayWindowDays || 7),
        totalQueued: Number(x.payload?.summary?.totalQueued || 0),
        atRiskCount: Number(x.payload?.summary?.atRiskCount || 0),
        birthdayCount: Number(x.payload?.summary?.birthdayCount || 0),
        generatedAt: x.payload?.generatedAt || x.createdAt,
        generatedBy: x.user?.name || x.user?.email || "",
      }));
    const latestQueue =
      logs
        .filter((x) => Number(x.payload?.branchId || 0) === Number(branchId))
        .map((x) => x.payload?.queue)
        .find((q) => Array.isArray(q) && q.length) || [];
    res.json({
      summary: {
        campaigns: rows.length,
        totalQueued: rows.reduce((sum, x) => sum + Number(x.totalQueued || 0), 0),
      },
      campaigns: rows,
      latestQueue,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerAccountStatementPdf = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid customer id" });

    const customer = await prisma.customer.findFirst({
      where: { id, branchId },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        balance: true,
        storedValueBalance: true,
      },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const [branch, recentSales, receipts] = await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId } }),
      prisma.sale.findMany({
        where: { branchId, customerId: id },
        orderBy: { createdAt: "desc" },
        take: 35,
      }),
      prisma.receiptVoucher.findMany({
        where: { branchId, customerId: id },
        orderBy: { createdAt: "desc" },
        take: 35,
      }),
    ]);

    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const filename = `customer-statement-${id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(16).text("Customer account statement", { align: "center" });
    doc.moveDown(0.6);
    doc.fontSize(10);
    doc.text(`Branch: ${branch?.name || ""} (${branch?.code || ""})`);
    doc.text(`Customer: ${customer.name}`);
    doc.text(`Phone: ${customer.phone || "—"}`);
    doc.text(`Address: ${customer.address || "—"}`);
    doc.moveDown();
    doc.text(`Outstanding balance (due): ${Number(customer.balance || 0).toFixed(2)} BDT`);
    doc.text(`Wallet balance: ${Number(customer.storedValueBalance || 0).toFixed(2)} BDT`);
    doc.moveDown();
    doc.fontSize(12).text("Recent invoices");
    doc.fontSize(9);
    if (!recentSales.length) doc.text("No sales on file.");
    for (const s of recentSales) {
      doc.text(
        `• ${s.invoiceNo || s.id} ${new Date(s.createdAt).toLocaleDateString()} Total ${Number(s.total || 0).toFixed(
          2
        )} Paid ${Number(s.paidAmount || 0).toFixed(2)} Due ${Number(s.dueAmount || 0).toFixed(2)}`
      );
    }
    doc.moveDown();
    doc.fontSize(12).text("Receipt vouchers");
    doc.fontSize(9);
    if (!receipts.length) doc.text("No receipts recorded.");
    for (const r of receipts) {
      doc.text(
        `• ${new Date(r.createdAt).toLocaleDateString()} ${Number(r.amount || 0).toFixed(2)} BDT ${String(
          r.method || ""
        ).slice(0, 24)}${r.note ? ` — ${String(r.note).slice(0, 80)}` : ""}`
      );
    }
    doc.moveDown();
    doc.fontSize(8).text("Generated by BD Smart POS — for reference only.", { align: "center" });
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
