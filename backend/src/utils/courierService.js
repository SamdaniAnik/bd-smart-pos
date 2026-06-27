const prisma = require("./prisma");
const logger = require("./logger");
const {
  bookCourierShipment,
  trackCourierShipment,
  isLiveCourierProvider,
  isTrackableProvider,
  hasLiveCourierCredentials,
} = require("../integrations/couriers");

function getProviderName(branch) {
  return String(branch?.courierProvider || process.env.COURIER_PROVIDER || "log").toLowerCase();
}

function buildAddress(row) {
  return [
    row.deliveryAddress || row.address,
    row.deliveryArea || row.area,
    row.deliveryDistrict || row.district,
    row.deliveryLandmark || row.landmark,
  ]
    .filter(Boolean)
    .join(", ");
}

function buildReferenceId({ saleId, pendingOrderId }) {
  if (pendingOrderId) return `PO-${pendingOrderId}-${Date.now()}`;
  if (saleId) return `SALE-${saleId}-${Date.now()}`;
  return `SHIP-${Date.now()}`;
}

async function createShipment({ branchId, saleId, pendingOrderId, provider, codAmount = 0 }) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new Error("Branch not found");

  let recipientName = "";
  let recipientPhone = "";
  let address = "";
  let district = null;
  let area = null;
  let resolvedCod = Number(codAmount || 0);

  if (pendingOrderId) {
    const order = await prisma.pendingOrder.findFirst({
      where: { id: Number(pendingOrderId), branchId },
    });
    if (!order) throw new Error("Pending order not found");
    recipientName = order.customerName;
    recipientPhone = order.customerPhone || "";
    address = buildAddress(order);
    district = order.district;
    area = order.area;
    if (String(order.paymentMethod || "").toUpperCase() === "COD") {
      try {
        const cart = JSON.parse(order.cartJson || "{}");
        resolvedCod = Number(cart.total || cart.grandTotal || 0) + Number(order.deliveryFee || 0);
      } catch {
        resolvedCod = Number(order.deliveryFee || 0);
      }
    }
  } else if (saleId) {
    const sale = await prisma.sale.findFirst({
      where: { id: Number(saleId), branchId },
      include: { customer: { select: { name: true, phone: true } } },
    });
    if (!sale) throw new Error("Sale not found");
    recipientName = sale.customer?.name || "Customer";
    recipientPhone = sale.customer?.phone || "";
    address = buildAddress(sale);
    district = sale.deliveryDistrict || sale.district;
    area = sale.deliveryArea || sale.area;
    if (String(sale.paymentMethod || "").toUpperCase() === "COD") {
      resolvedCod = Number(sale.codExpectedAmount || sale.total || 0);
    }
  } else {
    throw new Error("saleId or pendingOrderId required");
  }

  const resolvedProvider = String(provider || getProviderName(branch)).toLowerCase();
  let trackingId = null;
  let status = "CREATED";
  let meta = { simulated: true };

  if (isLiveCourierProvider(resolvedProvider) && hasLiveCourierCredentials(resolvedProvider, branch)) {
    const booked = await bookCourierShipment({
      provider: resolvedProvider,
      branch,
      recipientName,
      recipientPhone,
      address,
      codAmount: resolvedCod,
      referenceId: buildReferenceId({ saleId, pendingOrderId }),
      district,
      area,
    });
    trackingId = booked.trackingId;
    status = booked.status || "BOOKED";
    meta = { ...(booked.meta || {}), simulated: false, live: true };
  } else if (isLiveCourierProvider(resolvedProvider)) {
    trackingId = `${resolvedProvider.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    status = "BOOKED";
    meta = {
      simulated: true,
      note: `Live ${resolvedProvider} selected but API credentials missing — set env vars or branch courierApiKey`,
    };
  } else if (resolvedProvider === "manual" || resolvedProvider === "log") {
    trackingId = `MAN-${Date.now().toString(36).toUpperCase()}`;
    status = "MANUAL";
    meta = { simulated: true, provider: resolvedProvider };
  } else {
    trackingId = `${resolvedProvider.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    status = "BOOKED";
    meta = { simulated: true, provider: resolvedProvider };
  }

  const shipment = await prisma.courierShipment.create({
    data: {
      branchId,
      saleId: saleId ? Number(saleId) : null,
      pendingOrderId: pendingOrderId ? Number(pendingOrderId) : null,
      provider: resolvedProvider,
      status,
      trackingId,
      codAmount: resolvedCod,
      recipientName,
      recipientPhone,
      address,
      meta,
    },
  });

  if (pendingOrderId && trackingId) {
    await prisma.pendingOrder.update({
      where: { id: Number(pendingOrderId) },
      data: { trackingId, courierName: resolvedProvider, status: "DISPATCHED" },
    });
    try {
      const { notifyTrackingUpdate } = require("./fcommerceService");
      notifyTrackingUpdate(Number(pendingOrderId)).catch(() => {});
    } catch {
      /* f-commerce optional */
    }
  }
  if (saleId && trackingId) {
    await prisma.sale.update({
      where: { id: Number(saleId) },
      data: { trackingId, courierName: resolvedProvider },
    });
  }

  return shipment;
}

async function collectCod({ branchId, shipmentId, userId = null }) {
  const shipment = await prisma.courierShipment.findFirst({
    where: { id: Number(shipmentId), branchId },
  });
  if (!shipment) throw new Error("Shipment not found");
  if (shipment.codCollectedAt) throw new Error("COD already collected for this shipment");
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.courierShipment.update({
      where: { id: shipment.id },
      data: { codCollectedAt: now, status: "COD_COLLECTED" },
    });

    if (shipment.saleId) {
      const sale = await tx.sale.findUnique({ where: { id: shipment.saleId } });
      const codAmt = Number(shipment.codAmount || sale?.codExpectedAmount || sale?.total || 0);
      await tx.sale.update({
        where: { id: shipment.saleId },
        data: {
          codStatus: "COLLECTED",
          codCollectedAt: now,
          paidAmount: Number(sale?.paidAmount || 0) + codAmt,
          dueAmount: Math.max(0, Number(sale?.dueAmount || 0) - codAmt),
        },
      });

      // Post the cash-in journal: DR Courier/Cash clearing (1140 float or 1100),
      // CR Accounts Receivable (1200). COD cash physically arrives via courier
      // settlement, so we use the courier float account when present.
      if (codAmt > 0) {
        const accounts = await tx.account.findMany({ where: { branchId } });
        const map = new Map(accounts.map((a) => [a.code, a]));
        const funding = map.get("1140") || map.get("1100");
        const receivable = map.get("1200");
        if (funding && receivable) {
          await tx.journal.create({
            data: {
              branchId,
              createdBy: userId,
              refType: "COD_COLLECTION",
              refId: shipment.id,
              narration: `COD collected for sale #${shipment.saleId} via ${shipment.provider}`,
              lines: {
                create: [
                  { accountId: funding.id, debit: codAmt, credit: 0 },
                  { accountId: receivable.id, debit: 0, credit: codAmt },
                ],
              },
            },
          });
        }
      }
    }
    return updated;
  });
}

/**
 * Pull the latest status from the courier API and persist it. Falls back to the
 * stored status for providers without a tracking adapter or missing credentials.
 */
async function syncShipmentStatus({ branchId, shipmentId }) {
  const shipment = await prisma.courierShipment.findFirst({
    where: { id: Number(shipmentId), branchId },
  });
  if (!shipment) throw new Error("Shipment not found");
  if (!shipment.trackingId) throw new Error("Shipment has no tracking ID to sync");

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  const provider = String(shipment.provider || "").toLowerCase();
  if (!isTrackableProvider(provider) || !hasLiveCourierCredentials(provider, branch)) {
    return { shipment, synced: false, reason: "tracking-unsupported-or-unconfigured" };
  }

  const consignmentId = shipment.meta?.consignmentId || null;
  let result;
  try {
    result = await trackCourierShipment({
      provider,
      branch,
      trackingId: shipment.trackingId,
      consignmentId,
    });
  } catch (err) {
    logger.warn({ shipmentId: shipment.id, err: err.message }, "Courier status sync failed");
    return { shipment, synced: false, reason: err.message };
  }

  const updated = await prisma.courierShipment.update({
    where: { id: shipment.id },
    data: {
      status: result.status || shipment.status,
      lastSyncedAt: new Date(),
      deliveredAt: result.delivered ? new Date() : shipment.deliveredAt,
      meta: { ...(shipment.meta || {}), lastTrackStatus: result.rawStatus || null },
    },
  });
  return { shipment: updated, synced: true, delivered: Boolean(result.delivered) };
}

async function syncAllActiveShipments({ branchId, limit = 50 }) {
  const active = await prisma.courierShipment.findMany({
    where: {
      branchId,
      status: { notIn: ["DELIVERED", "RETURNED", "COD_COLLECTED"] },
      trackingId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  let synced = 0;
  let delivered = 0;
  for (const s of active) {
    const r = await syncShipmentStatus({ branchId, shipmentId: s.id }).catch(() => null);
    if (r?.synced) synced += 1;
    if (r?.delivered) delivered += 1;
  }
  return { scanned: active.length, synced, delivered };
}

module.exports = {
  createShipment,
  collectCod,
  syncShipmentStatus,
  syncAllActiveShipments,
  getProviderName,
};
