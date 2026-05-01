const prisma = require("../utils/prisma");
const { getSocketInstance } = require("../socket");
const { ensureOpenFiscalPeriod } = require("../utils/fiscal");
const { writeAuditLog } = require("../utils/audit");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

function generateInvoiceNo() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const randomPart = String(Math.floor(1000 + Math.random() * 9000));
  return `INV-${datePart}-${randomPart}`;
}

function generateQuoteNo() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const randomPart = String(Math.floor(1000 + Math.random() * 9000));
  return `QTE-${datePart}-${randomPart}`;
}

function getBranchId(req) {
  return req.branchId || Number(req.body.branchId || req.query.branchId || 1);
}

function getQuoteValidityDays() {
  return Math.max(1, Number(process.env.QUOTE_VALID_DAYS || 7));
}

function getQuoteValidUntil(baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + getQuoteValidityDays());
  return d;
}

function resolveQuoteStatus(payload = {}) {
  const rawStatus = String(payload.status || "OPEN").toUpperCase();
  if (rawStatus !== "OPEN") return rawStatus;
  const validUntil = payload.validUntil ? new Date(payload.validUntil) : null;
  if (validUntil && !Number.isNaN(validUntil.getTime()) && validUntil.getTime() < Date.now()) {
    return "EXPIRED";
  }
  return "OPEN";
}

function computeReminderStatus(followUpAtValue) {
  if (!followUpAtValue) return "NONE";
  const d = new Date(followUpAtValue);
  if (Number.isNaN(d.getTime())) return "NONE";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  if (d < startToday) return "OVERDUE";
  if (d >= startToday && d < startTomorrow) return "TODAY";
  if (d >= startTomorrow && d < startAfterTomorrow) return "TOMORROW";
  return "UPCOMING";
}

function isFollowUpDone(payload = {}) {
  return Boolean(payload.followUpDoneAt);
}

function getPerUnitPredefinedDiscount(product) {
  const type = product.defaultDiscountType || null;
  const value = Number(product.defaultDiscountValue || 0);
  if (!type || value <= 0) return 0;
  if (type === "PERCENT") {
    return Math.max(0, (Number(product.price) * value) / 100);
  }
  if (type === "AMOUNT") {
    return Math.max(0, value);
  }
  return 0;
}

function calculateManualDiscount(baseAmount, discountType, discountValue) {
  const amount = Number(discountValue || 0);
  if (!amount || amount < 0) return 0;
  if (discountType === "PERCENT") {
    return Math.max(0, (baseAmount * amount) / 100);
  }
  return amount;
}

function getManagerApprovalPin() {
  return String(process.env.MANAGER_APPROVAL_PIN || "1234");
}

function getApprovalThresholds() {
  return {
    percent: Number(process.env.MANAGER_APPROVAL_DISCOUNT_PERCENT || 10),
    amount: Number(process.env.MANAGER_APPROVAL_DISCOUNT_AMOUNT || 500),
  };
}

function getPriceOverrideThresholds() {
  return {
    percent: Number(process.env.MANAGER_APPROVAL_PRICE_OVERRIDE_PERCENT || 5),
    amount: Number(process.env.MANAGER_APPROVAL_PRICE_OVERRIDE_AMOUNT || 50),
  };
}

function requiresManagerApproval(discountType, manualDiscountValue, manualDiscountAmount) {
  const thresholds = getApprovalThresholds();
  if (discountType === "PERCENT" && Number(manualDiscountValue) > thresholds.percent) return true;
  return Number(manualDiscountAmount || 0) > thresholds.amount;
}

function parseCartPriceOverrides(cart, productMap) {
  const rows = [];
  for (const item of cart) {
    const dbProduct = productMap.get(item.id);
    if (!dbProduct) continue;
    const baseUnitPrice = Number(dbProduct.price || 0);
    const qty = Number(item.qty || 0);
    const rawOverride = item.overridePrice;
    const hasOverride =
      rawOverride !== undefined &&
      rawOverride !== null &&
      String(rawOverride).trim() !== "";
    if (!hasOverride) {
      rows.push({
        productId: Number(item.id),
        productName: dbProduct.name,
        qty,
        baseUnitPrice,
        appliedUnitPrice: baseUnitPrice,
        overrideUnitPrice: null,
        reductionPerUnit: 0,
        reductionPercent: 0,
      });
      continue;
    }
    const overrideUnitPrice = Number(rawOverride);
    if (!Number.isFinite(overrideUnitPrice) || overrideUnitPrice <= 0) {
      throw new Error(`Invalid override price for ${dbProduct.name}`);
    }
    const appliedUnitPrice = overrideUnitPrice;
    const reductionPerUnit = Math.max(0, baseUnitPrice - appliedUnitPrice);
    const reductionPercent = baseUnitPrice > 0 ? (reductionPerUnit / baseUnitPrice) * 100 : 0;
    rows.push({
      productId: Number(item.id),
      productName: dbProduct.name,
      qty,
      baseUnitPrice,
      appliedUnitPrice,
      overrideUnitPrice,
      reductionPerUnit,
      reductionPercent,
    });
  }
  return rows;
}

function requiresPriceOverrideApproval(overrideRows) {
  const thresholds = getPriceOverrideThresholds();
  const rowsNeedingApproval = overrideRows.filter(
    (row) =>
      row.overrideUnitPrice != null &&
      (Number(row.reductionPercent || 0) > thresholds.percent || Number(row.reductionPerUnit || 0) > thresholds.amount)
  );
  const totalReductionAmount = overrideRows.reduce(
    (sum, row) => sum + Number(row.reductionPerUnit || 0) * Number(row.qty || 0),
    0
  );
  return {
    required: rowsNeedingApproval.length > 0,
    rowsNeedingApproval,
    totalReductionAmount,
  };
}

function getLoyaltyConfig() {
  return {
    pointsPer100: Number(process.env.LOYALTY_POINTS_PER_100 || 1),
    silverAt: Number(process.env.LOYALTY_SILVER_AT || 500),
    goldAt: Number(process.env.LOYALTY_GOLD_AT || 2000),
  };
}

function getTierDiscountConfig() {
  return {
    silverPercent: Number(process.env.LOYALTY_SILVER_DISCOUNT_PERCENT || 2),
    goldPercent: Number(process.env.LOYALTY_GOLD_DISCOUNT_PERCENT || 5),
  };
}

function getTierFromPoints(points) {
  const { silverAt, goldAt } = getLoyaltyConfig();
  if (points >= goldAt) return "GOLD";
  if (points >= silverAt) return "SILVER";
  return "REGULAR";
}

function getTierDiscountPercent(tier) {
  const { silverPercent, goldPercent } = getTierDiscountConfig();
  if (tier === "GOLD") return goldPercent;
  if (tier === "SILVER") return silverPercent;
  return 0;
}

function pointsFromAmount(amount) {
  const { pointsPer100 } = getLoyaltyConfig();
  return Math.floor(Number(amount || 0) / 100) * pointsPer100;
}

function getPointValueInCurrency() {
  return Number(process.env.LOYALTY_BDT_PER_POINT || 1);
}

function getLoyaltyRedeemConfig() {
  return {
    maxPercentOfBill: Number(process.env.LOYALTY_REDEEM_MAX_PERCENT || 20),
    managerApprovalPoints: Number(process.env.LOYALTY_REDEEM_MANAGER_POINTS || 200),
  };
}

function parseRedeemedPointsFromNotes(notes) {
  if (!notes) return 0;
  try {
    const payload = JSON.parse(notes);
    return Number(payload?.loyalty?.redeemedPoints || 0);
  } catch {
    return 0;
  }
}

async function buildCustomerLoyalty(tx, branchId, customerId) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, branchId } });
  if (!customer) return null;
  const sales = await tx.sale.findMany({
    where: { branchId, customerId },
    select: { total: true, notes: true },
  });
  const totalSpent = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const earnedPoints = pointsFromAmount(totalSpent);
  const redeemedPoints = sales.reduce((sum, row) => sum + parseRedeemedPointsFromNotes(row.notes), 0);
  const points = Math.max(0, earnedPoints - redeemedPoints);
  return {
    customerId,
    customerName: customer.name,
    totalSpent,
    points,
    earnedPoints,
    redeemedPoints,
    tier: getTierFromPoints(points),
    orders: sales.length,
  };
}

function normalizePaymentBreakdown(paymentBreakdown) {
  if (!Array.isArray(paymentBreakdown)) return [];
  return paymentBreakdown
    .map((line) => ({
      method: String(line?.method || "").trim(),
      amount: Number(line?.amount || 0),
      channel: line?.channel ? String(line.channel).trim() : "",
    }))
    .filter((line) => line.method && line.amount > 0);
}

function parsePaymentBreakdownFromNotes(notes) {
  if (!notes) return [];
  try {
    const payload = JSON.parse(notes);
    if (!Array.isArray(payload?.paymentBreakdown)) return [];
    return normalizePaymentBreakdown(payload.paymentBreakdown);
  } catch {
    return [];
  }
}

function normalizeHeldCartPayload(input = {}) {
  return {
    cart: Array.isArray(input.cart) ? input.cart : [],
    paymentMethod: String(input.paymentMethod || "Cash"),
    paidAmount: Number(input.paidAmount || 0),
    paymentBreakdown: Array.isArray(input.paymentBreakdown) ? input.paymentBreakdown : [],
    paymentChannel: String(input.paymentChannel || ""),
    customer: input.customer && typeof input.customer === "object" ? input.customer : { name: "", phone: "" },
    discountType: String(input.discountType || "AMOUNT"),
    discountValue: Number(input.discountValue || 0),
    redeemPoints: Number(input.redeemPoints || 0),
    holdNote: String(input.holdNote || ""),
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

function writePdfTableReport(res, title, columns, rows, filename) {
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(14).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(1);

  const startX = 40;
  const tableWidth = 515;
  const colWidth = tableWidth / columns.length;
  let y = doc.y;

  doc.fontSize(10).font("Helvetica-Bold");
  columns.forEach((col, idx) => {
    doc.text(col.label, startX + idx * colWidth, y, { width: colWidth, align: "left" });
  });
  y += 18;
  doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).stroke("#888");

  doc.font("Helvetica").fontSize(10);
  rows.forEach((row) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    columns.forEach((col, idx) => {
      const value = row[col.key] == null ? "" : String(row[col.key]);
      doc.text(value, startX + idx * colWidth, y, { width: colWidth, align: "left" });
    });
    y += 18;
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

async function buildTodaySettlement(branchId) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return buildSettlement(branchId, start, end);
}

async function buildSettlement(branchId, fromDate, toDateExclusive) {
  const start = fromDate;
  const end = toDateExclusive;
  const salesWhere = { branchId };
  if (start || end) {
    salesWhere.createdAt = {};
    if (start) salesWhere.createdAt.gte = start;
    if (end) salesWhere.createdAt.lt = end;
  }

  const todaySales = await prisma.sale.findMany({
    where: salesWhere,
    select: {
      id: true,
      total: true,
      paidAmount: true,
      dueAmount: true,
      paymentMethod: true,
      paymentChannel: true,
      notes: true,
      createdAt: true,
    },
  });

  const methodTotals = new Map();
  const channelTotals = new Map();
  const dailyTotals = new Map();
  let totalPaid = 0;
  let totalDue = 0;

  const addAmount = (map, key, amount) => {
    const normalizedKey = key || "Unknown";
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + Number(amount || 0));
  };

  for (const sale of todaySales) {
    const salePaid = Number(sale.paidAmount || 0);
    totalPaid += salePaid;
    totalDue += Number(sale.dueAmount || 0);
    addAmount(dailyTotals, sale.createdAt.toISOString().slice(0, 10), salePaid);
    if (sale.paymentMethod === "Split") {
      const splitLines = parsePaymentBreakdownFromNotes(sale.notes);
      if (splitLines.length) {
        for (const line of splitLines) {
          addAmount(methodTotals, line.method, line.amount);
          if (line.channel) addAmount(channelTotals, line.channel, line.amount);
        }
        continue;
      }
    }
    addAmount(methodTotals, sale.paymentMethod || "Cash", salePaid);
    if (sale.paymentChannel) addAmount(channelTotals, sale.paymentChannel, salePaid);
  }

  const methods = Array.from(methodTotals.entries())
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
  const channels = Array.from(channelTotals.entries())
    .map(([channel, amount]) => ({ channel, amount }))
    .sort((a, b) => b.amount - a.amount);
  const days = Array.from(dailyTotals.entries())
    .map(([date, paid]) => ({ date, paid }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: start ? start.toISOString().slice(0, 10) : null,
    to: end ? new Date(end.getTime() - 1).toISOString().slice(0, 10) : null,
    billCount: todaySales.length,
    totalPaid,
    totalDue,
    methods,
    channels,
    days,
  };
}

function parseSettlementRange(req) {
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  const toInclusive = toRaw ? new Date(`${toRaw}T00:00:00.000Z`) : null;
  const toExclusive = toInclusive ? new Date(toInclusive.getTime() + 24 * 60 * 60 * 1000) : null;
  return { from, toExclusive };
}

async function buildSettlementFromRequest(req) {
  const branchId = getBranchId(req);
  const { from, toExclusive } = parseSettlementRange(req);
  if (!from && !toExclusive) return buildTodaySettlement(branchId);
  return buildSettlement(branchId, from, toExclusive);
}

async function exportSettlementMethodCSV(req, res, filename) {
  const settlement = await buildSettlementFromRequest(req);
  const rows = settlement.methods.map((x) => ({
    payment_method: x.method,
    collected_amount: Number(x.amount).toFixed(2),
  }));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCSV(rows));
}

async function exportSettlementChannelCSV(req, res, filename) {
  const settlement = await buildSettlementFromRequest(req);
  const rows = settlement.channels.map((x) => ({
    channel: x.channel,
    collected_amount: Number(x.amount).toFixed(2),
  }));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCSV(rows));
}

async function exportSettlementMethodPDF(req, res, title, filename) {
  const settlement = await buildSettlementFromRequest(req);
  const rows = settlement.methods.map((x) => ({
    method: x.method,
    amount: Number(x.amount).toFixed(2),
  }));
  writePdfTableReport(
    res,
    title,
    [
      { key: "method", label: "Payment Method" },
      { key: "amount", label: "Collected Amount" },
    ],
    rows,
    filename
  );
}

async function exportSettlementChannelPDF(req, res, title, filename) {
  const settlement = await buildSettlementFromRequest(req);
  const rows = settlement.channels.map((x) => ({
    channel: x.channel,
    amount: Number(x.amount).toFixed(2),
  }));
  writePdfTableReport(
    res,
    title,
    [
      { key: "channel", label: "Channel / Reference" },
      { key: "amount", label: "Collected Amount" },
    ],
    rows,
    filename
  );
}

exports.checkout = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const {
      cart,
      paymentMethod,
      paymentChannel,
      paidAmount,
      customer,
      discount,
      discountType,
      discountValue,
      notes,
      paymentBreakdown,
      managerApprovalPin,
      redeemPoints,
      holdCartAuditLogId: holdCartAuditLogIdRaw,
      quoteAuditLogId: quoteAuditLogIdRaw,
    } = req.body;
    const holdCartAuditLogId =
      holdCartAuditLogIdRaw != null && holdCartAuditLogIdRaw !== ""
        ? Number(holdCartAuditLogIdRaw)
        : null;
    const quoteAuditLogId =
      quoteAuditLogIdRaw != null && quoteAuditLogIdRaw !== "" ? Number(quoteAuditLogIdRaw) : null;
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });
    if (
      holdCartAuditLogId != null &&
      !Number.isNaN(holdCartAuditLogId) &&
      quoteAuditLogId != null &&
      !Number.isNaN(quoteAuditLogId)
    ) {
      return res.status(400).json({ error: "Cannot settle a quote and held cart on the same sale" });
    }
    await ensureOpenFiscalPeriod(branchId);

    const productIds = cart.map((item) => item.id);
    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds }, branchId } });
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    for (const item of cart) {
      const dbProduct = productMap.get(item.id);
      if (!dbProduct) return res.status(404).json({ error: `Product not found: ${item.id}` });
      if (Number(item.qty) <= 0) return res.status(400).json({ error: `Invalid quantity for ${dbProduct.name}` });
      if (dbProduct.stock < Number(item.qty)) {
        return res.status(400).json({ error: `Insufficient stock for ${dbProduct.name}. Available: ${dbProduct.stock}` });
      }
    }

    const overrideRows = parseCartPriceOverrides(cart, productMap);
    const overrideMap = new Map(overrideRows.map((row) => [row.productId, row]));
    const grossSubTotal = cart.reduce((sum, item) => {
      const row = overrideMap.get(Number(item.id));
      const unit = Number(row?.appliedUnitPrice ?? productMap.get(item.id).price);
      return sum + unit * Number(item.qty);
    }, 0);
    const predefinedDiscount = cart.reduce((sum, item) => {
      const dbProduct = productMap.get(item.id);
      const row = overrideMap.get(Number(item.id));
      const unit = Number(row?.appliedUnitPrice ?? dbProduct.price);
      const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(dbProduct));
      return sum + perUnit * Number(item.qty);
    }, 0);
    const subTotal = Math.max(0, grossSubTotal - predefinedDiscount);
    const vatAmount = cart.reduce((sum, item) => {
      const dbProduct = productMap.get(item.id);
      const row = overrideMap.get(Number(item.id));
      const unit = Number(row?.appliedUnitPrice ?? dbProduct.price);
      const perUnitDiscount = Math.min(unit, getPerUnitPredefinedDiscount(dbProduct));
      const netUnitPrice = Math.max(0, unit - perUnitDiscount);
      return sum + (netUnitPrice * Number(item.qty) * Number(dbProduct.vatRate || 0)) / 100;
    }, 0);
    const manualDiscountType = discountType || (discount ? "AMOUNT" : "AMOUNT");
    if (!["PERCENT", "AMOUNT"].includes(manualDiscountType)) {
      return res.status(400).json({ error: "Discount type must be PERCENT or AMOUNT" });
    }
    const manualDiscountValue = Number(discountValue ?? discount ?? 0);
    if (manualDiscountValue < 0) return res.status(400).json({ error: "Discount cannot be negative" });
    if (manualDiscountType === "PERCENT" && manualDiscountValue > 100) {
      return res.status(400).json({ error: "Percent discount cannot exceed 100" });
    }
    const manualDiscountAmount = calculateManualDiscount(subTotal, manualDiscountType, manualDiscountValue);
    if (requiresManagerApproval(manualDiscountType, manualDiscountValue, manualDiscountAmount)) {
      if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_DISCOUNT",
          entity: "Sale",
          entityId: null,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for manual discount",
            amount: manualDiscountAmount,
            meta: { discountType: manualDiscountType, discountValue: manualDiscountValue },
          },
        });
        return res.status(403).json({ error: "Manager approval PIN required for this discount" });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_DISCOUNT",
        entity: "Sale",
        entityId: null,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved manual discount",
          amount: manualDiscountAmount,
          meta: { discountType: manualDiscountType, discountValue: manualDiscountValue },
        },
      });
    }
    const overrideApproval = requiresPriceOverrideApproval(overrideRows);
    if (overrideApproval.required) {
      if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_PRICE_OVERRIDE",
          entity: "Sale",
          entityId: null,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for line price override",
            amount: overrideApproval.totalReductionAmount,
            meta: {
              rows: overrideApproval.rowsNeedingApproval.map((x) => ({
                productId: x.productId,
                productName: x.productName,
                reductionPerUnit: x.reductionPerUnit,
                reductionPercent: x.reductionPercent,
              })),
            },
          },
        });
        return res.status(403).json({ error: "Manager approval PIN required for line price override" });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_PRICE_OVERRIDE",
        entity: "Sale",
        entityId: null,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved line price override",
          amount: overrideApproval.totalReductionAmount,
          meta: {
            rows: overrideApproval.rowsNeedingApproval.map((x) => ({
              productId: x.productId,
              productName: x.productName,
              reductionPerUnit: x.reductionPerUnit,
              reductionPercent: x.reductionPercent,
            })),
          },
        },
      });
    }
    let customerLoyaltyContext = null;
    const customerName = String(customer?.name || "").trim();
    const customerPhone = String(customer?.phone || "").trim();
    const hasCustomerIdentity = Boolean(customerName || customerPhone);
    let existingCustomerForLoyalty = null;
    if (hasCustomerIdentity) {
      existingCustomerForLoyalty = customerPhone
        ? await prisma.customer.findFirst({ where: { phone: customerPhone, branchId } })
        : await prisma.customer.findFirst({ where: { name: customerName, branchId } });
      if (existingCustomerForLoyalty) {
        customerLoyaltyContext = await buildCustomerLoyalty(prisma, branchId, existingCustomerForLoyalty.id);
      }
    }
    const tierDiscountPercent = getTierDiscountPercent(customerLoyaltyContext?.tier);
    const tierDiscountAmount = Math.max(0, (subTotal * tierDiscountPercent) / 100);
    const requestedRedeemPoints = Math.max(0, Number(redeemPoints || 0));
    if (requestedRedeemPoints > 0) {
      if (!customerPhone) {
        return res.status(400).json({ error: "Customer phone is required for loyalty redemption" });
      }
      const customerRow = existingCustomerForLoyalty;
      if (!customerRow) {
        return res.status(404).json({ error: "Customer not found for loyalty redemption" });
      }
      customerLoyaltyContext = customerLoyaltyContext || (await buildCustomerLoyalty(prisma, branchId, customerRow.id));
      if (requestedRedeemPoints > Number(customerLoyaltyContext?.points || 0)) {
        return res.status(400).json({ error: "Redeem points exceed available loyalty points" });
      }
    }
    const pointValue = getPointValueInCurrency();
    const redeemConfig = getLoyaltyRedeemConfig();
    const redeemDiscountAmount = requestedRedeemPoints * pointValue;
    const redeemCapAmount = (subTotal * redeemConfig.maxPercentOfBill) / 100;
    if (redeemDiscountAmount > redeemCapAmount) {
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_REDEMPTION",
        entity: "Sale",
        entityId: null,
        payload: {
          status: "REJECTED",
          reason: `Redeem amount exceeded cap ${redeemConfig.maxPercentOfBill}%`,
          amount: redeemDiscountAmount,
          meta: { requestedRedeemPoints, redeemCapAmount },
        },
      });
      return res.status(400).json({
        error: `Redeem discount cannot exceed ${redeemConfig.maxPercentOfBill}% of subtotal`,
      });
    }
    if (requestedRedeemPoints > redeemConfig.managerApprovalPoints) {
      if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_REDEMPTION",
          entity: "Sale",
          entityId: null,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for high redemption",
            amount: redeemDiscountAmount,
            meta: { requestedRedeemPoints },
          },
        });
        return res.status(403).json({ error: "Manager approval PIN required for high redemption" });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_REDEMPTION",
        entity: "Sale",
        entityId: null,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved high redemption",
          amount: redeemDiscountAmount,
          meta: { requestedRedeemPoints },
        },
      });
    }
    const discountAmount = Math.max(
      0,
      predefinedDiscount + manualDiscountAmount + tierDiscountAmount + redeemDiscountAmount
    );
    const total = Math.max(0, subTotal + vatAmount - discountAmount);
    const splitPayments = normalizePaymentBreakdown(paymentBreakdown);
    const splitPaidAmount = splitPayments.reduce((sum, line) => sum + line.amount, 0);
    const hasSplitPayments = splitPayments.length > 0;
    const finalPaidAmount = hasSplitPayments ? splitPaidAmount : Number(paidAmount ?? total);
    if (finalPaidAmount < 0) return res.status(400).json({ error: "Paid amount cannot be negative" });
    if (hasSplitPayments && splitPaidAmount > total) {
      return res.status(400).json({ error: "Total split payment cannot exceed bill total" });
    }
    const dueAmount = Math.max(0, total - finalPaidAmount);
    const notesPayload = {
      freeText: notes ? String(notes) : "",
      paymentBreakdown: splitPayments,
      loyalty: {
        tier: customerLoyaltyContext?.tier || "REGULAR",
        tierDiscountPercent,
        tierDiscountAmount,
        redeemedPoints: requestedRedeemPoints,
        redeemedAmount: redeemDiscountAmount,
      },
    };
    if (dueAmount > 0 && hasCustomerIdentity) {
      const existingForCredit = customerPhone
        ? await prisma.customer.findFirst({ where: { phone: customerPhone, branchId } })
        : await prisma.customer.findFirst({ where: { name: customerName, branchId } });
      if (existingForCredit) {
        const limit = Number(existingForCredit.creditLimit || 0);
        if (limit > 0) {
          const currentBal = Number(existingForCredit.balance || 0);
          const projected = currentBal + dueAmount;
          if (projected > limit + 0.005) {
            if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
              await writeAuditLog({
                userId: req.user?.id || null,
                action: "APPROVAL_CREDIT_LIMIT",
                entity: "Customer",
                entityId: existingForCredit.id,
                payload: {
                  status: "REJECTED",
                  reason: "Manager PIN missing/invalid for credit limit override",
                  amount: projected - limit,
                  meta: {
                    limit,
                    projected,
                    currentBalance: currentBal,
                    dueAmount,
                    customerId: existingForCredit.id,
                  },
                },
              });
              return res.status(403).json({
                error: `Credit limit (${limit.toFixed(
                  2
                )} BDT) would be exceeded (projected balance ${projected.toFixed(
                  2
                )}). Enter manager PIN on checkout, or reduce the due amount.`,
              });
            }
            await writeAuditLog({
              userId: req.user?.id || null,
              action: "APPROVAL_CREDIT_LIMIT",
              entity: "Customer",
              entityId: existingForCredit.id,
              payload: {
                status: "APPROVED",
                reason: "Manager PIN approved exceeding credit limit",
                amount: projected - limit,
                meta: {
                  limit,
                  projected,
                  currentBalance: currentBal,
                  dueAmount,
                  customerId: existingForCredit.id,
                },
              },
            });
          }
        }
      }
    }
    let resultSale = null;
    let loyaltySnapshot = null;

    await prisma.$transaction(async (tx) => {
      let customerId = null;
      if (dueAmount > 0 && !customerName) throw new Error("Customer name is required for due/baki sale");
      if (hasCustomerIdentity) {
        const existingCustomer = customerPhone
          ? await tx.customer.findFirst({ where: { phone: customerPhone, branchId } })
          : await tx.customer.findFirst({ where: { name: customerName, branchId } });
        if (existingCustomer) {
          if (dueAmount > 0) {
            await tx.customer.update({ where: { id: existingCustomer.id }, data: { balance: { increment: dueAmount } } });
          }
          customerId = existingCustomer.id;
        } else if (customerName) {
          const savedCustomer = await tx.customer.create({
            data: { branchId, name: customerName, phone: customerPhone || null, balance: dueAmount > 0 ? dueAmount : 0 },
          });
          customerId = savedCustomer.id;
        }
      }

      resultSale = await tx.sale.create({
        data: {
          branchId,
          cashierId: req.user?.id || null,
          invoiceNo: generateInvoiceNo(),
          subTotal,
          vatAmount,
          discount: discountAmount,
          total,
          paidAmount: finalPaidAmount,
          dueAmount,
          paymentMethod: hasSplitPayments ? "Split" : paymentMethod || "Cash",
          paymentChannel: hasSplitPayments ? "Multi" : paymentChannel || null,
          notes: JSON.stringify(notesPayload),
          customerId,
          items: {
            create: cart.map((item) => ({
              productId: item.id,
              qty: Number(item.qty),
              price: Number(overrideMap.get(Number(item.id))?.appliedUnitPrice ?? productMap.get(item.id).price),
              cost: Number(productMap.get(item.id).price),
            })),
          },
        },
        include: { items: true, customer: true },
      });

      for (const item of cart) {
        await tx.product.update({ where: { id: item.id }, data: { stock: { decrement: Number(item.qty) } } });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: item.id,
            refType: "SALE",
            refId: resultSale.id,
            outQty: Number(item.qty),
            unitCost: Number(productMap.get(item.id).price),
          },
        });
      }

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const cash = map.get("1100");
      const receivable = map.get("1200");
      const revenue = map.get("4100");
      const cogs = map.get("5100");
      const inventory = map.get("1300");
      if (cash && receivable && revenue && cogs && inventory) {
        const cogsAmount = cart.reduce(
          (sum, item) => sum + Number(productMap.get(item.id).price) * Number(item.qty),
          0
        );
        await tx.journal.create({
          data: {
            branchId,
            saleId: resultSale.id,
            createdBy: req.user?.id || null,
            refType: "SALE",
            refId: resultSale.id,
            narration: `Sale ${resultSale.invoiceNo || resultSale.id}`,
            lines: {
              create: [
                { accountId: cash.id, debit: finalPaidAmount, credit: 0 },
                { accountId: receivable.id, debit: dueAmount, credit: 0 },
                { accountId: revenue.id, debit: 0, credit: total },
                { accountId: cogs.id, debit: cogsAmount, credit: 0 },
                { accountId: inventory.id, debit: 0, credit: cogsAmount },
              ],
            },
          },
        });
      }
      if (customerId) {
        loyaltySnapshot = await buildCustomerLoyalty(tx, branchId, customerId);
      }

      if (holdCartAuditLogId != null && !Number.isNaN(holdCartAuditLogId)) {
        const holdRow = await tx.auditLog.findUnique({ where: { id: holdCartAuditLogId } });
        if (!holdRow || holdRow.action !== "POS_HOLD_CART" || holdRow.entity !== "HoldCart") {
          throw new Error("Invalid held cart reference");
        }
        if (Number(holdRow.payload?.branchId || 0) !== Number(branchId)) {
          throw new Error("Held cart belongs to another branch");
        }
        const st = String(holdRow.payload?.status || "OPEN");
        if (st !== "OPEN") {
          throw new Error("Held cart is no longer active");
        }
        const holderId = holdRow.userId != null ? Number(holdRow.userId) : null;
        const lastResumeBy =
          holdRow.payload?.lastResumeByUserId != null ? Number(holdRow.payload.lastResumeByUserId) : null;
        const actorId = req.user?.id != null ? Number(req.user.id) : null;
        const authorized =
          actorId != null && (actorId === holderId || actorId === lastResumeBy);
        if (!authorized) {
          throw new Error(
            "Resume this held cart on this session before checkout (or ask the cashier who opened it)"
          );
        }
        await tx.auditLog.update({
          where: { id: holdCartAuditLogId },
          data: {
            payload: {
              ...(holdRow.payload || {}),
              status: "COMPLETED",
              completedSaleId: resultSale.id,
              completedAt: new Date().toISOString(),
              completedByUserId: req.user?.id || null,
            },
          },
        });
      }

      if (quoteAuditLogId != null && !Number.isNaN(quoteAuditLogId)) {
        const quoteRow = await tx.auditLog.findUnique({ where: { id: quoteAuditLogId } });
        if (!quoteRow || quoteRow.action !== "POS_SALES_QUOTE" || quoteRow.entity !== "SalesQuote") {
          throw new Error("Invalid sales quote reference");
        }
        if (Number(quoteRow.payload?.branchId || 0) !== Number(branchId)) {
          throw new Error("Quote belongs to another branch");
        }
        const qs = resolveQuoteStatus(quoteRow.payload || {});
        if (qs !== "OPEN") {
          throw new Error("Sales quote is no longer open");
        }
        await tx.auditLog.update({
          where: { id: quoteAuditLogId },
          data: {
            payload: {
              ...(quoteRow.payload || {}),
              status: "CONVERTED",
              convertedSaleId: resultSale.id,
              convertedAt: new Date().toISOString(),
              convertedByUserId: req.user?.id || null,
            },
          },
        });
      }
    });

    const updatedProducts = await prisma.product.findMany({ where: { branchId }, orderBy: { createdAt: "desc" } });
    const io = getSocketInstance();
    if (io) {
      io.emit("sale:created", resultSale);
      io.emit("product:stock-updated", updatedProducts);
    }
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SALE_CREATE",
      entity: "Sale",
      entityId: resultSale.id,
      payload: { total, dueAmount },
    });
    res.json({ message: "Sale completed", sale: resultSale, loyalty: loyaltySnapshot });
  } catch (err) {
    if (err.message.includes("Customer name is required")) return res.status(400).json({ error: err.message });
    const holdCheckoutMsgs = [
      "Invalid held cart reference",
      "Held cart belongs to another branch",
      "Held cart is no longer active",
      "Resume this held cart on this session before checkout",
      "Invalid sales quote reference",
      "Quote belongs to another branch",
      "Sales quote is no longer open",
    ];
    if (holdCheckoutMsgs.some((m) => err.message.includes(m))) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.createHeldCart = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const payload = normalizeHeldCartPayload(req.body || {});
    if (!Array.isArray(payload.cart) || payload.cart.length === 0) {
      return res.status(400).json({ error: "Cannot hold empty cart" });
    }
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "POS_HOLD_CART",
        entity: "HoldCart",
        payload: {
          branchId,
          status: "OPEN",
          holdNote: payload.holdNote || "",
          draft: payload,
        },
      },
    });
    res.status(201).json({ id: created.id, message: "Cart held successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getHeldCarts = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const q = String(req.query.q || "").trim().toLowerCase();
    const logs = await prisma.auditLog.findMany({
      where: {
        action: "POS_HOLD_CART",
        entity: "HoldCart",
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const rows = logs
      .filter((log) => Number(log.payload?.branchId || 0) === Number(branchId))
      .filter((log) => !["DISCARDED", "COMPLETED"].includes(String(log.payload?.status || "OPEN")))
      .map((log) => {
        const draft = log.payload?.draft || {};
        return {
          id: log.id,
          heldByUserId: log.userId || null,
          heldByName: log.user?.name || log.user?.email || "",
          status: String(log.payload?.status || "OPEN"),
          holdNote: String(log.payload?.holdNote || ""),
          customerName: String(draft.customer?.name || ""),
          customerPhone: String(draft.customer?.phone || ""),
          cartCount: Array.isArray(draft.cart) ? draft.cart.length : 0,
          totalQty: Array.isArray(draft.cart)
            ? draft.cart.reduce((sum, x) => sum + Number(x.qty || 0), 0)
            : 0,
          createdAt: log.createdAt,
        };
      });
    const filtered = q
      ? rows.filter((row) =>
          [row.customerName, row.customerPhone, row.holdNote]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : rows;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.discardHeldCart = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid held cart id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_HOLD_CART" || row.entity !== "HoldCart") {
      return res.status(404).json({ error: "Held cart not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Held cart not found" });
    }
    const holdStatus = String(row.payload?.status || "OPEN");
    if (holdStatus === "DISCARDED") {
      return res.status(400).json({ error: "Held cart already discarded" });
    }
    if (holdStatus === "COMPLETED") {
      return res.status(400).json({ error: "Held cart already completed" });
    }
    const heldByUserId = row.userId != null ? Number(row.userId) : null;
    const actorId = req.user?.id != null ? Number(req.user.id) : null;
    const isOwnHold =
      heldByUserId != null && actorId != null && heldByUserId === actorId;
    const managerApprovalPin = req.body?.managerApprovalPin ?? req.query?.managerApprovalPin ?? "";
    if (!isOwnHold) {
      if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_HOLD_DISCARD",
          entity: "HoldCart",
          entityId: id,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for discarding another user's held cart",
            amount: 0,
            meta: { heldByUserId, holdCartAuditId: id },
          },
        });
        return res.status(403).json({
          error: "Manager approval PIN required to discard another cashier's held cart",
        });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_HOLD_DISCARD",
        entity: "HoldCart",
        entityId: id,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved discard of another user's held cart",
          amount: 0,
          meta: { heldByUserId, holdCartAuditId: id },
        },
      });
    }
    const updated = await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          status: "DISCARDED",
          discardedAt: new Date().toISOString(),
          discardedByUserId: req.user?.id || null,
          discardedWithManagerPin: !isOwnHold,
        },
      },
    });
    res.json({ id: updated.id, message: "Held cart discarded" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resumeHeldCart = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid held cart id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_HOLD_CART" || row.entity !== "HoldCart") {
      return res.status(404).json({ error: "Held cart not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Held cart not found" });
    }
    const resumeStatus = String(row.payload?.status || "OPEN");
    if (resumeStatus === "DISCARDED") {
      return res.status(400).json({ error: "Held cart was discarded" });
    }
    if (resumeStatus === "COMPLETED") {
      return res.status(400).json({ error: "Held cart was already completed" });
    }
    const rawDraft = row.payload?.draft || {};
    const draft = normalizeHeldCartPayload(rawDraft);
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return res.status(400).json({ error: "Held cart is empty" });
    }
    const heldByUserId = row.userId != null ? Number(row.userId) : null;
    const actorId = req.user?.id != null ? Number(req.user.id) : null;
    const isOwnHold =
      heldByUserId != null && actorId != null && heldByUserId === actorId;
    const managerApprovalPin = req.body?.managerApprovalPin ?? req.query?.managerApprovalPin ?? "";
    if (!isOwnHold) {
      if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
        await writeAuditLog({
          userId: req.user?.id || null,
          action: "APPROVAL_HOLD_RESUME",
          entity: "HoldCart",
          entityId: id,
          payload: {
            status: "REJECTED",
            reason: "Manager PIN missing/invalid for resuming another user's held cart",
            amount: 0,
            meta: { heldByUserId, holdCartAuditId: id },
          },
        });
        return res.status(403).json({
          error: "Manager approval PIN required to resume another cashier's held cart",
        });
      }
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_HOLD_RESUME",
        entity: "HoldCart",
        entityId: id,
        payload: {
          status: "APPROVED",
          reason: "Manager PIN approved resume of another user's held cart",
          amount: 0,
          meta: { heldByUserId, holdCartAuditId: id },
        },
      });
    }
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          lastResumeAt: new Date().toISOString(),
          lastResumeByUserId: req.user?.id || null,
          lastResumeManagerApproved: !isOwnHold,
        },
      },
    });
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createSalesQuote = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const draft = normalizeHeldCartPayload(req.body || {});
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return res.status(400).json({ error: "Cannot save an empty quote" });
    }
    const quoteNo = generateQuoteNo();
    const validUntil = getQuoteValidUntil();
    const note = String(req.body.quoteNote || req.body.note || "").trim();
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "POS_SALES_QUOTE",
        entity: "SalesQuote",
        payload: {
          branchId,
          status: "OPEN",
          quoteNo,
          validUntil: validUntil.toISOString(),
          note,
          draft,
        },
      },
    });
    res.status(201).json({ id: created.id, quoteNo, validUntil: validUntil.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listSalesQuotes = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const statusQ = req.query.status ? String(req.query.status).toUpperCase() : "";
    const reminderQ = req.query.reminder ? String(req.query.reminder).toUpperCase() : "";
    const logs = await prisma.auditLog.findMany({
      where: { action: "POS_SALES_QUOTE", entity: "SalesQuote" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const followUpDoneUserIds = [
      ...new Set(
        logs
          .map((log) => Number(log.payload?.followUpDoneByUserId || 0))
          .filter((id) => id > 0)
      ),
    ];
    const doneUsers = followUpDoneUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: followUpDoneUserIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const doneUserMap = new Map(doneUsers.map((u) => [u.id, u.name || u.email || `User#${u.id}`]));
    const rows = logs
      .filter((log) => Number(log.payload?.branchId || 0) === Number(branchId))
      .map((log) => {
        const d = log.payload?.draft || {};
        const doneByUserId = Number(log.payload?.followUpDoneByUserId || 0) || null;
        return {
          id: log.id,
          quoteNo: String(log.payload?.quoteNo || ""),
          status: resolveQuoteStatus(log.payload || {}),
          note: String(log.payload?.note || ""),
          validUntil: log.payload?.validUntil || null,
          followUpAt: log.payload?.followUpAt || null,
          followUpDoneAt: log.payload?.followUpDoneAt || null,
          followUpDoneByUserId: doneByUserId,
          followUpDoneByName: doneByUserId ? doneUserMap.get(doneByUserId) || "" : "",
          followUpStatus: isFollowUpDone(log.payload || {})
            ? "DONE"
            : computeReminderStatus(log.payload?.followUpAt || null),
          convertedSaleId: log.payload?.convertedSaleId || null,
          convertedAt: log.payload?.convertedAt || null,
          duplicatedFromQuoteId: log.payload?.duplicatedFromQuoteId || null,
          createdByUserId: log.userId,
          createdByName: log.user?.name || log.user?.email || "",
          customerName: String(d.customer?.name || ""),
          customerPhone: String(d.customer?.phone || ""),
          lineCount: Array.isArray(d.cart) ? d.cart.length : 0,
          createdAt: log.createdAt,
        };
      })
      .filter((r) => !statusQ || r.status === statusQ)
      .filter((r) => !reminderQ || r.followUpStatus === reminderQ);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setSalesQuoteFollowUp = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const followUpAtRaw = req.body?.followUpAt;
    const nextPayload = { ...(row.payload || {}) };
    if (!followUpAtRaw) {
      nextPayload.followUpAt = null;
      nextPayload.followUpByUserId = null;
      nextPayload.followUpUpdatedAt = new Date().toISOString();
      nextPayload.followUpDoneAt = null;
      nextPayload.followUpDoneByUserId = null;
    } else {
      const d = new Date(followUpAtRaw);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid follow up date" });
      }
      nextPayload.followUpAt = d.toISOString();
      nextPayload.followUpByUserId = req.user?.id || null;
      nextPayload.followUpUpdatedAt = new Date().toISOString();
      nextPayload.followUpDoneAt = null;
      nextPayload.followUpDoneByUserId = null;
    }
    await prisma.auditLog.update({
      where: { id },
      data: { payload: nextPayload },
    });
    res.json({
      id,
      followUpAt: nextPayload.followUpAt || null,
      followUpStatus: computeReminderStatus(nextPayload.followUpAt || null),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markSalesQuoteFollowUpDone = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const nextPayload = {
      ...(row.payload || {}),
      followUpDoneAt: new Date().toISOString(),
      followUpDoneByUserId: req.user?.id || null,
      followUpUpdatedAt: new Date().toISOString(),
    };
    await prisma.auditLog.update({
      where: { id },
      data: { payload: nextPayload },
    });
    res.json({
      id,
      followUpDoneAt: nextPayload.followUpDoneAt,
      followUpStatus: "DONE",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSalesQuoteReminderSummary = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const logs = await prisma.auditLog.findMany({
      where: { action: "POS_SALES_QUOTE", entity: "SalesQuote" },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const summary = { overdue: 0, today: 0, tomorrow: 0, upcoming: 0, done: 0 };
    logs
      .filter((log) => Number(log.payload?.branchId || 0) === Number(branchId))
      .forEach((log) => {
        const quoteStatus = resolveQuoteStatus(log.payload || {});
        if (quoteStatus !== "OPEN") return;
        if (isFollowUpDone(log.payload || {})) {
          summary.done += 1;
          return;
        }
        const s = computeReminderStatus(log.payload?.followUpAt || null);
        if (s === "OVERDUE") summary.overdue += 1;
        if (s === "TODAY") summary.today += 1;
        if (s === "TOMORROW") summary.tomorrow += 1;
        if (s === "UPCOMING") summary.upcoming += 1;
      });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.loadSalesQuoteDraft = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const qs = resolveQuoteStatus(row.payload || {});
    if (qs !== "OPEN") {
      if (qs === "EXPIRED") {
        await prisma.auditLog.update({
          where: { id },
          data: {
            payload: {
              ...(row.payload || {}),
              status: "EXPIRED",
              expiredAt: new Date().toISOString(),
            },
          },
        });
        return res.status(400).json({ error: "Quote expired. Create a new one or duplicate this quote." });
      }
      return res.status(400).json({ error: "Quote is not open" });
    }
    const rawDraft = row.payload?.draft || {};
    const draft = normalizeHeldCartPayload(rawDraft);
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return res.status(400).json({ error: "Quote has no lines" });
    }
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          lastOpenedAt: new Date().toISOString(),
          lastOpenedByUserId: req.user?.id || null,
        },
      },
    });
    res.json({ id: row.id, quoteNo: String(row.payload?.quoteNo || ""), draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancelSalesQuote = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const qs = resolveQuoteStatus(row.payload || {});
    if (qs !== "OPEN") {
      return res.status(400).json({ error: "Only open quotes can be cancelled" });
    }
    await prisma.auditLog.update({
      where: { id },
      data: {
        payload: {
          ...(row.payload || {}),
          status: "CANCELLED",
          cancelledAt: new Date().toISOString(),
          cancelledByUserId: req.user?.id || null,
        },
      },
    });
    res.json({ id, message: "Quote cancelled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.duplicateSalesQuote = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const draft = normalizeHeldCartPayload(row.payload?.draft || {});
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return res.status(400).json({ error: "Quote has no lines" });
    }
    const quoteNo = generateQuoteNo();
    const validUntil = getQuoteValidUntil();
    const baseNote = String(row.payload?.note || "").trim();
    const note = baseNote ? `${baseNote} (duplicate)` : "Duplicated quote";
    const created = await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: "POS_SALES_QUOTE",
        entity: "SalesQuote",
        payload: {
          branchId,
          status: "OPEN",
          quoteNo,
          validUntil: validUntil.toISOString(),
          note,
          draft,
          duplicatedFromQuoteId: id,
        },
      },
    });
    res.status(201).json({ id: created.id, quoteNo, validUntil: validUntil.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSalesQuotePdf = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid quote id" });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row || row.action !== "POS_SALES_QUOTE" || row.entity !== "SalesQuote") {
      return res.status(404).json({ error: "Quote not found" });
    }
    if (Number(row.payload?.branchId || 0) !== Number(branchId)) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const payload = row.payload || {};
    const draft = normalizeHeldCartPayload(payload.draft || {});
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return res.status(400).json({ error: "Quote has no lines" });
    }

    const quoteNo = String(payload.quoteNo || `QTE-${row.id}`);
    const quoteStatus = resolveQuoteStatus(payload);
    const validUntilRaw = payload.validUntil ? new Date(payload.validUntil) : null;
    const note = String(payload.note || "");
    const customerName = String(draft.customer?.name || "Walk-in");
    const customerPhone = String(draft.customer?.phone || "-");

    const lineRows = draft.cart.map((item, idx) => {
      const qty = Number(item.qty || 0);
      const basePrice = Number(item.price || 0);
      const override =
        item.overridePrice !== undefined && item.overridePrice !== null && String(item.overridePrice).trim() !== ""
          ? Number(item.overridePrice)
          : null;
      const unit = Number.isFinite(override) && override > 0 ? override : basePrice;
      const amount = unit * qty;
      return {
        sl: idx + 1,
        product: String(item.name || `Product#${item.id}`),
        qty: qty.toFixed(2),
        rate: unit.toFixed(2),
        amount: amount.toFixed(2),
      };
    });

    const subTotal = lineRows.reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const discountType = String(draft.discountType || "AMOUNT").toUpperCase();
    const discountValue = Number(draft.discountValue || 0);
    const discountAmount =
      discountType === "PERCENT" ? Math.max(0, (subTotal * discountValue) / 100) : Math.max(0, discountValue);
    const netTotal = Math.max(0, subTotal - discountAmount);

    const doc = new PDFDocument({ margin: 36, size: "A4", bufferPages: true });
    const filename = `quote-${quoteNo}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.font("Helvetica-Bold").fontSize(16).text("Sales Quotation / Proforma", { align: "center" });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Quote No: ${quoteNo}`);
    doc.text(`Status: ${quoteStatus}`);
    doc.text(`Date: ${new Date(row.createdAt).toLocaleString()}`);
    doc.text(
      `Valid Until: ${
        validUntilRaw && !Number.isNaN(validUntilRaw.getTime()) ? validUntilRaw.toLocaleString() : "-"
      }`
    );
    doc.text(`Customer: ${customerName}`);
    doc.text(`Phone: ${customerPhone}`);
    if (note) doc.text(`Note: ${note}`);
    doc.moveDown(0.8);

    const startX = 36;
    const tableWidth = 520;
    const cols = [
      { key: "sl", label: "#", width: 40 },
      { key: "product", label: "Product", width: 220 },
      { key: "qty", label: "Qty", width: 70 },
      { key: "rate", label: "Rate", width: 90 },
      { key: "amount", label: "Amount", width: 100 },
    ];
    let y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    let x = startX;
    cols.forEach((c) => {
      doc.text(c.label, x, y, { width: c.width, align: c.key === "product" ? "left" : "right" });
      x += c.width;
    });
    y += 16;
    doc.font("Helvetica").fontSize(10);
    lineRows.forEach((r) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      let cx = startX;
      cols.forEach((c) => {
        doc.text(String(r[c.key] ?? ""), cx, y, { width: c.width, align: c.key === "product" ? "left" : "right" });
        cx += c.width;
      });
      y += 14;
    });

    y += 8;
    doc.font("Helvetica-Bold");
    doc.text(`Subtotal: ${subTotal.toFixed(2)}`, startX, y, { align: "right", width: tableWidth });
    y += 14;
    doc.text(`Discount: ${discountAmount.toFixed(2)}`, startX, y, { align: "right", width: tableWidth });
    y += 14;
    doc.text(`Net Total: ${netTotal.toFixed(2)} BDT`, startX, y, { align: "right", width: tableWidth });
    y += 26;
    doc.font("Helvetica").fontSize(9);
    doc.text("This is a quotation/proforma only. Stock is not deducted until final checkout.", startX, y, {
      width: tableWidth,
      align: "left",
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLoyaltyRedemptionHistory = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const where = { branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    const sales = await prisma.sale.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });
    const rows = sales
      .map((sale) => {
        let notesPayload = {};
        try {
          notesPayload = JSON.parse(sale.notes || "{}");
        } catch {
          notesPayload = {};
        }
        const redeemedPoints = Number(notesPayload?.loyalty?.redeemedPoints || 0);
        const redeemedAmount = Number(notesPayload?.loyalty?.redeemedAmount || 0);
        const tier = String(notesPayload?.loyalty?.tier || "REGULAR");
        const tierDiscountAmount = Number(notesPayload?.loyalty?.tierDiscountAmount || 0);
        if (redeemedPoints <= 0 && tierDiscountAmount <= 0) return null;
        return {
          id: sale.id,
          invoiceNo: sale.invoiceNo || `Sale-${sale.id}`,
          customerName: sale.customer?.name || "-",
          customerPhone: sale.customer?.phone || "-",
          tier,
          redeemedPoints,
          redeemedAmount,
          tierDiscountAmount,
          total: sale.total,
          createdAt: sale.createdAt,
        };
      })
      .filter(Boolean);
    const summary = rows.reduce(
      (acc, row) => {
        acc.redeemedPoints += Number(row.redeemedPoints || 0);
        acc.redeemedAmount += Number(row.redeemedAmount || 0);
        acc.tierDiscountAmount += Number(row.tierDiscountAmount || 0);
        return acc;
      },
      { redeemedPoints: 0, redeemedAmount: 0, tierDiscountAmount: 0, count: rows.length }
    );
    res.json({ rows, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportLoyaltyRedemptionHistoryCSV = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const where = { branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    const sales = await prisma.sale.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" } });
    const rows = sales
      .map((sale) => {
        let notesPayload = {};
        try {
          notesPayload = JSON.parse(sale.notes || "{}");
        } catch {
          notesPayload = {};
        }
        const redeemedPoints = Number(notesPayload?.loyalty?.redeemedPoints || 0);
        const redeemedAmount = Number(notesPayload?.loyalty?.redeemedAmount || 0);
        const tier = String(notesPayload?.loyalty?.tier || "REGULAR");
        const tierDiscountAmount = Number(notesPayload?.loyalty?.tierDiscountAmount || 0);
        if (redeemedPoints <= 0 && tierDiscountAmount <= 0) return null;
        return {
          sale_id: sale.id,
          invoice_no: sale.invoiceNo || "",
          customer: sale.customer?.name || "",
          phone: sale.customer?.phone || "",
          tier,
          redeemed_points: redeemedPoints,
          redeemed_amount: redeemedAmount.toFixed(2),
          tier_discount_amount: tierDiscountAmount.toFixed(2),
          total: Number(sale.total || 0).toFixed(2),
          date: sale.createdAt.toISOString(),
        };
      })
      .filter(Boolean);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="loyalty-redemption-history.csv"');
    res.send(toCSV(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportLoyaltyRedemptionHistoryPDF = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const where = { branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    const sales = await prisma.sale.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" } });
    const rows = sales
      .map((sale) => {
        let notesPayload = {};
        try {
          notesPayload = JSON.parse(sale.notes || "{}");
        } catch {
          notesPayload = {};
        }
        const redeemedPoints = Number(notesPayload?.loyalty?.redeemedPoints || 0);
        const redeemedAmount = Number(notesPayload?.loyalty?.redeemedAmount || 0);
        const tier = String(notesPayload?.loyalty?.tier || "REGULAR");
        if (redeemedPoints <= 0 && Number(notesPayload?.loyalty?.tierDiscountAmount || 0) <= 0) return null;
        return {
          invoiceNo: sale.invoiceNo || `Sale-${sale.id}`,
          customer: sale.customer?.name || "-",
          tier,
          points: redeemedPoints,
          amount: redeemedAmount.toFixed(2),
          date: new Date(sale.createdAt).toLocaleString(),
        };
      })
      .filter(Boolean);
    writePdfTableReport(
      res,
      "Loyalty Redemption History",
      [
        { key: "invoiceNo", label: "Invoice" },
        { key: "customer", label: "Customer" },
        { key: "tier", label: "Tier" },
        { key: "points", label: "Points" },
        { key: "amount", label: "Amount" },
        { key: "date", label: "Date" },
      ],
      rows,
      "loyalty-redemption-history.pdf"
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportLoyaltyRedemptionHistoryXLSX = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const where = { branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    const sales = await prisma.sale.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" } });
    const rows = sales
      .map((sale) => {
        let notesPayload = {};
        try {
          notesPayload = JSON.parse(sale.notes || "{}");
        } catch {
          notesPayload = {};
        }
        const redeemedPoints = Number(notesPayload?.loyalty?.redeemedPoints || 0);
        const redeemedAmount = Number(notesPayload?.loyalty?.redeemedAmount || 0);
        const tier = String(notesPayload?.loyalty?.tier || "REGULAR");
        const tierDiscountAmount = Number(notesPayload?.loyalty?.tierDiscountAmount || 0);
        if (redeemedPoints <= 0 && tierDiscountAmount <= 0) return null;
        return {
          SaleID: sale.id,
          Invoice: sale.invoiceNo || `Sale-${sale.id}`,
          Customer: sale.customer?.name || "-",
          Phone: sale.customer?.phone || "-",
          Tier: tier,
          RedeemedPoints: redeemedPoints,
          RedeemedAmount: redeemedAmount.toFixed(2),
          TierDiscountAmount: tierDiscountAmount.toFixed(2),
          Total: Number(sale.total || 0).toFixed(2),
          Date: sale.createdAt.toISOString(),
        };
      })
      .filter(Boolean);
    sendXlsx(res, rows, "loyalty-redemption-history.xlsx", "LoyaltyRedemptions");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saleReturn = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) return res.status(400).json({ error: "Invalid sale id" });
    const { items, reason, managerApprovalPin } = req.body;
    if (String(managerApprovalPin || "") !== getManagerApprovalPin()) {
      await writeAuditLog({
        userId: req.user?.id || null,
        action: "APPROVAL_RETURN",
        entity: "SaleReturn",
        entityId: saleId,
        payload: {
          status: "REJECTED",
          reason: "Manager PIN missing/invalid for return",
          amount: 0,
        },
      });
      return res.status(403).json({ error: "Manager approval PIN required for return" });
    }
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "APPROVAL_RETURN",
      entity: "SaleReturn",
      entityId: saleId,
      payload: {
        status: "APPROVED",
        reason: "Manager PIN approved return",
        amount: 0,
      },
    });
    const sale = await prisma.sale.findFirst({ where: { id: saleId, branchId }, include: { items: true } });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Return items required" });

    const created = await prisma.$transaction(async (tx) => {
      let amount = 0;
      const returnRows = [];
      for (const item of items) {
        const original = sale.items.find((x) => x.productId === Number(item.productId));
        if (!original) throw new Error("Return item not found in sale");
        const qty = Number(item.qty);
        if (qty <= 0 || qty > original.qty) throw new Error("Invalid return qty");
        const lineAmount = qty * Number(original.price);
        amount += lineAmount;
        returnRows.push({ productId: Number(item.productId), qty, amount: lineAmount });
        await tx.product.update({ where: { id: Number(item.productId) }, data: { stock: { increment: qty } } });
        await tx.stockLedger.create({
          data: { branchId, productId: Number(item.productId), refType: "SALE_RETURN", refId: saleId, inQty: qty, unitCost: original.price },
        });
      }

      const saleReturn = await tx.saleReturn.create({
        data: { saleId, amount, reason: reason || null, items: { create: returnRows } },
      });
      return saleReturn;
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SALE_RETURN_CREATE",
      entity: "SaleReturn",
      entityId: created.id,
      payload: { saleId, amount: created.amount },
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRecentSales = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const sales = await prisma.sale.findMany({
      where: { branchId },
      include: { customer: true, items: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todaySales = await prisma.sale.findMany({ where: { branchId, createdAt: { gte: start, lt: end } } });
    const summary = todaySales.reduce(
      (acc, sale) => {
        acc.totalSales += sale.total;
        acc.totalPaid += sale.paidAmount;
        acc.totalDue += sale.dueAmount;
        acc.totalVat += sale.vatAmount;
        return acc;
      },
      { totalSales: 0, totalPaid: 0, totalDue: 0, totalVat: 0, billCount: todaySales.length }
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTodaySettlement = async (req, res) => {
  try {
    const settlement = await buildSettlementFromRequest(req);
    res.json(settlement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportTodaySettlementMethodCSV = async (req, res) => {
  try {
    await exportSettlementMethodCSV(req, res, "today-settlement-by-method.csv");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportTodaySettlementChannelCSV = async (req, res) => {
  try {
    await exportSettlementChannelCSV(req, res, "today-settlement-by-channel.csv");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportTodaySettlementMethodPDF = async (req, res) => {
  try {
    await exportSettlementMethodPDF(req, res, "Settlement By Method", "today-settlement-by-method.pdf");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportTodaySettlementChannelPDF = async (req, res) => {
  try {
    await exportSettlementChannelPDF(req, res, "Settlement By Channel", "today-settlement-by-channel.pdf");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSaleInvoice = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid sale id" });
    const sale = await prisma.sale.findFirst({
      where: { id, branchId },
      include: { customer: true, items: { include: { product: true } } },
    });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};