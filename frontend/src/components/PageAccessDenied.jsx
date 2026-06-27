import { t } from "../i18n";
import { getRequiredPermissionCodes } from "../config/pagePermissions";

function PageAccessDenied({ lang, pageKey, pageDef, onGoDashboard, onGoRoles }) {
  const required = getRequiredPermissionCodes(pageDef);
  const pageLabel = pageDef?.labelKey ? t(lang, pageDef.labelKey) : pageKey || "—";

  return (
    <div className="page-card" style={{ maxWidth: 520, margin: "48px auto", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>🔒</div>
      <h2 style={{ marginTop: 0 }}>{t(lang, "pageAccessDeniedTitle")}</h2>
      <p className="text-muted" style={{ marginBottom: 16 }}>
        {t(lang, "pageAccessDeniedBody", { page: pageLabel })}
      </p>
      {required.length ? (
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
          {t(lang, "pageAccessDeniedRequired")}:{" "}
          <code style={{ fontSize: 12 }}>{required.join(" · ")}</code>
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" onClick={onGoDashboard}>
          {t(lang, "pageAccessDeniedGoDashboard")}
        </button>
        {onGoRoles ? (
          <button type="button" className="btn-secondary" onClick={onGoRoles}>
            {t(lang, "roleManagement")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default PageAccessDenied;
