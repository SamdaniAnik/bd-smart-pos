const prisma = require("../../utils/prisma");
const {
  createShipment,
  collectCod,
  syncShipmentStatus,
  syncAllActiveShipments,
} = require("../../utils/courierService");
const { streamCourierLabelPdf } = require("../../utils/courierLabel");
const { estimateCourierCost, DEFAULTS } = require("../../utils/courierCosting");

const DIMS_SELECT = {
  id: true,
  name: true,
  grossWeightGrams: true,
  netWeightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
};

/**
 * Estimate the chargeable (volumetric) courier weight + cost for a sale or an
 * ad-hoc set of items, using each product's dimensions and weight.
 */
exports.estimateShipmentCost = async (req, res) => {
  try {
    const branchId = req.branchId;
    const body = req.body || {};
    const config = {
      divisor: body.divisor,
      baseWeightKg: body.baseWeightKg,
      baseFare: body.baseFare,
      perKgFare: body.perKgFare,
      roundStepKg: body.roundStepKg,
    };

    let items = [];
    if (body.saleId != null && !Number.isNaN(Number(body.saleId))) {
      const sale = await prisma.sale.findFirst({
        where: { id: Number(body.saleId), branchId },
        include: { items: { include: { product: { select: DIMS_SELECT } } } },
      });
      if (!sale) return res.status(404).json({ error: "Sale not found" });
      items = sale.items.map((it) => ({ product: it.product, qty: Number(it.qty || 1) }));
    } else if (Array.isArray(body.items) && body.items.length) {
      const ids = [...new Set(body.items.map((x) => Number(x.productId)).filter(Boolean))];
      const products = await prisma.product.findMany({
        where: { id: { in: ids }, branchId },
        select: DIMS_SELECT,
      });
      const map = new Map(products.map((p) => [p.id, p]));
      items = body.items
        .map((x) => ({ product: map.get(Number(x.productId)), qty: Number(x.qty || 1) }))
        .filter((x) => x.product);
    } else {
      return res.status(400).json({ error: "Provide saleId or items[]" });
    }

    if (!items.length) return res.status(400).json({ error: "No items with product data to estimate" });
    res.json(estimateCourierCost({ items, config }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCostingDefaults = (req, res) => {
  res.json(DEFAULTS);
};

exports.listShipments = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = req.query.status ? String(req.query.status) : null;
    const rows = await prisma.courierShipment.findMany({
      where: {
        branchId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createCourierShipment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { saleId, pendingOrderId, provider, codAmount } = req.body || {};
    const shipment = await createShipment({
      branchId,
      saleId,
      pendingOrderId,
      provider,
      codAmount,
    });
    res.status(201).json(shipment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.collectShipmentCod = async (req, res) => {
  try {
    const branchId = req.branchId;
    const shipmentId = Number(req.params.id);
    const shipment = await collectCod({ branchId, shipmentId, userId: req.user?.id || null });
    res.json({ message: "COD marked collected", shipment });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.syncShipment = async (req, res) => {
  try {
    const branchId = req.branchId;
    const shipmentId = Number(req.params.id);
    const result = await syncShipmentStatus({ branchId, shipmentId });
    res.json({
      message: result.synced ? "Shipment status synced" : "Status not updated",
      ...result,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.syncAllShipments = async (req, res) => {
  try {
    const branchId = req.branchId;
    const result = await syncAllActiveShipments({ branchId });
    res.json({ message: "Active shipments synced", ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.printShipmentLabel = async (req, res) => {
  try {
    const branchId = req.branchId;
    const shipmentId = Number(req.params.id);
    const shipment = await prisma.courierShipment.findFirst({ where: { id: shipmentId, branchId } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    streamCourierLabelPdf({ shipment, branch, res });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listPendingCodSales = async (req, res) => {
  try {
    const branchId = req.branchId;
    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        paymentMethod: "COD",
        OR: [{ codStatus: null }, { codStatus: "PENDING" }],
      },
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
