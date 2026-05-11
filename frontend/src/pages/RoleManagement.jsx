import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { notifyPermissionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";

function RoleManagement() {
  const permissionsForUser = getStoredPermissions();
  const canManageRbac = hasPermission("rbac.manage", permissionsForUser);
  const [uiLang, setUiLang] = useState(() => getLang());
  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [templates, setTemplates] = useState({});
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([]);
  const [matrixFilter, setMatrixFilter] = useState("");
  const [matrixGroup, setMatrixGroup] = useState("all");
  const [matrixDraft, setMatrixDraft] = useState({});
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    roleId: "",
    branchId: "",
    language: "en",
  });
  const [overrideQuotaDraft, setOverrideQuotaDraft] = useState({});

  const load = useCallback(async () => {
    const [rolesRes, permissionsRes, usersRes, branchesRes, templateRes] = await Promise.all([
      api.get("/rbac/roles"),
      api.get("/rbac/permissions"),
      api.get("/rbac/users"),
      api.get("/branches"),
      api.get("/rbac/roles/templates"),
    ]);
    const quotaRes = await api.get("/rbac/override-quotas");
    setRoles(rolesRes.data);
    setPermissions(permissionsRes.data);
    setUsers(usersRes.data);
    setBranches(branchesRes.data);
    setTemplates(templateRes.data || {});
    setOverrideQuotaDraft(quotaRes.data?.map || {});
    setMatrixDraft({});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const createRole = async (e) => {
    e.preventDefault();
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    await api.post("/rbac/roles", { name: newRole });
    setNewRole("");
    load();
  };

  const savePermissions = async () => {
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    if (!selectedRoleId) return;
    await api.post(`/rbac/roles/${selectedRoleId}/permissions`, {
      permissionIds: selectedPermissionIds,
    });
    load();
  };

  const applyTemplate = async () => {
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    if (!selectedRoleId || !selectedTemplateName) return;
    await api.post(`/rbac/roles/${selectedRoleId}/apply-template`, {
      templateName: selectedTemplateName,
    });
    load();
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    await api.post("/rbac/users", {
      ...userForm,
      roleId: Number(userForm.roleId),
      branchId: Number(userForm.branchId),
    });
    setUserForm({ name: "", email: "", password: "", roleId: "", branchId: "", language: "en" });
    load();
  };

  const updateUserRole = async (userId, roleId) => {
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    await api.patch(`/rbac/users/${userId}/role`, { roleId: Number(roleId) });
    load();
  };

  const togglePermission = (permissionId) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId) ? prev.filter((id) => id !== permissionId) : [...prev, permissionId]
    );
  };

  const permissionGroups = useMemo(() => {
    const groups = new Set(["all"]);
    for (const permission of permissions) {
      const code = String(permission.code || "");
      const [prefix] = code.split(".");
      groups.add(prefix || "other");
    }
    return [...groups];
  }, [permissions]);

  const matrixPermissions = useMemo(() => {
    const term = String(matrixFilter || "").trim().toLowerCase();
    return (permissions || []).filter((permission) => {
      const code = String(permission.code || "");
      const [prefix] = code.split(".");
      const byGroup = matrixGroup === "all" ? true : (prefix || "other") === matrixGroup;
      const bySearch = term ? code.toLowerCase().includes(term) : true;
      return byGroup && bySearch;
    });
  }, [permissions, matrixFilter, matrixGroup]);

  const rolePermissionSetByRoleId = useMemo(() => {
    const map = new Map();
    for (const role of roles) {
      map.set(
        Number(role.id),
        new Set((role.rolePermissions || []).map((rp) => Number(rp.permissionId)))
      );
    }
    return map;
  }, [roles]);

  const financialLockRoleRows = useMemo(() => {
    const managePerm = (permissions || []).find((p) => String(p.code) === "financial.lock.manage");
    const overridePerm = (permissions || []).find((p) => String(p.code) === "financial.lock.override");
    const manageId = Number(managePerm?.id || 0);
    const overrideId = Number(overridePerm?.id || 0);
    return (roles || []).map((role) => {
      const set = rolePermissionSetByRoleId.get(Number(role.id)) || new Set();
      return {
        roleId: role.id,
        roleName: role.name,
        canManageLock: manageId ? set.has(manageId) : false,
        canOverrideLock: overrideId ? set.has(overrideId) : false,
      };
    });
  }, [roles, permissions, rolePermissionSetByRoleId]);

  const financialLockUserRows = useMemo(() => {
    const byRoleId = new Map(financialLockRoleRows.map((r) => [Number(r.roleId), r]));
    return (users || [])
      .map((u) => {
        const policy = byRoleId.get(Number(u.roleId));
        return {
          id: u.id,
          name: u.name || "-",
          roleName: u.role?.name || "-",
          canManageLock: Boolean(policy?.canManageLock),
          canOverrideLock: Boolean(policy?.canOverrideLock),
        };
      })
      .filter((u) => u.canManageLock || u.canOverrideLock);
  }, [users, financialLockRoleRows]);

  const getMatrixCellChecked = useCallback(
    (roleId, permissionId) => {
      const key = `${roleId}:${permissionId}`;
      if (Object.prototype.hasOwnProperty.call(matrixDraft, key)) {
        return Boolean(matrixDraft[key]);
      }
      return Boolean(rolePermissionSetByRoleId.get(Number(roleId))?.has(Number(permissionId)));
    },
    [matrixDraft, rolePermissionSetByRoleId]
  );

  const matrixDraftUpdates = useMemo(() => {
    const updates = [];
    for (const [key, checked] of Object.entries(matrixDraft)) {
      const [roleIdRaw, permissionIdRaw] = key.split(":");
      const roleId = Number(roleIdRaw);
      const permissionId = Number(permissionIdRaw);
      if (!Number.isFinite(roleId) || !Number.isFinite(permissionId)) continue;
      updates.push({ roleId, permissionId, checked: Boolean(checked) });
    }
    return updates;
  }, [matrixDraft]);

  const saveMatrixBulk = async () => {
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    if (!matrixDraftUpdates.length) return;
    await api.post("/rbac/permission-matrix/bulk-update", { updates: matrixDraftUpdates });
    await load();
  };

  const saveOverrideQuotas = async () => {
    if (!canManageRbac) {
      notifyPermissionRequired(tt("rmNeedPermManage"));
      return;
    }
    await api.post("/rbac/override-quotas", { map: overrideQuotaDraft });
    notifySuccess("Override quotas updated.");
    await load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Role management</div>
          <div className="page-title">{tt("roleManagement")}</div>
          <div className="page-subtitle">{tt("rmSubtitle")}</div>
        </div>
      </div>
      {!canManageRbac ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{tt("rmPermBanner")}</p>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div>
          <h4>{tt("rmCreateRole")}</h4>
          <form onSubmit={createRole}>
            <input placeholder={tt("rmPhRoleName")} value={newRole} onChange={(e) => setNewRole(e.target.value)} />
            <button type="submit" disabled={!canManageRbac}>{tt("rmCreateRoleBtn")}</button>
          </form>
          <h4 style={{ marginTop: "14px" }}>{tt("rmAssignPerms")}</h4>
          <select
            className="form-select-sm"
            value={selectedRoleId}
            onChange={(e) => {
              const nextRoleId = e.target.value;
              setSelectedRoleId(nextRoleId);
              const role = roles.find((r) => String(r.id) === String(nextRoleId));
              setSelectedPermissionIds((role?.rolePermissions || []).map((rp) => rp.permissionId));
            }}
          >
            <option value="">{tt("rmPhSelectRole")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <div style={{ maxHeight: "280px", overflow: "auto", border: "1px solid #ddd", borderRadius: "10px", padding: "8px" }}>
            {permissions.map((permission) => (
              <label key={permission.id} style={{ display: "block", marginBottom: "6px" }}>
                <input
                  type="checkbox"
                  checked={selectedPermissionIds.includes(permission.id)}
                  onChange={() => togglePermission(permission.id)}
                  style={{ width: "auto", marginRight: "8px" }}
                />
                {permission.code}
              </label>
            ))}
          </div>
          <button style={{ marginTop: "10px" }} onClick={savePermissions} disabled={!canManageRbac}>
            {tt("rmSavePerms")}
          </button>
          <h4 style={{ marginTop: "14px" }}>{tt("rmApplyTemplate")}</h4>
          <select className="form-select-sm" value={selectedTemplateName} onChange={(e) => setSelectedTemplateName(e.target.value)}>
            <option value="">{tt("rmPhSelectTemplate")}</option>
            {Object.keys(templates).map((templateName) => (
              <option key={templateName} value={templateName}>
                {templateName}
              </option>
            ))}
          </select>
          <button style={{ marginTop: "8px" }} onClick={applyTemplate} disabled={!canManageRbac}>
            {tt("rmApplyTemplateBtn")}
          </button>
        </div>
        <div>
          <h4>{tt("rmCreateUser")}</h4>
          <form onSubmit={createUser}>
            <input placeholder={tt("colName")} value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
            <input placeholder={tt("email")} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
            <input
              type="password"
              placeholder={tt("password")}
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            />
            <select className="form-select-sm" value={userForm.roleId} onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}>
              <option value="">{tt("rmPhSelectRole")}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select className="form-select-sm" value={userForm.branchId} onChange={(e) => setUserForm({ ...userForm, branchId: e.target.value })}>
              <option value="">{tt("rmPhSelectBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!canManageRbac}>{tt("rmCreateUserBtn")}</button>
          </form>
        </div>
      </div>
      <div className="page-card" style={{ marginTop: 14, marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>{tt("rmMatrixTitle")}</h4>
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <input
            placeholder={tt("rmPhSearchPerm")}
            value={matrixFilter}
            onChange={(e) => setMatrixFilter(e.target.value)}
          />
          <select className="form-select-sm" value={matrixGroup} onChange={(e) => setMatrixGroup(e.target.value)}>
            {permissionGroups.map((group) => (
              <option key={group} value={group}>
                {group === "all" ? tt("rmAllModules") : group}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary" onClick={() => setMatrixDraft({})} disabled={!Object.keys(matrixDraft).length}>
            {tt("rmResetUnsaved")}
          </button>
          <button type="button" onClick={saveMatrixBulk} disabled={!canManageRbac || !matrixDraftUpdates.length}>
            {tt("rmSaveMatrixChanges", { n: matrixDraftUpdates.length })}
          </button>
        </div>
        <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #ddd", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, background: "#fff" }}>
                  {tt("rmAction")}
                </th>
                {roles.map((role) => (
                  <th
                    key={`role-col-${role.id}`}
                    style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, background: "#fff" }}
                  >
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixPermissions.map((permission) => (
                <tr key={`perm-row-${permission.id}`}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>{permission.code}</td>
                  {roles.map((role) => {
                    const checked = getMatrixCellChecked(role.id, permission.id);
                    return (
                      <td key={`cell-${permission.id}-${role.id}`} style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(checked)}
                          disabled={!canManageRbac}
                          onChange={() => {
                            const key = `${role.id}:${permission.id}`;
                            setMatrixDraft((prev) => ({ ...prev, [key]: !Boolean(checked) }));
                          }}
                          style={{ width: "auto" }}
                          title={!canManageRbac ? tt("rmTitleNeedsPerm") : tt("rmTitleBulkEditable")}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!matrixPermissions.length ? (
                <tr>
                  <td colSpan={roles.length + 1} style={{ padding: 10, textAlign: "center", color: "var(--muted)" }}>
                    {tt("rmNoPermFound")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, color: "var(--muted)" }}>
          {tt("rmTip")}
        </div>
      </div>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>{tt("rmFinancialLockPolicyTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {tt("rmFinancialLockPolicyDesc")}
        </p>
        <div className="quick-stats" style={{ marginBottom: 8 }}>
          <div className="stat">
            {tt("rmFinancialLockRolesManage")}{" "}
            {financialLockRoleRows.filter((r) => r.canManageLock).length}
          </div>
          <div className="stat">
            {tt("rmFinancialLockRolesOverride")}{" "}
            {financialLockRoleRows.filter((r) => r.canOverrideLock).length}
          </div>
          <div className="stat">
            {tt("rmFinancialLockUsersOverride")}{" "}
            {financialLockUserRows.filter((u) => u.canOverrideLock).length}
          </div>
        </div>
        <DataTable
          title={tt("rmFinancialLockRoleTable")}
          allowExport={false}
          rows={financialLockRoleRows.map((r) => ({
            ...r,
            canManageLockLabel: r.canManageLock ? tt("rmYes") : tt("rmNo"),
            canOverrideLockLabel: r.canOverrideLock ? tt("rmYes") : tt("rmNo"),
          }))}
          searchableKeys={["roleName"]}
          columns={[
            { key: "roleId", label: tt("colId") },
            { key: "roleName", label: tt("rmRole") },
            { key: "canManageLockLabel", label: "financial.lock.manage" },
            { key: "canOverrideLockLabel", label: "financial.lock.override" },
          ]}
        />
        <DataTable
          title={tt("rmFinancialLockUserTable")}
          allowExport={false}
          rows={financialLockUserRows.map((u) => ({
            ...u,
            canManageLockLabel: u.canManageLock ? tt("rmYes") : tt("rmNo"),
            canOverrideLockLabel: u.canOverrideLock ? tt("rmYes") : tt("rmNo"),
          }))}
          searchableKeys={["name", "roleName"]}
          columns={[
            { key: "id", label: tt("colId") },
            { key: "name", label: tt("colName") },
            { key: "roleName", label: tt("rmRole") },
            { key: "canManageLockLabel", label: "financial.lock.manage" },
            { key: "canOverrideLockLabel", label: "financial.lock.override" },
          ]}
        />
        <div className="page-card" style={{ marginTop: 10 }}>
          <h4 style={{ marginTop: 0 }}>Override quota by role (monthly)</h4>
          <p className="text-muted" style={{ marginTop: 0 }}>
            Set max number of fiscal lock override actions per role per month.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>{tt("rmRole")}</th>
                <th>Monthly quota</th>
              </tr>
            </thead>
            <tbody>
              {(roles || []).map((role) => {
                const key = String(role.name || "").toLowerCase();
                const value = overrideQuotaDraft[key] != null ? overrideQuotaDraft[key] : "";
                return (
                  <tr key={`quota-row-${role.id}`}>
                    <td>{role.name}</td>
                    <td style={{ maxWidth: 180 }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={value}
                        disabled={!canManageRbac}
                        onChange={(e) =>
                          setOverrideQuotaDraft((prev) => ({
                            ...prev,
                            [key]: Number(e.target.value || 0),
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" onClick={saveOverrideQuotas} disabled={!canManageRbac}>
            Save override quotas
          </button>
        </div>
      </div>

      <DataTable
        title={tt("rmUsersTitle")}
        rows={users.map((u) => ({
          ...u,
          branchName: u.branch?.name || "-",
          roleName: u.role?.name || "-",
        }))}
        searchableKeys={["name", "email", "branchName", "roleName"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "name", label: tt("colName") },
          { key: "email", label: tt("email") },
          { key: "branchName", label: tt("rmBranch") },
          { key: "roleName", label: tt("rmRole") },
          {
            key: "roleId",
            label: tt("rmChangeRole"),
            render: (v, row) => (
              <select
                className="form-select-sm"
                value={v}
                onChange={(e) => updateUserRole(row.id, e.target.value)}
                disabled={!canManageRbac}
                style={{ marginBottom: 0 }}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            ),
          },
        ]}
      />
    </div>
  );
}

export default RoleManagement;
