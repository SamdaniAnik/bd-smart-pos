/**
 * Simplified Bangla QR / EMVCo dynamic payment payload builder.
 * Produces a TLV string suitable for QR encoding on the customer display.
 * When NPSB publishes per-MFS sub-tags, extend buildMerchantAccountInfo().
 */

function tlv(id, value) {
  const v = String(value ?? "");
  const len = String(v.length).padStart(2, "0");
  return `${id}${len}${v}`;
}

function crc16Ccitt(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildMerchantAccountInfo({ method, merchantId, merchantNumber }) {
  const m = String(method || "").toLowerCase();
  const wallet = String(merchantNumber || merchantId || "").trim();
  if (!wallet) return "";
  // GUID 00 = Bangladesh NPSB; sub-tag 01 = wallet / MFS identifier
  const mfsCode =
    m === "nagad" ? "NAGAD" : m === "rocket" ? "ROCKET" : m === "upay" ? "UPAY" : "BKASH";
  const inner = tlv("00", "bd.npsb.ewallet") + tlv("01", wallet) + tlv("02", mfsCode);
  return tlv("26", inner);
}

/**
 * @param {{ amount: number, merchantName?: string, city?: string, invoiceRef?: string, method?: string, merchantId?: string, merchantNumber?: string }} opts
 */
function buildBanglaQrPayload(opts) {
  const amount = Number(opts.amount || 0).toFixed(2);
  const merchantName = String(opts.merchantName || "BD Smart POS").slice(0, 25);
  const city = String(opts.city || "Dhaka").slice(0, 15);
  const invoiceRef = String(opts.invoiceRef || "").slice(0, 25);

  let payload =
    tlv("00", "01") +
    tlv("01", "12") +
    buildMerchantAccountInfo(opts) +
    tlv("52", "0000") +
    tlv("53", "050") +
    tlv("54", amount) +
    tlv("58", "BD") +
    tlv("59", merchantName) +
    tlv("60", city);

  if (invoiceRef) {
    payload += tlv("62", tlv("05", invoiceRef));
  }

  const toSign = `${payload}6304`;
  return `${toSign}${crc16Ccitt(toSign)}`;
}

module.exports = { buildBanglaQrPayload, tlv, crc16Ccitt };
