const prisma = require("../../utils/prisma");

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
