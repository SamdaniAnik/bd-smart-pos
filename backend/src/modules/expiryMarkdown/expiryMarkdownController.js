const prisma = require("../../utils/prisma");
const { writeAuditLog } = require("../../utils/audit");
const {
  parseConfig,
  serializeConfig,
  sanitizeTiers,
  daysUntil,
  markdownPercentForDays,
  maxTierDays,
  applyMarkdown,
} = require("../../utils/expiryMarkdown");

async function loadConfig(branchId) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { expiryMarkdownJson: true },
  });
  return parseConfig(branch?.expiryMarkdownJson);
}

exports.getConfig = async (req, res) => {
  try {
    res.json(await loadConfig(req.branchId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const branchId = req.branchId;
    const enabled = Boolean(req.body?.enabled);
    const tiers = sanitizeTiers(req.body?.tiers);
    if (!tiers.length) return res.status(400).json({ error: "Provide at least one valid markdown tier" });
    const json = serializeConfig({ enabled, tiers });
    await prisma.branch.update({ where: { id: branchId }, data: { expiryMarkdownJson: json } });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "EXPIRY_MARKDOWN_CONFIG",
      entity: "Branch",
      entityId: branchId,
      payload: { enabled, tierCount: tiers.length },
    });
    res.json(parseConfig(json));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** In-stock batches within the markdown window, with original + marked-down price. */
exports.listItems = async (req, res) => {
  try {
    const branchId = req.branchId;
    const config = await loadConfig(branchId);
    const horizonDays = maxTierDays(config.tiers);
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + horizonDays);

    const batches = await prisma.inventoryBatch.findMany({
      where: {
        branchId,
        qtyOnHand: { gt: 0 },
        expiryDate: { not: null, lte: horizon },
      },
      include: { product: { select: { id: true, name: true, nameBn: true, sku: true, price: true } } },
      orderBy: { expiryDate: "asc" },
      take: 500,
    });

    const items = batches
      .map((b) => {
        const d = daysUntil(b.expiryDate, now);
        const percent = markdownPercentForDays(d, config.tiers);
        const originalPrice = Number(b.product?.price || 0);
        return {
          batchId: b.id,
          batchCode: b.batchCode,
          productId: b.productId,
          productName: b.product?.name || `#${b.productId}`,
          productNameBn: b.product?.nameBn || null,
          sku: b.product?.sku || null,
          qtyOnHand: b.qtyOnHand,
          expiryDate: b.expiryDate,
          daysToExpiry: d,
          expired: d != null && d < 0,
          markdownPercent: percent,
          originalPrice,
          markdownPrice: percent > 0 ? applyMarkdown(originalPrice, percent) : originalPrice,
        };
      })
      .filter((x) => x.markdownPercent > 0 || x.expired);

    res.json({ enabled: config.enabled, tiers: config.tiers, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** Nearest-expiry markdown for a single product (used by POS when adding items). */
exports.getProductMarkdown = async (req, res) => {
  try {
    const branchId = req.branchId;
    const productId = Number(req.params.productId);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    const config = await loadConfig(branchId);
    if (!config.enabled) return res.json({ enabled: false, markdownPercent: 0 });

    const product = await prisma.product.findFirst({
      where: { id: productId, branchId },
      select: { id: true, price: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const batch = await prisma.inventoryBatch.findFirst({
      where: { branchId, productId, qtyOnHand: { gt: 0 }, expiryDate: { not: null } },
      orderBy: { expiryDate: "asc" },
      select: { expiryDate: true },
    });
    const d = batch ? daysUntil(batch.expiryDate) : null;
    const percent = markdownPercentForDays(d, config.tiers);
    const originalPrice = Number(product.price || 0);
    res.json({
      enabled: true,
      productId,
      daysToExpiry: d,
      markdownPercent: percent,
      originalPrice,
      markdownPrice: percent > 0 ? applyMarkdown(originalPrice, percent) : originalPrice,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
