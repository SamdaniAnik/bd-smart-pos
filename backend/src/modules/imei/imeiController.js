const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const { validateImei, normalizeImei } = require("../../utils/imei");

const STATUSES = ["IN_STOCK", "SOLD", "RETURNED", "BLOCKED"];

/** Is this IMEI free to sell at this branch? Checks the registry and past sales. */
async function resolveImeiAvailability(branchId, imei) {
  const record = await prisma.imeiRecord.findUnique({
    where: { branchId_imei: { branchId, imei } },
  });
  if (record && ["SOLD", "BLOCKED"].includes(record.status)) {
    return { available: false, record, reason: record.status === "BLOCKED" ? "blocked" : "sold" };
  }
  const priorSale = await prisma.saleItem.findFirst({
    where: { serialNumber: imei, sale: { branchId } },
    select: { id: true },
  });
  if (priorSale) return { available: false, record, reason: "sold" };
  return { available: true, record, reason: null };
}

exports.validate = async (req, res) => {
  try {
    const branchId = req.branchId;
    const raw = req.query.imei || req.query.serial || "";
    const v = validateImei(raw);
    if (!v.ok) {
      return res.json({
        valid: false,
        available: false,
        imei: v.normalized,
        reason: v.reason === "checksum" ? "invalid_checksum" : v.reason === "length" ? "invalid_length" : "invalid",
      });
    }
    const availability = await resolveImeiAvailability(branchId, v.normalized);
    res.json({
      valid: true,
      available: availability.available,
      imei: v.normalized,
      reason: availability.reason,
      status: availability.record?.status || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.lookup = async (req, res) => {
  try {
    const branchId = req.branchId;
    const imei = normalizeImei(req.query.imei || req.query.serial || "");
    if (!imei) return res.status(400).json({ error: "imei is required" });
    const record = await prisma.imeiRecord.findUnique({
      where: { branchId_imei: { branchId, imei } },
    });
    const saleItem = await prisma.saleItem.findFirst({
      where: { serialNumber: imei, sale: { branchId } },
      include: {
        product: { select: { id: true, name: true, sku: true, warrantyDays: true } },
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            createdAt: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });
    if (!record && !saleItem) return res.status(404).json({ error: "IMEI not found in registry or sales" });
    res.json({ imei, record, saleItem });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.list = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query.status || "").trim().toUpperCase();
    const productId = Number(req.query.productId) || null;
    const search = normalizeImei(req.query.search || "");
    const where = { branchId };
    if (STATUSES.includes(status)) where.status = status;
    if (productId) where.productId = productId;
    if (search) where.imei = { contains: search };
    const rows = await prisma.imeiRecord.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean))];
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    res.json(rows.map((r) => ({ ...r, product: r.productId ? productMap.get(r.productId) || null : null })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Bulk intake of handset IMEIs into stock. Validates Luhn + de-dupes. */
exports.intake = async (req, res) => {
  try {
    const branchId = req.branchId;
    const productId = Number(req.body?.productId) || null;
    if (productId) {
      const product = await prisma.product.findFirst({ where: { id: productId, branchId } });
      if (!product) return res.status(404).json({ error: "Product not found" });
    }
    const rawList = Array.isArray(req.body?.imeis)
      ? req.body.imeis
      : String(req.body?.imeis || "")
          .split(/[\s,;]+/)
          .filter(Boolean);
    if (!rawList.length) return res.status(400).json({ error: "Provide at least one IMEI" });

    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const raw of rawList) {
      const v = validateImei(raw);
      if (!v.ok) {
        rejected.push({ imei: v.normalized || String(raw), reason: v.reason || "invalid" });
        continue;
      }
      if (seen.has(v.normalized)) {
        rejected.push({ imei: v.normalized, reason: "duplicate_in_batch" });
        continue;
      }
      seen.add(v.normalized);
      const existing = await prisma.imeiRecord.findUnique({
        where: { branchId_imei: { branchId, imei: v.normalized } },
      });
      if (existing) {
        rejected.push({ imei: v.normalized, reason: "already_registered" });
        continue;
      }
      accepted.push(v.normalized);
    }

    let created = 0;
    if (accepted.length) {
      const result = await prisma.imeiRecord.createMany({
        data: accepted.map((imei) => ({
          branchId,
          imei,
          productId,
          status: "IN_STOCK",
          createdById: req.user?.id || null,
        })),
        skipDuplicates: true,
      });
      created = result.count;
    }

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "IMEI_INTAKE",
      entity: "ImeiRecord",
      entityId: null,
      payload: { branchId, productId, created, rejectedCount: rejected.length },
    });

    res.status(201).json({ created, acceptedCount: accepted.length, rejected });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid record id" });
    const status = String(req.body?.status || "").trim().toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of ${STATUSES.join(", ")}` });
    }
    const record = await prisma.imeiRecord.findFirst({ where: { id, branchId } });
    if (!record) return res.status(404).json({ error: "IMEI record not found" });
    const updated = await prisma.imeiRecord.update({
      where: { id },
      data: {
        status,
        note: req.body?.note != null ? String(req.body.note).slice(0, 191) : record.note,
        ...(status === "SOLD" ? { soldAt: record.soldAt || new Date() } : {}),
        ...(status === "IN_STOCK" ? { soldAt: null, saleId: null, saleItemId: null, customerId: null } : {}),
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "IMEI_STATUS_UPDATE",
      entity: "ImeiRecord",
      entityId: id,
      payload: { status },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resolveImeiAvailability = resolveImeiAvailability;
