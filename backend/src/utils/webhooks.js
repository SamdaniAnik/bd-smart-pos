const crypto = require("crypto");

const MAX_STORED_BODY_CHARS = 480_000;

function subscriptionWantsEvent(eventsField, event) {
  if (eventsField == null) return false;
  if (Array.isArray(eventsField)) {
    return eventsField.includes("*") || eventsField.includes(event);
  }
  return false;
}

function signWebhookBody(secret, body) {
  const s = String(secret || "").trim();
  if (!s) return "";
  return crypto.createHmac("sha256", s).update(body).digest("hex");
}

async function persistWebhookDelivery(prisma, row) {
  try {
    await prisma.webhookDeliveryLog.create({ data: row });
  } catch (err) {
    console.warn("[webhook] delivery log persist failed", err?.message);
  }
}

/**
 * Single outbound POST + log row (used by dispatch and manual replay).
 */
async function deliverWebhookOnce(prisma, { branchId, webhookSubscriptionId, url, secret, event, bodyString }) {
  const urlTrim = String(url || "").trim();
  if (!urlTrim || !bodyString) return;
  const storedBody =
    bodyString.length > MAX_STORED_BODY_CHARS ? bodyString.slice(0, MAX_STORED_BODY_CHARS) : bodyString;
  const sig = signWebhookBody(secret, bodyString);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  const t0 = Date.now();
  try {
    const resp = await fetch(urlTrim, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "bd-smart-pos-webhook/1",
        ...(sig ? { "X-Bdpos-Signature": sig } : {}),
      },
      body: bodyString,
      signal: ac.signal,
    });
    const durationMs = Date.now() - t0;
    await persistWebhookDelivery(prisma, {
      branchId,
      webhookSubscriptionId: webhookSubscriptionId || null,
      event,
      url: urlTrim,
      requestBody: storedBody,
      ok: resp.ok,
      statusCode: resp.status,
      errorMessage: resp.ok ? null : `HTTP ${resp.status}`,
      durationMs,
    });
  } catch (e) {
    const durationMs = Date.now() - t0;
    console.warn("[webhook] delivery failed", { webhookSubscriptionId, url: urlTrim, err: e?.message });
    await persistWebhookDelivery(prisma, {
      branchId,
      webhookSubscriptionId: webhookSubscriptionId || null,
      event,
      url: urlTrim,
      requestBody: storedBody,
      ok: false,
      statusCode: null,
      errorMessage: String(e?.message || "fetch failed").slice(0, 4000),
      durationMs,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchBranchWebhooks({ prisma, branchId, event, payload }) {
  if (!prisma || !branchId || !event) return;
  const subs = await prisma.webhookSubscription.findMany({
    where: { branchId, isActive: true },
  });
  const bodyObj = {
    event,
    createdAt: new Date().toISOString(),
    payload: payload || {},
  };
  const body = JSON.stringify(bodyObj);
  for (const row of subs) {
    if (!subscriptionWantsEvent(row.events, event)) continue;
    const url = String(row.url || "").trim();
    if (!url) continue;
    await deliverWebhookOnce(prisma, {
      branchId,
      webhookSubscriptionId: row.id,
      url,
      secret: row.secret,
      event,
      bodyString: body,
    });
  }
}

module.exports = {
  dispatchBranchWebhooks,
  subscriptionWantsEvent,
  signWebhookBody,
  deliverWebhookOnce,
};
