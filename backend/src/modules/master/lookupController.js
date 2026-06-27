const prisma = require("../../utils/prisma");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw) {
  const n = Number(raw || DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function parseQuery(req) {
  return String(req.query.q || req.query.search || "").trim();
}

function parseId(req) {
  const id = Number(req.query.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function toRow(value, label, raw = null) {
  return { value: String(value), label: String(label || value), raw };
}

async function lookupProducts(branchId, q, limit, id, extra = {}) {
  if (id) {
    const row = await prisma.product.findFirst({
      where: { id, branchId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        saleUnit: true,
        sellByWeight: true,
        isActive: true,
        vatRate: true,
        hasVariants: true,
      },
    });
    if (!row) return [];
    const unit = row.sellByWeight ? "KG" : row.saleUnit || "PCS";
    return [toRow(row.id, `${row.name}${row.sku ? ` · ${row.sku}` : ""} · ${unit}`, row)];
  }

  const where = { branchId };
  if (String(extra.activeOnly || "").toLowerCase() === "true") {
    where.isActive = true;
  }
  if (String(extra.rawMaterialOnly || "").toLowerCase() === "true") {
    where.isRawMaterial = true;
  }
  if (String(extra.excludeRawMaterial || "").toLowerCase() === "true") {
    where.isRawMaterial = false;
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { nameBn: { contains: q } },
      { sku: { contains: q } },
      { barcode: { contains: q } },
      { brand: { contains: q } },
      { genericName: { contains: q } },
    ];
  }

  const rows = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      saleUnit: true,
      sellByWeight: true,
      isActive: true,
      vatRate: true,
      hasVariants: true,
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: limit,
  });

  return rows.map((row) => {
    const unit = row.sellByWeight ? "KG" : row.saleUnit || "PCS";
    const suffix = row.sku ? ` · ${row.sku}` : row.barcode ? ` · ${row.barcode}` : "";
    return toRow(row.id, `${row.name}${suffix} · ${unit}`, row);
  });
}

async function lookupCustomers(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.customer.findFirst({
      where: { id, branchId },
      select: { id: true, name: true, phone: true, companyName: true },
    });
    if (!row) return [];
    const label = row.phone ? `${row.name} · ${row.phone}` : row.name;
    return [toRow(row.id, label, row)];
  }

  const where = { branchId };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { phone: { contains: q } },
      { companyName: { contains: q } },
      { address: { contains: q } },
      { area: { contains: q } },
    ];
  }

  const rows = await prisma.customer.findMany({
    where,
    select: { id: true, name: true, phone: true, companyName: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => {
    const label = row.phone ? `${row.name} · ${row.phone}` : row.name;
    return toRow(row.id, label, row);
  });
}

async function lookupSuppliers(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.supplier.findFirst({
      where: { id, branchId },
      select: { id: true, name: true, phone: true },
    });
    if (!row) return [];
    const label = row.phone ? `${row.name} · ${row.phone}` : row.name;
    return [toRow(row.id, label, row)];
  }

  const where = { branchId };
  if (q) {
    where.OR = [{ name: { contains: q } }, { phone: { contains: q } }, { address: { contains: q } }];
  }

  const rows = await prisma.supplier.findMany({
    where,
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => {
    const label = row.phone ? `${row.name} · ${row.phone}` : row.name;
    return toRow(row.id, label, row);
  });
}

async function lookupBranches(_branchId, q, limit, id) {
  if (id) {
    const row = await prisma.branch.findFirst({
      where: { id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!row) return [];
    return [toRow(row.id, `${row.code} — ${row.name}`, row)];
  }

  const where = {};
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { address: { contains: q } }];
  }

  const rows = await prisma.branch.findMany({
    where,
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => toRow(row.id, `${row.code} — ${row.name}`, row));
}

async function lookupWarehouses(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.warehouse.findFirst({
      where: { id, branchId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!row) return [];
    return [toRow(row.id, `${row.code || row.name} — ${row.name}`, row)];
  }

  const where = { branchId };
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { address: { contains: q } }];
  }

  const rows = await prisma.warehouse.findMany({
    where,
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => toRow(row.id, `${row.code || row.name} — ${row.name}`, row));
}

async function lookupUsers(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.user.findFirst({
      where: { id, branchId },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!row) return [];
    const label = row.email ? `${row.name} · ${row.email}` : row.name;
    return [toRow(row.id, label, row)];
  }

  const where = { branchId };
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const rows = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => {
    const label = row.email ? `${row.name} · ${row.email}` : row.name;
    return toRow(row.id, label, row);
  });
}

async function lookupCategories(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.productCategory.findFirst({
      where: { id, branchId },
      select: { id: true, name: true, department: true },
    });
    if (!row) return [];
    return [toRow(row.id, row.department ? `${row.name} (${row.department})` : row.name, row)];
  }

  const where = { branchId };
  if (q) {
    where.OR = [{ name: { contains: q } }, { department: { contains: q } }];
  }

  const rows = await prisma.productCategory.findMany({
    where,
    select: { id: true, name: true, department: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) =>
    toRow(row.id, row.department ? `${row.name} (${row.department})` : row.name, row)
  );
}

async function lookupPurchases(branchId, q, limit, id) {
  if (id) {
    const row = await prisma.purchase.findFirst({
      where: { id, branchId },
      include: { supplier: { select: { name: true } } },
    });
    if (!row) return [];
    return [
      toRow(
        row.id,
        `#${row.id} — ${row.supplier?.name || "Supplier"} — ৳${Number(row.total || 0).toFixed(2)}`,
        row
      ),
    ];
  }

  const where = { branchId };
  if (q) {
    const qNum = Number(q.replace(/^#/, ""));
    if (Number.isFinite(qNum) && qNum > 0) {
      where.OR = [{ id: qNum }, { invoiceNo: { contains: q } }];
    } else {
      where.OR = [{ invoiceNo: { contains: q } }];
    }
  }

  const rows = await prisma.purchase.findMany({
    where,
    include: { supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) =>
    toRow(
      row.id,
      `#${row.id} — ${row.supplier?.name || "Supplier"} — ৳${Number(row.total || 0).toFixed(2)}`,
      row
    )
  );
}

const LOOKUP_HANDLERS = {
  products: lookupProducts,
  customers: lookupCustomers,
  suppliers: lookupSuppliers,
  branches: lookupBranches,
  warehouses: lookupWarehouses,
  users: lookupUsers,
  categories: lookupCategories,
  purchases: lookupPurchases,
};

exports.lookupMaster = async (req, res) => {
  try {
    const type = String(req.params.type || "").trim().toLowerCase();
    const handler = LOOKUP_HANDLERS[type];
    if (!handler) {
      return res.status(400).json({ error: `Unknown lookup type: ${type}` });
    }

    const q = parseQuery(req);
    const limit = parseLimit(req.query.limit);
    const id = parseId(req);
    const rows = await handler(req.branchId, q, limit, id, req.query || {});

    res.json({ type, q, limit, rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
