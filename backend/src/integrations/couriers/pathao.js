const { fetchJson, normalizeBdPhone } = require("../httpClient");

const tokenCache = new Map();

function pathaoBaseUrl() {
  const env = String(process.env.PATHAO_ENV || "production").toLowerCase();
  if (env === "sandbox") return "https://courier-api-sandbox.pathao.com";
  return String(process.env.PATHAO_BASE_URL || "https://api-hermes.pathao.com").replace(/\/$/, "");
}

function credentials(branch) {
  const clientId = branch?.courierApiKey || process.env.PATHAO_CLIENT_ID;
  const clientSecret = process.env.PATHAO_CLIENT_SECRET;
  const username = process.env.PATHAO_USERNAME;
  const password = process.env.PATHAO_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) {
    throw new Error("Pathao credentials missing (PATHAO_CLIENT_ID/SECRET/USERNAME/PASSWORD or branch courierApiKey)");
  }
  return { clientId, clientSecret, username, password };
}

async function getAccessToken(branch) {
  const creds = credentials(branch);
  const cacheKey = `${creds.clientId}:${creds.username}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;

  const body = await fetchJson(`${pathaoBaseUrl()}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "password",
      username: creds.username,
      password: creds.password,
    }),
  });

  const token = body.access_token || body.data?.access_token;
  if (!token) throw new Error(body.message || "Pathao token grant failed");
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  });
  return token;
}

async function bookPathaoShipment({ branch, recipientName, recipientPhone, address, codAmount, referenceId }) {
  const storeId = Number(branch?.courierStoreId || process.env.PATHAO_STORE_ID);
  if (!storeId) throw new Error("Pathao store_id required (branch courierStoreId or PATHAO_STORE_ID)");

  const token = await getAccessToken(branch);
  const payload = {
    store_id: storeId,
    merchant_order_id: String(referenceId || `POS-${Date.now()}`).slice(0, 40),
    recipient_name: String(recipientName || "Customer").slice(0, 100),
    recipient_phone: normalizeBdPhone(recipientPhone),
    recipient_address: String(address || "Dhaka").slice(0, 250),
    delivery_type: Number(process.env.PATHAO_DELIVERY_TYPE || 48),
    item_type: Number(process.env.PATHAO_ITEM_TYPE || 2),
    item_quantity: 1,
    item_weight: Number(process.env.PATHAO_ITEM_WEIGHT || 0.5),
    amount_to_collect: Math.max(0, Math.round(Number(codAmount || 0))),
    item_description: "Retail parcel",
  };

  const body = await fetchJson(`${pathaoBaseUrl()}/aladdin/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = body.data || body;
  const trackingId =
    data.consignment_id ||
    data.tracking_id ||
    data.order_id ||
    data.merchant_order_id ||
    payload.merchant_order_id;

  return {
    trackingId: String(trackingId),
    status: "BOOKED",
    meta: { provider: "pathao", live: true, raw: body },
  };
}

function mapPathaoStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("deliver")) return "DELIVERED";
  if (s.includes("return")) return "RETURNED";
  if (s.includes("cancel")) return "RETURNED";
  if (s.includes("pickup") || s.includes("pending")) return "BOOKED";
  return "IN_TRANSIT";
}

async function trackPathaoShipment({ branch, trackingId }) {
  const token = await getAccessToken(branch);
  const body = await fetchJson(
    `${pathaoBaseUrl()}/aladdin/api/v1/orders/${encodeURIComponent(trackingId)}/info`,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    }
  );
  const data = body.data || body;
  const rawStatus = data.order_status || data.status || data.delivery_status;
  const mapped = mapPathaoStatus(rawStatus);
  return { status: mapped, delivered: mapped === "DELIVERED", raw: body, rawStatus };
}

module.exports = { bookPathaoShipment, getAccessToken, trackPathaoShipment };
