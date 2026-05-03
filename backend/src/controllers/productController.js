const prisma = require("../utils/prisma");

/** Load variants in a separate query so a stale Prisma client cannot fail on `include: { variants }`. */
const VARIANTS_MAX_PER_PRODUCT = 200;

async function loadVariantsByProductId(branchId, productIds) {
  const delegate = prisma.productVariant;
  const map = new Map();
  if (!delegate || typeof delegate.findMany !== "function" || !productIds?.length) {
    return map;
  }
  const rows = await delegate.findMany({
    where: { branchId, productId: { in: productIds } },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  for (const v of rows) {
    let arr = map.get(v.productId);
    if (!arr) {
      arr = [];
      map.set(v.productId, arr);
    }
    if (arr.length < VARIANTS_MAX_PER_PRODUCT) arr.push(v);
  }
  return map;
}

async function attachVariantsToProducts(branchId, products) {
  if (!products?.length) return products;
  const ids = products.map((p) => p.id);
  const byPid = await loadVariantsByProductId(branchId, ids);
  for (const p of products) {
    p.variants = byPid.get(p.id) || [];
  }
  return products;
}

async function attachVariantsToProduct(branchId, product) {
  if (!product) return product;
  const byPid = await loadVariantsByProductId(branchId, [product.id]);
  product.variants = byPid.get(product.id) || [];
  return product;
}

exports.createProduct = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const {
      name,
      price,
      stock,
      category,
      sku,
      vatRate,
      defaultDiscountType,
      defaultDiscountValue,
      reorderLevel,
      batchTracked,
      sellByWeight,
      stockKg,
      hasVariants,
    } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Product name must be at least 2 characters" });
    }
    if (Number(price) < 0 || Number(stock || 0) < 0) {
      return res.status(400).json({ error: "Price and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
    }
    if (Number(reorderLevel || 0) < 0) {
      return res.status(400).json({ error: "Reorder level must be non-negative" });
    }
    const sellByWt = Boolean(sellByWeight);
    const kgStock = Math.max(0, Number(stockKg || 0));
    const hasVa = Boolean(hasVariants);
    if (sellByWt && hasVa) {
      return res.status(400).json({ error: "Sell-by-weight and size/color variants cannot both be enabled" });
    }
    if ((sellByWt || hasVa) && Boolean(batchTracked)) {
      return res.status(400).json({
        error: "Batch/expiry tracking is not supported yet for weighed or variant items — disable batch tracking first",
      });
    }
    const normalizedDiscountType = defaultDiscountType || null;
    if (normalizedDiscountType && !["PERCENT", "AMOUNT"].includes(normalizedDiscountType)) {
      return res.status(400).json({ error: "Default discount type must be PERCENT or AMOUNT" });
    }
    if (Number(defaultDiscountValue || 0) < 0) {
      return res.status(400).json({ error: "Default discount value must be non-negative" });
    }
    if (normalizedDiscountType === "PERCENT" && Number(defaultDiscountValue || 0) > 100) {
      return res.status(400).json({ error: "Default percent discount cannot exceed 100" });
    }

    const product = await prisma.product.create({
      data: {
        branchId,
        name,
        price: Number(price),
        stock: hasVa ? 0 : Number(stock || 0),
        category,
        sku: sku || null,
        vatRate: Number(vatRate || 0),
        reorderLevel: Number(reorderLevel || 0),
        defaultDiscountType: normalizedDiscountType,
        defaultDiscountValue: Number(defaultDiscountValue || 0),
        batchTracked: Boolean(batchTracked),
        sellByWeight: sellByWt,
        stockKg: sellByWt ? kgStock : 0,
        hasVariants: hasVa,
      }
    });

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const includeVariants = String(req.query.include || "").includes("variants");
    const products = await prisma.product.findMany({
      where: { branchId },
      orderBy: {
        createdAt: "desc",
      },
    });
    if (includeVariants) {
      await attachVariantsToProducts(branchId, products);
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.findProductByCode = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "Barcode/SKU code is required" });
    }

    const variantHit = await prisma.productVariant.findFirst({
      where: { branchId, barcode: code },
      include: { product: true },
    });
    if (variantHit?.product?.branchId === branchId) {
      const product = variantHit.product;
      return res.json({
        ...product,
        matchedVariant: {
          id: variantHit.id,
          label: variantHit.label,
          barcode: variantHit.barcode,
          sku: variantHit.sku,
          stock: variantHit.stock,
          priceOverride: variantHit.priceOverride,
        },
      });
    }

    const product = await prisma.product.findFirst({
      where: {
        branchId,
        OR: [{ sku: code }, { name: { contains: code } }],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await attachVariantsToProduct(branchId, product);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProductDetails = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const product = await prisma.product.findFirst({
      where: { id, branchId },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await attachVariantsToProduct(branchId, product);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const existing = await prisma.product.findFirst({ where: { id, branchId } });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    const {
      name,
      price,
      stock,
      category,
      sku,
      vatRate,
      defaultDiscountType,
      defaultDiscountValue,
      reorderLevel,
      batchTracked,
      sellByWeight,
      stockKg,
      hasVariants,
    } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Product name must be at least 2 characters" });
    }
    if (Number(price) < 0 || Number(stock) < 0) {
      return res.status(400).json({ error: "Price and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
    }
    if (Number(reorderLevel || 0) < 0) {
      return res.status(400).json({ error: "Reorder level must be non-negative" });
    }
    const normalizedDiscountType = defaultDiscountType || null;
    if (normalizedDiscountType && !["PERCENT", "AMOUNT"].includes(normalizedDiscountType)) {
      return res.status(400).json({ error: "Default discount type must be PERCENT or AMOUNT" });
    }
    if (Number(defaultDiscountValue || 0) < 0) {
      return res.status(400).json({ error: "Default discount value must be non-negative" });
    }
    if (normalizedDiscountType === "PERCENT" && Number(defaultDiscountValue || 0) > 100) {
      return res.status(400).json({ error: "Default percent discount cannot exceed 100" });
    }
    const sellByWt =
      typeof sellByWeight === "boolean" ? sellByWeight : Boolean(existing.sellByWeight);
    const kgStock = Number(stockKg != null ? stockKg : existing.stockKg ?? 0);
    const hasVa = typeof hasVariants === "boolean" ? hasVariants : Boolean(existing.hasVariants);
    const nextBatch =
      typeof batchTracked === "boolean" ? batchTracked : Boolean(existing.batchTracked);
    if (sellByWt && hasVa) {
      return res.status(400).json({ error: "Sell-by-weight and size/color variants cannot both be enabled" });
    }
    if ((sellByWt || hasVa) && nextBatch) {
      return res.status(400).json({
        error: "Batch/expiry tracking is not supported yet for weighed or variant items — disable batch tracking first",
      });
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: String(name).trim(),
        price: Number(price),
        stock: hasVa ? 0 : Number(stock),
        category: category || null,
        sku: sku || null,
        vatRate: Number(vatRate || 0),
        reorderLevel: Number(reorderLevel || 0),
        defaultDiscountType: normalizedDiscountType,
        defaultDiscountValue: Number(defaultDiscountValue || 0),
        batchTracked: nextBatch,
        sellByWeight: sellByWt,
        stockKg: sellByWt ? Math.max(0, kgStock) : 0,
        hasVariants: hasVa,
      },
    });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const existing = await prisma.product.findFirst({ where: { id, branchId } });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    await prisma.product.delete({ where: { id } });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function ensureProductParent(branchId, productId) {
  const parent = await prisma.product.findFirst({ where: { id: productId, branchId } });
  if (!parent) {
    const err = new Error("Product not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (parent.sellByWeight) {
    const err = new Error("Variants are not supported on sell-by-weight products");
    err.code = "BAD_REQUEST";
    throw err;
  }
  return parent;
}

exports.listProductVariants = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    const rows = await prisma.productVariant.findMany({
      where: { productId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    res.json(rows);
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.createProductVariant = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    const { label, sku, barcode, stock, sortOrder, priceOverride } = req.body || {};
    const labelStr = String(label || "").trim();
    if (!labelStr) return res.status(400).json({ error: "Variant label required (e.g. M · Navy)" });
    const barcodeNormalized =
      barcode != null && String(barcode).trim() ? String(barcode).trim().slice(0, 48) : null;
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({
          data: {
            branchId,
            productId,
            label: labelStr.slice(0, 191),
            sku: sku ? String(sku).trim().slice(0, 191) : null,
            barcode: barcodeNormalized,
            stock: Math.max(0, Math.floor(Number(stock ?? 0))),
            sortOrder: Math.max(0, Math.floor(Number(sortOrder ?? 0))),
            priceOverride:
              priceOverride != null && String(priceOverride).trim() !== "" ? Number(priceOverride) : null,
          },
        });
        await tx.product.update({
          where: { id: productId },
          data: {
            hasVariants: true,
            stock: 0,
            batchTracked: false,
            sellByWeight: false,
            stockKg: 0,
          },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (e) {
      if (e.code === "P2002") return res.status(409).json({ error: "Barcode already used in this branch" });
      throw e;
    }
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.updateProductVariant = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    const variantId = Number(req.params.variantId);
    if (Number.isNaN(productId) || Number.isNaN(variantId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }
    await ensureProductParent(branchId, productId);
    const existing = await prisma.productVariant.findFirst({ where: { id: variantId, productId, branchId } });
    if (!existing) return res.status(404).json({ error: "Variant not found" });
    const { label, sku, barcode, stock, sortOrder, priceOverride } = req.body || {};
    const barcodeNormalized =
      barcode !== undefined
        ? barcode != null && String(barcode).trim()
          ? String(barcode).trim().slice(0, 48)
          : null
        : undefined;
    try {
      const row = await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(label !== undefined ? { label: String(label || "").slice(0, 191) } : {}),
          ...(sku !== undefined ? { sku: sku ? String(sku).trim().slice(0, 191) : null } : {}),
          ...(barcode !== undefined ? { barcode: barcodeNormalized } : {}),
          ...(stock !== undefined ? { stock: Math.max(0, Math.floor(Number(stock ?? 0))) } : {}),
          ...(sortOrder !== undefined ? { sortOrder: Math.max(0, Math.floor(Number(sortOrder ?? 0))) } : {}),
          ...(priceOverride !== undefined
            ? {
                priceOverride:
                  priceOverride != null && String(priceOverride).trim() !== ""
                    ? Number(priceOverride)
                    : null,
              }
            : {}),
        },
      });
      res.json(row);
    } catch (e) {
      if (e.code === "P2002") return res.status(409).json({ error: "Barcode already used in this branch" });
      throw e;
    }
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProductVariant = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    const variantId = Number(req.params.variantId);
    if (Number.isNaN(productId) || Number.isNaN(variantId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }
    await ensureProductParent(branchId, productId);
    const existing = await prisma.productVariant.findFirst({ where: { id: variantId, productId, branchId } });
    if (!existing) return res.status(404).json({ error: "Variant not found" });
    await prisma.productVariant.delete({ where: { id: variantId } });
    const remaining = await prisma.productVariant.count({ where: { productId } });
    if (remaining === 0) {
      await prisma.product.update({ where: { id: productId }, data: { hasVariants: false } });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};