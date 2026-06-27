const prisma = require("../utils/prisma");
const { formatSaleLineQty, getBillingUnitsForLine } = require("../utils/saleUnitFormat");
const { dispatchBranchWebhooks } = require("../utils/webhooks");
const { getSocketInstance } = require("../socket");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../utils/fiscal");
const { writeAuditLog } = require("../utils/audit");
const { generateMushak63 } = require("../modules/nbr/mushak63");
const { getPaymentSession, verifyPayment, refundPayment, isMfsMethod } = require("../modules/payments/mfsPaymentService");
const { submitSaleToEfd } = require("../modules/efd/efdService");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const {
  getLatestLandedCostByProduct,
  resolveSaleLineUnitCost,
  executeFefoPlan,
} = require("../utils/costingUtil");
const {
  loadBranchLoyaltyBonusMap,
  getCategoryMultiplier,
  pointsFromLineRevenue,
} = require("../utils/loyaltyAisleBonus");
const { buildCustomerLoyaltyBalance } = require("../utils/loyaltyPointsExpiry");
const { sendSms, renderSmsTemplate } = require("../utils/smsGateway");
const { recordCreditLedgerEntry, customerHasKyc } = require("../utils/bakirKhata");
const { validateImei } = require("../utils/imei");
const { resolveImeiAvailability } = require("../modules/imei/imeiController");

const DUE_SALE_SMS_TEMPLATE =
  "প্রিয় {name}, {store} এ ইনভয়েস {invoice} এ ৳{due} বকেয়া রেকর্ড হয়েছে। ধন্যবাদ।";

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

function validateCouponForSubtotal(couponRow, subTotal) {
  if (!couponRow) throw new Error("Invalid coupon");
  const now = new Date();
  if (!couponRow.isActive) throw new Error("Coupon inactive");
  if (couponRow.startsAt && new Date(couponRow.startsAt) > now) {
    throw new Error("Coupon not active yet");
  }
  if (couponRow.endsAt && new Date(couponRow.endsAt) < now) {
    throw new Error("Coupon expired");
  }
  const minBasket = Number(couponRow.minBasketAmount || 0);
  if (Number(subTotal || 0) + 0.0001 < minBasket) {
    throw new Error(`Coupon requires minimum basket ${minBasket.toFixed(2)} BDT`);
  }
  const maxRed = Number(couponRow.maxRedemptions || 0);
  if (maxRed > 0 && Number(couponRow.redemptionCount || 0) >= maxRed) {
    throw new Error("Coupon redemption limit reached");
  }
}

function computeCouponAmount(couponRow, subTotal) {
  const dtype = String(couponRow.discountType || "PERCENT").toUpperCase();
  let amt =
    dtype === "PERCENT"
      ? (Number(subTotal || 0) * Number(couponRow.discountValue || 0)) / 100
      : Number(couponRow.discountValue || 0);
  return Math.min(Math.max(0, amt), Number(subTotal || 0));
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

function getCartLineBillingUnits(item, dbProduct) {
  if (!dbProduct) return 0;
  if (dbProduct.sellByWeight) return Math.max(0, Number(item.weightKg || 0));
  return Math.max(0, Number(item.qty || 0));
}

function parseCartPriceOverrides(cart, productMap, variantMap = new Map()) {
  const rows = [];
  cart.forEach((item, lineIndex) => {
    const dbProduct = productMap.get(Number(item.id));
    if (!dbProduct) {
      throw new Error(`Unknown product ${item.id}`);
    }
    const vid = Number(item.variantId || 0) || null;
    const variant = vid ? variantMap.get(vid) : null;
    if (vid && (!variant || variant.productId !== dbProduct.id)) {
      throw new Error(`Variant ${vid} invalid for ${dbProduct.name}`);
    }
    const billingUnits = getCartLineBillingUnits(item, dbProduct);
    if (!dbProduct.sellByWeight && Number(item.weightKg ?? 0) > 1e-9) {
      throw new Error(`Weight not allowed on ${dbProduct.name} (not marked sell-by-KG)`);
    }
    const qtyPieces = Math.max(dbProduct.sellByWeight ? 1 : 1, Number(item.qty || 1));

    let baseUnitPrice =
      variant && variant.priceOverride != null ? Number(variant.priceOverride) : Number(dbProduct.price || 0);
    baseUnitPrice = Math.max(0, baseUnitPrice);

    const productLabel =
      variant && String(variant.label || "").trim()
        ? `${dbProduct.name} (${String(variant.label).trim()})`
        : dbProduct.name;

    const rawOverride = item.overridePrice;
    const hasOverride =
      rawOverride !== undefined && rawOverride !== null && String(rawOverride).trim() !== "";
    if (!hasOverride) {
      rows.push({
        lineIndex,
        productId: Number(item.id),
        variantId: vid,
        productName: productLabel,
        qty: qtyPieces,
        billingUnits,
        baseUnitPrice,
        appliedUnitPrice: baseUnitPrice,
        overrideUnitPrice: null,
        reductionPerUnit: 0,
        reductionPercent: 0,
      });
      return;
    }
    const overrideUnitPrice = Number(rawOverride);
    if (!Number.isFinite(overrideUnitPrice) || overrideUnitPrice <= 0) {
      throw new Error(`Invalid override price for ${dbProduct.name}`);
    }
    const appliedUnitPrice = overrideUnitPrice;
    const reductionPerUnit = Math.max(0, baseUnitPrice - appliedUnitPrice);
    const reductionPercent = baseUnitPrice > 0 ? (reductionPerUnit / baseUnitPrice) * 100 : 0;
    rows.push({
      lineIndex,
      productId: Number(item.id),
      variantId: vid,
      productName: productLabel,
      qty: qtyPieces,
      billingUnits,
      baseUnitPrice,
      appliedUnitPrice,
      overrideUnitPrice,
      reductionPerUnit,
      reductionPercent,
    });
  });
  return rows;
}

function requiresPriceOverrideApproval(overrideRows) {
  const thresholds = getPriceOverrideThresholds();
  const rowsNeedingApproval = overrideRows.filter(
    (row) =>
      row.overrideUnitPrice != null &&
      (Number(row.reductionPercent || 0) > thresholds.percent ||
        Number(row.reductionPerUnit || 0) > thresholds.amount)
  );
  const totalReductionAmount = overrideRows.reduce(
    (sum, row) =>
      sum + Number(row.reductionPerUnit || 0) * Number(row.billingUnits ?? row.qty ?? 0),
    0
  );
  return {
    required: rowsNeedingApproval.length > 0,
    rowsNeedingApproval,
    totalReductionAmount,
  };
}

function cartLineRetailSubtotal(item, lineIndex, productMap, variantMap, overrideMap) {
  const p = productMap.get(Number(item.id));
  if (!p) return 0;
  const vid = Number(item.variantId || 0) || null;
  const variant = vid ? variantMap.get(vid) : null;
  const base =
    variant && variant.priceOverride != null ? Number(variant.priceOverride) : Number(p.price || 0);
  const row = overrideMap.get(lineIndex);
  const applied = Number(row?.appliedUnitPrice ?? base);
  return applied * getCartLineBillingUnits(item, p);
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

async function computeEarnedPointsFromSaleItems(tx, branchId, customerId, bonusMap) {
  const sales = await tx.sale.findMany({
    where: { branchId, customerId },
    select: { id: true },
  });
  if (!sales.length) return 0;
  const { pointsPer100 } = getLoyaltyConfig();
  const items = await tx.saleItem.findMany({
    where: { saleId: { in: sales.map((s) => s.id) } },
    select: {
      qty: true,
      weightKg: true,
      price: true,
      product: { select: { category: true } },
    },
  });
  let points = 0;
  for (const item of items) {
    const bill =
      Number(item.weightKg || 0) > 1e-9 ? Number(item.weightKg || 0) : Number(item.qty || 0);
    const revenue = bill * Number(item.price || 0);
    const mult = getCategoryMultiplier(bonusMap, item.product?.category);
    points += pointsFromLineRevenue(revenue, pointsPer100, mult);
  }
  return Math.floor(points);
}

function computeCartEarnedPoints(cart, productMap, bonusMap) {
  const { pointsPer100 } = getLoyaltyConfig();
  let points = 0;
  for (const item of cart || []) {
    const prod = productMap.get(Number(item.id));
    const bill =
      Number(item.weightKg || 0) > 1e-9
        ? Number(item.weightKg || 0)
        : Number(item.qty || item.quantity || 0);
    const price = Number(item.price || prod?.price || 0);
    const revenue = bill * price;
    const mult = getCategoryMultiplier(bonusMap, prod?.category || item.category);
    points += pointsFromLineRevenue(revenue, pointsPer100, mult);
  }
  return Math.floor(points);
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
  const balance = await buildCustomerLoyaltyBalance(tx, branchId, customerId);
  return {
    customerId,
    customerName: customer.name,
    totalSpent: balance.totalSpent,
    points: balance.availablePoints,
    earnedPoints: balance.earnedPoints,
    redeemedPoints: balance.redeemedPoints,
    expiredPoints: balance.expiredPoints,
    expiringSoonPoints: balance.expiringSoonPoints,
    pointsExpiryDays: balance.pointsExpiryDays,
    tier: getTierFromPoints(balance.earnedPoints),
    orders: balance.orders,
    aisleBonusActive: balance.aisleBonusActive,
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

function normalizeGiftCardRedemptions(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => ({
      code: String(x?.code || "")
        .trim()
        .toUpperCase(),
      amount: x?.amount != null && x?.amount !== "" ? Number(x.amount) : null,
    }))
    .filter((x) => x.code);
}

function getSaleNotesMaxLength() {
  return Math.max(80, Number(process.env.SALE_NOTES_MAX_LENGTH || 240));
}

function sanitizeSaleNotesPayload(notesPayload = {}, maxLen = getSaleNotesMaxLength()) {
  const base = {
    freeText: String(notesPayload?.freeText || "").slice(0, 500),
    paymentBreakdown: Array.isArray(notesPayload?.paymentBreakdown)
      ? notesPayload.paymentBreakdown.slice(0, 8).map((line) => ({
          method: String(line?.method || "").slice(0, 20),
          amount: Number(line?.amount || 0),
          channel: String(line?.channel || "").slice(0, 60),
        }))
      : [],
    loyalty: notesPayload?.loyalty || {},
    promotions: {
      discountAmount: Number(notesPayload?.promotions?.discountAmount || 0),
      applied: Array.isArray(notesPayload?.promotions?.applied)
        ? notesPayload.promotions.applied.slice(0, 8).map((x) => ({
            ruleId: Number(x?.ruleId || 0),
            type: String(x?.type || "").slice(0, 30),
            name: String(x?.name || "").slice(0, 60),
            amount: Number(x?.amount || 0),
          }))
        : [],
    },
    antiFraud: {
      managerApprovalPinUsed: Boolean(notesPayload?.antiFraud?.managerApprovalPinUsed),
      approvalReason: notesPayload?.antiFraud?.approvalReason
        ? String(notesPayload.antiFraud.approvalReason).slice(0, 250)
        : null,
    },
    storedValue: Array.isArray(notesPayload?.storedValue?.gifts)
      ? {
          gifts: notesPayload.storedValue.gifts.slice(0, 6).map((g) => ({
            code: String(g?.code || "").slice(0, 24),
            amount: Number(g?.amount || 0),
          })),
          wallet: Number(notesPayload.storedValue.wallet || 0),
        }
      : undefined,
    coupon:
      notesPayload?.coupon && typeof notesPayload.coupon === "object" && notesPayload.coupon.code
        ? {
            couponCodeId: Number(notesPayload.coupon.couponCodeId || 0),
            code: String(notesPayload.coupon.code || "").slice(0, 32),
            discount: Number(notesPayload.coupon.discount || 0),
          }
        : undefined,
    restaurant:
      notesPayload?.restaurant && typeof notesPayload.restaurant === "object"
        ? {
            serviceMode: String(notesPayload.restaurant.serviceMode || "").slice(0, 16),
            tableId:
              notesPayload.restaurant.tableId != null ? Number(notesPayload.restaurant.tableId) : null,
            tableName: notesPayload.restaurant.tableName
              ? String(notesPayload.restaurant.tableName).slice(0, 64)
              : null,
          }
        : undefined,
  };

  let serialized = JSON.stringify(base);
  if (serialized.length <= maxLen) return serialized;

  // Progressive fallback to keep JSON valid under strict DB limits.
  base.promotions.applied = [];
  serialized = JSON.stringify(base);
  if (serialized.length <= maxLen) return serialized;

  base.paymentBreakdown = [];
  serialized = JSON.stringify(base);
  if (serialized.length <= maxLen) return serialized;

  base.freeText = base.freeText.slice(0, 40);
  serialized = JSON.stringify(base);
  if (serialized.length <= maxLen) return serialized;

  const compact = JSON.stringify({
    freeText: base.freeText,
    d: Number(base.promotions.discountAmount || 0),
    a: base.antiFraud?.approvalReason ? String(base.antiFraud.approvalReason).slice(0, 24) : null,
  });
  if (compact.length <= maxLen) return compact;

  const tiny = JSON.stringify({ d: Number(base.promotions.discountAmount || 0) });
  if (tiny.length <= maxLen) return tiny;

  // Absolute last resort for very small varchar columns.
  return "{}";
}

async function nextMushakDocumentNo(tx, branchId) {
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { code: true } });
  const now = new Date();
  const periodKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const scope = "MUSHAK_VAT";
  const existing = await tx.branchDocumentSeq.findUnique({
    where: { branchId_scope_periodKey: { branchId, scope, periodKey } },
  });
  let nextVal = 1;
  if (existing) {
    nextVal = Number(existing.lastValue || 0) + 1;
    await tx.branchDocumentSeq.update({
      where: { id: existing.id },
      data: { lastValue: nextVal },
    });
  } else {
    await tx.branchDocumentSeq.create({
      data: { branchId, scope, periodKey, lastValue: 1 },
    });
  }
  const code = String(branch?.code || branchId).replace(/\s+/g, "");
  return `MS-${code}-${periodKey}-${String(nextVal).padStart(5, "0")}`;
}

function buildVatBreakdownSnapshot(cart, productMap, overrideMap, variantMap) {
  const rows = [];
  (cart || []).forEach((item, idx) => {
    const p = productMap.get(Number(item.id));
    if (!p) return;
    const vid = Number(item.variantId || 0) || null;
    const variant = vid ? variantMap.get(vid) : null;
    const displayName =
      variant && String(variant.label || "").trim()
        ? `${p.name} (${String(variant.label).trim()})`
        : p.name;

    const row = overrideMap.get(idx);
    const unit = Number(row?.appliedUnitPrice ?? p.price);
    const perUnitDisc = Math.min(unit, getPerUnitPredefinedDiscount(p));
    const netUnit = Math.max(0, unit - perUnitDisc);
    const bill = getCartLineBillingUnits(item, p);
    const lineNet = netUnit * bill;
    const rate = Number(p.vatRate || 0);
    const sdRate = Number(p.sdRate || 0);
    const lineSd = (lineNet * sdRate) / 100;
    const lineVat = ((lineNet + lineSd) * rate) / 100;
    rows.push({
      productId: p.id,
      name: displayName,
      nameBn: p.nameBn || null,
      hsCode: p.hsCode || null,
      unit:
        (item.saleUnit && String(item.saleUnit).trim()) ||
        p.saleUnit ||
        p.unitOfMeasure ||
        (p.sellByWeight ? "KG" : "PCS"),
      qty: bill,
      sellByWeight: Boolean(p.sellByWeight),
      weightKg: p.sellByWeight ? Number(item.weightKg || bill) : null,
      variantId: vid || null,
      netAmount: Math.round(lineNet * 100) / 100,
      sdRate,
      sdAmount: Math.round(lineSd * 100) / 100,
      vatRate: rate,
      vatAmount: Math.round(lineVat * 100) / 100,
    });
  });
  return rows;
}

function isDigitalMethod(method) {
  return ["BKASH", "NAGAD", "ROCKET", "UPAY", "CARD"].includes(String(method || "").toUpperCase());
}

function isCodMethod(method) {
  return String(method || "").toUpperCase() === "COD";
}

function isPromotionActiveNow(rule, now = new Date()) {
  if (!rule?.isActive) return false;
  if (rule.startsAt && new Date(rule.startsAt) > now) return false;
  if (rule.endsAt && new Date(rule.endsAt) < now) return false;
  return true;
}

function computePromotionDiscount({ activePromotions, cart, productMap, overrideMap, subTotal }) {
  let discount = 0;
  const applied = [];
  const productQtyMap = new Map();
  for (let idx = 0; idx < (cart || []).length; idx += 1) {
    const item = cart[idx];
    const pid = Number(item.id);
    const dbProduct = productMap.get(pid);
    if (!dbProduct) continue;
    const bill = getCartLineBillingUnits(item, dbProduct);
    productQtyMap.set(pid, (productQtyMap.get(pid) || 0) + bill);
  }

  function averageUnitAcrossLines(productId) {
    let sum = 0;
    let billTotal = 0;
    cart.forEach((item, idx) => {
      if (Number(item.id) !== productId) return;
      const dbProduct = productMap.get(productId);
      if (!dbProduct) return;
      const u = Number((overrideMap.get(idx)?.appliedUnitPrice ?? dbProduct.price) || 0);
      const b = getCartLineBillingUnits(item, dbProduct);
      sum += u * b;
      billTotal += b;
    });
    return billTotal > 0 ? sum / billTotal : Number(productMap.get(productId)?.price || 0);
  }

  for (const rule of activePromotions) {
    if (rule.type === "CART_PERCENT") {
      const minBasketAmount = Number(rule.minBasketAmount || 0);
      const pct = Number(rule.discountValue || 0);
      if (pct <= 0) continue;
      if (subTotal < minBasketAmount) continue;
      const amount = (subTotal * pct) / 100;
      if (amount <= 0) continue;
      discount += amount;
      applied.push({ ruleId: rule.id, type: rule.type, name: rule.name, amount });
      continue;
    }

    if (rule.type === "CATEGORY_PERCENT") {
      const pct = Number(rule.discountValue || 0);
      const category = String(rule.category || "").trim().toLowerCase();
      if (pct <= 0 || !category) continue;
      let matchedSubtotal = 0;
      cart.forEach((item, idx) => {
        const dbProduct = productMap.get(Number(item.id));
        if (!dbProduct) return;
        if (String(dbProduct.category || "").trim().toLowerCase() !== category) return;
        const unit = Number((overrideMap.get(idx)?.appliedUnitPrice ?? dbProduct.price) || 0);
        matchedSubtotal += unit * getCartLineBillingUnits(item, dbProduct);
      });
      if (matchedSubtotal <= 0) continue;
      const amount = (matchedSubtotal * pct) / 100;
      if (amount <= 0) continue;
      discount += amount;
      applied.push({ ruleId: rule.id, type: rule.type, name: rule.name, amount });
      continue;
    }

    if (rule.type === "PRODUCT_PERCENT") {
      const pct = Number(rule.discountValue || 0);
      const productId = Number(rule.productId || 0);
      if (pct <= 0 || !productId) continue;
      const matchedItem = cart.find((item) => Number(item.id) === productId);
      if (!matchedItem) continue;
      const dbProduct = productMap.get(productId);
      if (!dbProduct) continue;
      let matchedSubtotal = 0;
      cart.forEach((item, idx) => {
        if (Number(item.id) !== productId) return;
        const unit = Number((overrideMap.get(idx)?.appliedUnitPrice ?? dbProduct.price) || 0);
        matchedSubtotal += unit * getCartLineBillingUnits(item, dbProduct);
      });
      if (matchedSubtotal <= 0) continue;
      const amount = (matchedSubtotal * pct) / 100;
      if (amount <= 0) continue;
      discount += amount;
      applied.push({ ruleId: rule.id, type: rule.type, name: rule.name, amount });
      continue;
    }

    if (rule.type === "BOGO_PRODUCT") {
      const productId = Number(rule.productId || 0);
      const buyQty = Math.max(1, Number(rule.buyQty || 1));
      const getQty = Math.max(1, Number(rule.getQty || 1));
      if (!productId) continue;
      const qty = Number(productQtyMap.get(productId) || 0);
      if (qty < buyQty) continue;
      const freeQty = Math.floor(qty / buyQty) * getQty;
      if (freeQty <= 0) continue;
      const dbProduct = productMap.get(productId);
      if (!dbProduct) continue;
      const unit = averageUnitAcrossLines(productId);
      const amount = Math.max(0, Math.min(qty, freeQty) * unit);
      if (amount <= 0) continue;
      discount += amount;
      applied.push({ ruleId: rule.id, type: rule.type, name: rule.name, amount, freeQty });
    }

    if (rule.type === "BUNDLE_FIXED") {
      const bundlePrice = Number(rule.bundlePrice || rule.discountValue || 0);
      const bundleIds = String(rule.bundleProductIds || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => !Number.isNaN(x) && x > 0);
      if (bundleIds.length < 2 || bundlePrice <= 0) continue;
      const bundleCount = bundleIds.reduce((minCount, pid) => {
        const bill = Number(productQtyMap.get(pid) || 0);
        return Math.min(minCount, Math.floor(bill + 1e-9));
      }, Number.MAX_SAFE_INTEGER);
      if (!Number.isFinite(bundleCount) || bundleCount <= 0) continue;
      let regularBundlePrice = 0;
      for (const pid of bundleIds) {
        const dbProduct = productMap.get(pid);
        if (!dbProduct) {
          regularBundlePrice = 0;
          break;
        }
        const unit = averageUnitAcrossLines(pid);
        regularBundlePrice += unit;
      }
      if (regularBundlePrice <= 0 || regularBundlePrice <= bundlePrice) continue;
      const amount = (regularBundlePrice - bundlePrice) * bundleCount;
      if (amount <= 0) continue;
      discount += amount;
      applied.push({
        ruleId: rule.id,
        type: rule.type,
        name: rule.name,
        amount,
        bundleCount,
      });
    }

    if (rule.type === "CATEGORY_BUNDLE_FIXED") {
      const bundleSize = Math.max(2, Number(rule.buyQty || 2));
      const bundlePrice = Number(rule.bundlePrice || rule.discountValue || 0);
      const category = String(rule.category || "").trim().toLowerCase();
      if (!category || bundlePrice <= 0) continue;
      const categoryItems = [];
      for (let ci = 0; ci < (cart || []).length; ci += 1) {
        const item = cart[ci];
        const dbProduct = productMap.get(Number(item.id));
        if (!dbProduct) continue;
        if (String(dbProduct.category || "").trim().toLowerCase() !== category) continue;
        const unit = Number((overrideMap.get(ci)?.appliedUnitPrice ?? dbProduct.price) || 0);
        const bill = getCartLineBillingUnits(item, dbProduct);
        const wholeSlots = Math.max(0, Math.floor(Number(bill) + 1e-9));
        for (let i = 0; i < wholeSlots; i += 1) {
          categoryItems.push(unit);
        }
      }
      if (categoryItems.length < bundleSize) continue;
      categoryItems.sort((a, b) => b - a);
      const bundleCount = Math.floor(categoryItems.length / bundleSize);
      if (bundleCount <= 0) continue;
      let amount = 0;
      for (let i = 0; i < bundleCount; i += 1) {
        const start = i * bundleSize;
        const regular = categoryItems.slice(start, start + bundleSize).reduce((sum, x) => sum + Number(x || 0), 0);
        if (regular > bundlePrice) {
          amount += regular - bundlePrice;
        }
      }
      if (amount <= 0) continue;
      discount += amount;
      applied.push({
        ruleId: rule.id,
        type: rule.type,
        name: rule.name,
        amount,
        bundleCount,
        bundleSize,
      });
    }

    if (rule.type === "MIX_MATCH_FIXED") {
      const bundleSize = Math.max(2, Number(rule.buyQty || 2));
      const bundlePrice = Number(rule.bundlePrice || rule.discountValue || 0);
      const eligibleIds = new Set(
        String(rule.bundleProductIds || "")
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((x) => !Number.isNaN(x) && x > 0)
      );
      if (eligibleIds.size < 2 || bundlePrice <= 0) continue;
      const unitPrices = [];
      for (let ci = 0; ci < (cart || []).length; ci += 1) {
        const item = cart[ci];
        const pid = Number(item.id);
        if (!eligibleIds.has(pid)) continue;
        const dbProduct = productMap.get(pid);
        if (!dbProduct) continue;
        const unit = Number((overrideMap.get(ci)?.appliedUnitPrice ?? dbProduct.price) || 0);
        const bill = getCartLineBillingUnits(item, dbProduct);
        const wholeSlots = Math.max(0, Math.floor(Number(bill) + 1e-9));
        for (let i = 0; i < wholeSlots; i += 1) {
          unitPrices.push(unit);
        }
      }
      if (unitPrices.length < bundleSize) continue;
      unitPrices.sort((a, b) => b - a);
      const bundleCount = Math.floor(unitPrices.length / bundleSize);
      if (bundleCount <= 0) continue;
      let amount = 0;
      for (let i = 0; i < bundleCount; i += 1) {
        const start = i * bundleSize;
        const regular = unitPrices.slice(start, start + bundleSize).reduce((sum, x) => sum + Number(x || 0), 0);
        if (regular > bundlePrice) {
          amount += regular - bundlePrice;
        }
      }
      if (amount <= 0) continue;
      discount += amount;
      applied.push({
        ruleId: rule.id,
        type: rule.type,
        name: rule.name,
        amount,
        bundleCount,
        bundleSize,
      });
    }
  }

  return {
    applied,
    amount: Math.min(Math.max(0, discount), Math.max(0, subTotal)),
  };
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
    buyerBinOrNidNote: String(input.buyerBinOrNidNote || ""),
    giftCardRedemptions: Array.isArray(input.giftCardRedemptions) ? input.giftCardRedemptions : [],
    walletRedeemAmount: Number(input.walletRedeemAmount || 0),
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
  const walletTxnWhere = {
    customer: { branchId },
    type: { in: ["WALLET_LOAD", "WALLET_REDEEM"] },
  };
  if (start || end) {
    salesWhere.createdAt = {};
    if (start) salesWhere.createdAt.gte = start;
    if (end) salesWhere.createdAt.lt = end;
    walletTxnWhere.createdAt = {};
    if (start) walletTxnWhere.createdAt.gte = start;
    if (end) walletTxnWhere.createdAt.lt = end;
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
  const walletTxns = await prisma.storedValueTxn.findMany({
    where: walletTxnWhere,
    select: { type: true, amount: true },
  });
  const cashOutAuditWhere = {
    action: { in: ["DIGITAL_CASH_TRANSFER", "DIGITAL_CASH_OUT"] },
    entity: "Branch",
    entityId: branchId,
  };
  if (start || end) {
    cashOutAuditWhere.createdAt = {};
    if (start) cashOutAuditWhere.createdAt.gte = start;
    if (end) cashOutAuditWhere.createdAt.lt = end;
  }
  const digitalCashOutRows = await prisma.auditLog.findMany({
    where: cashOutAuditWhere,
    select: { payload: true },
  });

  const methodTotals = new Map();
  const channelTotals = new Map();
  const digitalRefCounts = new Map();
  const dailyTotals = new Map();
  let totalPaid = 0;
  let totalDue = 0;
  let digitalCollectionTotal = 0;
  let digitalMissingRefCount = 0;
  let walletCashInTotal = 0;
  let walletCashOutTotal = 0;

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
          if (line.channel) {
            addAmount(channelTotals, line.channel, line.amount);
            digitalRefCounts.set(line.channel, (digitalRefCounts.get(line.channel) || 0) + 1);
          }
          if (isDigitalMethod(line.method)) {
            digitalCollectionTotal += Number(line.amount || 0);
            if (!String(line.channel || "").trim()) digitalMissingRefCount += 1;
          }
        }
        continue;
      }
    }
    addAmount(methodTotals, sale.paymentMethod || "Cash", salePaid);
    if (sale.paymentChannel) {
      addAmount(channelTotals, sale.paymentChannel, salePaid);
      digitalRefCounts.set(sale.paymentChannel, (digitalRefCounts.get(sale.paymentChannel) || 0) + 1);
    }
    if (isDigitalMethod(sale.paymentMethod)) {
      digitalCollectionTotal += salePaid;
      if (!String(sale.paymentChannel || "").trim()) digitalMissingRefCount += 1;
    }
  }
  for (const txn of walletTxns) {
    const amount = Number(txn.amount || 0);
    if (txn.type === "WALLET_LOAD") walletCashInTotal += amount;
    if (txn.type === "WALLET_REDEEM") walletCashOutTotal += amount;
  }
  for (const row of digitalCashOutRows) {
    const fromMethod = String(row?.payload?.fromMethod || "").trim();
    const toMethod = String(row?.payload?.toMethod || "Cash").trim() || "Cash";
    const amount = Number(row?.payload?.amount || 0);
    if (!fromMethod || !toMethod || !(amount > 0)) continue;
    addAmount(methodTotals, fromMethod, -amount);
    addAmount(methodTotals, toMethod, amount);
  }

  const methods = Array.from(methodTotals.entries())
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
  const channels = Array.from(channelTotals.entries())
    .map(([channel, amount]) => ({ channel, amount }))
    .sort((a, b) => b.amount - a.amount);
  const digitalRefs = Array.from(digitalRefCounts.entries())
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);
  const days = Array.from(dailyTotals.entries())
    .map(([date, paid]) => ({ date, paid }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: start ? start.toISOString().slice(0, 10) : null,
    to: end ? new Date(end.getTime() - 1).toISOString().slice(0, 10) : null,
    billCount: todaySales.length,
    totalPaid,
    totalDue,
    digitalCollectionTotal,
    digitalMissingRefCount,
    walletFlow: {
      cashOut: walletCashOutTotal,
      cashIn: walletCashInTotal,
      net: walletCashInTotal - walletCashOutTotal,
    },
    methods,
    channels,
    digitalRefs,
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
      approvalReason,
      redeemPoints,
      holdCartAuditLogId: holdCartAuditLogIdRaw,
      quoteAuditLogId: quoteAuditLogIdRaw,
      buyerBinOrNidNote: buyerBinOrNidNoteRaw,
      giftCardRedemptions: giftCardRedemptionsRaw,
      walletRedeemAmount: walletRedeemAmountRaw,
      couponCode: couponCodeRaw,
      prescriptionId: prescriptionIdRaw,
      mfsPaymentId: mfsPaymentIdRaw,
      fulfillmentType: fulfillmentTypeRaw,
      deliveryFee: deliveryFeeRaw,
      deliveryAddress: deliveryAddressRaw,
      deliveryDistrict: deliveryDistrictRaw,
      deliveryArea: deliveryAreaRaw,
      deliveryLandmark: deliveryLandmarkRaw,
      courierName: courierNameRaw,
      trackingId: trackingIdRaw,
      orderSource: orderSourceRaw,
      pendingOrderId: pendingOrderIdRaw,
      restaurantServiceMode: restaurantServiceModeRaw,
      restaurantTableId: restaurantTableIdRaw,
      restaurantTableName: restaurantTableNameRaw,
    } = req.body;
    const prescriptionId =
      prescriptionIdRaw != null && prescriptionIdRaw !== ""
        ? Number(prescriptionIdRaw)
        : null;
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
    await ensureOpenFiscalPeriod(branchId, new Date(), {
      permissions: req.permissions,
      userId: req.user?.id || null,
      actionName: "sale.create",
    });

    const productIds = [...new Set(cart.map((item) => Number(item.id)))];
    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds }, branchId } });
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    const variantIds = [
      ...new Set(
        cart
          .map((item) => Number(item.variantId || 0))
          .filter((x) => Number.isFinite(x) && x > 0)
      ),
    ];
    const dbVariants =
      variantIds.length > 0
        ? await prisma.productVariant.findMany({
            where: { branchId, id: { in: variantIds } },
          })
        : [];
    const variantMap = new Map(dbVariants.map((v) => [v.id, v]));

    const requiresKycProduct = [...productMap.values()].some((p) => p.requiresKyc);
    if (requiresKycProduct) {
      const custPhone = customer?.phone ? String(customer.phone).trim() : "";
      const custId = customer?.id ? Number(customer.id) : null;
      let custRow = null;
      if (custId && !Number.isNaN(custId)) {
        custRow = await prisma.customer.findFirst({ where: { id: custId, branchId } });
      } else if (custPhone) {
        custRow = await prisma.customer.findFirst({ where: { phone: custPhone, branchId } });
      }
      const noteNid = String(buyerBinOrNidNoteRaw || "").trim();
      if (!custRow || !customerHasKyc(custRow)) {
        if (noteNid.length < 10) {
          return res.status(400).json({
            error:
              "NID or birth certificate KYC required for SIM/financial products. Capture KYC on the customer profile or enter buyer NID on checkout.",
          });
        }
      }
    }

    const serialsInCart = new Set();
    for (const item of cart) {
      const dbProduct = productMap.get(Number(item.id));
      const unitTracked = dbProduct?.trackSerial || dbProduct?.trackImei;
      if (!unitTracked) continue;
      const serial = String(item.serialNumber || "").trim();
      if (!serial) {
        return res.status(400).json({ error: `Serial/IMEI is required for ${dbProduct.name}` });
      }
      if (Number(item.qty || 1) !== 1) {
        return res.status(400).json({ error: `Serial-tracked products must be sold one unit at a time (${dbProduct.name})` });
      }
      if (serialsInCart.has(serial)) {
        return res.status(400).json({ error: `Duplicate serial/IMEI in cart: ${serial}` });
      }
      serialsInCart.add(serial);
      // IMEI-tracked handsets must carry a structurally valid (Luhn) IMEI and
      // must not already be sold/blocked in the IMEI registry.
      if (dbProduct.trackImei) {
        const v = validateImei(serial);
        if (!v.ok) {
          return res.status(400).json({ error: `Invalid IMEI for ${dbProduct.name}: ${serial}` });
        }
        const availability = await resolveImeiAvailability(branchId, v.normalized);
        if (!availability.available) {
          return res.status(400).json({
            error: availability.reason === "blocked" ? `IMEI is blocked: ${v.normalized}` : `IMEI already sold: ${v.normalized}`,
          });
        }
      }
      const sold = await prisma.saleItem.findFirst({
        where: { serialNumber: serial, sale: { branchId } },
        select: { id: true },
      });
      if (sold) return res.status(400).json({ error: `Serial/IMEI already sold: ${serial}` });
    }

    for (const item of cart) {
      const dbProduct = productMap.get(Number(item.id));
      if (!dbProduct) return res.status(404).json({ error: `Product not found: ${item.id}` });
      const vid = Number(item.variantId || 0) || null;
      const weightVal = Number(item.weightKg ?? 0);

      if (dbProduct.sellByWeight && vid) {
        return res
          .status(400)
          .json({ error: `Cannot apply a variant to sell-by-KG product ${dbProduct.name}` });
      }
      if (!dbProduct.sellByWeight && weightVal > 1e-9) {
        return res.status(400).json({ error: `Weight is not allowed on ${dbProduct.name}` });
      }
      if (!dbProduct.hasVariants && vid) {
        return res.status(400).json({ error: `${dbProduct.name} does not use variants` });
      }
      if (dbProduct.hasVariants && !vid) {
        return res.status(400).json({ error: `Please pick a variant for ${dbProduct.name}` });
      }

      if (vid) {
        const vrow = variantMap.get(vid);
        if (!vrow || Number(vrow.productId) !== Number(dbProduct.id) || Number(vrow.branchId) !== Number(branchId)) {
          return res.status(400).json({ error: `Invalid variant for ${dbProduct.name}` });
        }
        const q = Number(item.qty ?? 0);
        if (!(q > 0)) {
          return res.status(400).json({ error: `Invalid quantity for ${dbProduct.name}` });
        }
        const need = Math.max(1, Math.ceil(Number(q) - 1e-9));
        if (vrow.stock < need) {
          return res.status(400).json({
            error: `Insufficient stock for variant of ${dbProduct.name}. Available: ${vrow.stock}`,
          });
        }
        continue;
      }

      if (dbProduct.sellByWeight) {
        const bill = getCartLineBillingUnits(item, dbProduct);
        if (!(bill > 0)) {
          return res.status(400).json({ error: `Invalid weight for ${dbProduct.name}` });
        }
        if (Number(dbProduct.stockKg) + 1e-9 < bill) {
          return res.status(400).json({
            error: `Insufficient KG stock for ${dbProduct.name}. Available: ${Number(dbProduct.stockKg).toFixed(3)}`,
          });
        }
        continue;
      }

      const q = Number(item.qty ?? 0);
      if (!(q > 0)) {
        return res.status(400).json({ error: `Invalid quantity for ${dbProduct.name}` });
      }
      const need = Math.max(1, Math.ceil(Number(q) - 1e-9));
      if (dbProduct.stock < need) {
        return res.status(400).json({
          error: `Insufficient stock for ${dbProduct.name}. Available: ${dbProduct.stock}`,
        });
      }
    }

    let overrideRows;
    try {
      overrideRows = parseCartPriceOverrides(cart, productMap, variantMap);
    } catch (e) {
      return res.status(400).json({ error: e.message || "Invalid cart" });
    }
    const overrideMap = new Map(overrideRows.map((row) => [row.lineIndex, row]));
    const grossSubTotal = cart.reduce(
      (sum, item, idx) => sum + cartLineRetailSubtotal(item, idx, productMap, variantMap, overrideMap),
      0
    );
    const predefinedDiscount = cart.reduce((sum, item, idx) => {
      const dbProduct = productMap.get(Number(item.id));
      if (!dbProduct) return sum;
      const row = overrideMap.get(idx);
      const unit = Number(row?.appliedUnitPrice ?? dbProduct.price);
      const bill = getCartLineBillingUnits(item, dbProduct);
      const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(dbProduct));
      return sum + perUnit * bill;
    }, 0);
    const subTotal = Math.max(0, grossSubTotal - predefinedDiscount);
    let sdAmountRaw = 0;
    const vatAmount = cart.reduce((sum, item, idx) => {
      const dbProduct = productMap.get(Number(item.id));
      if (!dbProduct) return sum;
      const row = overrideMap.get(idx);
      const unit = Number(row?.appliedUnitPrice ?? dbProduct.price);
      const bill = getCartLineBillingUnits(item, dbProduct);
      const perUnitDiscount = Math.min(unit, getPerUnitPredefinedDiscount(dbProduct));
      const netUnitPrice = Math.max(0, unit - perUnitDiscount);
      const lineNet = netUnitPrice * bill;
      // SD (Supplementary Duty) is charged on the value, then VAT applies on (value + SD).
      const lineSd = (lineNet * Number(dbProduct.sdRate || 0)) / 100;
      sdAmountRaw += lineSd;
      return sum + ((lineNet + lineSd) * Number(dbProduct.vatRate || 0)) / 100;
    }, 0);
    const sdAmount = Math.round(sdAmountRaw * 100) / 100;
    const manualDiscountType = discountType || (discount ? "AMOUNT" : "AMOUNT");
    if (!["PERCENT", "AMOUNT"].includes(manualDiscountType)) {
      return res.status(400).json({ error: "Discount type must be PERCENT or AMOUNT" });
    }
    const manualDiscountValue = Number(discountValue ?? discount ?? 0);
    const approvalReasonText = String(approvalReason || "").trim();
    if (manualDiscountValue < 0) return res.status(400).json({ error: "Discount cannot be negative" });
    if (manualDiscountType === "PERCENT" && manualDiscountValue > 100) {
      return res.status(400).json({ error: "Percent discount cannot exceed 100" });
    }
    const manualDiscountAmount = calculateManualDiscount(subTotal, manualDiscountType, manualDiscountValue);
    if (requiresManagerApproval(manualDiscountType, manualDiscountValue, manualDiscountAmount)) {
      if (!approvalReasonText) {
        return res.status(400).json({ error: "Approval reason is required for manager-approved discount" });
      }
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
            meta: { discountType: manualDiscountType, discountValue: manualDiscountValue, approvalReason: approvalReasonText },
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
          meta: { discountType: manualDiscountType, discountValue: manualDiscountValue, approvalReason: approvalReasonText },
        },
      });
    }
    const overrideApproval = requiresPriceOverrideApproval(overrideRows);
    if (overrideApproval.required) {
      if (!approvalReasonText) {
        return res.status(400).json({ error: "Approval reason is required for manager-approved price override" });
      }
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
              approvalReason: approvalReasonText,
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
            approvalReason: approvalReasonText,
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
    const customerDistrict = String(customer?.district || "").trim();
    const customerArea = String(customer?.area || "").trim();
    const customerLandmark = String(customer?.landmark || "").trim();
    const customerBuyerBin = String(customer?.buyerBin || "").trim();
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
      if (!approvalReasonText) {
        return res.status(400).json({ error: "Approval reason is required for high redemption approval" });
      }
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
            meta: { requestedRedeemPoints, approvalReason: approvalReasonText },
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
          meta: { requestedRedeemPoints, approvalReason: approvalReasonText },
        },
      });
    }
    const activePromotions = await prisma.promotionRule.findMany({
      where: { branchId, isActive: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    const eligiblePromotions = activePromotions.filter((rule) => isPromotionActiveNow(rule));
    const promotionSummary = computePromotionDiscount({
      activePromotions: eligiblePromotions,
      cart,
      productMap,
      overrideMap,
      subTotal,
    });

    const couponCodeNormalized = String(couponCodeRaw || "").trim().toUpperCase().slice(0, 48);
    let couponRowPre = null;
    let couponDiscountAmount = 0;
    if (couponCodeNormalized) {
      couponRowPre = await prisma.couponCode.findFirst({
        where: { branchId, code: couponCodeNormalized },
      });
      if (!couponRowPre) {
        return res.status(400).json({ error: "Invalid coupon code" });
      }
      try {
        validateCouponForSubtotal(couponRowPre, subTotal);
        couponDiscountAmount = computeCouponAmount(couponRowPre, subTotal);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    const discountAmount = Math.max(
      0,
      predefinedDiscount +
        manualDiscountAmount +
        tierDiscountAmount +
        redeemDiscountAmount +
        promotionSummary.amount +
        couponDiscountAmount
    );
    const total = Math.max(0, subTotal + sdAmount + vatAmount - discountAmount);
    const fulfillmentRaw = String(fulfillmentTypeRaw || "PICKUP").toUpperCase();
    const fulfillmentType = ["DELIVERY", "DINE_IN", "TAKEAWAY"].includes(fulfillmentRaw)
      ? fulfillmentRaw
      : "PICKUP";
    const deliveryFee =
      fulfillmentType === "DELIVERY" ? Math.max(0, Number(deliveryFeeRaw || 0)) : 0;
    const totalWithDelivery = Math.max(0, total + deliveryFee);
    const deliveryAddress =
      fulfillmentType === "DELIVERY" && deliveryAddressRaw
        ? String(deliveryAddressRaw).trim().slice(0, 500)
        : null;
    const deliveryDistrict =
      fulfillmentType === "DELIVERY" && deliveryDistrictRaw
        ? String(deliveryDistrictRaw).trim().slice(0, 191)
        : null;
    const deliveryArea =
      fulfillmentType === "DELIVERY" && deliveryAreaRaw
        ? String(deliveryAreaRaw).trim().slice(0, 191)
        : null;
    const deliveryLandmark =
      fulfillmentType === "DELIVERY" && deliveryLandmarkRaw
        ? String(deliveryLandmarkRaw).trim().slice(0, 191)
        : null;
    const courierName = courierNameRaw ? String(courierNameRaw).trim().slice(0, 191) : null;
    const trackingId = trackingIdRaw ? String(trackingIdRaw).trim().slice(0, 191) : null;
    const orderSource = orderSourceRaw ? String(orderSourceRaw).trim().slice(0, 32) : null;
    const restaurantTableId =
      restaurantTableIdRaw != null && restaurantTableIdRaw !== ""
        ? Number(restaurantTableIdRaw)
        : null;
    const restaurantMeta =
      orderSource === "RESTAURANT" || restaurantServiceModeRaw
        ? {
            serviceMode: String(restaurantServiceModeRaw || fulfillmentType || "TAKEAWAY")
              .trim()
              .slice(0, 16),
            tableId: restaurantTableId && !Number.isNaN(restaurantTableId) ? restaurantTableId : null,
            tableName: restaurantTableNameRaw
              ? String(restaurantTableNameRaw).trim().slice(0, 64)
              : null,
          }
        : null;
    const pendingOrderId =
      pendingOrderIdRaw != null && pendingOrderIdRaw !== "" ? Number(pendingOrderIdRaw) : null;
    const splitPayments = normalizePaymentBreakdown(paymentBreakdown);
    const splitPaidAmount = splitPayments.reduce((sum, line) => sum + line.amount, 0);
    const hasSplitPayments = splitPayments.length > 0;
    const normalizedMethod = String(paymentMethod || "Cash");
    const isCodSale = !hasSplitPayments && isCodMethod(normalizedMethod);
    if (isCodSale && String(fulfillmentType || "").toUpperCase() !== "DELIVERY") {
      return res.status(400).json({ error: "COD payment requires delivery fulfillment" });
    }
    if (isCodSale && !String(customerName || "").trim()) {
      return res.status(400).json({ error: "Customer name is required for COD delivery" });
    }
    if (!hasSplitPayments && !isCodSale && isDigitalMethod(normalizedMethod) && !String(paymentChannel || "").trim()) {
      return res.status(400).json({ error: `Transaction/reference ID is required for ${normalizedMethod} payment` });
    }
    if (hasSplitPayments) {
      const missingDigitalLine = splitPayments.find(
        (line) => isDigitalMethod(line.method) && !String(line.channel || "").trim()
      );
      if (missingDigitalLine) {
        return res.status(400).json({
          error: `Transaction/reference ID required for split digital line (${missingDigitalLine.method})`,
        });
      }
    }

    const mfsPaymentId = String(mfsPaymentIdRaw || "").trim();
    if (mfsPaymentId) {
      const mfsSession = await getPaymentSession(mfsPaymentId);
      if (!mfsSession || Number(mfsSession.branchId) !== Number(branchId)) {
        return res.status(400).json({ error: "MFS payment session not found or expired" });
      }
      if (mfsSession.status !== "VERIFIED") {
        const trxForVerify = String(paymentChannel || "").trim();
        if (!trxForVerify) {
          return res.status(400).json({ error: "Verify MFS payment before checkout (TrxID required)" });
        }
        try {
          await verifyPayment({ paymentId: mfsPaymentId, trxId: trxForVerify });
        } catch (mfsErr) {
          return res.status(400).json({ error: mfsErr.message || "MFS payment verification failed" });
        }
      } else if (
        String(paymentChannel || "").trim() &&
        mfsSession.trxId &&
        String(paymentChannel).trim().toUpperCase() !== String(mfsSession.trxId).toUpperCase()
      ) {
        return res.status(400).json({ error: "TrxID does not match verified MFS payment session" });
      }
      if (Math.abs(Number(mfsSession.amount) - Number(totalWithDelivery)) > 0.05) {
        return res.status(400).json({ error: "MFS verified amount does not match sale total" });
      }
      if (!hasSplitPayments && isMfsMethod(normalizedMethod) && mfsSession.method !== normalizedMethod) {
        return res.status(400).json({ error: `MFS session method (${mfsSession.method}) does not match payment method` });
      }
    }
    const giftCardRedemptions = normalizeGiftCardRedemptions(giftCardRedemptionsRaw);
    const walletRedeemRequest = Math.max(0, Number(walletRedeemAmountRaw || 0));
    if (walletRedeemRequest > 0 && !hasCustomerIdentity) {
      return res.status(400).json({ error: "Customer identity is required for wallet redemption" });
    }
    const buyerBinOrNidNote =
      String(buyerBinOrNidNoteRaw || customerBuyerBin || "").trim().slice(0, 120) || null;
    const vatRowsForSnapshot = buildVatBreakdownSnapshot(cart, productMap, overrideMap, variantMap);
    const landedByProduct = await getLatestLandedCostByProduct(branchId);

    let resultSale = null;
    let loyaltySnapshot = null;

    await prisma.$transaction(async (tx) => {
      let customerId = null;
      if (hasCustomerIdentity) {
        let existingCustomer = customerPhone
          ? await tx.customer.findFirst({ where: { phone: customerPhone, branchId } })
          : await tx.customer.findFirst({ where: { name: customerName, branchId } });
        if (!existingCustomer && customerName) {
          existingCustomer = await tx.customer.create({
            data: {
              branchId,
              name: customerName,
              phone: customerPhone || null,
              district: customerDistrict || null,
              area: customerArea || null,
              landmark: customerLandmark || null,
              buyerBin: customerBuyerBin || null,
              balance: 0,
              storedValueBalance: 0,
            },
          });
        } else if (existingCustomer) {
          const patch = {};
          if (customerDistrict) patch.district = customerDistrict;
          if (customerArea) patch.area = customerArea;
          if (customerLandmark) patch.landmark = customerLandmark;
          if (customerBuyerBin) patch.buyerBin = customerBuyerBin;
          if (Object.keys(patch).length) {
            try {
              await tx.customer.update({ where: { id: existingCustomer.id }, data: patch });
            } catch (e) {
              if (e.code !== "P2022") throw e;
            }
          }
        }
        customerId = existingCustomer?.id || null;
      }
      if (walletRedeemRequest > 0 && !customerId) {
        throw new Error("Customer record required for wallet redemption");
      }

      let billRemain = totalWithDelivery;
      const appliedGifts = [];
      for (const g of giftCardRedemptions) {
        const card = await tx.giftCard.findFirst({
          where: { branchId, code: g.code, status: "ACTIVE" },
        });
        if (!card) throw new Error(`Gift card not found: ${g.code}`);
        if (card.expiresAt && new Date(card.expiresAt) < new Date()) {
          throw new Error(`Gift card expired: ${g.code}`);
        }
        const bal = Number(card.balance || 0);
        if (bal <= 0) throw new Error(`Gift card has no balance: ${g.code}`);
        let take = Math.min(bal, billRemain);
        if (g.amount != null && Number.isFinite(g.amount) && g.amount > 0) {
          take = Math.min(take, g.amount);
        }
        if (take <= 0) continue;
        const nextBal = bal - take;
        await tx.giftCard.update({
          where: { id: card.id },
          data: {
            balance: nextBal,
            status: nextBal <= 0.0001 ? "DEPLETED" : card.status,
          },
        });
        appliedGifts.push({ id: card.id, code: g.code, amount: take });
        billRemain -= take;
      }

      let walletTake = 0;
      if (walletRedeemRequest > 0 && customerId) {
        const cRow = await tx.customer.findUnique({ where: { id: customerId } });
        const wbal = Number(cRow?.storedValueBalance || 0);
        walletTake = Math.min(walletRedeemRequest, wbal, billRemain);
        if (walletTake > 0) {
          await tx.customer.update({
            where: { id: customerId },
            data: { storedValueBalance: { decrement: walletTake } },
          });
          billRemain -= walletTake;
        }
      }

      const internalOwed = Math.max(0, billRemain);
      let internalCashPaid = hasSplitPayments ? splitPaidAmount : Number(paidAmount ?? internalOwed);
      if (isCodSale) internalCashPaid = 0;
      if (internalCashPaid < 0) throw new Error("Paid amount cannot be negative");
      if (hasSplitPayments && splitPaidAmount > internalOwed + 0.01) {
        throw new Error("Total split payment cannot exceed amount owed after gift/wallet");
      }
      if (!hasSplitPayments && internalCashPaid > internalOwed + 0.01) {
        throw new Error("Paid amount exceeds amount owed after gift/wallet");
      }
      const dueAmount = Math.max(0, internalOwed - internalCashPaid);

      if (dueAmount > 0 && !customerName) {
        throw new Error("Customer name is required for due/baki sale");
      }

      if (dueAmount > 0 && hasCustomerIdentity) {
        const existingForCredit = customerPhone
          ? await tx.customer.findFirst({ where: { phone: customerPhone, branchId } })
          : await tx.customer.findFirst({ where: { name: customerName, branchId } });
        if (existingForCredit) {
          const limit = Number(existingForCredit.creditLimit || 0);
          if (limit > 0) {
            const currentBal = Number(existingForCredit.balance || 0);
            const projected = currentBal + dueAmount;
            if (projected > limit + 0.005) {
              if (!approvalReasonText) {
                throw new Error("Approval reason required for credit limit override");
              }
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
                      approvalReason: approvalReasonText,
                    },
                  },
                });
                throw new Error(
                  `Credit limit (${limit.toFixed(
                    2
                  )} BDT) would be exceeded (projected balance ${projected.toFixed(
                    2
                  )}). Enter manager PIN on checkout, or reduce the due amount.`
                );
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
                    approvalReason: approvalReasonText,
                  },
                },
              });
            }
          }
        }
      }

      if (dueAmount > 0 && customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: { balance: { increment: dueAmount } },
        });
      } else if (dueAmount > 0 && customerName && !customerId) {
        const savedCustomer = await tx.customer.create({
          data: {
            branchId,
            name: customerName,
            phone: customerPhone || null,
            balance: dueAmount,
            storedValueBalance: 0,
          },
        });
        customerId = savedCustomer.id;
      }

      const giftTotal = appliedGifts.reduce((sum, g) => sum + g.amount, 0);
      const salePaidAmountTotal = internalCashPaid + giftTotal + walletTake;

      const aisleBonusMap = await loadBranchLoyaltyBonusMap(tx, branchId);
      const pointsEarnedThisSale =
        customerId || customerName
          ? computeCartEarnedPoints(cart, productMap, aisleBonusMap)
          : 0;

      const notesPayload = {
        freeText: notes ? String(notes) : "",
        paymentBreakdown: splitPayments,
        loyalty: {
          tier: customerLoyaltyContext?.tier || "REGULAR",
          tierDiscountPercent,
          tierDiscountAmount,
          redeemedPoints: requestedRedeemPoints,
          redeemedAmount: redeemDiscountAmount,
          pointsEarnedThisSale,
          aisleBonusActive: Object.keys(aisleBonusMap).length > 0,
        },
        promotions: {
          discountAmount: promotionSummary.amount,
          applied: promotionSummary.applied,
        },
        antiFraud: {
          managerApprovalPinUsed: Boolean(String(managerApprovalPin || "")),
          approvalReason: approvalReasonText || null,
        },
        storedValue: {
          gifts: appliedGifts,
          wallet: walletTake,
        },
        coupon: couponRowPre
          ? {
              couponCodeId: couponRowPre.id,
              code: couponCodeNormalized,
              discount: couponDiscountAmount,
            }
          : undefined,
        ...(restaurantMeta ? { restaurant: restaurantMeta } : {}),
      };
      const serializedSaleNotes = sanitizeSaleNotesPayload(notesPayload);
      const mushakDocumentNo = await nextMushakDocumentNo(tx, branchId);

      if (prescriptionId != null && !Number.isNaN(prescriptionId)) {
        const rx = await tx.prescription.findFirst({
          where: { id: prescriptionId, branchId, status: { in: ["OPEN", "PARTIAL"] } },
        });
        if (!rx) {
          throw new Error("Prescription not found or not open for dispensing");
        }
      }

      const branchCosting = await tx.branch.findUnique({
        where: { id: branchId },
        select: { costingMethod: true },
      });
      // Dispensing expired (already past expiry) batch stock is blocked unless a
      // manager approves via PIN. The same anti-fraud PIN gates the override.
      const wantsExpiredOverride =
        req.body?.allowExpiredBatches === true || req.body?.dispenseExpiredStock === true;
      const expiredOverrideApproved =
        wantsExpiredOverride && String(managerApprovalPin || "") === getManagerApprovalPin();

      const lineCostPlans = [];
      for (const item of cart) {
        const prod = productMap.get(Number(item.id));
        const bill = getCartLineBillingUnits(item, prod);
        const resolved = await resolveSaleLineUnitCost(tx, {
          branchId,
          product: prod,
          cartItem: item,
          billingUnits: bill,
          costingMethod: branchCosting?.costingMethod,
          landedByProduct,
          allowExpired: expiredOverrideApproved,
        });
        lineCostPlans.push({ ...resolved, billingUnits: bill });
      }

      resultSale = await tx.sale.create({
        data: {
          branchId,
          cashierId: req.user?.id || null,
          invoiceNo: generateInvoiceNo(),
          prescriptionId:
            prescriptionId != null && !Number.isNaN(prescriptionId) ? prescriptionId : null,
          subTotal,
          vatAmount,
          sdAmount,
          discount: discountAmount,
          total: totalWithDelivery,
          paidAmount: salePaidAmountTotal,
          dueAmount,
          paymentMethod: hasSplitPayments ? "Split" : paymentMethod || "Cash",
          paymentChannel: hasSplitPayments ? "Multi" : paymentChannel || null,
          notes: serializedSaleNotes,
          customerId,
          buyerBinOrNidNote,
          mushakDocumentNo,
          vatBreakdownSnapshot: vatRowsForSnapshot,
          couponCodeId: couponRowPre ? couponRowPre.id : null,
          couponDiscount: couponDiscountAmount,
          fulfillmentType,
          deliveryFee,
          deliveryAddress,
          deliveryDistrict,
          deliveryArea,
          deliveryLandmark,
          courierName,
          trackingId,
          orderSource,
          pendingOrderId:
            pendingOrderId != null && !Number.isNaN(pendingOrderId) ? pendingOrderId : null,
          codStatus: isCodSale ? "PENDING" : null,
          codExpectedAmount: isCodSale ? totalWithDelivery : 0,
          items: {
            create: cart.map((item, idx) => {
              const prod = productMap.get(Number(item.id));
              const row = overrideMap.get(idx);
              const vidCreate = Number(item.variantId || 0) || null;
              const weightKgVal = prod?.sellByWeight
                ? Math.max(0, Number(item.weightKg ?? getCartLineBillingUnits(item, prod)))
                : null;
              const saleUnitRaw = item.saleUnit != null ? String(item.saleUnit).trim() : "";
              const serialNumber = item.serialNumber ? String(item.serialNumber).trim().slice(0, 64) : null;
              const warrantyDays = Number(prod?.warrantyDays || 0);
              const warrantyUntil =
                serialNumber && warrantyDays > 0
                  ? new Date(Date.now() + warrantyDays * 24 * 60 * 60 * 1000)
                  : null;
              const lineSdRate = Number(prod?.sdRate || 0);
              const lineUnit = Number(row?.appliedUnitPrice ?? prod.price);
              const lineBill = getCartLineBillingUnits(item, prod);
              const linePerUnitDisc = Math.min(lineUnit, getPerUnitPredefinedDiscount(prod));
              const lineNetAmt = Math.max(0, lineUnit - linePerUnitDisc) * lineBill;
              const lineSdAmt = Math.round(((lineNetAmt * lineSdRate) / 100) * 100) / 100;
              return {
                productId: Number(item.id),
                productVariantId: vidCreate,
                qty: Number(item.qty ?? 1),
                weightKg: weightKgVal,
                saleUnit: saleUnitRaw || prod.saleUnit || prod.unitOfMeasure || null,
                price: Number(row?.appliedUnitPrice ?? prod.price),
                cost: Number(lineCostPlans[idx]?.unitCost ?? prod.unitPrice ?? 0),
                sdRate: lineSdRate,
                sdAmount: lineSdAmt,
                serialNumber,
                warrantyUntil,
              };
            }),
          },
        },
        include: { items: true, customer: true },
      });

      // Register sold IMEIs into the handset registry (mark SOLD, link the sale).
      for (const soldItem of resultSale.items) {
        const prodForImei = productMap.get(Number(soldItem.productId));
        if (!prodForImei?.trackImei) continue;
        const imei = String(soldItem.serialNumber || "").trim();
        if (!imei) continue;
        await tx.imeiRecord.upsert({
          where: { branchId_imei: { branchId, imei } },
          create: {
            branchId,
            imei,
            productId: soldItem.productId,
            status: "SOLD",
            saleId: resultSale.id,
            saleItemId: soldItem.id,
            customerId: customerId || null,
            soldAt: new Date(),
            createdById: req.user?.id || null,
          },
          update: {
            status: "SOLD",
            productId: soldItem.productId,
            saleId: resultSale.id,
            saleItemId: soldItem.id,
            customerId: customerId || null,
            soldAt: new Date(),
          },
        });
      }

      if (dueAmount > 0 && customerId) {
        const custAfter = await tx.customer.findUnique({ where: { id: customerId } });
        await recordCreditLedgerEntry(tx, {
          branchId,
          customerId,
          entryType: "SALE_CREDIT",
          amount: dueAmount,
          balanceAfter: Number(custAfter?.balance || 0),
          saleId: resultSale.id,
          note: `Invoice ${resultSale.invoiceNo}`,
          createdById: req.user?.id || null,
        });
      }

      if (pendingOrderId != null && !Number.isNaN(pendingOrderId)) {
        await tx.pendingOrder.updateMany({
          where: {
            id: pendingOrderId,
            branchId,
            status: { in: ["PENDING", "LOADED"] },
          },
          data: { status: "COMPLETED", saleId: resultSale.id },
        });
      }

      if (restaurantMeta?.tableId) {
        // Link this table's open KOTs to the bill and close them out.
        await tx.kitchenTicket.updateMany({
          where: {
            branchId,
            tableId: restaurantMeta.tableId,
            status: { in: ["OPEN", "PREPARING", "READY"] },
            saleId: null,
          },
          data: { status: "SERVED", saleId: resultSale.id },
        });
        await tx.restaurantTable.updateMany({
          where: { id: restaurantMeta.tableId, branchId },
          data: { status: "FREE" },
        });
      }

      if (restaurantMeta) {
        // Cook-to-order: restaurant sales of recipe-backed items consume raw
        // ingredients. The finished item's stock is restored (net zero) because
        // it was produced on demand, not taken from pre-made stock.
        const mfgQtyByProduct = new Map();
        for (const item of cart) {
          const prod = productMap.get(Number(item.id));
          if (!prod?.isManufactured || prod.sellByWeight) continue;
          const qty = Number(item.qty ?? 1);
          if (qty > 0) {
            mfgQtyByProduct.set(prod.id, (mfgQtyByProduct.get(prod.id) || 0) + qty);
          }
        }
        if (mfgQtyByProduct.size) {
          const recipes = await tx.manufacturingRecipe.findMany({
            where: {
              branchId,
              isActive: true,
              finishedProductId: { in: [...mfgQtyByProduct.keys()] },
            },
            include: {
              lines: {
                include: {
                  rawProduct: {
                    select: { id: true, name: true, sellByWeight: true, unitPrice: true },
                  },
                },
              },
            },
          });
          for (const recipe of recipes) {
            const soldQty = mfgQtyByProduct.get(recipe.finishedProductId) || 0;
            if (!soldQty || !recipe.lines.length) continue;
            const batches = soldQty / (Number(recipe.yieldQty) || 1);
            const consumption = [];
            let materialCost = 0;
            for (const line of recipe.lines) {
              const raw = line.rawProduct;
              const needQty = Number(line.qtyRequired) * batches;
              if (needQty <= 0) continue;
              const rawUnitCost = Number(raw.unitPrice || 0);
              if (raw.sellByWeight) {
                await tx.product.update({
                  where: { id: raw.id },
                  data: { stockKg: { decrement: needQty } },
                });
                await tx.stockLedger.create({
                  data: {
                    branchId,
                    productId: raw.id,
                    refType: "SALE_PRODUCTION",
                    refId: resultSale.id,
                    outQty: 0,
                    outWeightKg: needQty,
                    unitCost: rawUnitCost,
                  },
                });
              } else {
                const needInt = Math.ceil(needQty - 1e-9);
                await tx.product.update({
                  where: { id: raw.id },
                  data: { stock: { decrement: needInt } },
                });
                await tx.stockLedger.create({
                  data: {
                    branchId,
                    productId: raw.id,
                    refType: "SALE_PRODUCTION",
                    refId: resultSale.id,
                    outQty: needInt,
                    unitCost: rawUnitCost,
                  },
                });
              }
              materialCost += needQty * rawUnitCost;
              consumption.push({
                rawProductId: raw.id,
                name: raw.name,
                qty: Number(needQty.toFixed(4)),
                unitCost: rawUnitCost,
              });
            }
            await tx.product.update({
              where: { id: recipe.finishedProductId },
              data: { stock: { increment: soldQty } },
            });
            await tx.stockLedger.create({
              data: {
                branchId,
                productId: recipe.finishedProductId,
                refType: "SALE_PRODUCTION",
                refId: resultSale.id,
                inQty: soldQty,
                unitCost: soldQty > 0 ? Number((materialCost / soldQty).toFixed(4)) : 0,
              },
            });
            await tx.productionOrder.create({
              data: {
                branchId,
                recipeId: recipe.id,
                productionNo: `AUTO-${resultSale.invoiceNo}-${recipe.id}`,
                batchCount: Number(batches.toFixed(4)),
                finishedQty: soldQty,
                status: "COMPLETED",
                consumptionJson: JSON.stringify(consumption),
                notes: `Auto cook-to-order · invoice ${resultSale.invoiceNo}`,
                createdById: req.user?.id || null,
              },
            });
          }
        }
      }

      if (couponRowPre) {
        const refreshedCoupon = await tx.couponCode.findFirst({
          where: { id: couponRowPre.id, branchId, isActive: true },
        });
        if (!refreshedCoupon) {
          throw new Error("Coupon is no longer available");
        }
        validateCouponForSubtotal(refreshedCoupon, subTotal);
        const recheckAmt = computeCouponAmount(refreshedCoupon, subTotal);
        if (Math.abs(recheckAmt - couponDiscountAmount) > 0.02) {
          throw new Error("Coupon discount changed — remove coupon and try again");
        }
        await tx.couponCode.update({
          where: { id: refreshedCoupon.id },
          data: { redemptionCount: { increment: 1 } },
        });
      }

      const payRows = [];
      if (hasSplitPayments) {
        for (const line of splitPayments) {
          payRows.push({
            saleId: resultSale.id,
            method: String(line.method || "Cash"),
            channel: line.channel || null,
            amount: line.amount,
            meta:
              isMfsMethod(line.method) && mfsPaymentId
                ? { mfsPaymentId, trxId: line.channel || null }
                : {},
          });
        }
      } else {
        payRows.push({
          saleId: resultSale.id,
          method: normalizedMethod,
          channel: paymentChannel || null,
          amount: internalCashPaid,
          meta:
            isMfsMethod(normalizedMethod) && mfsPaymentId
              ? { mfsPaymentId, trxId: paymentChannel || null }
              : {},
        });
      }
      for (const g of appliedGifts) {
        payRows.push({
          saleId: resultSale.id,
          method: "GIFTCARD",
          channel: g.code,
          amount: g.amount,
          meta: { giftCardId: g.id },
        });
      }
      if (walletTake > 0) {
        payRows.push({
          saleId: resultSale.id,
          method: "WALLET",
          channel: customerId ? String(customerId) : "",
          amount: walletTake,
          meta: {},
        });
      }
      if (payRows.length) {
        await tx.salePayment.createMany({ data: payRows });
      }

      for (const g of appliedGifts) {
        await tx.storedValueTxn.create({
          data: {
            giftCardId: g.id,
            customerId,
            saleId: resultSale.id,
            type: "REDEEM",
            amount: g.amount,
            note: `Sale ${resultSale.invoiceNo || resultSale.id}`,
          },
        });
      }
      if (walletTake > 0 && customerId) {
        await tx.storedValueTxn.create({
          data: {
            customerId,
            saleId: resultSale.id,
            type: "WALLET_REDEEM",
            amount: walletTake,
            note: `Sale ${resultSale.invoiceNo || resultSale.id}`,
          },
        });
      }

      const fefoAllocations = [];
      for (let fi = 0; fi < resultSale.items.length; fi += 1) {
        const plan = lineCostPlans[fi]?.fefoPlan;
        if (!plan) continue;
        const saleItem = resultSale.items[fi];
        const prod = productMap.get(Number(saleItem.productId));
        const allocs = await executeFefoPlan(tx, plan, {
          saleItemId: saleItem.id,
          productId: saleItem.productId,
          productName: prod?.name || `Product#${saleItem.productId}`,
        });
        fefoAllocations.push(...allocs);
      }
      for (const alloc of fefoAllocations) {
        await tx.saleItemBatch.create({
          data: {
            saleItemId: alloc.saleItemId,
            batchId: alloc.batchId,
            qty: alloc.consumeQty,
          },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: Number(alloc.productId),
            refType: "SALE_BATCH",
            refId: resultSale.id,
            outQty: Number(alloc.consumeQty || 0),
            unitCost: Number(alloc.unitCost || 0),
          },
        });
      }

      for (let li = 0; li < cart.length; li += 1) {
        const item = cart[li];
        const dbProduct = productMap.get(Number(item.id));
        const vidLine = Number(item.variantId || 0) || null;
        const unitCostBase = Number(lineCostPlans[li]?.unitCost ?? dbProduct.unitPrice ?? 0);
        const skipSaleLedger = Boolean(lineCostPlans[li]?.fefoPlan);

        if (vidLine) {
          const dec = Math.max(1, Math.ceil(Number(item.qty ?? 1) - 1e-9));
          await tx.productVariant.update({
            where: { id: vidLine },
            data: { stock: { decrement: dec } },
          });
          if (!skipSaleLedger) {
            await tx.stockLedger.create({
              data: {
                branchId,
                productId: Number(item.id),
                refType: "SALE",
                refId: resultSale.id,
                outQty: dec,
                unitCost: unitCostBase,
              },
            });
          }
          continue;
        }

        if (dbProduct.sellByWeight) {
          const w = Math.max(0, Number(item.weightKg ?? getCartLineBillingUnits(item, dbProduct)));
          await tx.product.update({
            where: { id: Number(item.id) },
            data: { stockKg: { decrement: w } },
          });
          await tx.stockLedger.create({
            data: {
              branchId,
              productId: Number(item.id),
              refType: "SALE",
              refId: resultSale.id,
              outQty: 0,
              outWeightKg: w,
              unitCost: unitCostBase,
            },
          });
          continue;
        }

        const decQty = Math.max(1, Math.ceil(Number(item.qty ?? 0) - 1e-9));
        await tx.product.update({
          where: { id: Number(item.id) },
          data: { stock: { decrement: decQty } },
        });
        if (!skipSaleLedger) {
          await tx.stockLedger.create({
            data: {
              branchId,
              productId: Number(item.id),
              refType: "SALE",
              refId: resultSale.id,
              outQty: decQty,
              unitCost: unitCostBase,
            },
          });
        }
      }

      if (fefoAllocations.length) {
        await tx.auditLog.create({
          data: {
            userId: req.user?.id || null,
            action: "SALE_BATCH_ALLOCATE",
            entity: "Sale",
            entityId: resultSale.id,
            payload: {
              branchId,
              allocations: fefoAllocations.map((x) => ({
                productId: x.productId,
                productName: x.productName,
                batchCode: x.batchCode,
                expiryDate: x.expiryDate,
                qty: x.consumeQty,
              })),
            },
          },
        });
      }

      if (prescriptionId != null && !Number.isNaN(prescriptionId)) {
        // Partial dispense / refill tracking: increment dispensedQty per line by
        // the quantity actually sold in this checkout, then derive the status
        // (DISPENSED when every line is fully dispensed, otherwise PARTIAL).
        const rxLines = await tx.prescriptionLine.findMany({ where: { prescriptionId } });
        const soldMap = new Map();
        for (const item of cart) {
          const key = `${Number(item.id)}|${Number(item.variantId || 0)}`;
          soldMap.set(key, (soldMap.get(key) || 0) + Number(item.qty || 0));
        }
        let allFull = true;
        let anyDispensed = false;
        for (const rl of rxLines) {
          const key = `${rl.productId}|${Number(rl.productVariantId || 0)}`;
          const soldForLine = soldMap.get(key) || 0;
          const prevDispensed = Number(rl.dispensedQty || 0);
          if (soldForLine > 0) {
            const newDispensed = Math.min(Number(rl.qty || 0), prevDispensed + soldForLine);
            if (newDispensed !== prevDispensed) {
              anyDispensed = true;
              await tx.prescriptionLine.update({
                where: { id: rl.id },
                data: { dispensedQty: newDispensed },
              });
            }
            if (newDispensed < Number(rl.qty || 0)) allFull = false;
          } else if (prevDispensed < Number(rl.qty || 0)) {
            allFull = false;
          }
        }
        const newStatus = allFull ? "DISPENSED" : anyDispensed ? "PARTIAL" : "OPEN";
        await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            status: newStatus,
            saleId: resultSale.id,
            ...(newStatus === "DISPENSED"
              ? { dispensedAt: new Date(), dispensedById: req.user?.id || null }
              : {}),
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
        const cogsAmount = lineCostPlans.reduce(
          (sum, lc) => sum + Number(lc.unitCost || 0) * Number(lc.billingUnits || 0),
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
                { accountId: cash.id, debit: salePaidAmountTotal, credit: 0 },
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
      payload: { total, dueAmount: resultSale.dueAmount },
    });
    const saleOut = await prisma.sale.findFirst({
      where: { id: resultSale.id, branchId },
      include: { salePayments: true, customer: true, items: { include: { product: true } } },
    });

    // Emit Mushak 6.3 XML for this sale and persist alongside the row.
    // Failures here are non-fatal — the sale is committed and the cashier
    // workflow must not block on tax-document generation.
    try {
      const branchRow = await prisma.branch.findUnique({ where: { id: branchId } });
      if (branchRow && saleOut) {
        const { xml, hash } = generateMushak63({ sale: saleOut, branch: branchRow });
        await prisma.sale.update({
          where: { id: saleOut.id },
          data: { nbrXmlPayload: xml, nbrXmlHash: hash, nbrEmittedAt: new Date() },
        });
        saleOut.nbrXmlPayload = xml;
        saleOut.nbrXmlHash = hash;
      }
    } catch (mushakErr) {
      req.log?.warn?.({ err: mushakErr, saleId: resultSale.id }, "Mushak 6.3 emission failed");
    }

    try {
      const branchRow = await prisma.branch.findUnique({ where: { id: branchId } });
      if (branchRow && saleOut) {
        const efdResult = await submitSaleToEfd({ sale: saleOut, branch: branchRow });
        if (efdResult.ok) {
          await prisma.sale.update({
            where: { id: saleOut.id },
            data: {
              efdFiscalInvoiceNo: efdResult.fiscalInvoiceNo || null,
              efdQrPayload: efdResult.qrPayload || null,
              efdVerificationUrl: efdResult.verificationUrl || null,
              efdSubmittedAt: new Date(),
              efdProvider: efdResult.provider || null,
            },
          });
          saleOut.efdFiscalInvoiceNo = efdResult.fiscalInvoiceNo;
          saleOut.efdQrPayload = efdResult.qrPayload;
          saleOut.efdVerificationUrl = efdResult.verificationUrl;
          saleOut.efdSubmittedAt = new Date();
          saleOut.efdProvider = efdResult.provider;
        }
      }
    } catch (efdErr) {
      req.log?.warn?.({ err: efdErr, saleId: resultSale.id }, "EFD submission failed");
    }

    if (loyaltySnapshot && saleOut?.notes) {
      try {
        const notesPayload = JSON.parse(saleOut.notes);
        loyaltySnapshot.pointsEarnedThisSale = Number(notesPayload?.loyalty?.pointsEarnedThisSale || 0);
        loyaltySnapshot.aisleBonusActive = Boolean(notesPayload?.loyalty?.aisleBonusActive);
      } catch {
        loyaltySnapshot.pointsEarnedThisSale = 0;
      }
    }

    res.json({ message: "Sale completed", sale: saleOut, loyalty: loyaltySnapshot });
    process.nextTick(() => {
      const dueAmt = Number(saleOut?.dueAmount || 0);
      const phone = String(saleOut?.customer?.phone || "").trim();
      if (dueAmt > 0 && phone) {
        prisma.branch
          .findUnique({ where: { id: branchId }, select: { name: true } })
          .then((branchRow) =>
            sendSms({
              to: phone,
              message: renderSmsTemplate(DUE_SALE_SMS_TEMPLATE, {
                name: saleOut.customer?.name || "গ্রাহক",
                store: branchRow?.name || "আমাদের দোকান",
                invoice: saleOut.invoiceNo || String(saleOut.id),
                due: dueAmt.toFixed(2),
              }),
            })
          )
          .catch(() => {});
      }
      dispatchBranchWebhooks({
        prisma,
        branchId,
        event: "sale.created",
        payload: {
          saleId: saleOut.id,
          invoiceNo: saleOut.invoiceNo,
          branchId,
          customerId: saleOut.customerId,
          total: saleOut.total,
          paidAmount: saleOut.paidAmount,
          dueAmount: saleOut.dueAmount,
          couponCodeId: saleOut.couponCodeId ?? null,
          couponDiscount: saleOut.couponDiscount ?? 0,
          createdAt: saleOut.createdAt,
          items:
            saleOut.items?.map((it) => ({
              productId: it.productId,
              qty: it.qty,
              price: it.price,
            })) ?? [],
          payments:
            saleOut.salePayments?.map((pay) => ({
              method: pay.method,
              channel: pay.channel,
              amount: pay.amount,
            })) ?? [],
        },
      });
    });
  } catch (err) {
    if (err.message.includes("Customer name is required")) return res.status(400).json({ error: err.message });
    if (
      err.message.includes("Gift card") ||
      err.message.includes("wallet") ||
      err.message.includes("Wallet") ||
      err.message.includes("Credit limit") ||
      err.message.includes("split payment") ||
      err.message.includes("Paid amount") ||
      err.message.includes("Coupon")
    ) {
      return res.status(400).json({ error: err.message });
    }
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
    if (respondFiscalBlocked(res, err)) return;
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
          data: {
            branchId,
            productId: Number(item.productId),
            refType: "SALE_RETURN",
            refId: saleId,
            inQty: qty,
            unitCost: Number(original.cost ?? original.price ?? 0),
          },
        });
      }

      const saleReturn = await tx.saleReturn.create({
        data: { saleId, amount, reason: reason || null, items: { create: returnRows } },
      });
      return saleReturn;
    });
    // Attempt MFS refund (bKash/Nagad/aggregator) for the refunded amount when the
    // original sale was paid via a persisted MFS session. Defaults on; pass
    // refundMfs:false to record the return without refunding the wallet.
    let mfsRefund = null;
    const wantRefund = req.body?.refundMfs !== false;
    if (wantRefund && Number(created?.amount) > 0) {
      const mfsPay = await prisma.salePayment.findFirst({
        where: { saleId, method: { in: ["bKash", "Nagad", "Rocket", "Upay"] } },
      });
      const refPaymentId = mfsPay?.meta?.mfsPaymentId;
      if (refPaymentId) {
        try {
          const r = await refundPayment({
            paymentId: refPaymentId,
            amount: created.amount,
            reason: reason || "Sale return",
            branchId,
          });
          mfsRefund = {
            status: r.session.status,
            refundTrxId: r.session.refundTrxId,
            refundedAmount: r.session.refundedAmount,
            manual: r.manual,
            simulated: r.simulated,
          };
        } catch (refundErr) {
          mfsRefund = { error: refundErr.message };
        }
      }
    }

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SALE_RETURN_CREATE",
      entity: "SaleReturn",
      entityId: created.id,
      payload: { saleId, amount: created.amount, mfsRefund },
    });
    res.status(201).json({ ...created, mfsRefund });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRecentSales = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const sales = await prisma.sale.findMany({
      where: { branchId },
      include: {
        customer: true,
        items: { include: { product: { select: { sellByWeight: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPosTopProducts = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const days = Math.max(1, Number(req.query.days || 30));
    const limit = Math.min(24, Math.max(1, Number(req.query.limit || 12)));
    const from = new Date();
    from.setDate(from.getDate() - days);

    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          branchId,
          createdAt: { gte: from },
        },
      },
      select: {
        productId: true,
        qty: true,
        weightKg: true,
        price: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            price: true,
            stock: true,
            stockKg: true,
            sellByWeight: true,
            hasVariants: true,
          },
        },
      },
    });

    const byProduct = new Map();
    for (const row of saleItems) {
      const pid = Number(row.productId || 0);
      if (!pid || !row.product) continue;
      const bill =
        Number(row.weightKg || 0) > 1e-9
          ? Number(row.weightKg)
          : Number(row.qty || 0);
      if (!byProduct.has(pid)) {
        byProduct.set(pid, {
          productId: pid,
          soldQty: 0,
          revenue: 0,
          product: row.product,
        });
      }
      const agg = byProduct.get(pid);
      agg.soldQty += bill;
      agg.revenue += bill * Number(row.price || 0);
    }

    const rows = [...byProduct.values()]
      .sort((a, b) => b.soldQty - a.soldQty)
      .slice(0, limit)
      .map((r) => ({
        productId: r.productId,
        soldQty: Number(r.soldQty.toFixed(3)),
        revenue: Number(r.revenue.toFixed(2)),
        name: r.product?.name || `Product #${r.productId}`,
        category: r.product?.category || "",
        price: Number(r.product?.price || 0),
        stock: Number(r.product?.stock || 0),
        stockKg: Number(r.product?.stockKg || 0),
        sellByWeight: Boolean(r.product?.sellByWeight),
        hasVariants: Boolean(r.product?.hasVariants),
        saleUnit: r.product?.sellByWeight ? "KG" : "PCS",
      }));

    res.json({ days, limit, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSaleByInvoiceLookup = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const invoiceNo = String(req.query.invoiceNo || req.query.q || "").trim();
    if (!invoiceNo) {
      return res.status(400).json({ error: "invoiceNo query parameter is required" });
    }
    const sale = await prisma.sale.findUnique({
      where: {
        branchId_invoiceNo: {
          branchId,
          invoiceNo,
        },
      },
      select: {
        id: true,
        invoiceNo: true,
        mushakDocumentNo: true,
        createdAt: true,
      },
    });
    if (!sale) {
      return res.status(404).json({ error: "No sale found for this invoice number in this branch" });
    }
    return res.json({
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      mushakDocumentNo: sale.mushakDocumentNo || null,
      createdAt: sale.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomerRecentSales = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const take = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    const phone = String(req.query.phone || "").trim();
    const customerIdRaw = req.query.customerId;
    let customerId = null;
    if (customerIdRaw !== undefined && customerIdRaw !== null && String(customerIdRaw).trim() !== "") {
      customerId = Number(customerIdRaw);
      if (Number.isNaN(customerId)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
    } else if (phone.length >= 6) {
      const cust = await prisma.customer.findFirst({ where: { branchId, phone } });
      customerId = cust?.id ?? null;
    } else {
      return res.status(400).json({ error: "Provide phone (≥6 chars) or customerId" });
    }

    if (!customerId) {
      return res.json([]);
    }

    const sales = await prisma.sale.findMany({
      where: { branchId, customerId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        invoiceNo: true,
        total: true,
        paidAmount: true,
        dueAmount: true,
        createdAt: true,
        items: {
          select: {
            qty: true,
            price: true,
            weightKg: true,
            saleUnit: true,
            product: {
              select: { name: true, sellByWeight: true },
            },
            productVariant: { select: { label: true } },
          },
        },
      },
    });

    const rows = sales.map((s) => ({
      id: s.id,
      invoiceNo: s.invoiceNo,
      total: s.total,
      paidAmount: s.paidAmount,
      dueAmount: s.dueAmount,
      createdAt: s.createdAt,
      lines: (s.items || []).map((it) => {
        const nm = String(it.product?.name || "").trim() || "Item";
        const vl = String(it.productVariant?.label || "").trim();
        const label = vl ? `${nm} (${vl})` : nm;
        const billQty = getBillingUnitsForLine(it, it.product);
        const qtyFmt = formatSaleLineQty(it, it.product);
        return {
          label,
          qty: billQty,
          qtyDisplay: qtyFmt.display,
          saleUnit: it.saleUnit || it.product?.saleUnit || it.product?.unitOfMeasure || null,
          unitPrice: Number(it.price || 0),
          lineTotal: billQty * Number(it.price || 0),
        };
      }),
    }));

    res.json(rows);
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
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            productVariant: true,
            batchAllocations: {
              include: {
                batch: {
                  select: {
                    id: true,
                    batchCode: true,
                    expiryDate: true,
                    unitCost: true,
                  },
                },
              },
            },
          },
        },
        salePayments: true,
      },
    });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSalePayments = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid sale id" });
    const sale = await prisma.sale.findFirst({ where: { id, branchId }, select: { id: true } });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    const rows = await prisma.salePayment.findMany({
      where: { saleId: id },
      orderBy: { id: "asc" },
      include: { settlement: true },
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSaleMushakPdf = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid sale id" });
    const [sale, branch] = await Promise.all([
      prisma.sale.findFirst({
        where: { id, branchId },
        include: { customer: true, items: { include: { product: true } } },
      }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const filename = `mushak-${sale.mushakDocumentNo || sale.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(14).text("VAT Sales Invoice (Mushak reference)", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Document: ${sale.mushakDocumentNo || "—"}`);
    doc.text(`Seller BIN: ${branch?.sellerBin || "—"}  |  Trade license: ${branch?.tradeLicenseNo || "—"}`);
    if (branch?.vatRegistrationLabel) doc.text(String(branch.vatRegistrationLabel));
    doc.text(`Branch: ${branch?.name || ""} (${branch?.code || ""})`);
    doc.moveDown();
    doc.text(`Buyer BIN / NID ref: ${sale.buyerBinOrNidNote || "—"}`);
    doc.text(`Invoice: ${sale.invoiceNo || sale.id}  |  Date: ${new Date(sale.createdAt).toLocaleString()}`);
    if (sale.customer) {
      doc.text(`Customer: ${sale.customer.name}${sale.customer.phone ? ` · ${sale.customer.phone}` : ""}`);
    }
    doc.moveDown();
    doc.text(`Subtotal: ${Number(sale.subTotal || 0).toFixed(2)}  SD: ${Number(sale.sdAmount || 0).toFixed(2)}  VAT: ${Number(sale.vatAmount || 0).toFixed(2)}  Discount: ${Number(sale.discount || 0).toFixed(2)}`);
    doc.text(`Total: ${Number(sale.total || 0).toFixed(2)}  Paid: ${Number(sale.paidAmount || 0).toFixed(2)}  Due: ${Number(sale.dueAmount || 0).toFixed(2)}`);
    doc.moveDown();
    const snap = sale.vatBreakdownSnapshot;
    const lines = Array.isArray(snap) ? snap : snap && typeof snap === "object" ? Object.values(snap) : [];
    if (lines.length) {
      doc.fontSize(9).text("Line SD & VAT breakdown");
      lines.forEach((row, idx) => {
        const sdRate = Number(row.sdRate || 0);
        const sdPart = sdRate > 0 ? ` | SD ${sdRate.toFixed(2)}% = ${Number(row.sdAmount || 0).toFixed(2)}` : "";
        doc.text(
          `${idx + 1}. ${row.name || row.productId} × ${row.qty} | net ${Number(row.netAmount || 0).toFixed(2)}${sdPart} @ ${Number(row.vatRate || 0).toFixed(2)}% VAT = ${Number(row.vatAmount || 0).toFixed(2)}`
        );
      });
    } else if (sale.items?.length) {
      sale.items.forEach((row, idx) => {
        const qtyFmt = formatSaleLineQty(row, row.product);
        doc.text(
          `${idx + 1}. ${row.product?.name || row.productId} × ${qtyFmt.display} @ ${Number(row.price || 0).toFixed(2)}`
        );
      });
    }
    doc.moveDown();
    doc.fontSize(8).text("Generated by BD Smart POS. Use per NBR rules applicable to your business.", {
      align: "center",
    });
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};