const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const { resolveFundingAccountCode } = require("../../utils/fundingAccount");
const { TAX_CATEGORIES, getCategory } = require("./rates");
const {
  resolveRates,
  computeWithholding,
  buildJournalLines,
  journalBalances,
  nextWithholdingDocNo,
} = require("./withholdingService");
const { streamMushak66Pdf } = require("./mushak66");

function getBranchId(req) {
  return req.branchId || Number(req.body?.branchId || req.query?.branchId || 1);
}

// --- Lookup endpoints ---------------------------------------------------

exports.listTaxCategories = async (req, res) => {
  res.json({ categories: TAX_CATEGORIES });
};

// --- Preview ------------------------------------------------------------

exports.previewSupplierPayment = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const supplierId = Number(req.body?.supplierId || req.query?.supplierId || 0);
    const grossAmount = Number(req.body?.amount || req.query?.amount || 0);
    if (!grossAmount || grossAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than zero" });
    }

    const supplier = supplierId
      ? await prisma.supplier.findFirst({ where: { id: supplierId, branchId } })
      : null;

    const rates = resolveRates({
      supplier,
      overrideAitRate: req.body?.aitRate,
      overrideVdsRate: req.body?.vdsRate,
      overrideTaxCategory: req.body?.taxCategory,
    });
    const computed = computeWithholding({ grossAmount, aitRate: rates.aitRate, vdsRate: rates.vdsRate });

    return res.json({
      supplier: supplier
        ? { id: supplier.id, name: supplier.name, taxCategory: supplier.taxCategory, withholdingExempt: supplier.withholdingExempt }
        : null,
      rates,
      gross: grossAmount,
      ...computed,
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

// --- Pay supplier with auto withholding ---------------------------------

exports.paySupplierWithholding = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const {
      supplierId,
      amount,
      method,
      note,
      taxCategory: overrideCategory,
      aitRate: overrideAitRate,
      vdsRate: overrideVdsRate,
      withholdingNote,
      issueCertificate = true,
    } = req.body || {};

    const grossAmount = Number(amount);
    if (!grossAmount || grossAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than zero" });
    }

    await ensureOpenFiscalPeriod(branchId);

    const created = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: Number(supplierId), branchId },
      });
      if (!supplier) throw new Error("Supplier not found");
      if (grossAmount > Number(supplier.payableBalance || 0) + 0.005) {
        throw new Error("Payment amount exceeds supplier payable");
      }

      const rates = resolveRates({
        supplier,
        overrideAitRate,
        overrideVdsRate,
        overrideTaxCategory: overrideCategory,
      });
      const { aitAmount, vdsAmount, netPaid } = computeWithholding({
        grossAmount,
        aitRate: rates.aitRate,
        vdsRate: rates.vdsRate,
      });

      // Reduce payable by the gross amount — supplier's invoice is fully
      // settled even though only `netPaid` left our cash. The retentions
      // become liabilities owed to NBR (separate accounts).
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { payableBalance: { decrement: grossAmount } },
      });

      const docNo =
        issueCertificate && (aitAmount > 0 || vdsAmount > 0)
          ? await nextWithholdingDocNo(tx, branchId, new Date())
          : null;

      const voucher = await tx.paymentVoucher.create({
        data: {
          branchId,
          supplierId: supplier.id,
          amount: grossAmount,
          method: method || "Cash",
          note: note || null,
          taxCategory: rates.category || overrideCategory || supplier.taxCategory || null,
          aitRate: rates.aitRate,
          aitAmount,
          vdsRate: rates.vdsRate,
          vdsAmount,
          netPaid,
          withholdingNote: withholdingNote || null,
          mushak66DocumentNo: docNo,
        },
      });

      const fundingCode = resolveFundingAccountCode(method, req.body?.fundingAccountCode);

      const accounts = await tx.account.findMany({ where: { branchId } });
      const accountMap = new Map(accounts.map((a) => [a.code, a]));
      const lines = buildJournalLines({
        accountMap,
        gross: grossAmount,
        aitAmount,
        vdsAmount,
        netPaid,
        cashCode: fundingCode,
      });

      if (lines && journalBalances(lines)) {
        await tx.journal.create({
          data: {
            branchId,
            createdBy: req.user?.id || null,
            refType: "SUPPLIER_PAYMENT",
            refId: voucher.id,
            narration:
              `Supplier payment ${supplier.name}` +
              (aitAmount > 0 ? ` | AIT ${rates.aitRate}%` : "") +
              (vdsAmount > 0 ? ` | VDS ${rates.vdsRate}%` : ""),
            lines: { create: lines },
          },
        });
      } else if (aitAmount > 0 || vdsAmount > 0) {
        // Withholding requested but the AIT/VDS liability accounts are
        // missing. We refuse rather than silently book a half-correct journal.
        throw new Error(
          "Cannot post withholding journal — AIT (2120) and/or VDS (2125) liability accounts are missing. Re-run bootstrap or seed-tax-accounts."
        );
      } else {
        throw new Error(
          `Cannot post supplier payment — ensure Accounts Payable (2100) and funding account ${fundingCode} exist (Cash=1100, Bank=1130 after migration).`
        );
      }

      return { voucher, supplier, rates, computed: { aitAmount, vdsAmount, netPaid } };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SUPPLIER_PAYMENT_WITHHOLDING",
      entity: "PaymentVoucher",
      entityId: created.voucher.id,
      payload: {
        gross: grossAmount,
        aitRate: created.rates.aitRate,
        vdsRate: created.rates.vdsRate,
        aitAmount: created.computed.aitAmount,
        vdsAmount: created.computed.vdsAmount,
        netPaid: created.computed.netPaid,
        category: created.rates.category,
      },
    });

    return res.status(201).json({
      voucher: created.voucher,
      supplier: { id: created.supplier.id, name: created.supplier.name },
      rates: created.rates,
      ...created.computed,
    });
  } catch (err) {
    if (respondFiscalBlocked(res, err)) return;
    req.log?.warn?.({ err: err.message }, "paySupplierWithholding failed");
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

// --- Mushak 6.6 certificate PDF -----------------------------------------

exports.getMushak66Pdf = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid voucher id" });
    }
    const [voucher, branch] = await Promise.all([
      prisma.paymentVoucher.findFirst({
        where: { id, branchId },
        include: { supplier: true },
      }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    if (!voucher) return res.status(404).json({ error: "Payment voucher not found" });
    if (Number(voucher.aitAmount || 0) <= 0 && Number(voucher.vdsAmount || 0) <= 0) {
      return res.status(400).json({
        error:
          "This payment had no withholding (AIT and VDS are both zero). Mushak 6.6 is not applicable.",
      });
    }
    return streamMushak66Pdf({ voucher, branch, res });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

// --- Registers (AIT / VDS) ----------------------------------------------

function periodFilter(periodKey) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(periodKey || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end, year, month };
}

async function loadRegister({ branchId, periodKey, kind }) {
  const where = { branchId };
  const window = periodFilter(periodKey);
  if (window) where.createdAt = { gte: window.start, lt: window.end };
  if (kind === "AIT") where.aitAmount = { gt: 0 };
  if (kind === "VDS") where.vdsAmount = { gt: 0 };

  const rows = await prisma.paymentVoucher.findMany({
    where,
    include: { supplier: true },
    orderBy: { createdAt: "asc" },
  });

  const totalGross = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAit = rows.reduce((s, r) => s + Number(r.aitAmount || 0), 0);
  const totalVds = rows.reduce((s, r) => s + Number(r.vdsAmount || 0), 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.netPaid || 0), 0);

  return {
    period: window || null,
    rows,
    summary: {
      voucherCount: rows.length,
      totalGross: Math.round(totalGross * 100) / 100,
      totalAit: Math.round(totalAit * 100) / 100,
      totalVds: Math.round(totalVds * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
    },
  };
}

exports.getAitRegister = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const out = await loadRegister({ branchId, periodKey: req.query.period, kind: "AIT" });
    return res.json(out);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.getVdsRegister = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const out = await loadRegister({ branchId, periodKey: req.query.period, kind: "VDS" });
    return res.json(out);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function streamRegisterCsv(res, kind, out) {
  const filename = `${kind.toLowerCase()}-register${out.period ? `-${out.period.year}-${String(out.period.month).padStart(2, "0")}` : ""}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const headers = [
    "VoucherID",
    "CertificateNo",
    "Date",
    "Supplier",
    "TIN",
    "BIN",
    "TaxCategory",
    "Method",
    "GrossAmount",
    "AITRate",
    "AITAmount",
    "VDSRate",
    "VDSAmount",
    "NetPaid",
    "Note",
  ];
  res.write(headers.join(",") + "\n");
  for (const r of out.rows) {
    res.write(
      [
        r.id,
        r.mushak66DocumentNo || "",
        new Date(r.createdAt).toISOString().slice(0, 10),
        r.supplier?.name || "",
        r.supplier?.tinNumber || "",
        r.supplier?.binNumber || "",
        r.taxCategory || r.supplier?.taxCategory || "",
        r.method || "",
        Number(r.amount || 0).toFixed(2),
        Number(r.aitRate || 0).toFixed(2),
        Number(r.aitAmount || 0).toFixed(2),
        Number(r.vdsRate || 0).toFixed(2),
        Number(r.vdsAmount || 0).toFixed(2),
        Number(r.netPaid != null ? r.netPaid : Number(r.amount || 0) - Number(r.aitAmount || 0) - Number(r.vdsAmount || 0)).toFixed(2),
        r.withholdingNote || r.note || "",
      ]
        .map(csvEscape)
        .join(",") + "\n"
    );
  }
  res.write(
    [
      "TOTALS",
      "",
      "",
      `${out.summary.voucherCount} vouchers`,
      "",
      "",
      "",
      "",
      out.summary.totalGross.toFixed(2),
      "",
      out.summary.totalAit.toFixed(2),
      "",
      out.summary.totalVds.toFixed(2),
      out.summary.totalNet.toFixed(2),
      "",
    ]
      .map(csvEscape)
      .join(",") + "\n"
  );
  res.end();
}

exports.exportAitRegisterCsv = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const out = await loadRegister({ branchId, periodKey: req.query.period, kind: "AIT" });
    streamRegisterCsv(res, "AIT", out);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.exportVdsRegisterCsv = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const out = await loadRegister({ branchId, periodKey: req.query.period, kind: "VDS" });
    streamRegisterCsv(res, "VDS", out);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
