const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const { recordDeliveryReport, getProviderName } = require("../../utils/smsGateway");

/**
 * Public SMS delivery report (DLR) webhook. Providers (bulksmsbd, SSL Wireless,
 * etc.) POST/GET the final delivery state of a previously sent message here.
 * No auth — the message is matched by its provider message id.
 *
 * Common field names across BD gateways are accepted defensively.
 */
exports.handleDeliveryReport = async (req, res) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const providerMessageId =
      src.message_id || src.messageId || src.csms_id || src.csmsId || src.reference_id || src.referenceId || null;
    const status = src.status || src.dlr || src.delivery_status || src.deliveryStatus || src.state || null;

    if (!providerMessageId) {
      return res.status(400).json({ ok: false, error: "message id is required" });
    }

    const result = await recordDeliveryReport({
      providerMessageId,
      status,
      raw: src.error || src.error_message || null,
    });
    logger.info({ provider: getProviderName(), providerMessageId, status, ok: result.ok }, "SMS DLR received");
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 400).json({ ok: false, reason: result.reason });
    return res.json({ ok: true, status: result.log?.status, dlrStatus: result.log?.dlrStatus });
  } catch (error) {
    logger.error({ err: error.message }, "SMS DLR handling failed");
    res.status(500).json({ ok: false, error: error.message });
  }
};

exports.listDeliveryLogs = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "").trim().toUpperCase();
    const rows = await prisma.smsDeliveryLog.findMany({
      where: {
        branchId,
        ...(status && status !== "ALL" ? { status } : {}),
      },
      orderBy: { id: "desc" },
      take: 200,
    });
    res.json({ provider: getProviderName(), logs: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listTemplates = async (req, res) => {
  try {
    const rows = await prisma.smsTemplate.findMany({
      where: { branchId: req.branchId },
      orderBy: { key: "asc" },
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertTemplate = async (req, res) => {
  try {
    const branchId = req.branchId;
    const key = String(req.body?.key || "").trim().toUpperCase();
    const body = String(req.body?.body || "").trim();
    if (!key) return res.status(400).json({ error: "Template key is required" });
    if (!body) return res.status(400).json({ error: "Template body is required" });
    const name = req.body?.name ? String(req.body.name).trim().slice(0, 191) : null;
    const isActive = req.body?.isActive != null ? Boolean(req.body.isActive) : true;

    const row = await prisma.smsTemplate.upsert({
      where: { branchId_key: { branchId, key } },
      update: { body, name, isActive },
      create: { branchId, key, body, name, isActive },
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.smsTemplate.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Template not found" });
    await prisma.smsTemplate.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
