/**
 * NBR compliance footer + delivery block for thermal receipts.
 */
export function buildReceiptComplianceBlock(branch, options = {}) {
  const escapeHtml =
    options.escapeHtml ||
    ((value) =>
      String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"));

  const labels = options.labels || {};
  const binLabel = labels.bin || "BIN";
  const tradeLabel = labels.tradeLicense || "Trade license";
  const vatLabel = labels.vatReg || "VAT reg";

  const parts = [];
  if (branch?.sellerBin) parts.push(`${binLabel}: ${escapeHtml(branch.sellerBin)}`);
  if (branch?.tradeLicenseNo) parts.push(`${tradeLabel}: ${escapeHtml(branch.tradeLicenseNo)}`);
  if (branch?.vatRegistrationLabel) parts.push(`${vatLabel}: ${escapeHtml(branch.vatRegistrationLabel)}`);

  if (!parts.length) return "";
  return `<p style="text-align:center;font-size:10px;margin:6px 0 2px;color:#475569;">${parts.join(" · ")}</p>`;
}

export function buildReceiptDeliveryBlock(sale, options = {}) {
  const escapeHtml =
    options.escapeHtml ||
    ((value) =>
      String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"));

  if (String(sale?.fulfillmentType || "").toUpperCase() !== "DELIVERY") return "";

  const labels = options.labels || {};
  const deliveryLabel = labels.delivery || "Delivery";
  const feeLabel = labels.deliveryFee || "Delivery fee";
  const courierLabel = labels.courier || "Courier";
  const trackingLabel = labels.tracking || "Tracking";

  const lines = [`<p style="font-size:11px;margin:6px 0 2px;"><strong>${escapeHtml(deliveryLabel)}</strong></p>`];
  const addrParts = [sale.deliveryAddress, sale.deliveryArea, sale.deliveryDistrict, sale.deliveryLandmark]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (addrParts.length) {
    lines.push(`<p style="font-size:10px;margin:2px 0;color:#334155;">${escapeHtml(addrParts.join(", "))}</p>`);
  }
  if (Number(sale.deliveryFee || 0) > 0) {
    lines.push(
      `<p style="font-size:10px;margin:2px 0;">${escapeHtml(feeLabel)}: ${Number(sale.deliveryFee).toFixed(2)}</p>`
    );
  }
  if (sale.courierName) {
    lines.push(
      `<p style="font-size:10px;margin:2px 0;">${escapeHtml(courierLabel)}: ${escapeHtml(sale.courierName)}</p>`
    );
  }
  if (sale.trackingId) {
    lines.push(
      `<p style="font-size:10px;margin:2px 0;">${escapeHtml(trackingLabel)}: ${escapeHtml(sale.trackingId)}</p>`
    );
  }
  return lines.join("");
}
