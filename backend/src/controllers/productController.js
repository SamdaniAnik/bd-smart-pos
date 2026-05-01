const prisma = require("../utils/prisma");

exports.createProduct = async (req, res) => {
  try {
    const branchId = req.branchId || Number(req.body.branchId || 1);
    const { name, price, stock, category, sku, vatRate, defaultDiscountType, defaultDiscountValue } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Product name must be at least 2 characters" });
    }
    if (Number(price) < 0 || Number(stock || 0) < 0) {
      return res.status(400).json({ error: "Price and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
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
        stock: Number(stock || 0),
        category,
        sku: sku || null,
        vatRate: Number(vatRate || 0),
        defaultDiscountType: normalizedDiscountType,
        defaultDiscountValue: Number(defaultDiscountValue || 0),
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
    const products = await prisma.product.findMany({
      where: { branchId },
      orderBy: {
        createdAt: "desc",
      }
    });

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

    const { name, price, stock, category, sku, vatRate, defaultDiscountType, defaultDiscountValue } = req.body;
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Product name must be at least 2 characters" });
    }
    if (Number(price) < 0 || Number(stock) < 0) {
      return res.status(400).json({ error: "Price and stock must be non-negative" });
    }
    if (Number(vatRate || 0) < 0 || Number(vatRate || 0) > 100) {
      return res.status(400).json({ error: "VAT rate must be between 0 and 100" });
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

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: String(name).trim(),
        price: Number(price),
        stock: Number(stock),
        category: category || null,
        sku: sku || null,
        vatRate: Number(vatRate || 0),
        defaultDiscountType: normalizedDiscountType,
        defaultDiscountValue: Number(defaultDiscountValue || 0),
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