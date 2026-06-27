const prisma = require("../../utils/prisma");
const { listFestivalTemplates, getFestivalTemplate } = require("../../utils/festivalTemplates");

function normalizeRule(rule) {
  return {
    ...rule,
    buyQty: Number(rule.buyQty || 1),
    getQty: Number(rule.getQty || 1),
    discountValue: Number(rule.discountValue || 0),
    minBasketAmount: Number(rule.minBasketAmount || 0),
  };
}

exports.listPromotions = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.promotionRule.findMany({
      where: { branchId },
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    res.json(rows.map(normalizeRule));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPromotion = async (req, res) => {
  try {
    const branchId = req.branchId;
    const {
      name,
      type,
      productId,
      category,
      buyQty,
      getQty,
      discountValue,
      minBasketAmount,
      isActive,
      startsAt,
      endsAt,
    } = req.body || {};

    if (!name || !type) return res.status(400).json({ error: "name and type are required" });
    if (
      ![
        "BOGO_PRODUCT",
        "CATEGORY_PERCENT",
        "CART_PERCENT",
        "BUNDLE_FIXED",
        "CATEGORY_BUNDLE_FIXED",
        "MIX_MATCH_FIXED",
        "PRODUCT_PERCENT",
      ].includes(String(type))
    ) {
      return res
        .status(400)
        .json({
          error:
            "type must be BOGO_PRODUCT, CATEGORY_PERCENT, CART_PERCENT, BUNDLE_FIXED, CATEGORY_BUNDLE_FIXED, MIX_MATCH_FIXED, or PRODUCT_PERCENT",
        });
    }
    if (type === "BOGO_PRODUCT" && !productId) {
      return res.status(400).json({ error: "productId is required for BOGO_PRODUCT" });
    }
    if (type === "PRODUCT_PERCENT" && !productId) {
      return res.status(400).json({ error: "productId is required for PRODUCT_PERCENT" });
    }
    if (type === "CATEGORY_PERCENT" && !String(category || "").trim()) {
      return res.status(400).json({ error: "category is required for CATEGORY_PERCENT" });
    }
    if (type === "CATEGORY_BUNDLE_FIXED" && !String(category || "").trim()) {
      return res.status(400).json({ error: "category is required for CATEGORY_BUNDLE_FIXED" });
    }
    if (type === "CATEGORY_BUNDLE_FIXED" && Number(buyQty || 0) < 2) {
      return res.status(400).json({ error: "buyQty (bundle size) must be at least 2 for CATEGORY_BUNDLE_FIXED" });
    }
    if (type === "CATEGORY_BUNDLE_FIXED" && Number(discountValue || 0) <= 0) {
      return res.status(400).json({ error: "bundle fixed price is required for CATEGORY_BUNDLE_FIXED" });
    }
    const bundleProductIds =
      type === "BUNDLE_FIXED" || type === "MIX_MATCH_FIXED"
        ? Array.isArray(req.body?.bundleProductIds)
          ? req.body.bundleProductIds.map((x) => Number(x)).filter((x) => !Number.isNaN(x) && x > 0)
          : []
        : [];
    if (type === "BUNDLE_FIXED" && bundleProductIds.length < 2) {
      return res.status(400).json({ error: "bundleProductIds must include at least 2 products for BUNDLE_FIXED" });
    }
    if (type === "BUNDLE_FIXED" && Number(discountValue || 0) <= 0) {
      return res.status(400).json({ error: "bundle fixed price is required for BUNDLE_FIXED" });
    }
    if (type === "MIX_MATCH_FIXED" && bundleProductIds.length < 2) {
      return res.status(400).json({ error: "bundleProductIds must include at least 2 products for MIX_MATCH_FIXED" });
    }
    if (type === "MIX_MATCH_FIXED" && Number(buyQty || 0) < 2) {
      return res.status(400).json({ error: "buyQty (pick count) must be at least 2 for MIX_MATCH_FIXED" });
    }
    if (type === "MIX_MATCH_FIXED" && Number(discountValue || 0) <= 0) {
      return res.status(400).json({ error: "fixed bundle price is required for MIX_MATCH_FIXED" });
    }
    const row = await prisma.promotionRule.create({
      data: {
        branchId,
        name: String(name).trim(),
        type: String(type),
        productId: productId ? Number(productId) : null,
        category: category ? String(category).trim() : null,
        buyQty: Math.max(1, Number(buyQty || 1)),
        getQty: Math.max(1, Number(getQty || 1)),
        discountValue: Math.max(0, Number(discountValue || 0)),
        bundlePrice:
          type === "BUNDLE_FIXED" || type === "CATEGORY_BUNDLE_FIXED" || type === "MIX_MATCH_FIXED"
            ? Math.max(0, Number(discountValue || 0))
            : null,
        bundleProductIds:
          type === "BUNDLE_FIXED" || type === "MIX_MATCH_FIXED" ? bundleProductIds.join(",") : null,
        minBasketAmount: Math.max(0, Number(minBasketAmount || 0)),
        isActive: isActive == null ? true : Boolean(isActive),
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      },
    });
    res.status(201).json(normalizeRule(row));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePromotion = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid promotion id" });
    const existing = await prisma.promotionRule.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Promotion not found" });
    const body = req.body || {};
    const updated = await prisma.promotionRule.update({
      where: { id },
      data: {
        name: body.name != null ? String(body.name).trim() : existing.name,
        isActive: body.isActive != null ? Boolean(body.isActive) : existing.isActive,
        discountValue: body.discountValue != null ? Math.max(0, Number(body.discountValue || 0)) : existing.discountValue,
        bundlePrice: body.bundlePrice != null ? Math.max(0, Number(body.bundlePrice || 0)) : existing.bundlePrice,
        bundleProductIds:
          body.bundleProductIds != null
            ? (Array.isArray(body.bundleProductIds)
                ? body.bundleProductIds.map((x) => Number(x)).filter((x) => !Number.isNaN(x) && x > 0)
                : []
              ).join(",") || null
            : existing.bundleProductIds,
        minBasketAmount:
          body.minBasketAmount != null ? Math.max(0, Number(body.minBasketAmount || 0)) : existing.minBasketAmount,
        startsAt: body.startsAt !== undefined ? (body.startsAt ? new Date(body.startsAt) : null) : existing.startsAt,
        endsAt: body.endsAt !== undefined ? (body.endsAt ? new Date(body.endsAt) : null) : existing.endsAt,
      },
    });
    res.json(normalizeRule(updated));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deletePromotion = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid promotion id" });
    const existing = await prisma.promotionRule.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Promotion not found" });
    await prisma.promotionRule.delete({ where: { id } });
    res.json({ message: "Promotion deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listFestivalTemplates = async (_req, res) => {
  res.json(listFestivalTemplates());
};

exports.deployFestivalKit = async (req, res) => {
  try {
    const branchId = req.branchId;
    const templateId = String(req.params.templateId || "").trim();
    const tpl = getFestivalTemplate(templateId);
    if (!tpl) return res.status(404).json({ error: "Festival template not found" });

    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : null;
    const endsAt = req.body?.endsAt ? new Date(req.body.endsAt) : null;
    const prefix = `[${tpl.id}]`;
    const existing = await prisma.promotionRule.findFirst({
      where: { branchId, name: { startsWith: prefix } },
    });
    if (existing) {
      return res.status(409).json({ error: "This festival kit is already deployed — delete the existing rule first" });
    }

    const created = await prisma.promotionRule.create({
      data: {
        branchId,
        name: `${prefix} ${tpl.name}`,
        type: tpl.type,
        category: tpl.category || null,
        discountValue: Number(tpl.discountValue || 0),
        minBasketAmount: Number(tpl.minBasketAmount || 0),
        buyQty: 1,
        getQty: 1,
        isActive: true,
        startsAt,
        endsAt,
      },
    });
    res.status(201).json(normalizeRule(created));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
