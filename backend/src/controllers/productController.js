const prisma = require("../utils/prisma");

/** Load variants in a separate query so a stale Prisma client cannot fail on `include: { variants }`. */
const VARIANTS_MAX_PER_PRODUCT = 200;

function isMissingColumnError(err, columnName = "") {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "P2022" && (!columnName || msg.includes(String(columnName).toLowerCase()));
}

function isMissingTableError(err, tableName = "") {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "P2021" && (!tableName || msg.includes(String(tableName).toLowerCase()));
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const aStart = aFrom ? new Date(aFrom).getTime() : Number.NEGATIVE_INFINITY;
  const aEnd = aTo ? new Date(aTo).getTime() : Number.POSITIVE_INFINITY;
  const bStart = bFrom ? new Date(bFrom).getTime() : Number.NEGATIVE_INFINITY;
  const bEnd = bTo ? new Date(bTo).getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

function normalizeImageGallery(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((x) => x.slice(0, 500));
}

function normalizeAttributeValues(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k || "").trim().slice(0, 100);
    const value = String(v == null ? "" : v).trim().slice(0, 500);
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function getCategoryMarginPct(branchId, categoryName = "") {
  const rawName = String(categoryName || "").trim();
  if (rawName) {
    try {
      const category = await prisma.productCategory.findFirst({
        where: { branchId, OR: [{ name: rawName }, { name: { equals: rawName } }] },
        select: { minMarginPct: true },
      });
      if (category?.minMarginPct != null && Number.isFinite(Number(category.minMarginPct))) {
        return Number(category.minMarginPct);
      }
    } catch {
      // Fallback to env/default path if category query fails in partial rollout.
    }
  }
  const defaultPct = Number(process.env.PRODUCT_MIN_MARGIN_PCT_DEFAULT || 10);
  const rawMap = String(process.env.PRODUCT_MIN_MARGIN_PCT_BY_CATEGORY || "").trim();
  const key = rawName.toLowerCase();
  if (rawMap && key) {
    try {
      const parsed = JSON.parse(rawMap);
      if (parsed && Number.isFinite(Number(parsed[key]))) return Number(parsed[key]);
    } catch {
      // ignore malformed map and use default
    }
  }
  return defaultPct;
}

async function validateMarginGuardrail({ branchId, unitPrice, sellingPrice, category }) {
  const cost = Number(unitPrice || 0);
  const sell = Number(sellingPrice || 0);
  if (!(sell > 0)) return { ok: false, message: "Selling price must be greater than zero" };
  const marginPct = ((sell - cost) / sell) * 100;
  const minMarginPct = await getCategoryMarginPct(branchId, category);
  if (marginPct < minMarginPct) {
    return {
      ok: false,
      message: `Minimum margin for ${category || "this category"} is ${minMarginPct.toFixed(2)}% (current ${marginPct.toFixed(2)}%).`,
      minMarginPct,
      marginPct,
    };
  }
  return { ok: true, minMarginPct, marginPct };
}

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

async function attachBarcodesToProduct(branchId, product) {
  if (!product || !prisma.productBarcode) return product;
  try {
    const rows = await prisma.productBarcode.findMany({
      where: { branchId, productId: product.id },
      include: { productVariant: true },
      orderBy: [{ id: "desc" }],
      take: 200,
    });
    product.barcodes = rows;
  } catch (err) {
    if (!isMissingTableError(err, "productbarcode")) throw err;
    product.barcodes = [];
  }
  return product;
}

async function attachPriceListsToProduct(branchId, product) {
  if (!product || !prisma.productPriceList) return product;
  try {
    const rows = await prisma.productPriceList.findMany({
      where: { branchId, productId: product.id },
      orderBy: [{ priceType: "asc" }, { effectiveFrom: "desc" }, { id: "desc" }],
      take: 300,
    });
    product.priceLists = rows;
  } catch (err) {
    if (!isMissingTableError(err, "productpricelist")) throw err;
    product.priceLists = [];
  }
  return product;
}

exports.createProduct = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const {
      name,
      unitPrice,
      price,
      stock,
      category,
      sku,
      barcode,
      imageUrl,
      size,
      color,
      brand,
      model,
      specification,
      attributeValues,
      imageGallery,
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
    if (Number(unitPrice || 0) < 0 || Number(price) < 0 || Number(stock || 0) < 0) {
      return res.status(400).json({ error: "Unit price, selling price, and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
    }
    if (Number(reorderLevel || 0) < 0) {
      return res.status(400).json({ error: "Reorder level must be non-negative" });
    }
    const marginCheck = await validateMarginGuardrail({
      branchId,
      unitPrice: Number(unitPrice || 0),
      sellingPrice: Number(price),
      category,
    });
    if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
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

    const createData = {
      branchId,
      name,
      unitPrice: Number(unitPrice || 0),
      price: Number(price),
      stock: hasVa ? 0 : Number(stock || 0),
      category,
      sku: sku || null,
      barcode: barcode ? String(barcode).trim().slice(0, 191) : null,
      imageUrl: imageUrl ? String(imageUrl).trim().slice(0, 500) : null,
      size: size ? String(size).trim().slice(0, 191) : null,
      color: color ? String(color).trim().slice(0, 191) : null,
      brand: brand ? String(brand).trim().slice(0, 191) : null,
      model: model ? String(model).trim().slice(0, 191) : null,
      specification: specification ? String(specification).trim().slice(0, 4000) : null,
      attributeValues: normalizeAttributeValues(attributeValues),
      imageGallery: normalizeImageGallery(imageGallery),
      vatRate: Number(vatRate || 0),
      reorderLevel: Number(reorderLevel || 0),
      defaultDiscountType: normalizedDiscountType,
      defaultDiscountValue: Number(defaultDiscountValue || 0),
      batchTracked: Boolean(batchTracked),
      sellByWeight: sellByWt,
      stockKg: sellByWt ? kgStock : 0,
      hasVariants: hasVa,
    };
    let product;
    try {
      product = await prisma.product.create({ data: createData });
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      const fallbackData = { ...createData };
      delete fallbackData.size;
      delete fallbackData.color;
      delete fallbackData.brand;
      delete fallbackData.model;
      delete fallbackData.specification;
      delete fallbackData.attributeValues;
      delete fallbackData.imageGallery;
      delete fallbackData.barcode;
      delete fallbackData.imageUrl;
      product = await prisma.product.create({ data: fallbackData });
    }

    res.status(201).json(product);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "SKU or barcode already exists in this branch" });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const includeVariants = String(req.query.include || "").includes("variants");
    const includePriceLists = String(req.query.include || "").toLowerCase().includes("pricelists");
    const products = await prisma.product.findMany({
      where: { branchId },
      orderBy: {
        createdAt: "desc",
      },
    });
    if (includeVariants) {
      await attachVariantsToProducts(branchId, products);
    }
    if (includePriceLists) {
      await Promise.all(products.map((p) => attachPriceListsToProduct(branchId, p)));
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
      await attachPriceListsToProduct(branchId, product);
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
    if (prisma.productBarcode) {
      try {
        const aliasHit = await prisma.productBarcode.findFirst({
          where: { branchId, barcode: code },
          include: { product: true, productVariant: true },
        });
        if (aliasHit?.product?.branchId === branchId) {
          const product = aliasHit.product;
          await attachPriceListsToProduct(branchId, product);
          return res.json({
            ...product,
            matchedBarcodeAlias: {
              id: aliasHit.id,
              barcode: aliasHit.barcode,
              note: aliasHit.note || "",
            },
            ...(aliasHit.productVariant
              ? {
                  matchedVariant: {
                    id: aliasHit.productVariant.id,
                    label: aliasHit.productVariant.label,
                    barcode: aliasHit.productVariant.barcode,
                    sku: aliasHit.productVariant.sku,
                    stock: aliasHit.productVariant.stock,
                    priceOverride: aliasHit.productVariant.priceOverride,
                    imageUrl: aliasHit.productVariant.imageUrl || null,
                  },
                }
              : {}),
          });
        }
      } catch (e) {
        if (!isMissingTableError(e, "productbarcode")) throw e;
      }
    }

    let product = null;
    try {
      product = await prisma.product.findFirst({
        where: {
          branchId,
          OR: [{ sku: code }, { barcode: code }, { name: { contains: code } }],
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    } catch (e) {
      if (!isMissingColumnError(e, "barcode")) throw e;
      product = await prisma.product.findFirst({
        where: {
          branchId,
          OR: [{ sku: code }, { name: { contains: code } }],
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await attachVariantsToProduct(branchId, product);
    await attachBarcodesToProduct(branchId, product);
    await attachPriceListsToProduct(branchId, product);
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
    await attachBarcodesToProduct(branchId, product);
    await attachPriceListsToProduct(branchId, product);
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
      unitPrice,
      price,
      stock,
      category,
      sku,
      barcode,
      imageUrl,
      size,
      color,
      brand,
      model,
      specification,
      attributeValues,
      imageGallery,
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
    if (Number(unitPrice ?? existing.unitPrice ?? 0) < 0 || Number(price) < 0 || Number(stock) < 0) {
      return res.status(400).json({ error: "Unit price, selling price, and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
    }
    if (Number(reorderLevel || 0) < 0) {
      return res.status(400).json({ error: "Reorder level must be non-negative" });
    }
    const marginCheck = await validateMarginGuardrail({
      branchId,
      unitPrice: Number(unitPrice ?? existing.unitPrice ?? 0),
      sellingPrice: Number(price),
      category: category != null ? category : existing.category,
    });
    if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
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

    const updateData = {
      name: String(name).trim(),
      unitPrice: Number(unitPrice ?? existing.unitPrice ?? 0),
      price: Number(price),
      stock: hasVa ? 0 : Number(stock),
      category: category || null,
      sku: sku || null,
      barcode: barcode ? String(barcode).trim().slice(0, 191) : null,
      imageUrl: imageUrl ? String(imageUrl).trim().slice(0, 500) : null,
      size: size ? String(size).trim().slice(0, 191) : null,
      color: color ? String(color).trim().slice(0, 191) : null,
      brand: brand ? String(brand).trim().slice(0, 191) : null,
      model: model ? String(model).trim().slice(0, 191) : null,
      specification: specification ? String(specification).trim().slice(0, 4000) : null,
      attributeValues: normalizeAttributeValues(attributeValues),
      imageGallery: normalizeImageGallery(imageGallery),
      vatRate: Number(vatRate || 0),
      reorderLevel: Number(reorderLevel || 0),
      defaultDiscountType: normalizedDiscountType,
      defaultDiscountValue: Number(defaultDiscountValue || 0),
      batchTracked: nextBatch,
      sellByWeight: sellByWt,
      stockKg: sellByWt ? Math.max(0, kgStock) : 0,
      hasVariants: hasVa,
    };
    let product;
    try {
      product = await prisma.product.update({
        where: { id },
        data: updateData,
      });
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      const fallbackData = { ...updateData };
      delete fallbackData.size;
      delete fallbackData.color;
      delete fallbackData.brand;
      delete fallbackData.model;
      delete fallbackData.specification;
      delete fallbackData.attributeValues;
      delete fallbackData.imageGallery;
      delete fallbackData.barcode;
      delete fallbackData.imageUrl;
      product = await prisma.product.update({
        where: { id },
        data: fallbackData,
      });
    }

    res.json(product);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "SKU or barcode already exists in this branch" });
    }
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
    const { label, sku, barcode, stock, sortOrder, priceOverride, imageUrl } = req.body || {};
    const labelStr = String(label || "").trim();
    if (!labelStr) return res.status(400).json({ error: "Variant label required (e.g. M · Navy)" });
    const barcodeNormalized =
      barcode != null && String(barcode).trim() ? String(barcode).trim().slice(0, 48) : null;
    const parent = await prisma.product.findFirst({ where: { id: productId, branchId } });
    if (!parent) return res.status(404).json({ error: "Product not found" });
    if (priceOverride != null && String(priceOverride).trim() !== "") {
      const marginCheck = await validateMarginGuardrail({
        branchId,
        unitPrice: Number(parent.unitPrice || 0),
        sellingPrice: Number(priceOverride),
        category: parent.category,
      });
      if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
    }
    try {
      const row = await prisma.$transaction(async (tx) => {
        const createData = {
          branchId,
          productId,
          label: labelStr.slice(0, 191),
          sku: sku ? String(sku).trim().slice(0, 191) : null,
          barcode: barcodeNormalized,
          stock: Math.max(0, Math.floor(Number(stock ?? 0))),
          sortOrder: Math.max(0, Math.floor(Number(sortOrder ?? 0))),
          priceOverride:
            priceOverride != null && String(priceOverride).trim() !== "" ? Number(priceOverride) : null,
          imageUrl: imageUrl ? String(imageUrl).trim().slice(0, 500) : null,
        };
        let created;
        try {
          created = await tx.productVariant.create({ data: createData });
        } catch (e) {
          if (!isMissingColumnError(e, "imageurl")) throw e;
          const fallbackData = { ...createData };
          delete fallbackData.imageUrl;
          created = await tx.productVariant.create({ data: fallbackData });
        }
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
    const { label, sku, barcode, stock, sortOrder, priceOverride, imageUrl } = req.body || {};
    const barcodeNormalized =
      barcode !== undefined
        ? barcode != null && String(barcode).trim()
          ? String(barcode).trim().slice(0, 48)
          : null
        : undefined;
    const parent = await prisma.product.findFirst({ where: { id: productId, branchId } });
    if (!parent) return res.status(404).json({ error: "Product not found" });
    if (priceOverride != null && String(priceOverride).trim() !== "") {
      const marginCheck = await validateMarginGuardrail({
        branchId,
        unitPrice: Number(parent.unitPrice || 0),
        sellingPrice: Number(priceOverride),
        category: parent.category,
      });
      if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
    }
    try {
      const updateData = {
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
        ...(imageUrl !== undefined
          ? { imageUrl: imageUrl ? String(imageUrl).trim().slice(0, 500) : null }
          : {}),
      };
      let row;
      try {
        row = await prisma.productVariant.update({
          where: { id: variantId },
          data: updateData,
        });
      } catch (e) {
        if (!isMissingColumnError(e, "imageurl")) throw e;
        const fallbackData = { ...updateData };
        delete fallbackData.imageUrl;
        row = await prisma.productVariant.update({
          where: { id: variantId },
          data: fallbackData,
        });
      }
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

exports.listProductBarcodes = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productBarcode) return res.json([]);
    let rows;
    try {
      rows = await prisma.productBarcode.findMany({
        where: { productId, branchId },
        include: { productVariant: true },
        orderBy: [{ id: "desc" }],
        take: 200,
      });
    } catch (e) {
      if (!isMissingColumnError(e, "productvariantid")) throw e;
      rows = await prisma.productBarcode.findMany({
        where: { productId, branchId },
        orderBy: [{ id: "desc" }],
        take: 200,
      });
    }
    res.json(rows);
  } catch (err) {
    if (isMissingTableError(err, "productbarcode")) return res.json([]);
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.createProductBarcode = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productBarcode) {
      return res.status(503).json({ error: "Product barcode aliases are unavailable until migration is applied" });
    }
    const barcode = String(req.body?.barcode || "").trim().slice(0, 191);
    const note = String(req.body?.note || "").trim().slice(0, 191);
    const variantIdRaw = req.body?.variantId;
    const variantId =
      variantIdRaw != null && String(variantIdRaw).trim() !== "" ? Number(variantIdRaw) : null;
    if (!barcode) return res.status(400).json({ error: "Barcode is required" });
    if (variantId != null) {
      if (!Number.isFinite(variantId)) return res.status(400).json({ error: "Invalid variantId" });
      const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, branchId, productId },
      });
      if (!variant) return res.status(404).json({ error: "Variant not found for this product" });
    }
    let row;
    try {
      row = await prisma.productBarcode.create({
        data: { branchId, productId, productVariantId: variantId, barcode, note: note || null },
      });
    } catch (e) {
      if (!isMissingColumnError(e, "productvariantid")) throw e;
      row = await prisma.productBarcode.create({
        data: { branchId, productId, barcode, note: note || null },
      });
    }
    res.status(201).json(row);
  } catch (err) {
    if (isMissingTableError(err, "productbarcode")) {
      return res.status(503).json({ error: "Product barcode aliases are unavailable until migration is applied" });
    }
    if (err.code === "P2002") return res.status(409).json({ error: "Barcode already exists in this branch" });
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProductBarcode = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    const barcodeId = Number(req.params.barcodeId);
    if (Number.isNaN(productId) || Number.isNaN(barcodeId)) return res.status(400).json({ error: "Invalid ids" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productBarcode) {
      return res.status(503).json({ error: "Product barcode aliases are unavailable until migration is applied" });
    }
    const existing = await prisma.productBarcode.findFirst({
      where: { id: barcodeId, productId, branchId },
    });
    if (!existing) return res.status(404).json({ error: "Barcode alias not found" });
    await prisma.productBarcode.delete({ where: { id: barcodeId } });
    res.json({ ok: true });
  } catch (err) {
    if (isMissingTableError(err, "productbarcode")) {
      return res.status(503).json({ error: "Product barcode aliases are unavailable until migration is applied" });
    }
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.listProductPriceLists = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productPriceList) return res.json([]);
    const rows = await prisma.productPriceList.findMany({
      where: { branchId, productId },
      orderBy: [{ priceType: "asc" }, { effectiveFrom: "desc" }, { id: "desc" }],
      take: 300,
    });
    res.json(rows);
  } catch (err) {
    if (isMissingTableError(err, "productpricelist")) return res.json([]);
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.createProductPriceList = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productPriceList) {
      return res.status(503).json({ error: "Product price lists are unavailable until migration is applied" });
    }
    const priceTypeRaw = String(req.body?.priceType || "").trim().toUpperCase();
    const amount = Number(req.body?.amount || 0);
    const effectiveFrom = req.body?.effectiveFrom ? new Date(req.body.effectiveFrom) : null;
    const effectiveTo = req.body?.effectiveTo ? new Date(req.body.effectiveTo) : null;
    const note = String(req.body?.note || "").trim().slice(0, 191);
    if (!["RETAIL", "WHOLESALE", "DEALER"].includes(priceTypeRaw)) {
      return res.status(400).json({ error: "priceType must be RETAIL, WHOLESALE, or DEALER" });
    }
    if (!(amount >= 0)) return res.status(400).json({ error: "amount must be non-negative" });
    const product = await prisma.product.findFirst({
      where: { id: productId, branchId },
      select: { id: true, unitPrice: true, category: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    const marginCheck = await validateMarginGuardrail({
      branchId,
      unitPrice: Number(product.unitPrice || 0),
      sellingPrice: amount,
      category: product.category,
    });
    if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
    if (!effectiveFrom || Number.isNaN(effectiveFrom.getTime())) {
      return res.status(400).json({ error: "effectiveFrom is required and must be a valid date" });
    }
    if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
      return res.status(400).json({ error: "effectiveTo must be a valid date" });
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return res.status(400).json({ error: "effectiveTo cannot be earlier than effectiveFrom" });
    }
    const existingRows = await prisma.productPriceList.findMany({
      where: {
        branchId,
        productId,
        priceType: priceTypeRaw,
      },
      orderBy: [{ effectiveFrom: "desc" }],
      take: 500,
    });
    const overlap = existingRows.find((row) =>
      rangesOverlap(effectiveFrom, effectiveTo || null, row.effectiveFrom, row.effectiveTo || null)
    );
    if (overlap) {
      return res.status(409).json({
        error: `Overlapping ${priceTypeRaw} price window exists (${String(overlap.effectiveFrom).slice(0, 10)} to ${
          overlap.effectiveTo ? String(overlap.effectiveTo).slice(0, 10) : "open"
        }).`,
      });
    }
    const row = await prisma.productPriceList.create({
      data: {
        branchId,
        productId,
        priceType: priceTypeRaw,
        amount,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        note: note || null,
      },
    });
    res.status(201).json(row);
  } catch (err) {
    if (isMissingTableError(err, "productpricelist")) {
      return res.status(503).json({ error: "Product price lists are unavailable until migration is applied" });
    }
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProductPriceList = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const productId = Number(req.params.id);
    const priceListId = Number(req.params.priceListId);
    if (Number.isNaN(productId) || Number.isNaN(priceListId)) return res.status(400).json({ error: "Invalid ids" });
    await ensureProductParent(branchId, productId);
    if (!prisma.productPriceList) {
      return res.status(503).json({ error: "Product price lists are unavailable until migration is applied" });
    }
    const existing = await prisma.productPriceList.findFirst({
      where: { id: priceListId, branchId, productId },
    });
    if (!existing) return res.status(404).json({ error: "Price list row not found" });
    await prisma.productPriceList.delete({ where: { id: priceListId } });
    res.json({ ok: true });
  } catch (err) {
    if (isMissingTableError(err, "productpricelist")) {
      return res.status(503).json({ error: "Product price lists are unavailable until migration is applied" });
    }
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};