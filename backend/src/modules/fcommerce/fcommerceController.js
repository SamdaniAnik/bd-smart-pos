const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const {
  parseConfig,
  findBranchByVerifyToken,
  processMetaWebhook,
  getProviderMode,
  isFcommerceLive,
} = require("../../utils/fcommerceService");

const CONFIG_KEYS = [
  "enabled",
  "autoReplyEnabled",
  "smsFallback",
  "metaVerifyToken",
  "metaAccessToken",
  "whatsappPhoneNumberId",
  "messengerPageId",
];

function sanitizeConfig(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (src[key] === undefined) continue;
    if (key === "enabled" || key === "autoReplyEnabled" || key === "smsFallback") {
      out[key] = Boolean(src[key]);
    } else {
      out[key] = String(src[key] || "").trim().slice(0, 500);
    }
  }
  if (out.enabled === undefined) out.enabled = true;
  if (out.autoReplyEnabled === undefined) out.autoReplyEnabled = true;
  if (out.smsFallback === undefined) out.smsFallback = true;
  return out;
}

function maskConfig(config) {
  const c = { ...config };
  if (c.metaAccessToken) c.metaAccessToken = `${c.metaAccessToken.slice(0, 4)}…${c.metaAccessToken.slice(-4)}`;
  if (c.metaVerifyToken) c.metaVerifyToken = `${c.metaVerifyToken.slice(0, 4)}…`;
  return c;
}

exports.getConfig = async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.branchId },
      select: { id: true, fcommerceConfigJson: true },
    });
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    const config = parseConfig(branch.fcommerceConfigJson);
    res.json({
      provider: getProviderMode(),
      live: isFcommerceLive(),
      webhookUrl: "/api/fcommerce/meta/webhook",
      config: maskConfig(config),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const branchId = req.branchId;
    const existing = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { fcommerceConfigJson: true },
    });
    const merged = { ...parseConfig(existing?.fcommerceConfigJson), ...sanitizeConfig(req.body?.config || req.body) };
    // Keep existing secrets when the form leaves token fields blank.
    const incoming = req.body?.config || req.body || {};
    if (!String(incoming.metaAccessToken || "").trim() && parseConfig(existing?.fcommerceConfigJson).metaAccessToken) {
      merged.metaAccessToken = parseConfig(existing?.fcommerceConfigJson).metaAccessToken;
    }
    if (!String(incoming.metaVerifyToken || "").trim() && parseConfig(existing?.fcommerceConfigJson).metaVerifyToken) {
      merged.metaVerifyToken = parseConfig(existing?.fcommerceConfigJson).metaVerifyToken;
    }
    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: { fcommerceConfigJson: JSON.stringify(merged) },
      select: { id: true, fcommerceConfigJson: true },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FCOMMERCE_CONFIG_UPDATE",
      entity: "Branch",
      entityId: branchId,
      payload: { enabled: merged.enabled, hasWhatsApp: Boolean(merged.whatsappPhoneNumberId), hasMessenger: Boolean(merged.messengerPageId) },
    });
    res.json({ config: maskConfig(parseConfig(updated.fcommerceConfigJson)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** F-commerce monitoring dashboard: inbound order volume by platform + recent feed. */
exports.getMonitor = async (req, res) => {
  try {
    const branchId = req.branchId;
    const [byPlatform, statusCounts, recent, branch] = await Promise.all([
      prisma.pendingOrder.groupBy({
        by: ["externalPlatform"],
        where: { branchId, externalPlatform: { not: null } },
        _count: { id: true },
      }),
      prisma.pendingOrder.groupBy({
        by: ["status"],
        where: { branchId, externalPlatform: { not: null } },
        _count: { id: true },
      }),
      prisma.pendingOrder.findMany({
        where: { branchId, externalPlatform: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          orderNo: true,
          customerName: true,
          customerPhone: true,
          externalPlatform: true,
          externalSenderId: true,
          status: true,
          deliveryFee: true,
          createdAt: true,
        },
      }),
      prisma.branch.findUnique({ where: { id: branchId }, select: { fcommerceConfigJson: true } }),
    ]);
    const config = parseConfig(branch?.fcommerceConfigJson);
    res.json({
      provider: getProviderMode(),
      live: isFcommerceLive(),
      enabled: Boolean(config.enabled),
      autoReplyEnabled: Boolean(config.autoReplyEnabled),
      smsFallback: Boolean(config.smsFallback),
      hasWhatsApp: Boolean(config.whatsappPhoneNumberId),
      hasMessenger: Boolean(config.messengerPageId),
      byPlatform: byPlatform.map((r) => ({ platform: r.externalPlatform, count: r._count.id })),
      statusCounts: statusCounts.map((r) => ({ status: r.status, count: r._count.id })),
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** Meta webhook verification (GET). */
exports.verifyMetaWebhook = async (req, res) => {
  try {
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = req.query["hub.challenge"];
    if (mode !== "subscribe") return res.status(403).send("Forbidden");

    const branch = await findBranchByVerifyToken(token);
    if (!branch) return res.status(403).send("Invalid verify token");
    return res.status(200).send(String(challenge ?? ""));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** Meta webhook events (POST) — WhatsApp + Messenger. */
exports.handleMetaWebhook = async (req, res) => {
  try {
    // Meta expects a quick 200 even when processing async-ish work.
    const results = await processMetaWebhook(req.body || {});
    res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
