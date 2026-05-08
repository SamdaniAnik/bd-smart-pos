const jwt = require("jsonwebtoken");
const prisma = require("../utils/prisma");
const config = require("../utils/config");

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    req.user = user;
    req.branchId = Number(req.headers["x-branch-id"] || user.branchId);
    req.permissions = new Set(user.role.rolePermissions.map((p) => p.permission.code));
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.permissions || !req.permissions.has(code)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function requireAnyPermission(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  return (req, res, next) => {
    if (!req.permissions || !list.some((c) => req.permissions.has(c))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requirePermission,
  requireAnyPermission,
};
