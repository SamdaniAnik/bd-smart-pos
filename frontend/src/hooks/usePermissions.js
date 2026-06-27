import { useCallback, useEffect, useState } from "react";
import {
  getStoredPermissions,
  hasAnyPermission as checkAny,
  hasPermission as checkOne,
} from "../utils/permissions";

export default function usePermissions() {
  const [permissions, setPermissions] = useState(() => getStoredPermissions());

  useEffect(() => {
    const sync = () => setPermissions(getStoredPermissions());
    window.addEventListener("bd_pos_permissions_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_permissions_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const hasPermission = useCallback(
    (code) => checkOne(code, permissions),
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (codes) => checkAny(codes, permissions),
    [permissions]
  );

  return { permissions, hasPermission, hasAnyPermission };
}
