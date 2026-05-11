const express = require("express");
const {
  getRoles,
  createRole,
  getPermissions,
  assignPermissionsToRole,
  getUsers,
  createUser,
  updateUserRole,
  getRoleTemplates,
  applyRoleTemplate,
  getPermissionMatrix,
  bulkUpdatePermissionMatrix,
  getOverrideQuotas,
  updateOverrideQuotas,
} = require("./rbacController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/roles", requireAuth, requirePermission("rbac.manage"), getRoles);
router.post("/roles", requireAuth, requirePermission("rbac.manage"), createRole);
router.post("/roles/:roleId/permissions", requireAuth, requirePermission("rbac.manage"), assignPermissionsToRole);
router.get("/roles/templates", requireAuth, requirePermission("rbac.manage"), getRoleTemplates);
router.post("/roles/:roleId/apply-template", requireAuth, requirePermission("rbac.manage"), applyRoleTemplate);
router.get("/permissions", requireAuth, requirePermission("rbac.manage"), getPermissions);
router.get("/permission-matrix", requireAuth, requirePermission("rbac.manage"), getPermissionMatrix);
router.post("/permission-matrix/bulk-update", requireAuth, requirePermission("rbac.manage"), bulkUpdatePermissionMatrix);
router.get("/override-quotas", requireAuth, requirePermission("rbac.manage"), getOverrideQuotas);
router.post("/override-quotas", requireAuth, requirePermission("rbac.manage"), updateOverrideQuotas);

router.get("/users", requireAuth, requirePermission("rbac.manage"), getUsers);
router.post("/users", requireAuth, requirePermission("rbac.manage"), createUser);
router.patch("/users/:userId/role", requireAuth, requirePermission("rbac.manage"), updateUserRole);

module.exports = router;
