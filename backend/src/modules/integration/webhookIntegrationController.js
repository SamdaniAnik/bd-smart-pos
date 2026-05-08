const prisma = require("../../utils/prisma");
const { deliverWebhookOnce } = require("../../utils/webhooks");

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replaceAll('"', '""')}"`;
}

function normalizeEvents(input) {
  if (input == null) return ["sale.created"];
  if (input === "*" || input === "") return ["*"];
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 32);
  }
  if (typeof input === "string") {
    return input
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 32);
  }
  return ["sale.created"];
}

exports.listWebhooks = async (req, res) => {
  try {
    const rows = await prisma.webhookSubscription.findMany({
      where: { branchId: req.branchId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createWebhook = async (req, res) => {
  try {
    const branchId = req.branchId;
    const url = String(req.body?.url || "").trim().slice(0, 2048);
    const secret = String(req.body?.secret || "").slice(0, 256);
    const events = normalizeEvents(req.body?.events);
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "url must start with http:// or https://" });
    const row = await prisma.webhookSubscription.create({
      data: {
        branchId,
        url,
        secret,
        events,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateWebhook = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.webhookSubscription.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Webhook not found" });
    const data = {};
    if (req.body?.url !== undefined) {
      const url = String(req.body.url || "").trim().slice(0, 2048);
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "url must start with http:// or https://" });
      data.url = url;
    }
    if (req.body?.secret !== undefined) data.secret = String(req.body.secret || "").slice(0, 256);
    if (req.body?.events !== undefined) data.events = normalizeEvents(req.body.events);
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const row = await prisma.webhookSubscription.update({ where: { id }, data });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteWebhook = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.webhookSubscription.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Webhook not found" });
    await prisma.webhookSubscription.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listWebhookDeliveries = async (req, res) => {
  try {
    const branchId = req.branchId;
    const take = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const rows = await prisma.webhookDeliveryLog.findMany({
      where: { branchId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        webhookSubscriptionId: true,
        event: true,
        url: true,
        ok: true,
        statusCode: true,
        errorMessage: true,
        durationMs: true,
        createdAt: true,
        requestBody: true,
      },
    });
    const sanitized = rows.map(({ requestBody, ...rest }) => ({
      ...rest,
      canReplay: Boolean(requestBody && String(requestBody).trim().length > 0),
    }));
    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportWebhookDeliveriesCsv = async (req, res) => {
  try {
    const branchId = req.branchId;
    const take = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const rows = await prisma.webhookDeliveryLog.findMany({
      where: { branchId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        webhookSubscriptionId: true,
        event: true,
        url: true,
        ok: true,
        statusCode: true,
        errorMessage: true,
        durationMs: true,
        createdAt: true,
        requestBody: true,
      },
    });
    const header = [
      "id",
      "createdAt",
      "event",
      "webhookSubscriptionId",
      "url",
      "ok",
      "statusCode",
      "errorMessage",
      "durationMs",
      "hasStoredBody",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const hasBody = Boolean(r.requestBody && String(r.requestBody).trim());
      const err = (r.errorMessage || "").replaceAll("\r\n", " ").replaceAll("\n", " ");
      lines.push(
        [
          r.id,
          r.createdAt ? r.createdAt.toISOString() : "",
          r.event,
          r.webhookSubscriptionId ?? "",
          r.url,
          r.ok ? "1" : "0",
          r.statusCode ?? "",
          err,
          r.durationMs ?? "",
          hasBody ? "1" : "0",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="webhook-deliveries.csv"');
    res.send(lines.join("\n"));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.replayWebhookDelivery = async (req, res) => {
  try {
    const branchId = req.branchId;
    const deliveryId = Number(req.params.deliveryId);
    if (Number.isNaN(deliveryId)) return res.status(400).json({ error: "Invalid delivery id" });

    const log = await prisma.webhookDeliveryLog.findFirst({
      where: { id: deliveryId, branchId },
    });
    if (!log) return res.status(404).json({ error: "Delivery not found" });
    const bodyString = log.requestBody ? String(log.requestBody).trim() : "";
    if (!bodyString) return res.status(400).json({ error: "No stored payload for this delivery (cannot replay)" });

    let url = String(log.url || "").trim();
    let secret = "";
    const webhookSubscriptionId = log.webhookSubscriptionId || null;
    if (log.webhookSubscriptionId) {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id: log.webhookSubscriptionId, branchId },
      });
      if (sub) {
        secret = String(sub.secret || "");
        url = String(sub.url || "").trim() || url;
      }
    }
    if (!url) return res.status(400).json({ error: "No target URL for replay" });

    await deliverWebhookOnce(prisma, {
      branchId,
      webhookSubscriptionId,
      url,
      secret,
      event: String(log.event || "replay"),
      bodyString,
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
