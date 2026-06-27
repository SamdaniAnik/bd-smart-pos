const prisma = require("../utils/prisma");
const { resolveCategoryDepartment } = require("../constants/retailDepartments");
const saleUnits = require("../constants/saleUnits");
const { parseScaleBarcode, pluLookupCandidates } = require("../utils/pluBarcodeUtil");
const { parseListQuery, pagedResult } = require("../utils/listQuery");

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

const PRODUCT_CONDITIONS = ["NEW", "REFURBISHED", "USED"];
function normalizeProductCondition(input) {
  const v = String(input || "").trim().toUpperCase();
  return PRODUCT_CONDITIONS.includes(v) ? v : null;
}

function normalizeTags(input) {
  const rows = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
  return rows.slice(0, 30).map((x) => String(x).slice(0, 64));
}

function optStr(value, max = 191) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function optText(value, max = 8000) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function optNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function optInt(value) {
  const n = optNum(value);
  if (n == null) return null;
  return Math.max(0, Math.floor(n));
}

async function resolveCategoryLink(branchId, body) {
  const categoryIdRaw = body.categoryId;
  if (categoryIdRaw != null && String(categoryIdRaw).trim() !== "") {
    const id = Number(categoryIdRaw);
    if (!Number.isNaN(id) && id > 0) {
      const cat = await prisma.productCategory.findFirst({ where: { id, branchId } });
      if (cat) return { categoryId: cat.id, category: cat.name };
    }
  }
  const name = body.category != null ? String(body.category || "").trim() : "";
  if (!name) return { categoryId: null, category: null };
  const cat = await prisma.productCategory.findFirst({
    where: { branchId, name: { equals: name } },
  });
  return { categoryId: cat?.id ?? null, category: name };
}

async function resolveSaleUnitFields(branchId, body, categoryLink) {
  let categoryRow = null;
  if (categoryLink?.categoryId) {
    categoryRow = await prisma.productCategory.findFirst({
      where: { id: categoryLink.categoryId, branchId },
    });
  }
  const dept = resolveCategoryDepartment(categoryLink?.category || body.category, categoryRow);
  const requested = saleUnits.normalizeSaleUnit(body.saleUnit || body.unitOfMeasure || "");
  const defaultUnit = saleUnits.getDefaultSaleUnitForDepartment(dept);
  const finalUnit =
    requested && saleUnits.validateSaleUnitForDepartment(requested, dept) ? requested : defaultUnit;
  const sellByWt = saleUnits.syncSellByWeightFromSaleUnit(finalUnit, body.sellByWeight);
  let allowed = Array.isArray(body.allowedSaleUnits) ? body.allowedSaleUnits : null;
  if (allowed?.length) {
    allowed = [
      ...new Set(
        allowed
          .map((x) => saleUnits.normalizeSaleUnit(x))
          .filter((x) => saleUnits.validateSaleUnitForDepartment(x, dept))
      ),
    ];
  }
  if (!allowed?.length) {
    allowed = saleUnits.getAllowedSaleUnitsForDepartment(dept);
  }
  if (!allowed.includes(finalUnit)) {
    allowed = [finalUnit, ...allowed];
  }
  return {
    saleUnit: finalUnit,
    unitOfMeasure: finalUnit,
    sellByWeight: sellByWt,
    allowedSaleUnits: allowed,
  };
}

function buildProductData(body, { sellByWt, hasVa, normalizedDiscountType, saleUnitFields }) {
  const unitFields = saleUnitFields || {};
  const resolvedSellByWt =
    unitFields.sellByWeight !== undefined ? unitFields.sellByWeight : sellByWt;
  return {
    name: String(body.name || "").trim(),
    nameBn: optStr(body.nameBn, 191),
    description: optText(body.description, 12000),
    shortDescription: optStr(body.shortDescription, 500),
    manufacturer: optStr(body.manufacturer, 191),
    countryOfOrigin: optStr(body.countryOfOrigin, 64),
    genericName: optStr(body.genericName, 191),
    strength: optStr(body.strength, 64),
    dosageForm: optStr(body.dosageForm, 64),
    drugRegNo: optStr(body.drugRegNo, 64),
    mrp: Math.max(0, Number(body.mrp || 0)),
    tags: normalizeTags(body.tags),
    isActive: body.isActive !== false,
    internalNotes: optText(body.internalNotes, 8000),
    weightGrams: optNum(body.weightGrams),
    shelfLifeDays: optInt(body.shelfLifeDays),
    storageCondition: optStr(body.storageCondition, 64),
    unitPrice: Number(body.unitPrice || 0),
    price: Number(body.price),
    stock: hasVa ? 0 : Number(body.stock || 0),
    sku: body.sku || null,
    barcode: body.barcode ? String(body.barcode).trim().slice(0, 191) : null,
    imageUrl: body.imageUrl ? String(body.imageUrl).trim().slice(0, 500) : null,
    size: optStr(body.size, 191),
    color: optStr(body.color, 191),
    brand: optStr(body.brand, 191),
    model: optStr(body.model, 191),
    specification: optText(body.specification, 4000),
    attributeValues: normalizeAttributeValues(body.attributeValues),
    imageGallery: normalizeImageGallery(body.imageGallery),
    hsCode: optStr(body.hsCode, 32),
    unitOfMeasure: unitFields.unitOfMeasure || optStr(body.unitOfMeasure, 16) || "PCS",
    saleUnit: unitFields.saleUnit || optStr(body.saleUnit, 16) || null,
    allowedSaleUnits: unitFields.allowedSaleUnits || null,
    vatRate: Number(body.vatRate || 0),
    reorderLevel: Number(body.reorderLevel || 0),
    defaultDiscountType: normalizedDiscountType,
    defaultDiscountValue: Number(body.defaultDiscountValue || 0),
    batchTracked: Boolean(body.batchTracked),
    trackExpiry: Boolean(body.trackExpiry),
    trackSerial: Boolean(body.trackSerial),
    trackImei: Boolean(body.trackImei),
    requiresKyc: Boolean(body.requiresKyc),
    warrantyDays:
      body.warrantyDays != null && body.warrantyDays !== ""
        ? Math.max(0, Math.min(3650, Number(body.warrantyDays)))
        : null,
    sellByWeight: resolvedSellByWt,
    stockKg: resolvedSellByWt ? Math.max(0, Number(body.stockKg || 0)) : 0,
    hasVariants: hasVa,
    isRawMaterial: Boolean(body.isRawMaterial),
    isManufactured: Boolean(body.isManufactured),
    sdRate: Math.min(100, Math.max(0, Number(body.sdRate || 0))),
    nbrProductCode: optStr(body.nbrProductCode, 32),
    bstiCertNo: optStr(body.bstiCertNo, 64),
    isHalalCertified: Boolean(body.isHalalCertified),
    halalCertNo: optStr(body.halalCertNo, 64),
    importerName: optStr(body.importerName, 191),
    importerAddress: optText(body.importerAddress, 1000),
    productCondition: normalizeProductCondition(body.productCondition),
    purchaseUnit: optStr(body.purchaseUnit, 16),
    unitsPerPack: optInt(body.unitsPerPack),
    packsPerCarton: optInt(body.packsPerCarton),
    netWeightGrams: optNum(body.netWeightGrams),
    grossWeightGrams: optNum(body.grossWeightGrams),
    lengthCm: optNum(body.lengthCm),
    widthCm: optNum(body.widthCm),
    heightCm: optNum(body.heightCm),
    minOrderQty: optInt(body.minOrderQty),
    maxOrderQty: optInt(body.maxOrderQty),
    leadTimeDays: optInt(body.leadTimeDays),
  };
}

const LEGACY_PRODUCT_FIELD_STRIPS = [
  "nameBn",
  "description",
  "shortDescription",
  "manufacturer",
  "countryOfOrigin",
  "genericName",
  "strength",
  "dosageForm",
  "drugRegNo",
  "mrp",
  "tags",
  "isActive",
  "internalNotes",
  "weightGrams",
  "shelfLifeDays",
  "storageCondition",
  "hsCode",
  "unitOfMeasure",
  "saleUnit",
  "allowedSaleUnits",
  "size",
  "color",
  "brand",
  "model",
  "specification",
  "attributeValues",
  "imageGallery",
  "barcode",
  "imageUrl",
  "categoryId",
  "sdRate",
  "nbrProductCode",
  "bstiCertNo",
  "isHalalCertified",
  "halalCertNo",
  "importerName",
  "importerAddress",
  "productCondition",
  "purchaseUnit",
  "unitsPerPack",
  "packsPerCarton",
  "netWeightGrams",
  "grossWeightGrams",
  "lengthCm",
  "widthCm",
  "heightCm",
  "minOrderQty",
  "maxOrderQty",
  "leadTimeDays",
  "trackImei",
];

function stripLegacyProductFields(data) {
  const out = { ...data };
  for (const key of LEGACY_PRODUCT_FIELD_STRIPS) delete out[key];
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
    const body = req.body || {};
    const {
      name,
      unitPrice,
      price,
      stock,
      vatRate,
      defaultDiscountType,
      defaultDiscountValue,
      reorderLevel,
      batchTracked,
      sellByWeight,
      stockKg,
      hasVariants,
    } = body;
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
      category: body.category,
    });
    if (!marginCheck.ok) return res.status(400).json({ error: marginCheck.message });
    const categoryLink = await resolveCategoryLink(branchId, body);
    const saleUnitFields = await resolveSaleUnitFields(branchId, body, categoryLink);
    const sellByWt = saleUnitFields.sellByWeight;
    const kgStock = Math.max(0, Number(stockKg || 0));
    const hasVa = Boolean(hasVariants);
    if (sellByWt && hasVa) {
      return res.status(400).json({ error: "Sell-by-weight and size/color variants cannot both be enabled" });
    }
    if (sellByWt && (Boolean(batchTracked) || Boolean(body.trackExpiry))) {
      return res.status(400).json({
        error: "Batch/expiry tracking cannot be used with sell-by-weight products",
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
      ...buildProductData(
        { ...body, stock, vatRate: body.vatRate, attributeValues: body.attributeValues, imageGallery: body.imageGallery },
        { sellByWt, hasVa, normalizedDiscountType, saleUnitFields }
      ),
      ...categoryLink,
    };
    let product;
    try {
      product = await prisma.product.create({ data: createData });
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      product = await prisma.product.create({ data: stripLegacyProductFields(createData) });
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

    const lq = parseListQuery(req, {
      searchableFields: [
        "name", "nameBn", "sku", "barcode", "category", "brand", "manufacturer",
        "genericName", "model", "size", "color", "specification", "drugRegNo",
        "strength", "dosageForm", "hsCode", "countryOfOrigin",
        "nbrProductCode", "bstiCertNo", "importerName",
      ],
      filterableFields: ["category", "brand", "isActive", "batchTracked"],
      sortableFields: [
        "name", "sku", "category", "price", "unitPrice", "mrp", "stock",
        "reorderLevel", "vatRate", "createdAt",
      ],
      defaultSort: "createdAt",
      defaultSortDir: "desc",
      defaultPageSize: 10,
    });

    const where = { branchId };
    if (String(req.query.activeOnly || "").toLowerCase() === "true") {
      where.isActive = true;
    }
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    // Backward compatible: only paginate + wrap when the client opts in.
    if (lq.paged) {
      const [products, total] = await prisma.$transaction([
        prisma.product.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.product.count({ where }),
      ]);
      if (includeVariants) await attachVariantsToProducts(branchId, products);
      if (includePriceLists) {
        await Promise.all(products.map((p) => attachPriceListsToProduct(branchId, p)));
      }
      return res.json(pagedResult({ data: products, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: lq.orderBy || { createdAt: "desc" },
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

async function resolveProductByScanCode(branchId, code) {
  const scanCode = String(code || "").trim();
  if (!scanCode) return null;

  const variantHit = await prisma.productVariant.findFirst({
    where: { branchId, barcode: scanCode },
    include: { product: true },
  });
  if (variantHit?.product?.branchId === branchId) {
    return {
      product: variantHit.product,
      matchedVariant: {
        id: variantHit.id,
        label: variantHit.label,
        barcode: variantHit.barcode,
        sku: variantHit.sku,
        stock: variantHit.stock,
        priceOverride: variantHit.priceOverride,
      },
    };
  }

  if (prisma.productBarcode) {
    try {
      const aliasHit = await prisma.productBarcode.findFirst({
        where: { branchId, barcode: scanCode },
        include: { product: true, productVariant: true },
      });
      if (aliasHit?.product?.branchId === branchId) {
        return {
          product: aliasHit.product,
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
        };
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
        OR: [{ sku: scanCode }, { barcode: scanCode }, { name: { contains: scanCode } }],
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    if (!isMissingColumnError(e, "barcode")) throw e;
    product = await prisma.product.findFirst({
      where: {
        branchId,
        OR: [{ sku: scanCode }, { name: { contains: scanCode } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!product) return null;
  return { product };
}

async function enrichProductScanResponse(branchId, payload) {
  const product = payload.product;
  await attachVariantsToProduct(branchId, product);
  await attachBarcodesToProduct(branchId, product);
  await attachPriceListsToProduct(branchId, product);
  const { product: _p, ...rest } = payload;
  return { ...product, ...rest };
}

exports.findProductByCode = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.query.branchId || 1);
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "Barcode/SKU code is required" });
    }

    const branchRow = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { scalePluDigits: true },
    });
    const scale = parseScaleBarcode(code, branchRow?.scalePluDigits);
    const lookupCodes = scale
      ? pluLookupCandidates(scale.plu, scale.pluBlock)
      : [code];

    for (const scanCode of lookupCodes) {
      const hit = await resolveProductByScanCode(branchId, scanCode);
      if (!hit) continue;
      const body = await enrichProductScanResponse(branchId, hit);
      if (scale) {
        body.scaleScan = {
          weightKg: scale.weightKg,
          plu: scale.plu,
          originalCode: code,
        };
      }
      return res.json(body);
    }

    if (scale) {
      return res.status(404).json({
        error: `No product linked to scale PLU ${scale.plu}. Set product barcode/SKU to match the PLU on the scale label.`,
      });
    }

    return res.status(404).json({ error: "Product not found" });
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

    const body = req.body || {};
    const {
      name,
      unitPrice,
      price,
      stock,
      category,
      defaultDiscountType,
      defaultDiscountValue,
      reorderLevel,
      batchTracked,
      sellByWeight,
      stockKg,
      hasVariants,
    } = body;
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
    const categoryLink = await resolveCategoryLink(branchId, {
      category: category != null ? category : existing.category,
      categoryId: body.categoryId != null ? body.categoryId : existing.categoryId,
    });
    const saleUnitFields = await resolveSaleUnitFields(
      branchId,
      {
        ...body,
        saleUnit: body.saleUnit ?? body.unitOfMeasure ?? existing.saleUnit ?? existing.unitOfMeasure,
        unitOfMeasure: body.unitOfMeasure ?? existing.unitOfMeasure,
        sellByWeight:
          typeof sellByWeight === "boolean" ? sellByWeight : Boolean(existing.sellByWeight),
        category: category != null ? category : existing.category,
      },
      categoryLink
    );
    const sellByWt = saleUnitFields.sellByWeight;
    const kgStock = Number(stockKg != null ? stockKg : existing.stockKg ?? 0);
    const hasVa = typeof hasVariants === "boolean" ? hasVariants : Boolean(existing.hasVariants);
    const nextBatch =
      typeof batchTracked === "boolean" ? batchTracked : Boolean(existing.batchTracked);
    const nextTrackExpiry =
      typeof body.trackExpiry === "boolean" ? body.trackExpiry : Boolean(existing.trackExpiry);
    if (sellByWt && hasVa) {
      return res.status(400).json({ error: "Sell-by-weight and size/color variants cannot both be enabled" });
    }
    if (sellByWt && (nextBatch || nextTrackExpiry)) {
      return res.status(400).json({
        error: "Batch/expiry tracking cannot be used with sell-by-weight products",
      });
    }

    const updateData = {
      ...buildProductData(
        {
          ...body,
          name,
          unitPrice: unitPrice ?? existing.unitPrice,
          price,
          stock,
          vatRate: body.vatRate != null ? body.vatRate : existing.vatRate,
          attributeValues: body.attributeValues,
          imageGallery: body.imageGallery,
          isActive: body.isActive !== undefined ? body.isActive : existing.isActive !== false,
        },
        { sellByWt, hasVa, normalizedDiscountType, saleUnitFields }
      ),
      ...categoryLink,
    };
    let product;
    try {
      product = await prisma.product.update({
        where: { id },
        data: updateData,
      });
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      product = await prisma.product.update({
        where: { id },
        data: stripLegacyProductFields(updateData),
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