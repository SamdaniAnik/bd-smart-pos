const prisma = require("../../utils/prisma");
const { submitSaleToEfd, getEfdProvider } = require("./efdService");
const { buildMushak91Payload, submitMushak91Return } = require("./mushak91Service");
const { isMushak91FilingConfigured } = require("./ivasClient");
const efdRetryQueue = require("./efdRetryQueue");

exports.listEfdPendingSales = async (req, res) => {
  try {
    const branchId = req.branchId;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = {
      branchId,
      OR: [{ efdFiscalInvoiceNo: null }, { efdQrPayload: null }],
    };
    if (from && !Number.isNaN(from.getTime())) {
      where.createdAt = { ...(where.createdAt || {}), gte: from };
    }
    if (to && !Number.isNaN(to.getTime())) {
      where.createdAt = { ...(where.createdAt || {}), lte: to };
    }
    const rows = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        invoiceNo: true,
        total: true,
        createdAt: true,
        efdFiscalInvoiceNo: true,
        efdQrPayload: true,
        efdSubmittedAt: true,
        efdProvider: true,
        paymentMethod: true,
      },
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.retrySaleEfd = async (req, res) => {
  try {
    const branchId = req.branchId;
    const saleId = Number(req.params.saleId);
    if (Number.isNaN(saleId)) return res.status(400).json({ error: "Invalid sale id" });

    const [sale, branch] = await Promise.all([
      prisma.sale.findFirst({
        where: { id: saleId, branchId },
        include: { items: { include: { product: true } } },
      }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    const result = await submitSaleToEfd({ sale, branch });
    if (!result.ok) return res.status(502).json({ error: result.error || "EFD submission failed" });

    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        efdFiscalInvoiceNo: result.fiscalInvoiceNo || null,
        efdQrPayload: result.qrPayload || null,
        efdVerificationUrl: result.verificationUrl || null,
        efdSubmittedAt: new Date(),
        efdProvider: result.provider || getEfdProvider(),
      },
    });

    res.json({
      message: result.simulated ? "EFD submission simulated" : "EFD submission completed",
      saleId: sale.id,
      fiscalInvoiceNo: result.fiscalInvoiceNo,
      qrPayload: result.qrPayload,
      verificationUrl: result.verificationUrl,
      provider: result.provider,
      simulated: Boolean(result.simulated),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getEfdStatus = async (req, res) => {
  try {
    const branchId = req.branchId;
    const saleId = Number(req.params.saleId);
    if (Number.isNaN(saleId)) return res.status(400).json({ error: "Invalid sale id" });

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, branchId },
      select: {
        id: true,
        invoiceNo: true,
        efdFiscalInvoiceNo: true,
        efdQrPayload: true,
        efdVerificationUrl: true,
        efdSubmittedAt: true,
        efdProvider: true,
      },
    });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    res.json(sale);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.previewMushak91 = async (req, res) => {
  try {
    const taxPeriod = String(req.query.taxPeriod || "").trim();
    if (!taxPeriod) return res.status(400).json({ error: "taxPeriod query (YYYY-MM) is required" });
    const payload = await buildMushak91Payload(req.branchId, taxPeriod);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.submitMushak91 = async (req, res) => {
  try {
    const taxPeriod = String(req.body?.taxPeriod || req.query?.taxPeriod || "").trim();
    if (!taxPeriod) return res.status(400).json({ error: "taxPeriod (YYYY-MM) is required" });
    if (!isMushak91FilingConfigured()) {
      const preview = await buildMushak91Payload(req.branchId, taxPeriod);
      return res.json({
        message: "Mushak 9.1 payload generated (export-only — set EFD_MUSHAK91_URL + EFD_MUSHAK91_PROVIDER for live iVAS/ERP filing)",
        simulated: true,
        ...preview,
      });
    }
    const result = await submitMushak91Return(req.branchId, taxPeriod);
    res.json({
      message: "Mushak 9.1 return submitted",
      simulated: false,
      ...result,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};

exports.runEfdRetrySweep = async (req, res) => {
  try {
    const result = await efdRetryQueue.runOnce();
    res.json({ message: "EFD retry sweep executed", ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
