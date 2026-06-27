const jwt = require("jsonwebtoken");
const prisma = require("../utils/prisma");
const config = require("../utils/config");

// Permission that allows a user to operate across branches (e.g. owners/admins
// using the branch switcher). Everyone else is pinned to their home branch.
const CROSS_BRANCH_PERMISSION = "branch.manage";

// Resolve the effective branch for the request. The `x-branch-id` header is
// client-controlled, so we only honour it when the user is explicitly allowed
// to switch branches; otherwise we fall back to the user's own branch. This
// prevents a regular user from reading or mutating another branch's data by
// simply changing a request header (cross-tenant IDOR).
function resolveBranchId(user, permissions, headerValue) {
  const homeBranchId = Number(user.branchId);
  const requested = Number(headerValue);
  if (!Number.isFinite(requested) || requested <= 0) return homeBranchId;
  if (requested === homeBranchId) return homeBranchId;
  if (permissions.has(CROSS_BRANCH_PERMISSION)) return requested;
  return homeBranchId;
}

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

    const permissions = new Set(user.role.rolePermissions.map((p) => p.permission.code));
    req.user = user;
    req.permissions = permissions;
    req.branchId = resolveBranchId(user, permissions, req.headers["x-branch-id"]);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.permissions || !req.permissions.has(code)) {
      return res.status(403).json({ error: "Forbidden", requiredPermission: code });
    }
    next();
  };
}

function requireAnyPermission(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  return (req, res, next) => {
    if (!req.permissions || !list.some((c) => req.permissions.has(c))) {
      return res.status(403).json({ error: "Forbidden", requiredPermissions: list });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requirePermission,
  requireAnyPermission,
};
