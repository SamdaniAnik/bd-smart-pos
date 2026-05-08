// Mushak 9.1 (Monthly VAT Return / মাসিক ভ্যাট রিটার্ন) emitter.
//
// Aggregates a tax period (calendar month, fiscal-year-aligned) of sales
// (output VAT) and purchases (input VAT credit) per HS-code/rate slab, plus
// summary totals required by NBR Form 9.1.
//
// As with Mushak 6.3, NBR has not published a public XSD; this implementation
// follows the official form layout. Unknown leaves can be remapped without
// touching the aggregation pipeline.

const prisma = require("../../utils/prisma");
const { buildXml } = require("./xmlBuilder");
const crypto = require("crypto");

const NAMESPACE = "https://nbr.gov.bd/mushak/9.1";
const SPEC_VERSION = "1.0";

function fmt(n, dp = 2) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return (0).toFixed(dp);
  return v.toFixed(dp);
}

function periodBounds(periodKey) {
  // periodKey: "YYYY-MM". We anchor period bounds to UTC midnight so the
  // emitted XML start/end dates are timezone-deterministic — NBR returns are
  // filed by calendar month (Asia/Dhaka). The DB query uses the same UTC
  // bounds; sales created at local-midnight BST fall into the correct month
  // because Dhaka is UTC+6 (always positive offset, no DST).
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ""));
  if (!m) throw new Error(`Invalid period key "${periodKey}". Expected YYYY-MM.`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month ${month} in "${periodKey}"`);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)); // exclusive
  const lastDay = new Date(end.getTime() - 1);
  const startISO = `${year}-${String(month).padStart(2, "0")}-01`;
  const endISO = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, "0")}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
  return { year, month, start, end, startISO, endISO };
}

/**
 * Build the canonical Mushak 9.1 XML for a (branchId, periodKey) pair.
 *
 * @param {object} ctx
 * @param {number} ctx.branchId
 * @param {string} ctx.periodKey  "YYYY-MM"
 * @returns {{ xml: string, hash: string, summary: object, warnings: string[] }}
 */
async function generateMushak91({ branchId, periodKey }) {
  if (!branchId) throw new Error("generateMushak91: branchId is required");
  const { year, month, start, end, startISO, endISO } = periodBounds(periodKey);

  const branch = await prisma.branch.findUnique({ where: { id: Number(branchId) } });
  if (!branch) throw new Error(`Branch ${branchId} not found`);

  // Output side: sales in scope.
  const sales = await prisma.sale.findMany({
    where: {
      branchId: Number(branchId),
      createdAt: { gte: start, lt: end },
      status: "completed",
    },
    select: {
      id: true,
      invoiceNo: true,
      mushakDocumentNo: true,
      subTotal: true,
      vatAmount: true,
      discount: true,
      total: true,
      vatBreakdownSnapshot: true,
      createdAt: true,
    },
  });

  // Input side: purchases in scope (VAT credit).
  const purchases = await prisma.purchase.findMany({
    where: {
      branchId: Number(branchId),
      createdAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      invoiceNo: true,
      total: true,
      createdAt: true,
      items: {
        select: {
          qty: true,
          cost: true,
          product: { select: { vatRate: true, hsCode: true, name: true } },
        },
      },
    },
  });

  // ----- Output VAT bucketing -----
  // bucketKey = `${rate}|${hsCode || "UNCLASSIFIED"}`
  const outputBuckets = new Map();
  let totalOutputNet = 0;
  let totalOutputVat = 0;
  let salesMissingMushakNo = 0;
  let salesMissingHsCode = 0;

  for (const s of sales) {
    if (!s.mushakDocumentNo) salesMissingMushakNo += 1;
    const snap = s.vatBreakdownSnapshot;
    const rows = Array.isArray(snap)
      ? snap
      : snap && typeof snap === "object"
      ? Object.values(snap)
      : [];
    if (!rows.length) continue;

    for (const row of rows) {
      const rate = round2(Number(row.vatRate || 0));
      const hs = row.hsCode || "UNCLASSIFIED";
      if (hs === "UNCLASSIFIED") salesMissingHsCode += 1;
      const k = `${rate}|${hs}`;
      const cur = outputBuckets.get(k) || { rate, hsCode: hs, net: 0, vat: 0, lineCount: 0 };
      cur.net += Number(row.netAmount || 0);
      cur.vat += Number(row.vatAmount || 0);
      cur.lineCount += 1;
      outputBuckets.set(k, cur);
      totalOutputNet += Number(row.netAmount || 0);
      totalOutputVat += Number(row.vatAmount || 0);
    }
  }

  // ----- Input VAT bucketing (estimated from product.vatRate when no
  // line-level VAT trace exists on Purchase). -----
  const inputBuckets = new Map();
  let totalInputNet = 0;
  let totalInputVat = 0;

  for (const p of purchases) {
    for (const it of p.items || []) {
      const qty = Number(it.qty || 0);
      const cost = Number(it.cost || 0);
      const rate = round2(Number(it.product?.vatRate || 0));
      if (qty <= 0 || cost <= 0) continue;
      const lineNet = qty * cost;
      const lineVat = (lineNet * rate) / 100;
      const hs = it.product?.hsCode || "UNCLASSIFIED";
      const k = `${rate}|${hs}`;
      const cur = inputBuckets.get(k) || { rate, hsCode: hs, net: 0, vat: 0, lineCount: 0 };
      cur.net += lineNet;
      cur.vat += lineVat;
      cur.lineCount += 1;
      inputBuckets.set(k, cur);
      totalInputNet += lineNet;
      totalInputVat += lineVat;
    }
  }

  const netVatPayable = totalOutputVat - totalInputVat;

  const warnings = [];
  if (salesMissingMushakNo > 0) {
    warnings.push(`${salesMissingMushakNo} sale(s) have no Mushak document number`);
  }
  if (salesMissingHsCode > 0) {
    warnings.push(`${salesMissingHsCode} sale line(s) have no HS Code (bucketed as UNCLASSIFIED)`);
  }
  if (!branch.sellerBin) warnings.push("branch.sellerBin (Seller BIN) is missing");

  const summary = {
    branchId: Number(branchId),
    branchName: branch.name,
    period: { year, month, start: start.toISOString(), end: end.toISOString(), startISO, endISO, key: periodKey },
    counts: {
      salesCount: sales.length,
      purchaseCount: purchases.length,
      salesMissingMushakNo,
      salesMissingHsCode,
    },
    output: {
      totalNet: round2(totalOutputNet),
      totalVat: round2(totalOutputVat),
      buckets: sortedBuckets(outputBuckets),
    },
    input: {
      totalNet: round2(totalInputNet),
      totalVat: round2(totalInputVat),
      buckets: sortedBuckets(inputBuckets),
    },
    netVatPayable: round2(netVatPayable),
    warnings,
  };

  const tree = renderTree(branch, summary);
  const xml = buildXml(tree, { pretty: false });
  const hash = crypto.createHash("sha256").update(xml, "utf8").digest("hex");
  return { xml, hash, summary, warnings };
}

function sortedBuckets(map) {
  return [...map.values()]
    .map((b) => ({ ...b, net: round2(b.net), vat: round2(b.vat) }))
    .sort((a, b) => {
      if (a.rate !== b.rate) return b.rate - a.rate;
      return String(a.hsCode).localeCompare(String(b.hsCode));
    });
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function renderTree(branch, s) {
  return [
    "Mushak91",
    { xmlns: NAMESPACE, version: SPEC_VERSION },
    [
      ["Period", null, [
        ["Year", null, s.period.year],
        ["Month", null, s.period.month],
        ["StartDate", null, s.period.startISO],
        ["EndDate", null, s.period.endISO],
      ]],
      ["Seller", null, [
        ["BIN", null, branch.sellerBin],
        ["TradeLicenseNo", null, branch.tradeLicenseNo],
        ["BranchCode", null, branch.code],
        ["BranchName", null, branch.name],
        ["Address", null, branch.address],
        ["Phone", null, branch.phone],
      ]],
      ["OutputVAT", null, [
        ["TotalNet", null, fmt(s.output.totalNet, 2)],
        ["TotalVAT", null, fmt(s.output.totalVat, 2)],
        ["Buckets", null, s.output.buckets.map((b) => [
          "Bucket",
          { rate: fmt(b.rate, 2), hsCode: b.hsCode },
          [
            ["LineCount", null, b.lineCount],
            ["Net", null, fmt(b.net, 2)],
            ["VAT", null, fmt(b.vat, 2)],
          ],
        ])],
      ]],
      ["InputVAT", null, [
        ["TotalNet", null, fmt(s.input.totalNet, 2)],
        ["TotalVAT", null, fmt(s.input.totalVat, 2)],
        ["Buckets", null, s.input.buckets.map((b) => [
          "Bucket",
          { rate: fmt(b.rate, 2), hsCode: b.hsCode },
          [
            ["LineCount", null, b.lineCount],
            ["Net", null, fmt(b.net, 2)],
            ["VAT", null, fmt(b.vat, 2)],
          ],
        ])],
      ]],
      ["Summary", null, [
        ["NetVATPayable", null, fmt(s.netVatPayable, 2)],
        ["SalesCount", null, s.counts.salesCount],
        ["PurchaseCount", null, s.counts.purchaseCount],
      ]],
      s.warnings.length
        ? ["Warnings", null, s.warnings.map((w) => ["Warning", null, w])]
        : null,
    ],
  ];
}

module.exports = { generateMushak91, periodBounds, NAMESPACE, SPEC_VERSION };
