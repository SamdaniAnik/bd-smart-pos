const prisma = require("../../utils/prisma");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const { RETAIL_CATEGORY_SEEDS } = require("../../constants/retailDepartments");
const { sendBulkSms, renderSmsTemplate, isSmsConfigured, getProviderName } = require("../../utils/smsGateway");
const { isEfdConfigured, getEfdProvider } = require("../efd/efdService");
const { isTopupConfigured, getProviderName: getTopupProvider } = require("../../utils/topupGateway");
const { isFcommerceLive, getProviderMode: getFcommerceProvider } = require("../../utils/fcommerceService");
const {
  buildCustomerLoyaltyBalance,
  buildBranchCustomerLoyaltyMap,
  loadBranchPointsExpiryDays,
} = require("../../utils/loyaltyPointsExpiry");

const ALLOWED_DEPARTMENTS = new Set(["GROCERY", "PHARMACY", "APPAREL", "GENERAL"]);

function normalizeDepartment(value) {
  const key = String(value || "")
    .trim()
    .toUpperCase();
  return ALLOWED_DEPARTMENTS.has(key) ? key : null;
}

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
  const balance = await buildCustomerLoyaltyBalance(prisma, branchId, customerId);
  return {
    loyaltyPoints: balance.availablePoints,
    loyaltyEarnedPoints: balance.earnedPoints,
    loyaltyRedeemedPoints: balance.redeemedPoints,
    loyaltyExpiredPoints: balance.expiredPoints,
    loyaltyExpiringSoonPoints: balance.expiringSoonPoints,
    loyaltyPointsExpiryDays: balance.pointsExpiryDays,
    loyaltyTier: tierFromPoints(balance.earnedPoints),
    loyaltyTotalSpent: balance.totalSpent,
    loyaltyOrders: balance.orders,
    loyaltyExpiryEnabled: balance.expiryEnabled,
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
    const lq = parseListQuery(req, {
      searchableFields: ["name", "phone", "address", "tinNumber", "binNumber", "taxCategory", "withholdingNote"],
      filterableFields: ["taxCategory", "withholdingExempt"],
      sortableFields: ["id", "name", "payableBalance", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const where = { branchId: req.branchId };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [suppliers, total] = await prisma.$transaction([
        prisma.supplier.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.supplier.count({ where }),
      ]);
      return res.json(pagedResult({ data: suppliers, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: lq.orderBy || { createdAt: "desc" },
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

const CUSTOMER_TYPES = new Set(["RETAIL", "WHOLESALE", "INSTITUTION"]);

function buildCustomerPayload(body, branchId) {
  const {
    name,
    phone,
    address,
    district,
    area,
    landmark,
    customerType,
    buyerBin,
    companyName,
    whatsappOptIn,
    creditLimit,
    birthDate,
    marketingOptIn,
    priceTier,
    nidNumber,
    birthCertificateNo,
    kycDocumentType,
  } = body;
  const normalizedPriceTier = ["RETAIL", "WHOLESALE", "DEALER"].includes(String(priceTier || "").toUpperCase())
    ? String(priceTier).toUpperCase()
    : "RETAIL";
  const normalizedCustomerType = CUSTOMER_TYPES.has(String(customerType || "").toUpperCase())
    ? String(customerType).toUpperCase()
    : "RETAIL";
  return {
    branchId,
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : null,
    address: address ? String(address).trim() : null,
    district: district ? String(district).trim() : null,
    area: area ? String(area).trim() : null,
    landmark: landmark ? String(landmark).trim() : null,
    customerType: normalizedCustomerType,
    buyerBin: buyerBin ? String(buyerBin).trim().slice(0, 64) : null,
    companyName: companyName ? String(companyName).trim() : null,
    whatsappOptIn: whatsappOptIn == null ? false : Boolean(whatsappOptIn),
    creditLimit:
      creditLimit != null && creditLimit !== "" && !Number.isNaN(Number(creditLimit))
        ? Number(creditLimit)
        : 0,
    birthDate: birthDate ? new Date(birthDate) : null,
    marketingOptIn: marketingOptIn == null ? true : Boolean(marketingOptIn),
    priceTier: normalizedPriceTier,
    nidNumber: nidNumber ? String(nidNumber).trim().slice(0, 20) : null,
    birthCertificateNo: birthCertificateNo ? String(birthCertificateNo).trim().slice(0, 40) : null,
    kycDocumentType: ["NID", "BIRTH_CERT"].includes(String(kycDocumentType || "").toUpperCase())
      ? String(kycDocumentType).toUpperCase()
      : nidNumber
        ? "NID"
        : birthCertificateNo
          ? "BIRTH_CERT"
          : null,
    kycCapturedAt:
      nidNumber || birthCertificateNo ? new Date() : undefined,
  };
}

async function saveCustomerRecord(prismaClient, { isCreate, id, data }) {
  try {
    if (isCreate) {
      return await prismaClient.customer.create({ data });
    }
    return await prismaClient.customer.update({ where: { id }, data });
  } catch (e) {
    if (e.code !== "P2022") throw e;
    const fallback = { ...data };
    [
      "district",
      "area",
      "landmark",
      "customerType",
      "buyerBin",
      "companyName",
      "whatsappOptIn",
      "priceTier",
    ].forEach((key) => delete fallback[key]);
    if (isCreate) {
      return await prismaClient.customer.create({ data: fallback });
    }
    return await prismaClient.customer.update({ where: { id }, data: fallback });
  }
}

exports.createCustomer = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { name } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name must be at least 2 characters" });
    }
    const customer = await saveCustomerRecord(prisma, {
      isCreate: true,
      data: buildCustomerPayload(req.body, branchId),
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const lq = parseListQuery(req, {
      searchableFields: [
        "name", "phone", "address", "companyName", "buyerBin",
        "nidNumber", "district", "area", "priceTier",
      ],
      filterableFields: ["customerType", "priceTier"],
      sortableFields: ["id", "name", "balance", "creditLimit", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const where = { branchId: req.branchId };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    let total = null;
    let customers;
    if (lq.paged) {
      [customers, total] = await prisma.$transaction([
        prisma.customer.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.customer.count({ where }),
      ]);
    } else {
      customers = await prisma.customer.findMany({ where, orderBy: lq.orderBy || { createdAt: "desc" } });
    }

    const sendRows = (rows) =>
      lq.paged
        ? res.json(pagedResult({ data: rows, total: total || 0, page: lq.page, pageSize: lq.pageSize }))
        : res.json(rows);

    const customerIds = customers.map((c) => c.id);
    if (!customerIds.length) return sendRows(customers);
    const [loyaltyMap, salesAgg] = await Promise.all([
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: { branchId: req.branchId, customerId: { in: customerIds } },
        _sum: { total: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
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
    sendRows(
      customers.map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0, lastPurchaseAt: null };
        const bal = loyaltyMap.get(c.id) || {
          earnedPoints: 0,
          availablePoints: 0,
          redeemedPoints: 0,
          expiredPoints: 0,
          expiringSoonPoints: 0,
        };
        const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
        const atRiskDays = getRetentionThresholdDays();
        const daysUntilBirthday = calcDaysUntilBirthday(c.birthDate);
        return {
          ...c,
          loyaltyPoints: bal.availablePoints,
          loyaltyEarnedPoints: bal.earnedPoints,
          loyaltyRedeemedPoints: bal.redeemedPoints,
          loyaltyExpiredPoints: bal.expiredPoints,
          loyaltyExpiringSoonPoints: bal.expiringSoonPoints,
          loyaltyTier: tierFromPoints(bal.earnedPoints),
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
    const [loyaltyMap, salesAgg] = await Promise.all([
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: { branchId: req.branchId, customerId: { in: customerIds } },
        _sum: { total: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
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
        const bal = loyaltyMap.get(c.id) || {
          earnedPoints: 0,
          availablePoints: 0,
          expiredPoints: 0,
          expiringSoonPoints: 0,
        };
        const daysSinceLastPurchase = calcDaysDiffFromToday(stats.lastPurchaseAt);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          loyaltyPoints: bal.availablePoints,
          loyaltyEarnedPoints: bal.earnedPoints,
          loyaltyExpiredPoints: bal.expiredPoints,
          loyaltyExpiringSoonPoints: bal.expiringSoonPoints,
          loyaltyTier: tierFromPoints(bal.earnedPoints),
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
    const [loyaltyMap, salesAgg] = await Promise.all([
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: { branchId: req.branchId, customerId: { in: customerIds } },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const bal = loyaltyMap.get(c.id) || { earnedPoints: 0, availablePoints: 0, expiredPoints: 0, expiringSoonPoints: 0 };
        return {
          customer_id: c.id,
          customer_name: c.name,
          phone: c.phone || "",
          tier: tierFromPoints(bal.earnedPoints),
          available_points: bal.availablePoints,
          expiring_soon_points: bal.expiringSoonPoints,
          expired_points: bal.expiredPoints,
          total_spent: stats.totalSpent.toFixed(2),
          orders: stats.orders,
        };
      })
      .sort((a, b) => b.available_points - a.available_points);
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
    const [loyaltyMap, salesAgg] = await Promise.all([
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      customerIds.length
        ? prisma.sale.groupBy({
            by: ["customerId"],
            where: { branchId: req.branchId, customerId: { in: customerIds } },
            _sum: { total: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const bal = loyaltyMap.get(c.id) || { earnedPoints: 0, availablePoints: 0 };
        return {
          name: c.name,
          phone: c.phone || "-",
          tier: tierFromPoints(bal.earnedPoints),
          points: bal.availablePoints,
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
    const [loyaltyMap, salesAgg] = await Promise.all([
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      customerIds.length
        ? prisma.sale.groupBy({
            by: ["customerId"],
            where: { branchId: req.branchId, customerId: { in: customerIds } },
            _sum: { total: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const byCustomer = new Map(
      salesAgg
        .filter((x) => x.customerId != null)
        .map((x) => [x.customerId, { totalSpent: Number(x._sum.total || 0), orders: Number(x._count._all || 0) }])
    );
    const rows = customers
      .map((c) => {
        const stats = byCustomer.get(c.id) || { totalSpent: 0, orders: 0 };
        const bal = loyaltyMap.get(c.id) || {
          earnedPoints: 0,
          availablePoints: 0,
          expiredPoints: 0,
          expiringSoonPoints: 0,
        };
        return {
          CustomerID: c.id,
          Customer: c.name,
          Phone: c.phone || "",
          Tier: tierFromPoints(bal.earnedPoints),
          AvailablePoints: bal.availablePoints,
          ExpiringSoonPoints: bal.expiringSoonPoints,
          ExpiredPoints: bal.expiredPoints,
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

exports.getLoyaltyPointsExpiry = async (req, res) => {
  try {
    const onlyExpiring = String(req.query.filter || "expiring") !== "all";
    const [customers, loyaltyMap, pointsExpiryDays] = await Promise.all([
      prisma.customer.findMany({
        where: { branchId: req.branchId },
        select: { id: true, name: true, phone: true },
        orderBy: { name: "asc" },
      }),
      buildBranchCustomerLoyaltyMap(prisma, req.branchId),
      loadBranchPointsExpiryDays(prisma, req.branchId),
    ]);
    const rows = customers
      .map((c) => {
        const bal = loyaltyMap.get(c.id) || {
          earnedPoints: 0,
          availablePoints: 0,
          redeemedPoints: 0,
          expiredPoints: 0,
          expiringSoonPoints: 0,
        };
        if (onlyExpiring && bal.expiringSoonPoints <= 0 && bal.expiredPoints <= 0) return null;
        return {
          customerId: c.id,
          name: c.name,
          phone: c.phone || "",
          availablePoints: bal.availablePoints,
          earnedPoints: bal.earnedPoints,
          redeemedPoints: bal.redeemedPoints,
          expiredPoints: bal.expiredPoints,
          expiringSoonPoints: bal.expiringSoonPoints,
          loyaltyTier: tierFromPoints(bal.earnedPoints),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.expiringSoonPoints - a.expiringSoonPoints || b.expiredPoints - a.expiredPoints);
    const summary = {
      pointsExpiryDays,
      expiryEnabled: pointsExpiryDays > 0,
      customersWithExpiringSoon: rows.filter((r) => r.expiringSoonPoints > 0).length,
      totalExpiringSoonPoints: rows.reduce((s, r) => s + Number(r.expiringSoonPoints || 0), 0),
      totalExpiredPoints: [...loyaltyMap.values()].reduce((s, r) => s + Number(r.expiredPoints || 0), 0),
    };
    res.json({ summary, rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportLoyaltyPointsExpiryCSV = async (req, res) => {
  try {
    req.query = { ...(req.query || {}), filter: req.query.filter || "expiring" };
    const customers = await prisma.customer.findMany({
      where: { branchId: req.branchId },
      select: { id: true, name: true, phone: true },
    });
    const loyaltyMap = await buildBranchCustomerLoyaltyMap(prisma, req.branchId);
    const onlyExpiring = String(req.query.filter || "expiring") !== "all";
    const rows = customers
      .map((c) => {
        const bal = loyaltyMap.get(c.id) || {
          availablePoints: 0,
          expiredPoints: 0,
          expiringSoonPoints: 0,
          earnedPoints: 0,
        };
        if (onlyExpiring && bal.expiringSoonPoints <= 0 && bal.expiredPoints <= 0) return null;
        return {
          customer_id: c.id,
          customer_name: c.name,
          phone: c.phone || "",
          available_points: bal.availablePoints,
          expiring_soon_points: bal.expiringSoonPoints,
          expired_points: bal.expiredPoints,
          earned_points: bal.earnedPoints,
        };
      })
      .filter(Boolean);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="loyalty-points-expiry.csv"');
    res.send(toCSV(rows));
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

    const { name } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name must be at least 2 characters" });
    }

    const payload = buildCustomerPayload(req.body, req.branchId);
    delete payload.branchId;
    const customer = await saveCustomerRecord(prisma, {
      isCreate: false,
      id,
      data: payload,
    });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getFeatureReadiness = async (_req, res) => {
  try {
    const tableRows = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'ProductBarcode'");
    const priceListTableRows = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'ProductPriceList'");
    const productCols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Product`");
    const customerCols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Customer`");
    const colSet = new Set((productCols || []).map((c) => String(c.Field || "")));
    const customerColSet = new Set((customerCols || []).map((c) => String(c.Field || "")));
    const required = [
      "size",
      "color",
      "brand",
      "model",
      "specification",
      "barcode",
      "imageUrl",
    ];
    const missing = required.filter((c) => !colSet.has(c));
    const customerRequired = ["priceTier"];
    const missingCustomer = customerRequired.filter((c) => !customerColSet.has(c));
    const mfsDefaultProvider = String(process.env.MFS_PROVIDER || "log").trim().toLowerCase();
    const bkashProvider = String(process.env.MFS_BKASH_PROVIDER || mfsDefaultProvider).trim().toLowerCase();
    const smsProvider = getProviderName();
    const efdProvider = getEfdProvider();

    res.json({
      ok:
        missing.length === 0 &&
        missingCustomer.length === 0 &&
        Array.isArray(tableRows) &&
        tableRows.length > 0 &&
        Array.isArray(priceListTableRows) &&
        priceListTableRows.length > 0,
      productMaster: {
        productColumnsReady: missing.length === 0,
        missingProductColumns: missing,
        productBarcodeAliasTableReady: Array.isArray(tableRows) && tableRows.length > 0,
        productPriceListTableReady: Array.isArray(priceListTableRows) && priceListTableRows.length > 0,
        customerColumnsReady: missingCustomer.length === 0,
        missingCustomerColumns: missingCustomer,
      },
      integrations: {
        sms: {
          provider: smsProvider,
          mode: isSmsConfigured() ? "live" : "simulated",
          senderId: process.env.SMS_SENDER_ID || null,
        },
        mfs: {
          defaultProvider: mfsDefaultProvider,
          bkashProvider,
          bkashLive: bkashProvider === "bkash" && Boolean(process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET),
          nagadLive: Boolean(process.env.NAGAD_MERCHANT_ID || process.env.NAGAD_MERCHANT_NUMBER),
          bkashMerchantNumber: process.env.BKASH_MERCHANT_NUMBER || process.env.BKASH_CHECKOUT_NUMBER || null,
          nagadMerchantNumber: process.env.NAGAD_MERCHANT_NUMBER || null,
          rocketMerchantNumber: process.env.ROCKET_MERCHANT_NUMBER || null,
          upayMerchantNumber: process.env.UPAY_MERCHANT_NUMBER || null,
        },
        efd: {
          provider: efdProvider,
          mode: isEfdConfigured() ? "live" : "simulated",
          deviceId: process.env.EFD_DEVICE_ID || null,
          genexUrlConfigured: Boolean(process.env.EFD_GENEX_URL),
        },
        topup: {
          provider: getTopupProvider(),
          mode: isTopupConfigured() ? "live" : "simulated",
          aggregatorUrlConfigured: Boolean(process.env.TOPUP_API_URL),
        },
        fcommerce: {
          provider: getFcommerceProvider(),
          mode: isFcommerceLive() ? "live" : "simulated",
          metaAccessTokenConfigured: Boolean(process.env.META_ACCESS_TOKEN),
          webhookPath: "/api/fcommerce/meta/webhook",
        },
        storefront: {
          publicCatalog: true,
          publicOrderPath: "/api/storefront/order",
          hashRoute: "#/storefront?token=…",
        },
        pwa: {
          serviceWorker: true,
          indexedDbCatalog: true,
          offlineSaleQueue: true,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listProductCategories = async (req, res) => {
  try {
    const rows = await prisma.productCategory.findMany({
      where: { branchId: req.branchId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 300,
    });
    res.json(
      rows.map((row) => ({
        ...row,
        department: row.department ? String(row.department).toUpperCase() : null,
        attributeSet: Array.isArray(row.attributeSet) ? row.attributeSet : [],
        minMarginPct:
          row.minMarginPct != null && Number.isFinite(Number(row.minMarginPct))
            ? Number(row.minMarginPct)
            : null,
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createProductCategory = async (req, res) => {
  try {
    const branchId = req.branchId;
    const name = String(req.body?.name || "").trim();
    const minMarginPctRaw = req.body?.minMarginPct;
    const minMarginPct =
      minMarginPctRaw != null && String(minMarginPctRaw).trim() !== ""
        ? Number(minMarginPctRaw)
        : null;
    if (!name) return res.status(400).json({ error: "Category name is required" });
    if (minMarginPct != null && (!Number.isFinite(minMarginPct) || minMarginPct < 0 || minMarginPct > 99.99)) {
      return res.status(400).json({ error: "minMarginPct must be between 0 and 99.99" });
    }
    const attributeSet = Array.isArray(req.body?.attributeSet)
      ? req.body.attributeSet
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 30)
      : [];
    const department = normalizeDepartment(req.body?.department);
    const existing = await prisma.productCategory.findFirst({
      where: { branchId, name: { equals: name } },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: "Category already exists" });
    const row = await prisma.productCategory.create({
      data: {
        branchId,
        name,
        department,
        attributeSet,
        minMarginPct: minMarginPct != null ? Number(minMarginPct) : null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProductCategory = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid category id" });
    const existing = await prisma.productCategory.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Category not found" });
    const name = String(req.body?.name || existing.name || "").trim();
    if (!name) return res.status(400).json({ error: "Category name is required" });
    const minMarginPctRaw = req.body?.minMarginPct;
    const minMarginPct =
      minMarginPctRaw != null && String(minMarginPctRaw).trim() !== ""
        ? Number(minMarginPctRaw)
        : null;
    if (minMarginPct != null && (!Number.isFinite(minMarginPct) || minMarginPct < 0 || minMarginPct > 99.99)) {
      return res.status(400).json({ error: "minMarginPct must be between 0 and 99.99" });
    }
    const attributeSet = Array.isArray(req.body?.attributeSet)
      ? req.body.attributeSet
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 30)
      : Array.isArray(existing.attributeSet)
        ? existing.attributeSet
        : [];
    const department =
      req.body?.department != null ? normalizeDepartment(req.body.department) : existing.department;
    const dup = await prisma.productCategory.findFirst({
      where: {
        branchId,
        name: { equals: name },
        NOT: { id },
      },
      select: { id: true },
    });
    if (dup) return res.status(409).json({ error: "Category already exists" });
    const row = await prisma.productCategory.update({
      where: { id },
      data: {
        name,
        department,
        attributeSet,
        minMarginPct: minMarginPct != null ? Number(minMarginPct) : null,
      },
    });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteProductCategory = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid category id" });
    const existing = await prisma.productCategory.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Category not found" });
    const linkedCount = await prisma.product.count({
      where: {
        branchId,
        OR: [{ categoryId: id }, { category: existing.name }],
      },
    });
    if (linkedCount > 0) {
      return res.status(409).json({ error: "Cannot delete category with linked products" });
    }
    await prisma.productCategory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function upsertRetailCategoriesForBranch(branchId) {
  let created = 0;
  let updated = 0;
  for (const seed of RETAIL_CATEGORY_SEEDS) {
    const name = String(seed.name || "").trim();
    if (!name) continue;
    const attributeSet = Array.isArray(seed.attributeSet) ? seed.attributeSet : [];
    const department = normalizeDepartment(seed.department);
    const minMarginPct =
      seed.minMarginPct != null && Number.isFinite(Number(seed.minMarginPct))
        ? Number(seed.minMarginPct)
        : null;
    const existing = await prisma.productCategory.findFirst({
      where: { branchId, name: { equals: name } },
    });
    if (existing) {
      await prisma.productCategory.update({
        where: { id: existing.id },
        data: {
          department: department || existing.department,
          attributeSet: attributeSet.length ? attributeSet : existing.attributeSet,
          minMarginPct: minMarginPct != null ? minMarginPct : existing.minMarginPct,
        },
      });
      updated += 1;
    } else {
      await prisma.productCategory.create({
        data: {
          branchId,
          name,
          department,
          attributeSet,
          minMarginPct,
        },
      });
      created += 1;
    }
  }
  return { created, updated, total: RETAIL_CATEGORY_SEEDS.length };
}

exports.seedRetailCategories = async (req, res) => {
  try {
    const branchId = req.branchId;
    const result = await upsertRetailCategoriesForBranch(branchId);
    res.json({
      message: "Retail categories seeded for super shop, pharmacy, and apparel",
      ...result,
    });
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
        dispatchedAt: x.payload?.dispatch?.dispatchedAt || null,
        dispatchProvider: x.payload?.dispatch?.provider || null,
        smsSent: Number(x.payload?.dispatch?.summary?.sent || 0),
        smsSimulated: Number(x.payload?.dispatch?.summary?.simulated || 0),
        smsFailed: Number(x.payload?.dispatch?.summary?.failed || 0),
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

const RETENTION_SMS_TEMPLATES = {
  BIRTHDAY_OFFER:
    "প্রিয় {name}, শুভ জন্মদিন! {store} এ আপনার জন্য জন্মদিনের বিশেষ অফার ও বোনাস পয়েন্ট অপেক্ষা করছে। আজই ঘুরে যান!",
  AT_RISK_WINBACK:
    "প্রিয় {name}, অনেকদিন আপনাকে দেখি না! {store} এ ফিরে আসুন — আপনার জন্য বিশেষ ছাড় ও বোনাস পয়েন্ট রয়েছে।",
  GENERIC_RETENTION:
    "প্রিয় {name}, {store} এ আপনার জন্য বিশেষ অফার চলছে। আজই ভিজিট করুন!",
};

exports.dispatchCustomerRetentionAutomation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const automationId = Number(req.params.id);
    if (Number.isNaN(automationId)) return res.status(400).json({ error: "Invalid automation id" });

    const log = await prisma.auditLog.findFirst({
      where: { id: automationId, action: "CUSTOMER_RETENTION_AUTOMATION", entity: "RetentionCampaign" },
    });
    if (!log || Number(log.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Retention automation run not found" });
    }
    if (log.payload?.dispatch?.dispatchedAt) {
      return res.status(409).json({ error: "This automation queue has already been dispatched" });
    }
    const queue = Array.isArray(log.payload?.queue) ? log.payload.queue : [];
    const pending = queue.filter((x) => String(x.status || "PENDING") === "PENDING" && String(x.phone || "").trim());
    if (!pending.length) return res.status(400).json({ error: "No pending contacts with phone numbers in this queue" });

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    const storeName = branch?.name || "আমাদের দোকান";
    const customTemplate = String(req.body?.messageTemplate || "").trim();

    const recipients = pending.map((row) => {
      const template = customTemplate || RETENTION_SMS_TEMPLATES[row.campaignType] || RETENTION_SMS_TEMPLATES.GENERIC_RETENTION;
      return {
        customerId: row.customerId,
        to: row.phone,
        message: renderSmsTemplate(template, {
          name: row.customerName || "গ্রাহক",
          store: storeName,
          offer: row.suggestedOffer || "",
        }),
      };
    });

    const { results, summary } = await sendBulkSms(recipients);
    const resultByCustomer = new Map(results.map((x) => [x.customerId, x]));
    const updatedQueue = queue.map((row) => {
      const result = resultByCustomer.get(row.customerId);
      return result ? { ...row, status: result.status, smsError: result.error || null } : row;
    });
    const dispatch = {
      dispatchedAt: new Date().toISOString(),
      dispatchedByUserId: req.user?.id || null,
      provider: getProviderName(),
      simulated: !isSmsConfigured(),
      summary,
    };

    await prisma.auditLog.update({
      where: { id: log.id },
      data: { payload: { ...log.payload, queue: updatedQueue, dispatch } },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "CUSTOMER_RETENTION_SMS_DISPATCH",
        entity: "RetentionCampaign",
        entityId: String(log.id),
        payload: { branchId, automationId: log.id, ...dispatch },
      },
    });

    res.json({
      message: dispatch.simulated
        ? "SMS dispatch simulated (configure SMS_PROVIDER to send for real)"
        : "SMS dispatch completed",
      automationId: log.id,
      ...dispatch,
      results: results.map((x) => ({
        customerId: x.customerId,
        msisdn: x.msisdn,
        status: x.status,
        segments: x.segments,
        encoding: x.encoding,
        error: x.error || null,
      })),
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

exports.issueLoyaltyCard = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const customer = await prisma.customer.findFirst({ where: { id, branchId } });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    if (!String(customer.phone || "").trim()) {
      return res.status(400).json({ error: "Customer phone is required for loyalty SMS OTP" });
    }
    const { issueLoyaltyCardToken } = require("../loyalty/loyaltyPublicController");
    const loyaltyCardToken = issueLoyaltyCardToken();
    await prisma.customer.update({ where: { id }, data: { loyaltyCardToken } });
    const cardUrl =
      typeof process.env.PUBLIC_APP_URL === "string" && process.env.PUBLIC_APP_URL
        ? `${process.env.PUBLIC_APP_URL.replace(/\/$/, "")}/#/loyalty?card=${encodeURIComponent(loyaltyCardToken)}`
        : null;
    res.json({ loyaltyCardToken, cardUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
