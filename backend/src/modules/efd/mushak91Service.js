// Mushak 9.1 live filing wrapper.
//
// The canonical aggregation (output VAT + input VAT credit per HS/rate slab) is
// owned by the NBR module's generateMushak91(). This wrapper reuses that single
// source of truth so the EFD/iVAS filing path and the XML export path can never
// diverge (previously this file hardcoded inputVat = 0).

const prisma = require("../../utils/prisma");
const { generateMushak91, periodBounds } = require("../nbr/mushak91");
const { uploadMushak91 } = require("./ivasClient");

function taxPeriodBounds(taxPeriod) {
  const { year, month, start, end, startISO, endISO } = periodBounds(taxPeriod);
  return { from: start, to: end, label: `${startISO.slice(0, 7)}`, year, month, startISO, endISO };
}

async function buildMushak91Payload(branchId, taxPeriod) {
  const branch = await prisma.branch.findUnique({ where: { id: Number(branchId) } });
  if (!branch) throw new Error("Branch not found");

  // Single source of truth: full HS/rate bucketed output + input VAT + warnings.
  const { xml, hash, summary, warnings } = await generateMushak91({
    branchId: Number(branchId),
    periodKey: taxPeriod,
  });

  const outputVat = Number(summary.output.totalVat || 0);
  const inputVat = Number(summary.input.totalVat || 0);
  const netPayable = Number(summary.netVatPayable || 0);

  return {
    form: "Mushak-9.1",
    taxPeriod: summary.period.key,
    branch: {
      code: branch.code,
      name: branch.name,
      sellerBin: branch.sellerBin || "",
      tradeLicenseNo: branch.tradeLicenseNo || "",
      vatRegistrationLabel: branch.vatRegistrationLabel || "",
    },
    summary: {
      salesCount: summary.counts.salesCount,
      purchaseCount: summary.counts.purchaseCount,
      outputTaxable: Number(summary.output.totalNet || 0),
      inputTaxable: Number(summary.input.totalNet || 0),
      outputVat: Number(outputVat.toFixed(2)),
      inputVat: Number(inputVat.toFixed(2)),
      netVatPayable: Number(netPayable.toFixed(2)),
    },
    outputBuckets: summary.output.buckets,
    inputBuckets: summary.input.buckets,
    warnings,
    xmlHash: hash,
    xml,
    submittedAt: new Date().toISOString(),
  };
}

async function submitMushak91Return(branchId, taxPeriod) {
  const url = String(process.env.EFD_MUSHAK91_URL || "").trim();
  const apiKey = String(process.env.EFD_MUSHAK91_API_KEY || process.env.EFD_GENEX_API_KEY || "").trim();
  if (!url || !apiKey) {
    throw new Error("Mushak 9.1 live filing requires EFD_MUSHAK91_URL and EFD_MUSHAK91_API_KEY (NBR iVAS / authorized ERP endpoint)");
  }

  const payload = await buildMushak91Payload(branchId, taxPeriod);
  const result = await uploadMushak91(payload);

  return {
    ok: true,
    provider: "mushak91",
    taxPeriod: payload.taxPeriod,
    referenceNo: result.referenceNo,
    status: result.status,
    netVatPayable: payload.summary.netVatPayable,
    raw: result.raw,
  };
}

module.exports = {
  buildMushak91Payload,
  submitMushak91Return,
  taxPeriodBounds,
};
