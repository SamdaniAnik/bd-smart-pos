// Pure compute helpers for AIT / VDS withholding on a supplier payment.
// No DB access — caller passes the supplier row + payment context.

const { getCategory } = require("./rates");

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Resolve effective AIT and VDS rates for a payment, with the following
 * priority (highest first):
 *   1. Supplier.withholdingExempt -> 0/0
 *   2. Per-payment explicit override (`overrideAitRate`, `overrideVdsRate`)
 *   3. Per-payment taxCategory override (`overrideTaxCategory`)
 *   4. Supplier.taxCategory default
 *   5. Zero / zero
 */
function resolveRates({ supplier, overrideAitRate, overrideVdsRate, overrideTaxCategory }) {
  if (supplier && supplier.withholdingExempt) {
    return { aitRate: 0, vdsRate: 0, source: "EXEMPT", category: null };
  }

  if (overrideAitRate !== undefined || overrideVdsRate !== undefined) {
    return {
      aitRate: Math.max(0, Number(overrideAitRate || 0)),
      vdsRate: Math.max(0, Number(overrideVdsRate || 0)),
      source: "OVERRIDE_RATES",
      category: overrideTaxCategory || supplier?.taxCategory || null,
    };
  }

  const overrideCat = getCategory(overrideTaxCategory);
  if (overrideCat) {
    return {
      aitRate: overrideCat.aitRate,
      vdsRate: overrideCat.vdsRate,
      source: "OVERRIDE_CATEGORY",
      category: overrideCat.code,
    };
  }

  const supplierCat = getCategory(supplier?.taxCategory);
  if (supplierCat) {
    return {
      aitRate: supplierCat.aitRate,
      vdsRate: supplierCat.vdsRate,
      source: "SUPPLIER_DEFAULT",
      category: supplierCat.code,
    };
  }

  return { aitRate: 0, vdsRate: 0, source: "NONE", category: null };
}

/**
 * Compute AIT / VDS / netPaid for a gross supplier payment amount.
 *
 * Bangladesh practice: both AIT and VDS are computed on the gross invoice
 * value (before VAT for VDS, on payment-base for AIT). The buyer withholds
 * both, so cash actually leaving the buyer = gross - aitAmount - vdsAmount.
 *
 * @param {object} input
 * @param {number} input.grossAmount       Full invoice / due-clearance amount.
 * @param {number} input.aitRate           Effective AIT % (e.g. 5).
 * @param {number} input.vdsRate           Effective VDS % (e.g. 7.5).
 * @returns {{ aitAmount: number, vdsAmount: number, netPaid: number }}
 */
function computeWithholding({ grossAmount, aitRate, vdsRate }) {
  const gross = Math.max(0, Number(grossAmount || 0));
  const ait = Math.max(0, Number(aitRate || 0));
  const vds = Math.max(0, Number(vdsRate || 0));
  const aitAmount = round2((gross * ait) / 100);
  const vdsAmount = round2((gross * vds) / 100);
  const netPaid = round2(gross - aitAmount - vdsAmount);
  return { aitAmount, vdsAmount, netPaid };
}

/**
 * Build the journal-line payload for a supplier payment with withholding.
 *
 *   DR  Accounts Payable           gross
 *     CR  Cash / Bank              netPaid
 *     CR  AIT Payable to NBR       aitAmount  (if > 0)
 *     CR  VDS Payable to NBR       vdsAmount  (if > 0)
 *
 * `accountMap` is a Map<code, accountRow>.  Caller is responsible for ensuring
 * accounts 1100, 2100, 2120, 2125 exist (seeded by bootstrap).
 *
 * Returns null if mandatory accounts are missing — caller decides whether to
 * proceed without journaling (legacy behaviour) or hard-fail.
 */
function buildJournalLines({ accountMap, gross, aitAmount, vdsAmount, netPaid, cashCode = "1100" }) {
  const cash = accountMap.get(cashCode);
  const payable = accountMap.get("2100");
  if (!cash || !payable) return null;

  const lines = [
    { accountId: payable.id, debit: round2(gross), credit: 0 },
    { accountId: cash.id, debit: 0, credit: round2(netPaid) },
  ];

  if (aitAmount > 0) {
    const aitLiability = accountMap.get("2120");
    if (!aitLiability) return null;
    lines.push({ accountId: aitLiability.id, debit: 0, credit: round2(aitAmount) });
  }

  if (vdsAmount > 0) {
    const vdsLiability = accountMap.get("2125");
    if (!vdsLiability) return null;
    lines.push({ accountId: vdsLiability.id, debit: 0, credit: round2(vdsAmount) });
  }

  return lines;
}

/**
 * Validate that a journal payload balances (sum debits == sum credits).
 * Returns true if balanced, false otherwise.
 */
function journalBalances(lines) {
  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return Math.abs(debit - credit) < 0.005;
}

/**
 * Generate a Mushak 6.6 / withholding certificate document number.
 * Format: WHT-{branchCode}-{YYYYMM}-{seq}, sequenced via BranchDocumentSeq.
 *
 * @param {object} tx        Prisma transaction client.
 * @param {number} branchId
 * @param {Date}   [date]
 */
async function nextWithholdingDocNo(tx, branchId, date) {
  const dt = date instanceof Date ? date : new Date();
  const periodKey = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const scope = "WHT_CERT";
  const branch = await tx.branch.findUnique({ where: { id: Number(branchId) }, select: { code: true } });
  const code = String(branch?.code || branchId).replace(/\s+/g, "");
  const existing = await tx.branchDocumentSeq.findUnique({
    where: { branchId_scope_periodKey: { branchId: Number(branchId), scope, periodKey } },
  });
  let nextVal = 1;
  if (existing) {
    nextVal = Number(existing.lastValue || 0) + 1;
    await tx.branchDocumentSeq.update({ where: { id: existing.id }, data: { lastValue: nextVal } });
  } else {
    await tx.branchDocumentSeq.create({ data: { branchId: Number(branchId), scope, periodKey, lastValue: 1 } });
  }
  return `WHT-${code}-${periodKey}-${String(nextVal).padStart(5, "0")}`;
}

module.exports = {
  resolveRates,
  computeWithholding,
  buildJournalLines,
  journalBalances,
  nextWithholdingDocNo,
};
