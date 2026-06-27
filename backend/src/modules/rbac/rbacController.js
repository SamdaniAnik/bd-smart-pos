const prisma = require("../../utils/prisma");
const bcrypt = require("bcrypt");
const { writeAuditLog } = require("../../utils/audit");

const roleTemplates = {
  Cashier: ["sale.view", "sale.create", "product.view", "customer.view", "topup.view", "topup.create", "fcommerce.view"],
  Manager: [
    "sale.view",
    "sale.create",
    "sale.return",
    "product.view",
    "product.create",
    "inventory.view",
    "inventory.adjust",
    "purchase.view",
    "report.view",
    "supplier.view",
    "customer.view",
    "cheque.view",
    "cheque.manage",
    "asset.view",
    "costcenter.view",
    "pettycash.view",
    "topup.view",
    "topup.create",
    "topup.manage",
    "fcommerce.view",
    "fcommerce.manage",
  ],
  Accountant: [
    "accounting.view",
    "accounting.journal.create",
    "accounting.report",
    "purchase.view",
    "sale.view",
    "report.view",
    "cheque.view",
    "cheque.manage",
    "cheque.clear",
    "asset.view",
    "asset.manage",
    "costcenter.view",
    "costcenter.manage",
    "pettycash.view",
    "pettycash.manage",
    "financial.lock.manage",
    "financial.lock.maturity.view",
  ],
  Admin: ["*"],
};

async function getLatestOverrideQuotaConfig() {
  const latest = await prisma.auditLog.findFirst({
    where: {
      action: "FINANCIAL_OVERRIDE_QUOTA_CONFIG",
      entity: "System",
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const map = latest?.payload?.map;
  if (!map || typeof map !== "object") return {};
  const normalized = {};
  for (const [k, v] of Object.entries(map)) {
    const key = String(k || "").trim().toLowerCase();
    const value = Number(v);
    if (!key || !Number.isFinite(value)) continue;
    normalized[key] = Math.max(0, Math.floor(value));
  }
  return normalized;
}

exports.getRoles = async (_req, res) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Role name is required" });
    const role = await prisma.role.create({ data: { name } });
    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPermissions = async (_req, res) => {
  try {
    for (const code of [
      "financial.lock.manage",
      "financial.lock.override",
      "financial.lock.maturity.view",
      "financial.lock.maturity.override",
    ]) {
      await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code },
      });
    }
    const permissions = await prisma.permission.findMany({ orderBy: { code: "asc" } });
    res.json(permissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.assignPermissionsToRole = async (req, res) => {
  try {
    const roleId = Number(req.params.roleId);
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: "permissionIds must be an array" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const permissionId of permissionIds) {
        await tx.rolePermission.create({
          data: { roleId, permissionId: Number(permissionId) },
        });
      }
    });

    res.json({ message: "Role permissions updated" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUsers = async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { role: true, branch: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, roleId, branchId, language } = req.body;
    if (!name || !email || !password || !roleId || !branchId) {
      return res.status(400).json({ error: "name, email, password, roleId, branchId are required" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        roleId: Number(roleId),
        branchId: Number(branchId),
        language: language || "en",
      },
    });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const { roleId } = req.body;
    const user = await prisma.user.update({
      where: { id: userId },
      data: { roleId: Number(roleId) },
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRoleTemplates = async (_req, res) => {
  res.json(roleTemplates);
};

exports.applyRoleTemplate = async (req, res) => {
  try {
    const roleId = Number(req.params.roleId);
    const { templateName } = req.body;
    const codes = roleTemplates[templateName];
    if (!codes) {
      return res.status(400).json({ error: "Unknown template" });
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ error: "Role not found" });

    let permissions = [];
    if (codes.includes("*")) {
      permissions = await prisma.permission.findMany();
    } else {
      permissions = await prisma.permission.findMany({
        where: { code: { in: codes } },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const permission of permissions) {
        await tx.rolePermission.create({
          data: { roleId, permissionId: permission.id },
        });
      }
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "ROLE_TEMPLATE_APPLY",
      entity: "Role",
      entityId: roleId,
      payload: { templateName, permissionCount: permissions.length },
    });

    res.json({ message: "Role template applied" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPermissionMatrix = async (_req, res) => {
  try {
    const [roles, permissions, rolePermissions] = await Promise.all([
      prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.permission.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
      prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true } }),
    ]);
    const map = new Map();
    for (const rp of rolePermissions) {
      const key = `${rp.roleId}:${rp.permissionId}`;
      map.set(key, true);
    }
    const rows = permissions.map((permission) => ({
      permissionId: permission.id,
      code: permission.code,
      roleChecks: roles.map((role) => ({
        roleId: role.id,
        checked: Boolean(map.get(`${role.id}:${permission.id}`)),
      })),
    }));
    res.json({ roles, permissions, rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bulkUpdatePermissionMatrix = async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!updates.length) return res.status(400).json({ error: "updates array is required" });
    await prisma.$transaction(async (tx) => {
      for (const row of updates) {
        const roleId = Number(row.roleId);
        const permissionId = Number(row.permissionId);
        const checked = Boolean(row.checked);
        if (!Number.isFinite(roleId) || !Number.isFinite(permissionId)) continue;
        const existing = await tx.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId, permissionId } },
        });
        if (checked && !existing) {
          await tx.rolePermission.create({ data: { roleId, permissionId } });
        }
        if (!checked && existing) {
          await tx.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId } } });
        }
      }
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "RBAC_MATRIX_BULK_UPDATE",
      entity: "RolePermission",
      entityId: null,
      payload: { updatesCount: updates.length },
    });
    res.json({ message: "Permission matrix updated", updatesCount: updates.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOverrideQuotas = async (_req, res) => {
  try {
    const map = await getLatestOverrideQuotaConfig();
    res.json({ map });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateOverrideQuotas = async (req, res) => {
  try {
    const incoming = req.body?.map;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ error: "map object is required" });
    }
    const nextMap = {};
    for (const [roleName, quota] of Object.entries(incoming)) {
      const key = String(roleName || "").trim().toLowerCase();
      const value = Number(quota);
      if (!key) continue;
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ error: `Invalid quota for role ${roleName}` });
      }
      nextMap[key] = Math.floor(value);
    }
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "FINANCIAL_OVERRIDE_QUOTA_CONFIG",
      entity: "System",
      entityId: null,
      payload: { map: nextMap },
    });
    res.json({ message: "Override quotas updated", map: nextMap });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
