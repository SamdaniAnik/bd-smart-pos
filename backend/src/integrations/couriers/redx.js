const { fetchJson, normalizeBdPhone } = require("../httpClient");

function redxBaseUrl() {
  return String(process.env.REDX_BASE_URL || "https://openapi.redx.com.bd/v1.0.0-beta").replace(/\/$/, "");
}

function redxToken(branch) {
  const token = branch?.courierApiKey || process.env.REDX_API_TOKEN;
  if (!token) throw new Error("RedX API token missing (REDX_API_TOKEN or branch courierApiKey)");
  return token;
}

async function bookRedxShipment({ branch, recipientName, recipientPhone, address, codAmount, referenceId }) {
  const pickupStoreId = Number(branch?.courierStoreId || process.env.REDX_PICKUP_STORE_ID);
  const deliveryAreaId = Number(process.env.REDX_DELIVERY_AREA_ID || 1);
  if (!pickupStoreId) throw new Error("RedX pickup_store_id required (branch courierStoreId or REDX_PICKUP_STORE_ID)");

  const payload = {
    customer_name: String(recipientName || "Customer").slice(0, 100),
    customer_phone: normalizeBdPhone(recipientPhone),
    customer_address: String(address || "Dhaka").slice(0, 250),
    delivery_area_id: deliveryAreaId,
    delivery_area: process.env.REDX_DELIVERY_AREA_NAME || "Dhaka",
    cash_collection_amount: String(Math.max(0, Math.round(Number(codAmount || 0)))),
    parcel_weight: Number(process.env.REDX_PARCEL_WEIGHT_GRAM || 500),
    merchant_invoice_id: String(referenceId || `POS-${Date.now()}`).slice(0, 40),
    pickup_store_id: pickupStoreId,
    instruction: "Handle with care",
  };

  const body = await fetchJson(`${redxBaseUrl()}/parcel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "API-ACCESS-TOKEN": `Bearer ${redxToken(branch)}`,
    },
    body: JSON.stringify(payload),
  });

  const trackingId =
    body.tracking_id ||
    body.trackingId ||
    body.data?.tracking_id ||
    body.data?.trackingId ||
    body.parcel?.tracking_id;

  if (!trackingId) throw new Error(body.message || body.error || "RedX parcel created but tracking id missing");

  return {
    trackingId: String(trackingId),
    status: "BOOKED",
    meta: { provider: "redx", live: true, raw: body },
  };
}

module.exports = { bookRedxShipment };
