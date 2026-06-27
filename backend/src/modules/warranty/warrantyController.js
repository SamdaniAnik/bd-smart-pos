const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");

function generateClaimNo() {
  return `WC-${Date.now().toString(36).toUpperCase()}`;
}

exports.listClaims = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = req.query.status ? String(req.query.status) : null;
    const serial = String(req.query.serial || "").trim();
    const lq = parseListQuery(req, {
      searchableFields: ["claimNo", "serialNumber", "invoiceNo", "issue"],
      sortableFields: ["id", "claimNo", "status", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const where = {
      branchId,
      ...(status ? { status } : {}),
      ...(serial ? { serialNumber: { contains: serial } } : {}),
    };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [rows, total] = await prisma.$transaction([
        prisma.warrantyClaim.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.warrantyClaim.count({ where }),
      ]);
      return res.json(pagedResult({ data: rows, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const rows = await prisma.warrantyClaim.findMany({
      where,
      orderBy: lq.orderBy || { createdAt: "desc" },
      take: 100,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createClaim = async (req, res) => {
  try {
    const branchId = req.branchId;
    const serialNumber = String(req.body?.serialNumber || req.body?.serial || "").trim();
    const issue = String(req.body?.issue || "").trim();
    if (serialNumber.length < 8) return res.status(400).json({ error: "Serial/IMEI required (min 8 chars)" });
    if (issue.length < 5) return res.status(400).json({ error: "Issue description required" });

    const saleItem = await prisma.saleItem.findFirst({
      where: { serialNumber, sale: { branchId } },
      include: {
        sale: { select: { id: true, invoiceNo: true, customerId: true } },
        product: { select: { id: true, name: true, warrantyDays: true } },
      },
      orderBy: { id: "desc" },
    });

    const now = new Date();
    const warrantyUntil = saleItem?.warrantyUntil ? new Date(saleItem.warrantyUntil) : null;
    const warrantyActive = warrantyUntil ? warrantyUntil >= now : null;

    const row = await prisma.warrantyClaim.create({
      data: {
        branchId,
        claimNo: generateClaimNo(),
        saleItemId: saleItem?.id || null,
        serialNumber,
        customerId: saleItem?.sale?.customerId || null,
        productId: saleItem?.productId || null,
        saleId: saleItem?.saleId || null,
        invoiceNo: saleItem?.sale?.invoiceNo || null,
        warrantyUntil,
        status: "OPEN",
        issue,
        createdById: req.user?.id || null,
      },
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "WARRANTY_CLAIM_OPEN",
      entity: "WarrantyClaim",
      entityId: row.id,
      payload: { serialNumber, warrantyActive },
    });

    res.status(201).json({
      ...row,
      productName: saleItem?.product?.name || null,
      warrantyActive,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateClaimStatus = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const status = String(req.body?.status || "").trim().toUpperCase();
    const resolution = String(req.body?.resolution || "").trim();
    const allowed = new Set(["OPEN", "APPROVED", "REJECTED", "COMPLETED", "REPLACED"]);
    if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status" });

    const existing = await prisma.warrantyClaim.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Claim not found" });

    const updated = await prisma.warrantyClaim.update({
      where: { id },
      data: {
        status,
        resolution: resolution || existing.resolution,
      },
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "WARRANTY_CLAIM_STATUS",
      entity: "WarrantyClaim",
      entityId: id,
      payload: { status, resolution: resolution || null },
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
