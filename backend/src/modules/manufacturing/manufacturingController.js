const prisma = require("../../utils/prisma");

function productionNo() {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `MFG-${datePart}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line, idx) => ({
      rawProductId: Number(line.rawProductId || line.productId),
      qtyRequired: Number(line.qtyRequired || line.qty || 0),
      sortOrder: Number(line.sortOrder ?? idx),
    }))
    .filter((l) => l.rawProductId && l.qtyRequired > 0);
}

async function componentDependsOnProduct(branchId, productId, targetId, memo = new Map()) {
  if (productId === targetId) return true;
  const key = `${productId}->${targetId}`;
  if (memo.has(key)) return memo.get(key);

  const recipe = await prisma.manufacturingRecipe.findFirst({
    where: { branchId, finishedProductId: productId, isActive: true },
    include: { lines: { select: { rawProductId: true } } },
  });
  if (!recipe?.lines?.length) {
    memo.set(key, false);
    return false;
  }
  for (const line of recipe.lines) {
    if (
      line.rawProductId === targetId ||
      (await componentDependsOnProduct(branchId, line.rawProductId, targetId, memo))
    ) {
      memo.set(key, true);
      return true;
    }
  }
  memo.set(key, false);
  return false;
}

async function markRawMaterialFlags(branchId, lines) {
  const rawIds = lines.map((l) => l.rawProductId);
  const raws = await prisma.product.findMany({
    where: { branchId, id: { in: rawIds } },
    select: { id: true, isManufactured: true },
  });
  const pureRawIds = raws.filter((r) => !r.isManufactured).map((r) => r.id);
  if (pureRawIds.length) {
    await prisma.product.updateMany({
      where: { id: { in: pureRawIds } },
      data: { isRawMaterial: true },
    });
  }
}

async function validateRecipeProducts(branchId, finishedProductId, lines) {
  const finished = await prisma.product.findFirst({
    where: { id: finishedProductId, branchId },
  });
  if (!finished) return { ok: false, error: "Finished product not found" };
  if (finished.isRawMaterial && !finished.isManufactured) {
    return { ok: false, error: "Finished product cannot be a raw-only material" };
  }
  if (!lines.length) return { ok: false, error: "At least one raw material line is required" };

  const rawIds = lines.map((l) => l.rawProductId);
  if (rawIds.includes(finishedProductId)) {
    return { ok: false, error: "Finished product cannot be its own raw material" };
  }
  const raws = await prisma.product.findMany({
    where: { branchId, id: { in: rawIds } },
  });
  if (raws.length !== rawIds.length) {
    return { ok: false, error: "One or more raw materials not found in branch" };
  }
  for (const rawId of rawIds) {
    if (await componentDependsOnProduct(branchId, rawId, finishedProductId)) {
      return { ok: false, error: "Circular BOM: a component depends on this finished product" };
    }
  }
  return { ok: true, finished };
}

exports.listRecipes = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.manufacturingRecipe.findMany({
      where: { branchId, ...(req.query.activeOnly === "1" ? { isActive: true } : {}) },
      include: {
        finishedProduct: { select: { id: true, name: true, sku: true, stock: true, price: true, unitPrice: true } },
        lines: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            rawProduct: {
              select: { id: true, name: true, sku: true, stock: true, stockKg: true, sellByWeight: true, unitPrice: true, isRawMaterial: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRecipe = async (req, res) => {
  try {
    const branchId = req.branchId;
    const finishedProductId = Number(req.body?.finishedProductId);
    const name = String(req.body?.name || "").trim();
    const yieldQty = Math.max(0.001, Number(req.body?.yieldQty || 1));
    const lines = normalizeLines(req.body?.lines);
    if (!finishedProductId) return res.status(400).json({ error: "finishedProductId is required" });
    if (!name) return res.status(400).json({ error: "Recipe name is required" });

    const check = await validateRecipeProducts(branchId, finishedProductId, lines);
    if (!check.ok) return res.status(400).json({ error: check.error });

    await prisma.product.update({
      where: { id: finishedProductId },
      data: { isManufactured: true, isRawMaterial: false },
    });
    await markRawMaterialFlags(branchId, lines);

    const recipe = await prisma.manufacturingRecipe.create({
      data: {
        branchId,
        finishedProductId,
        name,
        yieldQty,
        notes: req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null,
        isActive: req.body?.isActive !== false,
        lines: { create: lines },
      },
      include: {
        finishedProduct: { select: { id: true, name: true, sku: true, stock: true } },
        lines: { include: { rawProduct: { select: { id: true, name: true, sku: true, stock: true } } } },
      },
    });
    res.status(201).json(recipe);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "A recipe already exists for this finished product" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.updateRecipe = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    const existing = await prisma.manufacturingRecipe.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Recipe not found" });

    const finishedProductId =
      req.body?.finishedProductId != null ? Number(req.body.finishedProductId) : existing.finishedProductId;
    const lines = req.body?.lines != null ? normalizeLines(req.body.lines) : null;
    if (lines) {
      const check = await validateRecipeProducts(branchId, finishedProductId, lines);
      if (!check.ok) return res.status(400).json({ error: check.error });
      await prisma.manufacturingRecipeLine.deleteMany({ where: { recipeId: id } });
      await prisma.manufacturingRecipeLine.createMany({
        data: lines.map((l) => ({ recipeId: id, ...l })),
      });
      await markRawMaterialFlags(branchId, lines);
    }

    const recipe = await prisma.manufacturingRecipe.update({
      where: { id },
      data: {
        ...(req.body?.name != null ? { name: String(req.body.name).trim() } : {}),
        ...(req.body?.yieldQty != null ? { yieldQty: Math.max(0.001, Number(req.body.yieldQty)) } : {}),
        ...(req.body?.notes != null ? { notes: String(req.body.notes).trim().slice(0, 500) || null } : {}),
        ...(req.body?.isActive != null ? { isActive: Boolean(req.body.isActive) } : {}),
        ...(req.body?.finishedProductId != null ? { finishedProductId } : {}),
      },
      include: {
        finishedProduct: { select: { id: true, name: true, sku: true, stock: true } },
        lines: { include: { rawProduct: { select: { id: true, name: true, sku: true, stock: true } } } },
      },
    });
    res.json(recipe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listProductionOrders = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.productionOrder.findMany({
      where: { branchId },
      include: {
        recipe: {
          include: {
            finishedProduct: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(
      rows.map((row) => ({
        ...row,
        consumption: row.consumptionJson ? JSON.parse(row.consumptionJson) : [],
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.runProduction = async (req, res) => {
  try {
    const branchId = req.branchId;
    const recipeId = Number(req.body?.recipeId);
    const batchCount = Math.max(0.001, Number(req.body?.batchCount || 1));
    if (!recipeId) return res.status(400).json({ error: "recipeId is required" });

    const recipe = await prisma.manufacturingRecipe.findFirst({
      where: { id: recipeId, branchId, isActive: true },
      include: {
        finishedProduct: true,
        lines: { include: { rawProduct: true } },
      },
    });
    if (!recipe) return res.status(404).json({ error: "Recipe not found or inactive" });
    if (!recipe.lines.length) return res.status(400).json({ error: "Recipe has no raw material lines" });

    const finishedQty = Number(recipe.yieldQty) * batchCount;
    const consumption = [];

    for (const line of recipe.lines) {
      const raw = line.rawProduct;
      const needQty = Number(line.qtyRequired) * batchCount;
      if (raw.sellByWeight) {
        const have = Number(raw.stockKg || 0);
        if (have < needQty) {
          return res.status(400).json({
            error: `Insufficient ${raw.name}: need ${needQty.toFixed(3)} kg, have ${have.toFixed(3)} kg`,
          });
        }
      } else {
        const needInt = Math.ceil(needQty);
        const have = Number(raw.stock || 0);
        if (have < needInt) {
          return res.status(400).json({
            error: `Insufficient ${raw.name}: need ${needInt}, have ${have}`,
          });
        }
      }
      consumption.push({
        rawProductId: raw.id,
        name: raw.name,
        qty: needQty,
        unitCost: Number(raw.unitPrice || 0),
        lineCost: Number((needQty * Number(raw.unitPrice || 0)).toFixed(4)),
      });
    }

    const totalMaterialCost = consumption.reduce((s, c) => s + c.lineCost, 0);
    const unitCost = totalMaterialCost / finishedQty;

    const result = await prisma.$transaction(async (tx) => {
      for (const line of recipe.lines) {
        const raw = line.rawProduct;
        const needQty = Number(line.qtyRequired) * batchCount;
        if (raw.sellByWeight) {
          await tx.product.update({
            where: { id: raw.id },
            data: { stockKg: { decrement: needQty } },
          });
          await tx.stockLedger.create({
            data: {
              branchId,
              productId: raw.id,
              refType: "PRODUCTION",
              refId: recipeId,
              outQty: 0,
              outWeightKg: needQty,
              unitCost: Number(raw.unitPrice || 0),
            },
          });
        } else {
          const needInt = Math.ceil(needQty);
          await tx.product.update({
            where: { id: raw.id },
            data: { stock: { decrement: needInt } },
          });
          await tx.stockLedger.create({
            data: {
              branchId,
              productId: raw.id,
              refType: "PRODUCTION",
              refId: recipeId,
              outQty: needInt,
              unitCost: Number(raw.unitPrice || 0),
            },
          });
        }
      }

      const finished = recipe.finishedProduct;
      const addQty = finished.sellByWeight ? finishedQty : Math.ceil(finishedQty);
      const prevStock = finished.sellByWeight ? Number(finished.stockKg || 0) : Number(finished.stock || 0);
      const prevCost = Number(finished.unitPrice || 0);
      const newStock = prevStock + addQty;
      const weightedUnitCost =
        newStock > 0 ? (prevStock * prevCost + totalMaterialCost) / newStock : unitCost;

      if (finished.sellByWeight) {
        await tx.product.update({
          where: { id: finished.id },
          data: {
            stockKg: { increment: addQty },
            unitPrice: weightedUnitCost,
          },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: finished.id,
            refType: "PRODUCTION",
            refId: recipeId,
            inQty: 0,
            inWeightKg: addQty,
            unitCost: weightedUnitCost,
          },
        });
      } else {
        await tx.product.update({
          where: { id: finished.id },
          data: {
            stock: { increment: addQty },
            unitPrice: weightedUnitCost,
          },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId: finished.id,
            refType: "PRODUCTION",
            refId: recipeId,
            inQty: addQty,
            unitCost: weightedUnitCost,
          },
        });
      }

      const order = await tx.productionOrder.create({
        data: {
          branchId,
          recipeId,
          productionNo: productionNo(),
          batchCount,
          finishedQty: addQty,
          status: "COMPLETED",
          consumptionJson: JSON.stringify(consumption),
          notes: req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null,
          createdById: req.user?.id || null,
        },
        include: {
          recipe: { include: { finishedProduct: { select: { id: true, name: true, sku: true, stock: true } } } },
        },
      });
      return { order, unitCost: weightedUnitCost, totalMaterialCost };
    });

    res.status(201).json({
      ...result.order,
      consumption,
      unitCost: result.unitCost,
      totalMaterialCost: result.totalMaterialCost,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listManufacturingProducts = async (req, res) => {
  try {
    const branchId = req.branchId;
    const type = String(req.query.type || "all").toLowerCase();
    const where = { branchId, isActive: true };
    if (type === "raw") {
      where.OR = [
        { isRawMaterial: true },
        {
          isManufactured: true,
          manufacturingRecipesFinished: { some: { branchId, isActive: true } },
        },
      ];
    } else if (type === "finished") {
      where.isRawMaterial = false;
    }
    const rows = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        stock: true,
        stockKg: true,
        sellByWeight: true,
        unitPrice: true,
        price: true,
        isRawMaterial: true,
        isManufactured: true,
        unitOfMeasure: true,
        saleUnit: true,
      },
      orderBy: { name: "asc" },
      take: 500,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
