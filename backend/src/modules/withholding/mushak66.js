// Mushak 6.6 (Withholding Tax Certificate / উৎসে কর কর্তন প্রত্যয়ন পত্র) PDF.
//
// Issued by the buyer (withholding agent) to the seller for each supplier
// payment where AIT and/or VDS was deducted. The seller uses this certificate
// to claim credit on their own tax return. Per VAT Rules 2016 the certificate
// must be issued within 7 days of payment.
//
// We emit a clean A4 PDF (PDFKit). When NBR publishes the structured XML
// schema for Mushak 6.6, we'll add an XML emitter here too.

const PDFDocument = require("pdfkit");

function fmt(n, dp = 2) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toFixed(dp) : (0).toFixed(dp);
}

function fmtBdt(n) {
  // Lakh/crore grouping: "1,23,45,678.50". Simple impl mirroring frontend util.
  const s = fmt(n, 2);
  const [intPart, frac] = s.split(".");
  const negative = intPart.startsWith("-");
  const abs = negative ? intPart.slice(1) : intPart;
  if (abs.length <= 3) return `${negative ? "-" : ""}${abs}.${frac}`;
  const last3 = abs.slice(-3);
  const rest = abs.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${rest},${last3}.${frac}`;
}

/**
 * Stream a Mushak 6.6 PDF for a single PaymentVoucher to the supplied
 * writable response.
 *
 * @param {object} ctx
 * @param {object} ctx.voucher  PaymentVoucher row with `supplier` included.
 * @param {object} ctx.branch   Branch row (sellerBin, tradeLicenseNo, name, address).
 * @param {Writable} res        HTTP response or any writable stream.
 * @param {object} [options]
 * @param {string} [options.filename]
 */
function streamMushak66Pdf({ voucher, branch, res, options = {} }) {
  if (!voucher) throw new Error("streamMushak66Pdf: voucher is required");
  if (!branch) throw new Error("streamMushak66Pdf: branch is required");

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const filename =
    options.filename ||
    `mushak-6.6-${voucher.mushak66DocumentNo || voucher.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const supplier = voucher.supplier || {};

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("Withholding Tax Certificate", { align: "center" });
  doc
    .font("Helvetica")
    .fontSize(11)
    .text("(Mushak 6.6 — VAT Rules 2016)", { align: "center" });
  doc.moveDown(0.5);
  doc
    .fontSize(9)
    .fillColor("#666")
    .text(
      "Issued by the withholding agent to the supplier as evidence of tax deducted at source. The supplier may use this certificate to claim AIT and VDS credit on their own tax filings.",
      { align: "center" }
    )
    .fillColor("#000");
  doc.moveDown(1);

  // --- Document header ---
  doc.fontSize(11).font("Helvetica-Bold").text("Document");
  doc.font("Helvetica").fontSize(10);
  doc.text(`Certificate No.: ${voucher.mushak66DocumentNo || "—"}`);
  doc.text(`Issue date: ${new Date(voucher.createdAt || Date.now()).toISOString().slice(0, 10)}`);
  doc.text(`Reference: PaymentVoucher #${voucher.id}`);
  doc.moveDown(0.5);

  // --- Withholding agent (buyer) ---
  doc.font("Helvetica-Bold").text("Withholding Agent (Buyer)");
  doc.font("Helvetica");
  doc.text(`Name: ${branch.name || "—"}`);
  if (branch.address) doc.text(`Address: ${branch.address}`);
  if (branch.phone) doc.text(`Phone: ${branch.phone}`);
  doc.text(`BIN: ${branch.sellerBin || "—"}`);
  if (branch.tradeLicenseNo) doc.text(`Trade License: ${branch.tradeLicenseNo}`);
  doc.moveDown(0.5);

  // --- Supplier (seller) ---
  doc.font("Helvetica-Bold").text("Supplier (Seller)");
  doc.font("Helvetica");
  doc.text(`Name: ${supplier.name || "—"}`);
  if (supplier.address) doc.text(`Address: ${supplier.address}`);
  if (supplier.phone) doc.text(`Phone: ${supplier.phone}`);
  doc.text(`TIN: ${supplier.tinNumber || "—"}      BIN: ${supplier.binNumber || "—"}`);
  if (voucher.taxCategory || supplier.taxCategory) {
    doc.text(`Tax category: ${voucher.taxCategory || supplier.taxCategory}`);
  }
  doc.moveDown(0.7);

  // --- Amount table ---
  doc.font("Helvetica-Bold").text("Withholding Detail");
  doc.font("Helvetica");

  const startX = doc.x;
  const widthLabel = 220;
  const widthVal = 180;
  const drawRow = (label, value, opts = {}) => {
    if (opts.bold) doc.font("Helvetica-Bold");
    doc.text(label, startX, doc.y, { width: widthLabel, continued: true });
    doc.text(value, { width: widthVal, align: "right" });
    if (opts.bold) doc.font("Helvetica");
  };

  drawRow("Gross payment amount", `BDT ${fmtBdt(voucher.amount)}`);
  drawRow(
    `AIT @ ${fmt(voucher.aitRate, 2)}% (Income Tax at source)`,
    `BDT ${fmtBdt(voucher.aitAmount)}`
  );
  drawRow(
    `VDS @ ${fmt(voucher.vdsRate, 2)}% (VAT Deducted at Source)`,
    `BDT ${fmtBdt(voucher.vdsAmount)}`
  );
  doc.moveDown(0.3);
  drawRow(
    "Net amount paid to supplier",
    `BDT ${fmtBdt(voucher.netPaid != null ? voucher.netPaid : Number(voucher.amount || 0) - Number(voucher.aitAmount || 0) - Number(voucher.vdsAmount || 0))}`,
    { bold: true }
  );
  doc.moveDown(0.5);
  drawRow("Payment method", String(voucher.method || "Cash"));
  if (voucher.note) drawRow("Payment note", String(voucher.note));
  if (voucher.withholdingNote) drawRow("Withholding note", String(voucher.withholdingNote));
  doc.moveDown(1);

  // --- Legal footer ---
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(
      "This certificate is issued in compliance with Income Tax Ordinance 1984 (sec. 52 / 52A / 52AA) and the VAT and Supplementary Duty Act 2012 (sec. 49) read with VAT Rules 2016. The withholding agent has deposited / will deposit the deducted amounts to the National Board of Revenue treasury within the statutory timeline. Please retain this document for your records and to claim withholding tax credit.",
      { align: "left" }
    )
    .fillColor("#000");

  doc.moveDown(2);
  doc.fontSize(10).font("Helvetica-Bold").text("Authorised Signatory", { align: "right" });
  doc.font("Helvetica").fontSize(9);
  doc.text(`For ${branch.name || "—"}`, { align: "right" });
  doc.text(`Date: ${new Date(voucher.createdAt || Date.now()).toISOString().slice(0, 10)}`, {
    align: "right",
  });

  doc.end();
}

module.exports = { streamMushak66Pdf };
