const prisma = require("../../utils/prisma");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");

function nextPrescriptionNo(branchId) {
  return `RX-${branchId}-${Date.now().toString(36).toUpperCase()}`;
}

exports.listPrescriptions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "").trim().toUpperCase();
    const lq = parseListQuery(req, {
      searchableFields: ["patientName", "patientPhone", "doctorName", "prescriptionNo"],
      sortableFields: ["id", "patientName", "status", "createdAt"],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
    });
    const include = {
      lines: {
        include: {
          product: { select: { id: true, name: true, batchTracked: true, hasVariants: true } },
          productVariant: { select: { id: true, label: true, sku: true } },
        },
      },
    };
    const where = { branchId };
    if (status && status !== "ALL") where.status = status;
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [rows, total] = await prisma.$transaction([
        prisma.prescription.findMany({ where, include, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.prescription.count({ where }),
      ]);
      return res.json(pagedResult({ data: rows, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const q = String(req.query?.q || "").trim().toLowerCase();
    const rows = await prisma.prescription.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include,
    });
    const filtered = q
      ? rows.filter((row) => {
          const hay = [row.patientName, row.patientPhone, row.doctorName, row.prescriptionNo]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : rows;
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPrescription = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid prescription id" });
    const row = await prisma.prescription.findFirst({
      where: { id, branchId },
      include: {
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                vatRate: true,
                batchTracked: true,
                hasVariants: true,
                sellByWeight: true,
              },
            },
            productVariant: {
              select: { id: true, label: true, sku: true, priceOverride: true, stock: true },
            },
          },
        },
      },
    });
    if (!row) return res.status(404).json({ error: "Prescription not found" });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPrescription = async (req, res) => {
  try {
    const branchId = req.branchId;
    const patientName = String(req.body?.patientName || "").trim();
    if (patientName.length < 2) {
      return res.status(400).json({ error: "Patient name is required" });
    }
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!lines.length) return res.status(400).json({ error: "At least one medicine line is required" });

    const lineCreates = [];
    for (const line of lines) {
      const productId = Number(line.productId);
      const qty = Number(line.qty || 0);
      if (!productId || qty <= 0) {
        return res.status(400).json({ error: "Each line needs a product and positive quantity" });
      }
      const product = await prisma.product.findFirst({
        where: { id: productId, branchId },
        select: { id: true, hasVariants: true },
      });
      if (!product) return res.status(404).json({ error: `Product ${productId} not found` });
      const variantId = Number(line.productVariantId || 0) || null;
      if (product.hasVariants && !variantId) {
        return res.status(400).json({ error: "Variant required for variant product on prescription line" });
      }
      if (variantId) {
        const variant = await prisma.productVariant.findFirst({
          where: { id: variantId, branchId, productId },
        });
        if (!variant) return res.status(400).json({ error: "Invalid variant for product" });
      }
      lineCreates.push({
        productId,
        productVariantId: variantId,
        qty,
        batchId: Number(line.batchId || 0) || null,
        dosageNote: line.dosageNote ? String(line.dosageNote).trim().slice(0, 500) : null,
      });
    }

    const prescriptionNo =
      String(req.body?.prescriptionNo || "").trim() || nextPrescriptionNo(branchId);

    const created = await prisma.prescription.create({
      data: {
        branchId,
        prescriptionNo,
        patientName,
        patientPhone: req.body?.patientPhone ? String(req.body.patientPhone).trim().slice(0, 64) : null,
        doctorName: req.body?.doctorName ? String(req.body.doctorName).trim().slice(0, 191) : null,
        notes: req.body?.notes ? String(req.body.notes).trim().slice(0, 2000) : null,
        customerId: req.body?.customerId ? Number(req.body.customerId) : null,
        createdById: req.user?.id || null,
        status: "OPEN",
        lines: { create: lineCreates },
      },
      include: {
        lines: {
          include: {
            product: { select: { id: true, name: true } },
            productVariant: { select: { id: true, label: true } },
          },
        },
      },
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePrescription = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid prescription id" });
    const existing = await prisma.prescription.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Prescription not found" });
    if (!["OPEN", "PARTIAL"].includes(existing.status)) {
      return res.status(400).json({ error: "Only open/partial prescriptions can be edited" });
    }

    const data = {};
    if (req.body?.patientName != null) {
      const pn = String(req.body.patientName).trim();
      if (pn.length < 2) return res.status(400).json({ error: "Patient name is required" });
      data.patientName = pn;
    }
    if (req.body?.patientPhone !== undefined) {
      data.patientPhone = req.body.patientPhone ? String(req.body.patientPhone).trim().slice(0, 64) : null;
    }
    if (req.body?.doctorName !== undefined) {
      data.doctorName = req.body.doctorName ? String(req.body.doctorName).trim().slice(0, 191) : null;
    }
    if (req.body?.notes !== undefined) {
      data.notes = req.body.notes ? String(req.body.notes).trim().slice(0, 2000) : null;
    }

    // Optional full line replacement (only allowed while nothing dispensed yet).
    const replaceLines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (replaceLines) {
      const existingLines = await prisma.prescriptionLine.findMany({ where: { prescriptionId: id } });
      if (existingLines.some((l) => Number(l.dispensedQty || 0) > 0)) {
        return res.status(400).json({ error: "Cannot replace lines after partial dispensing" });
      }
      if (!replaceLines.length) return res.status(400).json({ error: "At least one medicine line is required" });
      const lineCreates = [];
      for (const line of replaceLines) {
        const productId = Number(line.productId);
        const qty = Number(line.qty || 0);
        if (!productId || qty <= 0) {
          return res.status(400).json({ error: "Each line needs a product and positive quantity" });
        }
        const product = await prisma.product.findFirst({
          where: { id: productId, branchId },
          select: { id: true, hasVariants: true },
        });
        if (!product) return res.status(404).json({ error: `Product ${productId} not found` });
        const variantId = Number(line.productVariantId || 0) || null;
        if (product.hasVariants && !variantId) {
          return res.status(400).json({ error: "Variant required for variant product on prescription line" });
        }
        lineCreates.push({
          productId,
          productVariantId: variantId,
          qty,
          batchId: Number(line.batchId || 0) || null,
          dosageNote: line.dosageNote ? String(line.dosageNote).trim().slice(0, 500) : null,
        });
      }
      await prisma.prescriptionLine.deleteMany({ where: { prescriptionId: id } });
      data.lines = { create: lineCreates };
    }

    const updated = await prisma.prescription.update({
      where: { id },
      data,
      include: {
        lines: {
          include: {
            product: { select: { id: true, name: true } },
            productVariant: { select: { id: true, label: true } },
          },
        },
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.cancelPrescription = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.prescription.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Prescription not found" });
    if (existing.status !== "OPEN") {
      return res.status(400).json({ error: "Only open prescriptions can be cancelled" });
    }
    const row = await prisma.prescription.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Cart payload for POS dispensing */
exports.getPrescriptionPosCart = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const row = await prisma.prescription.findFirst({
      where: { id, branchId },
      include: {
        lines: {
          include: {
            product: true,
            productVariant: true,
          },
        },
      },
    });
    if (!row) return res.status(404).json({ error: "Prescription not found" });
    if (!["OPEN", "PARTIAL"].includes(row.status)) {
      return res.status(400).json({ error: `Prescription is ${row.status}, not open for dispensing` });
    }
    // Only load the remaining (un-dispensed) quantity per line so refills don't
    // double-dispense already-collected medicine.
    const cart = row.lines
      .map((line) => {
        const remaining = Math.max(0, Number(line.qty || 0) - Number(line.dispensedQty || 0));
        if (remaining <= 0) return null;
        const price =
          line.productVariant?.priceOverride != null
            ? Number(line.productVariant.priceOverride)
            : Number(line.product.price || 0);
        return {
          id: line.productId,
          name: line.product.name,
          qty: remaining,
          orderedQty: Number(line.qty || 0),
          dispensedQty: Number(line.dispensedQty || 0),
          price,
          vatRate: Number(line.product.vatRate || 0),
          batchTracked: Boolean(line.product.batchTracked),
          sellByWeight: Boolean(line.product.sellByWeight),
          hasVariants: Boolean(line.product.hasVariants),
          ...(line.productVariantId ? { variantId: line.productVariantId } : {}),
          ...(line.batchId ? { preferredBatchId: line.batchId } : {}),
          dosageNote: line.dosageNote,
          matchedVariant: line.productVariant || null,
        };
      })
      .filter(Boolean);
    if (!cart.length) {
      return res.status(400).json({ error: "All prescription lines are already fully dispensed" });
    }
    res.json({
      prescriptionId: row.id,
      prescriptionNo: row.prescriptionNo,
      patientName: row.patientName,
      patientPhone: row.patientPhone,
      doctorName: row.doctorName,
      customer: row.patientPhone
        ? { name: row.patientName, phone: row.patientPhone }
        : { name: row.patientName, phone: "" },
      cart,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
