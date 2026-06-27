export function getStoredPermissions() {
  try {
    const raw = localStorage.getItem("bd_pos_permissions");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setStoredPermissions(codes) {
  const list = Array.isArray(codes) ? codes : [];
  localStorage.setItem("bd_pos_permissions", JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("bd_pos_permissions_changed", { detail: { permissions: list } }));
  return list;
}

export function hasPermission(code, permissions = getStoredPermissions()) {
  if (!code) return false;
  return permissions.includes(code);
}

export function hasAnyPermission(codes, permissions = getStoredPermissions()) {
  if (!Array.isArray(codes) || !codes.length) return false;
  return codes.some((code) => hasPermission(code, permissions));
}
