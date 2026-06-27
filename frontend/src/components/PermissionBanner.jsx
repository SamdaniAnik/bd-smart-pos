function PermissionBanner({ show, code, tt, messageKey = "permBannerCreate" }) {
  if (!show) return null;
  return (
    <div className="page-card" style={{ marginBottom: 10 }}>
      <p style={{ margin: 0, fontSize: 13 }}>{tt(messageKey, { code: code || "—" })}</p>
    </div>
  );
}

export default PermissionBanner;
