const { fetchJson, normalizeBdPhone } = require("../httpClient");

function steadfastBaseUrl() {
  return String(process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1").replace(/\/$/, "");
}

function credentials(branch) {
  const apiKey = branch?.courierApiKey || process.env.STEADFAST_API_KEY;
  const secretKey = process.env.STEADFAST_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error("Steadfast credentials missing (STEADFAST_API_KEY, STEADFAST_SECRET_KEY or branch courierApiKey)");
  }
  return { apiKey, secretKey };
}

async function bookSteadfastShipment({ branch, recipientName, recipientPhone, address, codAmount, referenceId }) {
  const { apiKey, secretKey } = credentials(branch);
  const invoice = String(referenceId || `POS-${Date.now()}`)
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 60);

  const payload = {
    invoice,
    recipient_name: String(recipientName || "Customer").slice(0, 100),
    recipient_phone: normalizeBdPhone(recipientPhone),
    recipient_address: String(address || "Dhaka").slice(0, 250),
    cod_amount: Math.max(0, Number(codAmount || 0)),
    note: "BD Smart POS shipment",
  };

  const body = await fetchJson(`${steadfastBaseUrl()}/create_order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Api-Key": apiKey,
      "Secret-Key": secretKey,
    },
    body: JSON.stringify(payload),
  });

  const consignment = body.consignment || body.data?.consignment || body;
  const trackingId =
    consignment.tracking_code ||
    consignment.trackingCode ||
    consignment.consignment_id ||
    consignment.consignmentId ||
    invoice;

  return {
    trackingId: String(trackingId),
    status: "BOOKED",
    meta: { provider: "steadfast", live: true, consignmentId: consignment.consignment_id || consignment.consignmentId, raw: body },
  };
}

function mapSteadfastStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["delivered", "partial_delivered"].includes(s)) return "DELIVERED";
  if (["cancelled", "return", "returned"].includes(s)) return "RETURNED";
  if (["in_review", "pending"].includes(s)) return "BOOKED";
  return "IN_TRANSIT";
}

async function trackSteadfastShipment({ branch, trackingId, consignmentId }) {
  const { apiKey, secretKey } = credentials(branch);
  const headers = {
    Accept: "application/json",
    "Api-Key": apiKey,
    "Secret-Key": secretKey,
  };
  const path = consignmentId
    ? `status_by_cid/${encodeURIComponent(consignmentId)}`
    : `status_by_trackingcode/${encodeURIComponent(trackingId)}`;
  const body = await fetchJson(`${steadfastBaseUrl()}/${path}`, { method: "GET", headers });
  const deliveryStatus = body.delivery_status || body.status || body.data?.delivery_status;
  const mapped = mapSteadfastStatus(deliveryStatus);
  return { status: mapped, delivered: mapped === "DELIVERED", raw: body, rawStatus: deliveryStatus };
}

module.exports = { bookSteadfastShipment, trackSteadfastShipment };
