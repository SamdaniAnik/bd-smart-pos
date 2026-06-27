import QRCode from "qrcode";

/**
 * Builds printable HTML for the EFD fiscal QR block on thermal receipts.
 * Returns empty string when the sale has no EFD data.
 */
export async function buildEfdQrReceiptBlock(sale, options = {}) {
  const escapeHtml =
    options.escapeHtml ||
    ((value) =>
      String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"));

  const qrLabel = options.qrLabel || "EFD fiscal QR";
  const fiscalLabel = options.fiscalLabel || "EFD fiscal";
  const qrSize = Number(options.qrSize || 132);

  const payload = String(sale?.efdQrPayload || "").trim();
  const invoiceNo = String(sale?.efdFiscalInvoiceNo || "").trim();
  const verifyUrl = String(sale?.efdVerificationUrl || "").trim();
  if (!payload && !invoiceNo) return "";

  const parts = [];
  if (invoiceNo) {
    parts.push(
      `<p style="text-align:center;font-size:11px;margin:8px 0 4px;">${escapeHtml(fiscalLabel)}: ${escapeHtml(invoiceNo)}</p>`
    );
  }
  if (payload) {
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        width: qrSize,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      parts.push(
        `<div style="text-align:center;margin:6px 0 4px;"><img src="${dataUrl}" alt="${escapeHtml(qrLabel)}" style="width:${qrSize}px;height:${qrSize}px;" /><p style="font-size:10px;margin:4px 0;color:#334155;">${escapeHtml(qrLabel)}</p></div>`
      );
    } catch {
      parts.push(`<p style="font-size:10px;text-align:center;color:#64748b;">${escapeHtml(qrLabel)}</p>`);
    }
  }
  if (verifyUrl) {
    parts.push(
      `<p style="font-size:9px;text-align:center;word-break:break-all;color:#64748b;margin:2px 0 0;">${escapeHtml(verifyUrl)}</p>`
    );
  }
  return parts.join("");
}
