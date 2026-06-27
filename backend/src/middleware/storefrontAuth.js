const prisma = require("../utils/prisma");

async function storefrontAuth(req, res, next) {
  try {
    const token = String(req.headers["x-storefront-token"] || req.query?.token || "").trim();
    if (!token) return res.status(401).json({ error: "Missing x-storefront-token header" });
    const branch = await prisma.branch.findFirst({
      where: { storefrontToken: token, isActive: true },
      select: { id: true, name: true },
    });
    if (!branch) return res.status(401).json({ error: "Invalid storefront token" });
    req.branchId = branch.id;
    req.storefrontBranch = branch;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { storefrontAuth };
