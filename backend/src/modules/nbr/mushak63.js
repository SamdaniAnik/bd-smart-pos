// Mushak 6.3 (Tax Invoice / চালান পত্র) emitter.
//
// Implements the field structure prescribed in VAT and Supplementary Duty
// Act 2012 + VAT Rules 2016 (পরিশিষ্ট-"গ", Form 6.3) for VAT-registered taxpayers
// in Bangladesh. Output is a canonical, deterministic UTF-8 XML document
// suitable for:
//   - Storing alongside each Sale (audit + Mushak 9.1 aggregation).
//   - Submitting to the NBR VAT Online (IVAS) portal once the production XML
//     schema endpoint is enabled by NBR for the taxpayer.
//
// IMPORTANT: NBR has not published a single, public, machine-readable XSD for
// Mushak 6.3. Field names below mirror the official Bangla form labels and the
// JSON shape used by the NBR's Mushak helper utilities. When NBR publishes a
// final XSD, only the leaf XML element names need to be remapped here — the
// underlying data we capture (HS code, BIN, Mushak document number, line VAT)
// is already complete.

const crypto = require("crypto");
const { buildXml } = require("./xmlBuilder");

const NAMESPACE = "https://nbr.gov.bd/mushak/6.3";
const SPEC_VERSION = "1.0";

function fmt(n, dp = 2) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return (0).toFixed(dp);
  return v.toFixed(dp);
}

function isoDateOnly(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoTimestamp(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString();
}

function vatTreatment(sale) {
  // NBR distinguishes inclusive vs exclusive VAT. Our Sale model captures
  // vatAmount on top of subTotal, so emission is treated as exclusive unless
  // the legacy snapshot says otherwise.
  return "EXCLUSIVE";
}

function deriveLineRows(sale) {
  // Prefer the immutable vatBreakdownSnapshot (captured at sale-create time);
  // fall back to live sale.items if snapshot is absent (older sales).
  const snap = sale.vatBreakdownSnapshot;
  const fromSnap = Array.isArray(snap)
    ? snap
    : snap && typeof snap === "object"
    ? Object.values(snap)
    : null;

  if (fromSnap && fromSnap.length > 0) {
    return fromSnap.map((row, idx) => ({
      lineNo: idx + 1,
      productId: Number(row.productId || 0),
      productName: String(row.name || row.productName || `Product#${row.productId}`),
      productNameBn: row.nameBn || null,
      hsCode: row.hsCode || null,
      unit: row.unit || row.unitOfMeasure || (row.sellByWeight ? "KG" : "PCS"),
      qty: Number(row.qty || 0),
      // For weight-billed lines the qty IS the weight in kg; treat them uniformly.
      netAmount: Number(row.netAmount || 0),
      vatRate: Number(row.vatRate || 0),
      vatAmount: Number(row.vatAmount || 0),
    }));
  }

  return (sale.items || []).map((item, idx) => {
    const p = item.product || {};
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const lineNet = qty * price;
    const rate = Number(p.vatRate || 0);
    const lineVat = (lineNet * rate) / 100;
    return {
      lineNo: idx + 1,
      productId: Number(item.productId || 0),
      productName: String(p.name || `Product#${item.productId}`),
      productNameBn: p.nameBn || null,
      hsCode: p.hsCode || null,
      unit: p.unitOfMeasure || (p.sellByWeight ? "KG" : "PCS"),
      qty,
      netAmount: lineNet,
      vatRate: rate,
      vatAmount: lineVat,
    };
  });
}

/**
 * Build the canonical Mushak 6.3 XML for a single sale.
 *
 * @param {object} ctx
 * @param {object} ctx.sale     Sale row with `items`, `customer`, `vatBreakdownSnapshot`.
 * @param {object} ctx.branch   Branch row (sellerBin, tradeLicenseNo, name, address).
 * @returns {{ xml: string, hash: string, payload: object }}
 */
function generateMushak63({ sale, branch }) {
  if (!sale) throw new Error("generateMushak63: sale is required");
  if (!branch) throw new Error("generateMushak63: branch is required");

  const lines = deriveLineRows(sale);
  const totalNet = lines.reduce((s, r) => s + r.netAmount, 0);
  const totalVat = lines.reduce((s, r) => s + r.vatAmount, 0);
  const totalGross = totalNet + totalVat;

  // Discount and final billed total may differ from sum-of-lines
  // (cart-level discount, coupon, loyalty redeem). We expose all three
  // numbers explicitly so the auditor can reconcile.
  const cartDiscount = Number(sale.discount || 0);
  const declaredVat = Number(sale.vatAmount || totalVat);
  const declaredSubTotal = Number(sale.subTotal || totalNet);
  const declaredTotal = Number(sale.total || totalGross);

  const customer = sale.customer || {};
  const buyerType = sale.buyerBinOrNidNote
    ? /^[0-9]{13}$/.test(String(sale.buyerBinOrNidNote).trim())
      ? "REGISTERED"
      : "CONSUMER"
    : "WALK_IN";

  // Canonical payload — also returned alongside XML for callers who want to
  // round-trip into JSON (Mushak 9.1 aggregation).
  const payload = {
    spec: { name: "Mushak-6.3", version: SPEC_VERSION, namespace: NAMESPACE },
    document: {
      mushakDocumentNo: sale.mushakDocumentNo || null,
      invoiceNo: sale.invoiceNo || String(sale.id),
      issuedAt: isoTimestamp(sale.createdAt),
      issuedDate: isoDateOnly(sale.createdAt),
      vatTreatment: vatTreatment(sale),
      currency: "BDT",
    },
    seller: {
      branchCode: branch.code || null,
      branchName: branch.name || null,
      address: branch.address || null,
      phone: branch.phone || null,
      bin: branch.sellerBin || null,
      tradeLicenseNo: branch.tradeLicenseNo || null,
      vatRegistrationLabel: branch.vatRegistrationLabel || null,
    },
    buyer: {
      type: buyerType,
      name: customer.name || null,
      phone: customer.phone || null,
      address: customer.address || null,
      binOrNid: sale.buyerBinOrNidNote || null,
    },
    lines,
    totals: {
      lineNetSum: round2(totalNet),
      lineVatSum: round2(totalVat),
      lineGrossSum: round2(totalGross),
      cartDiscount: round2(cartDiscount),
      declaredSubTotal: round2(declaredSubTotal),
      declaredVat: round2(declaredVat),
      declaredTotal: round2(declaredTotal),
    },
    payment: {
      method: sale.paymentMethod || "Cash",
      channel: sale.paymentChannel || null,
      paid: round2(Number(sale.paidAmount || 0)),
      due: round2(Number(sale.dueAmount || 0)),
    },
  };

  const tree = renderTree(payload);
  const xml = buildXml(tree, { pretty: false });
  const hash = sha256Hex(xml);
  return { xml, hash, payload };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function renderTree(p) {
  return [
    "Mushak63",
    {
      xmlns: NAMESPACE,
      version: SPEC_VERSION,
    },
    [
      ["Document", null, [
        ["MushakDocumentNo", null, p.document.mushakDocumentNo],
        ["InvoiceNo", null, p.document.invoiceNo],
        ["IssuedAt", null, p.document.issuedAt],
        ["IssuedDate", null, p.document.issuedDate],
        ["VATTreatment", null, p.document.vatTreatment],
        ["Currency", null, p.document.currency],
      ]],
      ["Seller", null, [
        ["BranchCode", null, p.seller.branchCode],
        ["BranchName", null, p.seller.branchName],
        ["Address", null, p.seller.address],
        ["Phone", null, p.seller.phone],
        ["BIN", null, p.seller.bin],
        ["TradeLicenseNo", null, p.seller.tradeLicenseNo],
        ["VATRegistrationLabel", null, p.seller.vatRegistrationLabel],
      ]],
      ["Buyer", { type: p.buyer.type }, [
        ["Name", null, p.buyer.name],
        ["Phone", null, p.buyer.phone],
        ["Address", null, p.buyer.address],
        ["BINorNID", null, p.buyer.binOrNid],
      ]],
      ["Lines", null, p.lines.map((l) => [
        "Line",
        { no: l.lineNo },
        [
          ["ProductId", null, l.productId],
          ["ProductName", null, l.productName],
          l.productNameBn ? ["ProductNameBn", null, l.productNameBn] : null,
          ["HSCode", null, l.hsCode],
          ["Unit", null, l.unit],
          ["Quantity", null, fmt(l.qty, 3)],
          ["NetAmount", null, fmt(l.netAmount, 2)],
          ["VATRate", null, fmt(l.vatRate, 2)],
          ["VATAmount", null, fmt(l.vatAmount, 2)],
          ["GrossAmount", null, fmt(l.netAmount + l.vatAmount, 2)],
        ],
      ])],
      ["Totals", null, [
        ["LineNetSum", null, fmt(p.totals.lineNetSum, 2)],
        ["LineVATSum", null, fmt(p.totals.lineVatSum, 2)],
        ["LineGrossSum", null, fmt(p.totals.lineGrossSum, 2)],
        ["CartDiscount", null, fmt(p.totals.cartDiscount, 2)],
        ["DeclaredSubTotal", null, fmt(p.totals.declaredSubTotal, 2)],
        ["DeclaredVAT", null, fmt(p.totals.declaredVat, 2)],
        ["DeclaredTotal", null, fmt(p.totals.declaredTotal, 2)],
      ]],
      ["Payment", null, [
        ["Method", null, p.payment.method],
        ["Channel", null, p.payment.channel],
        ["Paid", null, fmt(p.payment.paid, 2)],
        ["Due", null, fmt(p.payment.due, 2)],
      ]],
    ],
  ];
}

/**
 * Inspect a sale and report which mandatory NBR fields are missing.
 * Used by Mushak 9.1 export to warn the user before generating the return.
 */
function checkCompleteness({ sale, branch }) {
  const issues = [];
  if (!branch?.sellerBin) issues.push("branch.sellerBin (Seller BIN) is missing");
  if (!sale.mushakDocumentNo) issues.push("sale.mushakDocumentNo is missing");
  const lines = deriveLineRows(sale);
  if (lines.length === 0) issues.push("sale has no line items");
  for (const ln of lines) {
    if (!ln.hsCode) issues.push(`line ${ln.lineNo} (${ln.productName}): HS Code missing`);
  }
  return issues;
}

module.exports = {
  generateMushak63,
  checkCompleteness,
  SPEC_VERSION,
  NAMESPACE,
};
