const prisma = require("../../utils/prisma");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");

const ORDER_SOURCES = new Set(["PHONE", "FACEBOOK", "WHATSAPP", "WEB", "WEB_STORE", "DARAZ", "FOODPANDA"]);
const ORDER_STATUSES = new Set(["PENDING", "LOADED", "COMPLETED", "CANCELLED"]);

function generateOrderNo() {
  const ts = Date.now().toString(36).toUpperCase();
  return `ORD-${ts}`;
}

function parseCartLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => ({
      productId: Number(line.productId || line.id),
      productVariantId:
        line.productVariantId != null
          ? Number(line.productVariantId)
          : line.variantId != null
            ? Number(line.variantId)
            : null,
      qty: Number(line.qty || 1),
      weightKg: line.weightKg != null ? Number(line.weightKg) : null,
      saleUnit: line.saleUnit != null ? String(line.saleUnit) : null,
    }))
    .filter((line) => Number.isFinite(line.productId) && line.productId > 0 && line.qty > 0);
}

async function buildPosCartFromLines(branchId, lines) {
  if (!lines.length) return [];
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { branchId, id: { in: productIds } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantIds = lines.map((l) => l.productVariantId).filter((id) => id != null && id > 0);
  const variants =
    variantIds.length > 0
      ? await prisma.productVariant.findMany({ where: { branchId, id: { in: variantIds } } })
      : [];
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const cart = [];
  for (const line of lines) {
    const product = productMap.get(line.productId);
    if (!product) continue;
    const variant = line.productVariantId ? variantMap.get(line.productVariantId) : null;
    const price =
      variant?.priceOverride != null ? Number(variant.priceOverride) : Number(product.price || 0);
    cart.push({
      id: product.id,
      name: product.name,
      qty: line.qty,
      price,
      vatRate: Number(product.vatRate || 0),
      batchTracked: Boolean(product.batchTracked),
      sellByWeight: Boolean(product.sellByWeight),
      hasVariants: Boolean(product.hasVariants),
      category: product.category || "",
      ...(line.productVariantId ? { variantId: line.productVariantId } : {}),
      ...(line.weightKg != null ? { weightKg: line.weightKg } : {}),
      ...(line.saleUnit ? { saleUnit: line.saleUnit } : {}),
      matchedVariant: variant || null,
    });
  }
  return cart;
}

const withLineCount = (row) => ({
  ...row,
  lineCount: (() => {
    try {
      const parsed = JSON.parse(row.cartJson || "[]");
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  })(),
});

exports.listPendingOrders = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query.status || "").trim().toUpperCase();
    const lq = parseListQuery(req, {
      searchableFields: ["orderNo", "customerName", "customerPhone", "district", "trackingId"],
      sortableFields: ["id", "orderNo", "status", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const where = { branchId };
    if (status && ORDER_STATUSES.has(status)) where.status = status;
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [rows, total] = await prisma.$transaction([
        prisma.pendingOrder.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.pendingOrder.count({ where }),
      ]);
      return res.json(
        pagedResult({ data: rows.map(withLineCount), total, page: lq.page, pageSize: lq.pageSize })
      );
    }

    const rows = await prisma.pendingOrder.findMany({
      where,
      orderBy: lq.orderBy || { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 200, 500),
    });
    res.json(rows.map(withLineCount));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPendingOrder = async (req, res) => {
  try {
    const branchId = req.branchId;
    const {
      source,
      customerName,
      customerPhone,
      district,
      area,
      landmark,
      deliveryAddress,
      deliveryFee,
      courierName,
      trackingId,
      paymentMethod,
      notes,
      lines,
    } = req.body;

    const name = String(customerName || "").trim();
    if (name.length < 2) return res.status(400).json({ error: "Customer name is required" });

    const cartLines = parseCartLines(lines);
    if (!cartLines.length) return res.status(400).json({ error: "At least one order line is required" });

    const normalizedSource = ORDER_SOURCES.has(String(source || "").toUpperCase())
      ? String(source).toUpperCase()
      : "PHONE";

    const row = await prisma.pendingOrder.create({
      data: {
        branchId,
        orderNo: generateOrderNo(),
        source: normalizedSource,
        status: "PENDING",
        customerName: name,
        customerPhone: customerPhone ? String(customerPhone).trim() : null,
        district: district ? String(district).trim() : null,
        area: area ? String(area).trim() : null,
        landmark: landmark ? String(landmark).trim() : null,
        deliveryAddress: deliveryAddress ? String(deliveryAddress).trim() : null,
        deliveryFee: Math.max(0, Number(deliveryFee || 0)),
        courierName: courierName ? String(courierName).trim() : null,
        trackingId: trackingId ? String(trackingId).trim() : null,
        paymentMethod: paymentMethod ? String(paymentMethod).trim() : null,
        notes: notes ? String(notes).trim() : null,
        cartJson: JSON.stringify(cartLines),
        createdById: req.user?.id || null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.cancelPendingOrder = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const row = await prisma.pendingOrder.findFirst({ where: { id, branchId } });
    if (!row) return res.status(404).json({ error: "Order not found" });
    if (row.status === "COMPLETED") {
      return res.status(400).json({ error: "Completed orders cannot be cancelled" });
    }
    const updated = await prisma.pendingOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPendingOrderPosCart = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const row = await prisma.pendingOrder.findFirst({ where: { id, branchId } });
    if (!row) return res.status(404).json({ error: "Order not found" });
    if (row.status === "COMPLETED") {
      return res.status(400).json({ error: "Order already completed at POS" });
    }
    if (row.status === "CANCELLED") {
      return res.status(400).json({ error: "Order was cancelled" });
    }

    let lines = [];
    try {
      lines = parseCartLines(JSON.parse(row.cartJson || "[]"));
    } catch {
      return res.status(400).json({ error: "Invalid order cart data" });
    }

    const cart = await buildPosCartFromLines(branchId, lines);
    if (!cart.length) return res.status(400).json({ error: "No valid products on this order" });

    if (row.status === "PENDING") {
      await prisma.pendingOrder.update({
        where: { id: row.id },
        data: { status: "LOADED" },
      });
    }

    res.json({
      pendingOrderId: row.id,
      orderNo: row.orderNo,
      source: row.source,
      fulfillmentType: "DELIVERY",
      deliveryFee: Number(row.deliveryFee || 0),
      deliveryAddress: row.deliveryAddress || "",
      deliveryDistrict: row.district || "",
      deliveryArea: row.area || "",
      deliveryLandmark: row.landmark || "",
      courierName: row.courierName || "",
      trackingId: row.trackingId || "",
      orderSource: row.source,
      paymentMethod: row.paymentMethod || "Cash",
      notes: row.notes || "",
      customer: {
        name: row.customerName,
        phone: row.customerPhone || "",
        district: row.district || "",
        area: row.area || "",
        landmark: row.landmark || "",
      },
      cart,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Public storefront / marketplace order intake (Phase 4). */
exports.createInboundOrder = async (req, res) => {
  req.user = req.user || { id: null };
  const source = String(req.body?.source || "WEB_STORE").toUpperCase();
  req.body = { ...req.body, source: ORDER_SOURCES.has(source) ? source : "WEB_STORE" };
  return exports.createPendingOrder(req, res);
};