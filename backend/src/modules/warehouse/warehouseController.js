const prisma = require("../../utils/prisma");
const { parseListQuery, pagedResult } = require("../../utils/listQuery");

exports.createWarehouse = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Warehouse name is required" });
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        branchId,
        name: String(name).trim(),
      },
    });
    res.status(201).json(warehouse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getWarehouses = async (req, res) => {
  try {
    const lq = parseListQuery(req, {
      searchableFields: ["name"],
      sortableFields: ["id", "name"],
      defaultSort: "id",
      defaultSortDir: "desc",
    });
    const where = { branchId: req.branchId };
    if (lq.searchClauses.length) where.AND = lq.searchClauses;

    if (lq.paged) {
      const [warehouses, total] = await prisma.$transaction([
        prisma.warehouse.findMany({ where, orderBy: lq.orderBy, skip: lq.skip, take: lq.take }),
        prisma.warehouse.count({ where }),
      ]);
      return res.json(pagedResult({ data: warehouses, total, page: lq.page, pageSize: lq.pageSize }));
    }

    const warehouses = await prisma.warehouse.findMany({
      where,
      orderBy: lq.orderBy || { id: "desc" },
    });
    res.json(warehouses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getWarehouseDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid warehouse id" });

    const warehouse = await prisma.warehouse.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!warehouse) return res.status(404).json({ error: "Warehouse not found" });

    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateWarehouse = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid warehouse id" });

    const existing = await prisma.warehouse.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });

    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Warehouse name is required" });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        name: String(name).trim(),
      },
    });
    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteWarehouse = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid warehouse id" });

    const existing = await prisma.warehouse.findFirst({
      where: { id, branchId: req.branchId },
    });
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });

    await prisma.warehouse.delete({ where: { id } });
    res.json({ message: "Warehouse deleted" });
  } catch (error) {
    res.status(400).json({ error: "Warehouse cannot be deleted while linked data exists" });
  }
};
