// Courier AWB (Air Waybill) label PDF generator.
//
// Produces a compact 4x6-style shipping label with the tracking ID, recipient,
// COD amount and origin store, suitable for thermal/label printers.

const PDFDocument = require("pdfkit");

function fmtBdt(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}

/**
 * Stream an AWB label PDF for a shipment to the writable response.
 * @param {object} ctx
 * @param {object} ctx.shipment  CourierShipment row
 * @param {object} ctx.branch    Branch row (name, address, phone)
 * @param {Writable} ctx.res
 */
function streamCourierLabelPdf({ shipment, branch, res, options = {} }) {
  if (!shipment) throw new Error("streamCourierLabelPdf: shipment is required");

  // 4x6 inch label (288 x 432 pt).
  const doc = new PDFDocument({ size: [288, 432], margin: 16 });
  const filename = options.filename || `awb-${shipment.trackingId || shipment.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);

  const provider = String(shipment.provider || "manual").toUpperCase();

  doc.fontSize(14).font("Helvetica-Bold").text(provider, { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica").text("Air Waybill / শিপিং লেবেল", { align: "center" });
  doc.moveTo(16, doc.y + 4).lineTo(272, doc.y + 4).stroke();
  doc.moveDown(0.8);

  // Tracking ID (large, monospace-ish for scanning).
  doc.fontSize(10).font("Helvetica-Bold").text("Tracking ID");
  doc.fontSize(18).font("Courier-Bold").text(String(shipment.trackingId || "—"), { align: "left" });
  doc.moveDown(0.6);

  // From
  doc.fontSize(9).font("Helvetica-Bold").text("From:");
  doc
    .font("Helvetica")
    .text(branch?.name || "BD Smart POS")
    .text(branch?.address || "")
    .text(branch?.phone ? `Phone: ${branch.phone}` : "");
  doc.moveDown(0.4);

  // To
  doc.font("Helvetica-Bold").text("To:");
  doc
    .font("Helvetica")
    .text(shipment.recipientName || "Customer")
    .text(shipment.recipientPhone ? `Phone: ${shipment.recipientPhone}` : "")
    .text(shipment.address || "", { width: 256 });
  doc.moveDown(0.6);

  // COD box
  doc.moveTo(16, doc.y).lineTo(272, doc.y).stroke();
  doc.moveDown(0.4);
  const cod = Number(shipment.codAmount || 0);
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(cod > 0 ? `COD: ৳ ${fmtBdt(cod)}` : "Prepaid (No COD)", { align: "center" });
  doc.moveDown(0.4);
  doc.moveTo(16, doc.y).lineTo(272, doc.y).stroke();
  doc.moveDown(0.6);

  doc.fontSize(8).font("Helvetica").text(`Status: ${shipment.status || "CREATED"}`);
  doc.text(`Created: ${new Date(shipment.createdAt || Date.now()).toLocaleString()}`);
  doc.text(`Ref: ${shipment.saleId ? `SALE-${shipment.saleId}` : shipment.pendingOrderId ? `PO-${shipment.pendingOrderId}` : shipment.id}`);

  doc.end();
}

module.exports = { streamCourierLabelPdf };
