const { fetchJson, normalizeBdPhone } = require("../httpClient");

function paperflyKey(branch) {
  const key = branch?.courierApiKey || process.env.PAPERFLY_API_KEY;
  if (!key) throw new Error("Paperfly paperflykey missing (PAPERFLY_API_KEY or branch courierApiKey)");
  return key;
}

async function bookPaperflyShipment({ branch, recipientName, recipientPhone, address, codAmount, referenceId, district, area }) {
  const payload = {
    paperflykey: paperflyKey(branch),
    merOrderRef: String(referenceId || `POS-${Date.now()}`).slice(0, 40),
    productSizeWeight: process.env.PAPERFLY_PRODUCT_SIZE || "standard",
    productBrief: "Retail parcel",
    packagePrice: String(Math.max(0, Math.round(Number(codAmount || 0)))),
    max_weight: String(process.env.PAPERFLY_MAX_WEIGHT_KG || "1"),
    deliveryOption: process.env.PAPERFLY_DELIVERY_OPTION || "regular",
    custname: String(recipientName || "Customer").slice(0, 100),
    custaddress: String(address || "Dhaka").slice(0, 250),
    customerThana: String(area || process.env.PAPERFLY_DEFAULT_THANA || "Dhaka").slice(0, 80),
    customerDistrict: String(district || process.env.PAPERFLY_DEFAULT_DISTRICT || "Dhaka").slice(0, 80),
    custPhone: normalizeBdPhone(recipientPhone),
  };

  const url = String(
    process.env.PAPERFLY_ORDER_URL || "https://api.paperfly.com.bd/merchant/api/service/new_order.php"
  );

  const body = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });

  const trackingId =
    body.tracking_number ||
    body.trackingNumber ||
    body.orderRef ||
    body.order_ref ||
    body.merOrderRef ||
    payload.merOrderRef;

  if (String(body.response_code || body.status || "").toLowerCase().includes("error")) {
    throw new Error(body.message || body.response_message || "Paperfly order rejected");
  }

  return {
    trackingId: String(trackingId),
    status: "BOOKED",
    meta: { provider: "paperfly", live: true, raw: body },
  };
}

module.exports = { bookPaperflyShipment };
