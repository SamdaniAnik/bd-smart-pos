import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [templates, setTemplates] = useState({});
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([]);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    roleId: "",
    branchId: "",
    language: "en",
  });

  const selectedRole = useMemo(
    () => roles.find((r) => String(r.id) === String(selectedRoleId)),
    [roles, selectedRoleId]
  );

  const load = async () => {
    const [rolesRes, permissionsRes, usersRes, branchesRes, templateRes] = await Promise.all([
      api.get("/rbac/roles"),
      api.get("/rbac/permissions"),
      api.get("/rbac/users"),
      api.get("/branches"),
      api.get("/rbac/roles/templates"),
    ]);
    setRoles(rolesRes.data);
    setPermissions(permissionsRes.data);
    setUsers(usersRes.data);
    setBranches(branchesRes.data);
    setTemplates(templateRes.data || {});
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedRole) {
      setSelectedPermissionIds([]);
      return;
    }
    setSelectedPermissionIds(selectedRole.rolePermissions.map((rp) => rp.permissionId));
  }, [selectedRole]);

  const createRole = async (e) => {
    e.preventDefault();
    await api.post("/rbac/roles", { name: newRole });
    setNewRole("");
    load();
  };

  const savePermissions = async () => {
    if (!selectedRoleId) return;
    await api.post(`/rbac/roles/${selectedRoleId}/permissions`, {
      permissionIds: selectedPermissionIds,
    });
    load();
  };

  const applyTemplate = async () => {
    if (!selectedRoleId || !selectedTemplateName) return;
    await api.post(`/rbac/roles/${selectedRoleId}/apply-template`, {
      templateName: selectedTemplateName,
    });
    load();
  };

  const createUser = async (e) => {
    e.preventDefault();
    await api.post("/rbac/users", {
      ...userForm,
      roleId: Number(userForm.roleId),
      branchId: Number(userForm.branchId),
    });
    setUserForm({ name: "", email: "", password: "", roleId: "", branchId: "", language: "en" });
    load();
  };

  const updateUserRole = async (userId, roleId) => {
    await api.patch(`/rbac/users/${userId}/role`, { roleId: Number(roleId) });
    load();
  };

  const togglePermission = (permissionId) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId) ? prev.filter((id) => id !== permissionId) : [...prev, permissionId]
    );
  };

  return (
    <div>
      <h2>Role Management</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div>
          <h4>Create Role</h4>
          <form onSubmit={createRole}>
            <input placeholder="Role name" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
            <button type="submit">Create Role</button>
          </form>
          <h4 style={{ marginTop: "14px" }}>Assign Permissions</h4>
          <select value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)}>
            <option value="">Select Role</option>
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
          <button style={{ marginTop: "10px" }} onClick={savePermissions}>
            Save Permissions
          </button>
          <h4 style={{ marginTop: "14px" }}>Apply Role Template</h4>
          <select value={selectedTemplateName} onChange={(e) => setSelectedTemplateName(e.target.value)}>
            <option value="">Select Template</option>
            {Object.keys(templates).map((templateName) => (
              <option key={templateName} value={templateName}>
                {templateName}
              </option>
            ))}
          </select>
          <button style={{ marginTop: "8px" }} onClick={applyTemplate}>
            Apply Template
          </button>
        </div>
        <div>
          <h4>Create User</h4>
          <form onSubmit={createUser}>
            <input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
            <input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
            <input
              type="password"
              placeholder="Password"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            />
            <select value={userForm.roleId} onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}>
              <option value="">Select Role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select value={userForm.branchId} onChange={(e) => setUserForm({ ...userForm, branchId: e.target.value })}>
              <option value="">Select Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <button type="submit">Create User</button>
          </form>
        </div>
      </div>

      <DataTable
        title="Users"
        rows={users.map((u) => ({
          ...u,
          branchName: u.branch?.name || "-",
          roleName: u.role?.name || "-",
        }))}
        searchableKeys={["name", "email", "branchName", "roleName"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "branchName", label: "Branch" },
          { key: "roleName", label: "Role" },
          {
            key: "roleId",
            label: "Change Role",
            render: (v, row) => (
              <select
                value={v}
                onChange={(e) => updateUserRole(row.id, e.target.value)}
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
