const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const { generateMushak63, checkCompleteness } = require("./mushak63");
const { generateMushak91 } = require("./mushak91");

function getBranchId(req) {
  return Number(req.headers["x-branch-id"] || req.user?.branchId || 0);
}

exports.getSaleMushak63Xml = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }

    const [sale, branch] = await Promise.all([
      prisma.sale.findFirst({
        where: { id, branchId },
        include: { customer: true, items: { include: { product: true } } },
      }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    // Prefer the canonical XML stored at sale-create time. Re-emit only if
    // the row is older than the column or was migrated from a legacy install.
    let xml = sale.nbrXmlPayload;
    let hash = sale.nbrXmlHash;
    let regenerated = false;

    if (!xml) {
      const out = generateMushak63({ sale, branch });
      xml = out.xml;
      hash = out.hash;
      regenerated = true;
    }

    const filename = `mushak-6.3-${sale.mushakDocumentNo || sale.id}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Mushak-XML-Hash", hash || "");
    if (regenerated) res.setHeader("X-Mushak-XML-Regenerated", "true");
    return res.status(200).send(xml);
  } catch (err) {
    req.log?.error?.({ err }, "getSaleMushak63Xml failed");
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.getSaleMushak63CompletenessReport = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }
    const [sale, branch] = await Promise.all([
      prisma.sale.findFirst({
        where: { id, branchId },
        include: { customer: true, items: { include: { product: true } } },
      }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    const issues = checkCompleteness({ sale, branch });
    return res.json({ saleId: sale.id, mushakDocumentNo: sale.mushakDocumentNo, issues });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.exportMushak91Xml = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const periodKey = String(req.query.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
      return res.status(400).json({ error: "period query param must be YYYY-MM" });
    }
    const out = await generateMushak91({ branchId, periodKey });
    const filename = `mushak-9.1-${branchId}-${periodKey}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Mushak-XML-Hash", out.hash);
    return res.status(200).send(out.xml);
  } catch (err) {
    req.log?.error?.({ err }, "exportMushak91Xml failed");
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.getMushak91Summary = async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const periodKey = String(req.query.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
      return res.status(400).json({ error: "period query param must be YYYY-MM" });
    }
    const out = await generateMushak91({ branchId, periodKey });
    return res.json({ summary: out.summary, hash: out.hash, warnings: out.warnings });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
