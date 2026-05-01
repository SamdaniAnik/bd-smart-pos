const prisma = require("../../utils/prisma");

exports.createBranch = async (req, res) => {
  try {
    const { code, name, address, phone } = req.body;
    const branch = await prisma.branch.create({
      data: { code, name, address, phone },
    });
    res.status(201).json(branch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBranches = async (_req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { id: "asc" },
    });
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBranchDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    res.json(branch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    const { code, name, address, phone, isActive } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: "Branch code and name are required" });
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        code: String(code).trim(),
        name: String(name).trim(),
        address: address || null,
        phone: phone || null,
        isActive: typeof isActive === "boolean" ? isActive : existing.isActive,
      },
    });
    res.json(branch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid branch id" });
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    await prisma.branch.delete({ where: { id } });
    res.json({ message: "Branch deleted" });
  } catch (error) {
    res.status(400).json({ error: "Branch cannot be deleted while linked data exists" });
  }
};
