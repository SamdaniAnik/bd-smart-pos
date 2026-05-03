const crypto = require("crypto");

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
    const sig = signWebhookBody(row.secret, body);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "bd-smart-pos-webhook/1",
          ...(sig ? { "X-Bdpos-Signature": sig } : {}),
        },
        body,
        signal: ac.signal,
      });
    } catch (e) {
      console.warn("[webhook] delivery failed", { id: row.id, url, err: e?.message });
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { dispatchBranchWebhooks, subscriptionWantsEvent, signWebhookBody };
