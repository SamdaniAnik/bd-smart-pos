const logger = require("../../utils/logger");
const { buildBanglaQrPayload } = require("../../utils/banglaQr");
const { fetchJson } = require("../../integrations/httpClient");

function getEfdProvider() {
  return String(process.env.EFD_PROVIDER || "log").trim().toLowerCase();
}

function isEfdConfigured() {
  return getEfdProvider() !== "log";
}

function buildEfdPayload({ sale, branch }) {
  return {
    sellerBin: branch?.sellerBin || "",
    tradeLicenseNo: branch?.tradeLicenseNo || "",
    branchCode: branch?.code || "",
    branchName: branch?.name || "",
    invoiceNo: sale.invoiceNo || "",
    mushakDocumentNo: sale.mushakDocumentNo || "",
    saleDate: sale.createdAt,
    subTotal: Number(sale.subTotal || 0),
    sdAmount: Number(sale.sdAmount || 0),
    vatAmount: Number(sale.vatAmount || 0),
    discount: Number(sale.discount || 0),
    total: Number(sale.total || 0),
    paymentMethod: sale.paymentMethod || "Cash",
    buyerBinOrNidNote: sale.buyerBinOrNidNote || "",
    lines: Array.isArray(sale.items)
      ? sale.items.map((item, idx) => ({
          lineNo: idx + 1,
          name: item.product?.name || `Item#${item.productId}`,
          qty: Number(item.qty || 0),
          unitPrice: Number(item.price || 0),
          sdRate: Number(item.sdRate || 0),
          sdAmount: Number(item.sdAmount || 0),
          vatRate: Number(item.vatRate || 0),
          vatAmount: Number(item.vatAmount || 0),
          lineTotal: Number(item.total || 0),
        }))
      : [],
  };
}

async function submitToGenexSdc(payload, { saleId } = {}) {
  const url = String(process.env.EFD_GENEX_URL || "").trim();
  const apiKey = String(process.env.EFD_GENEX_API_KEY || "").trim();
  const deviceId = String(process.env.EFD_DEVICE_ID || "").trim();
  if (!url || !apiKey || !deviceId) {
    throw new Error("EFD Genex integration requires EFD_GENEX_URL, EFD_GENEX_API_KEY, EFD_DEVICE_ID");
  }

  const body = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-EFD-Device-Id": deviceId,
      ...(saleId ? { "X-Idempotency-Key": `sale-${saleId}` } : {}),
    },
    body: JSON.stringify({ deviceId, invoice: payload }),
  }, { timeoutMs: 20000, retries: 2 });

  const fiscalInvoiceNo = String(body.fiscalInvoiceNo || body.invoiceId || body.fiscalInvoiceNumber || "");
  const qrPayload = String(body.qrPayload || body.qrCode || body.qrData || "");
  if (!fiscalInvoiceNo) {
    throw new Error(body?.message || body?.error || "EFD SDC response missing fiscalInvoiceNo");
  }

  return {
    fiscalInvoiceNo,
    qrPayload,
    verificationUrl: String(body.verificationUrl || body.verifyUrl || ""),
    provider: "genex",
    simulated: false,
    raw: body,
  };
}

async function submitSaleToEfd({ sale, branch }) {
  const provider = getEfdProvider();
  const payload = buildEfdPayload({ sale, branch });

  try {
    if (provider === "genex") {
      const result = await submitToGenexSdc(payload, { saleId: sale?.id });
      return { ok: true, ...result };
    }

    const fiscalInvoiceNo = `EFD-${branch?.code || "BR"}-${sale.invoiceNo || sale.id}`;
    const qrPayload = buildBanglaQrPayload({
      amount: sale.total,
      merchantName: branch?.name || "BD Smart POS",
      city: "Dhaka",
      invoiceRef: fiscalInvoiceNo,
      method: "bKash",
      merchantNumber: process.env.EFD_MERCHANT_WALLET || "",
    });
    logger.info({ saleId: sale.id, fiscalInvoiceNo }, "EFD submission simulated (EFD_PROVIDER=log)");
    return {
      ok: true,
      fiscalInvoiceNo,
      qrPayload,
      verificationUrl: `https://nbr.gov.bd/efd-verify?inv=${encodeURIComponent(fiscalInvoiceNo)}`,
      provider: "log",
      simulated: true,
    };
  } catch (error) {
    logger.error({ err: error.message, saleId: sale?.id }, "EFD submission failed");
    return { ok: false, error: error.message, provider };
  }
}

module.exports = {
  submitSaleToEfd,
  buildEfdPayload,
  isEfdConfigured,
  getEfdProvider,
};
