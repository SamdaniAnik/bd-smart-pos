/**
 * F-commerce automation: WhatsApp Business + Facebook Messenger → OrderInbox.
 *
 * Provider mode via FCOMMERCE_PROVIDER env (default "log"):
 *   - log: parses messages, creates PendingOrder, logs outbound replies
 *   - meta: sends via Meta Graph API when branch fcommerceConfigJson has tokens
 */
const prisma = require("./prisma");
const logger = require("./logger");
const { sendSms, normalizeBdPhone, renderSmsTemplate } = require("./smsGateway");
const { matchesProductQuery } = require("./banglishSearch");

const META_GRAPH = String(process.env.META_GRAPH_URL || "https://graph.facebook.com/v21.0").replace(/\/$/, "");

function getProviderMode() {
  return String(process.env.FCOMMERCE_PROVIDER || "log").trim().toLowerCase();
}

function isFcommerceLive() {
  return getProviderMode() === "meta";
}

function parseConfig(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function generateOrderNo() {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

/** Split chat text into order lines: "2 dudh", "dudh 2", "#12 x 3", "3x bread". */
function parseOrderLines(text) {
  const lines = [];
  const chunks = String(text || "")
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^#(\d+)\s*(?:x\s*)?(\d+(?:\.\d+)?)?$/i);
    if (idMatch) {
      lines.push({ productId: Number(idMatch[1]), qty: Number(idMatch[2] || 1), label: chunk });
      continue;
    }
    const qtyFirst = chunk.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?(.+)$/i);
    if (qtyFirst) {
      lines.push({ qty: Number(qtyFirst[1]), nameQuery: qtyFirst[2].trim(), label: chunk });
      continue;
    }
    const nameFirst = chunk.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
    if (nameFirst) {
      lines.push({ qty: Number(nameFirst[2]), nameQuery: nameFirst[1].trim(), label: chunk });
      continue;
    }
    if (chunk.length >= 2) {
      lines.push({ qty: 1, nameQuery: chunk, label: chunk });
    }
  }
  return lines;
}

async function resolveCartLines(branchId, parsedLines) {
  const products = await prisma.product.findMany({
    where: { branchId, isActive: true },
    select: { id: true, name: true, nameBn: true, sku: true, barcode: true },
    take: 2000,
  });

  const cartLines = [];
  const unmatched = [];

  for (const line of parsedLines) {
    if (line.productId) {
      const product = products.find((p) => p.id === line.productId);
      if (product) {
        cartLines.push({ productId: product.id, qty: line.qty || 1 });
      } else {
        unmatched.push(line.label || `#${line.productId}`);
      }
      continue;
    }
    const query = String(line.nameQuery || "").trim();
    if (!query) continue;
    const hit =
      products.find((p) => matchesProductQuery(query, p)) ||
      products.find((p) => String(p.name || "").toLowerCase().includes(query.toLowerCase()));
    if (hit) {
      cartLines.push({ productId: hit.id, qty: line.qty || 1 });
    } else {
      unmatched.push(line.label || query);
    }
  }

  return { cartLines, unmatched };
}

function extractAddressHints(text) {
  const raw = String(text || "");
  const addressMatch = raw.match(/(?:address|ঠিকানা|addr)\s*[:\-]\s*(.+)/i);
  const districtMatch = raw.match(/(?:district|জেলা)\s*[:\-]\s*(.+)/i);
  return {
    deliveryAddress: addressMatch ? addressMatch[1].split(/[\n,]/)[0].trim() : null,
    district: districtMatch ? districtMatch[1].split(/[\n,]/)[0].trim() : null,
  };
}

async function findBranchByWhatsAppPhoneId(phoneNumberId) {
  const id = String(phoneNumberId || "").trim();
  if (!id) return null;
  const branches = await prisma.branch.findMany({
    where: { isActive: true, fcommerceConfigJson: { not: null } },
    select: { id: true, name: true, fcommerceConfigJson: true },
  });
  return (
    branches.find((b) => String(parseConfig(b.fcommerceConfigJson).whatsappPhoneNumberId || "") === id) ||
    null
  );
}

async function findBranchByMessengerPageId(pageId) {
  const id = String(pageId || "").trim();
  if (!id) return null;
  const branches = await prisma.branch.findMany({
    where: { isActive: true, fcommerceConfigJson: { not: null } },
    select: { id: true, name: true, fcommerceConfigJson: true },
  });
  return (
    branches.find((b) => String(parseConfig(b.fcommerceConfigJson).messengerPageId || "") === id) || null
  );
}

async function findBranchByVerifyToken(verifyToken) {
  const token = String(verifyToken || "").trim();
  if (!token) return null;
  const envToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (envToken && envToken === token) {
    const first = await prisma.branch.findFirst({ where: { isActive: true }, select: { id: true, name: true, fcommerceConfigJson: true } });
    return first;
  }
  const branches = await prisma.branch.findMany({
    where: { isActive: true, fcommerceConfigJson: { not: null } },
    select: { id: true, name: true, fcommerceConfigJson: true },
  });
  return branches.find((b) => String(parseConfig(b.fcommerceConfigJson).metaVerifyToken || "") === token) || null;
}

async function createOrderFromChat({
  branchId,
  platform,
  senderId,
  messageId,
  senderName,
  senderPhone,
  text,
}) {
  const existing = messageId
    ? await prisma.pendingOrder.findFirst({ where: { branchId, externalMessageId: String(messageId) } })
    : null;
  if (existing) return { order: existing, duplicate: true };

  const parsedLines = parseOrderLines(text);
  if (!parsedLines.length) {
    return { error: "NO_LINES", reply: buildHelpReply() };
  }

  const { cartLines, unmatched } = await resolveCartLines(branchId, parsedLines);
  if (!cartLines.length) {
    return {
      error: "NO_MATCH",
      unmatched,
      reply: `Sorry, we could not match: ${unmatched.join(", ")}. Reply with product name + qty, e.g. "2 dudh" or "#12 x 1".`,
    };
  }

  const hints = extractAddressHints(text);
  const phone = normalizeBdPhone(senderPhone) ? senderPhone : null;
  const customerName =
    String(senderName || "").trim() ||
    (phone ? `Customer ${phone}` : platform === "WHATSAPP" ? "WhatsApp Customer" : "Messenger Customer");

  const source = platform === "WHATSAPP" ? "WHATSAPP" : "FACEBOOK";
  let notes = `Auto-imported from ${platform}`;
  if (unmatched.length) notes += `. Unmatched: ${unmatched.join(", ")}`;

  const order = await prisma.pendingOrder.create({
    data: {
      branchId,
      orderNo: generateOrderNo(),
      source,
      status: "PENDING",
      customerName: customerName.slice(0, 120),
      customerPhone: phone,
      district: hints.district,
      deliveryAddress: hints.deliveryAddress,
      deliveryFee: 60,
      paymentMethod: "COD",
      notes,
      cartJson: JSON.stringify(cartLines),
      externalPlatform: platform,
      externalSenderId: String(senderId || ""),
      externalMessageId: messageId ? String(messageId) : null,
    },
  });

  return { order, unmatched, reply: buildOrderConfirmReply(order, cartLines.length, unmatched) };
}

function buildHelpReply() {
  return (
    "Send your order like:\n" +
    "2 dudh\n" +
    "1 bread\n" +
    "Or #productId x qty\n" +
    "Address: your area, district"
  );
}

function buildOrderConfirmReply(order, lineCount, unmatched) {
  let msg = `Order ${order.orderNo} received (${lineCount} item(s)). We will confirm shortly.`;
  if (unmatched?.length) msg += ` Could not match: ${unmatched.join(", ")}.`;
  return msg;
}

function buildTrackingReply(order) {
  const tracking = order.trackingId || "pending";
  const courier = order.courierName || "courier";
  return `Order ${order.orderNo}: shipped via ${courier}. Tracking: ${tracking}. Thank you!`;
}

async function sendMetaWhatsApp({ config, to, text }) {
  const token = String(config.metaAccessToken || process.env.META_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(config.whatsappPhoneNumberId || "").trim();
  if (!token || !phoneNumberId) return { status: "SKIPPED", reason: "missing credentials" };

  const response = await fetch(`${META_GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to || "").replace(/\D/g, ""),
      type: "text",
      text: { body: String(text || "").slice(0, 4096) },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `WhatsApp send failed (${response.status})`);
  return { status: "SENT", providerMessageId: body?.messages?.[0]?.id || null };
}

async function sendMetaMessenger({ config, recipientId, text }) {
  const token = String(config.metaAccessToken || process.env.META_ACCESS_TOKEN || "").trim();
  const pageId = String(config.messengerPageId || "").trim();
  if (!token || !pageId) return { status: "SKIPPED", reason: "missing credentials" };

  const response = await fetch(`${META_GRAPH}/${pageId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(recipientId) },
      message: { text: String(text || "").slice(0, 2000) },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Messenger send failed (${response.status})`);
  return { status: "SENT", providerMessageId: body?.message_id || null };
}

async function sendAutoReply({ branch, order, platform, recipientId, text, smsPhone }) {
  const config = parseConfig(branch.fcommerceConfigJson);
  if (config.autoReplyEnabled === false) return { channel: "none" };

  const message = text || buildOrderConfirmReply(order, 1, []);
  const results = { whatsapp: null, messenger: null, sms: null };

  try {
    if (getProviderMode() === "meta") {
      if (platform === "WHATSAPP" && config.whatsappPhoneNumberId) {
        results.whatsapp = await sendMetaWhatsApp({ config, to: recipientId, text: message });
      } else if (platform === "MESSENGER" && config.messengerPageId) {
        results.messenger = await sendMetaMessenger({ config, recipientId, text: message });
      }
    } else {
      logger.info({ branchId: branch.id, platform, recipientId, message }, "F-commerce reply simulated (FCOMMERCE_PROVIDER=log)");
      results.simulated = true;
    }
  } catch (err) {
    logger.error({ err: err.message, branchId: branch.id }, "F-commerce Meta reply failed");
    results.error = err.message;
  }

  if (config.smsFallback !== false && smsPhone) {
    const smsTemplate =
      platform === "WHATSAPP" || platform === "MESSENGER"
        ? "Order {orderNo} received. {message}"
        : "{message}";
    results.sms = await sendSms({
      to: smsPhone,
      message: renderSmsTemplate(smsTemplate, {
        orderNo: order?.orderNo || "-",
        message: String(message).slice(0, 140),
      }),
    });
  }

  return results;
}

async function notifyTrackingUpdate(pendingOrderId) {
  const order = await prisma.pendingOrder.findUnique({
    where: { id: Number(pendingOrderId) },
    include: { branch: { select: { id: true, name: true, fcommerceConfigJson: true } } },
  });
  if (!order?.externalPlatform || !order.externalSenderId || !order.trackingId) return null;

  const text = buildTrackingReply(order);
  return sendAutoReply({
    branch: order.branch,
    order,
    platform: order.externalPlatform,
    recipientId: order.externalSenderId,
    text,
    smsPhone: order.customerPhone,
  });
}

/** Process Meta webhook payload (WhatsApp Cloud + Messenger). */
async function processMetaWebhook(body) {
  const objectType = String(body?.object || "");
  const results = [];

  if (objectType === "whatsapp_business_account") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;
        const branch = await findBranchByWhatsAppPhoneId(phoneNumberId);
        if (!branch) {
          results.push({ skipped: true, reason: "unknown whatsapp phone_number_id", phoneNumberId });
          continue;
        }
        const config = parseConfig(branch.fcommerceConfigJson);
        if (config.enabled === false) continue;

        for (const msg of value.messages || []) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          const outcome = await createOrderFromChat({
            branchId: branch.id,
            platform: "WHATSAPP",
            senderId: msg.from,
            messageId: msg.id,
            senderName: value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name,
            senderPhone: msg.from,
            text: msg.text.body,
          });
          if (outcome.order && !outcome.duplicate && outcome.reply) {
            await sendAutoReply({
              branch,
              order: outcome.order,
              platform: "WHATSAPP",
              recipientId: msg.from,
              text: outcome.reply,
              smsPhone: msg.from,
            });
          } else if (outcome.reply && !outcome.order) {
            await sendAutoReply({
              branch,
              order: null,
              platform: "WHATSAPP",
              recipientId: msg.from,
              text: outcome.reply,
              smsPhone: msg.from,
            });
          }
          results.push({ platform: "WHATSAPP", ...outcome });
        }
      }
    }
  }

  if (objectType === "page") {
    for (const entry of body.entry || []) {
      const pageId = entry.id;
      const branch = await findBranchByMessengerPageId(pageId);
      if (!branch) {
        results.push({ skipped: true, reason: "unknown messenger page id", pageId });
        continue;
      }
      const config = parseConfig(branch.fcommerceConfigJson);
      if (config.enabled === false) continue;

      for (const event of entry.messaging || []) {
        const msg = event.message;
        if (!msg?.text) continue;
        const senderId = event.sender?.id;
        const outcome = await createOrderFromChat({
          branchId: branch.id,
          platform: "MESSENGER",
          senderId,
          messageId: msg.mid,
          senderName: null,
          senderPhone: null,
          text: msg.text,
        });
        if (outcome.order && !outcome.duplicate && outcome.reply) {
          await sendAutoReply({
            branch,
            order: outcome.order,
            platform: "MESSENGER",
            recipientId: senderId,
            text: outcome.reply,
            smsPhone: null,
          });
        } else if (outcome.reply && !outcome.order) {
          await sendAutoReply({
            branch,
            order: null,
            platform: "MESSENGER",
            recipientId: senderId,
            text: outcome.reply,
            smsPhone: null,
          });
        }
        results.push({ platform: "MESSENGER", ...outcome });
      }
    }
  }

  return results;
}

module.exports = {
  getProviderMode,
  isFcommerceLive,
  parseConfig,
  parseOrderLines,
  findBranchByVerifyToken,
  processMetaWebhook,
  notifyTrackingUpdate,
  sendAutoReply,
  buildOrderConfirmReply,
  buildTrackingReply,
};
