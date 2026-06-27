import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { formatBDT } from "../utils/currency";
import { notifyError, notifyPermissionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";

const bdt = (v) => formatBDT(v, { lang: getLang(), decimals: 2 });

function ExpiryMarkdown() {
  const tt = useMemo(() => (key, params) => t(getLang(), key, params), []);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("inventory.view");
  const canManage = hasPermission("branch.manage");

  const [enabled, setEnabled] = useState(false);
  const [tiers, setTiers] = useState([]);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadConfig = async () => {
    const res = await api.get("/expiry-markdown/config");
    setEnabled(Boolean(res.data?.enabled));
    setTiers(Array.isArray(res.data?.tiers) ? res.data.tiers : []);
  };

  const loadItems = async () => {
    const res = await api.get("/expiry-markdown/items");
    setItems(res.data?.items || []);
  };

  useEffect(() => {
    if (!canView) return;
    loadConfig().catch(() => {});
    loadItems().catch(() => {});
  }, [canView]);

  const updateTier = (idx, field, value) => {
    setTiers((prev) => prev.map((tt2, i) => (i === idx ? { ...tt2, [field]: value } : tt2)));
  };
  const addTier = () => setTiers((prev) => [...prev, { days: 7, percent: 25 }]);
  const removeTier = (idx) => setTiers((prev) => prev.filter((_, i) => i !== idx));

  const saveConfig = async (e) => {
    e.preventDefault();
    if (!canManage) {
      notifyPermissionRequired(tt("permNeedCode", { code: "branch.manage" }));
      return;
    }
    const cleaned = tiers
      .map((x) => ({ days: Math.floor(Number(x.days)), percent: Number(x.percent) }))
      .filter((x) => x.days > 0 && x.percent > 0);
    if (!cleaned.length) {
      notifyError(tt("expMkAtLeastOne"));
      return;
    }
    setSaving(true);
    try {
      const res = await api.put("/expiry-markdown/config", { enabled, tiers: cleaned });
      setEnabled(Boolean(res.data?.enabled));
      setTiers(res.data?.tiers || []);
      notifySuccess(tt("expMkSaved"));
      await loadItems();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("expMkSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="page-stack">
        <PermissionBanner show code="inventory.view" tt={tt} />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("expMkPageTitle")}</div>
          <div className="page-subtitle">{tt("expMkPageSubtitle")}</div>
        </div>
      </div>

      <form onSubmit={saveConfig} className="page-card">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: "auto" }}
            disabled={!canManage}
          />
          <strong>{tt("expMkEnable")}</strong>
        </label>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
          {tt("expMkTiersHelp")}
        </p>
        <table className="table" style={{ maxWidth: 360 }}>
          <thead>
            <tr>
              <th>{tt("expMkColWithinDays")}</th>
              <th>{tt("expMkColPercent")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={tier.days}
                    onChange={(e) => updateTier(idx, "days", e.target.value)}
                    disabled={!canManage}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={95}
                    value={tier.percent}
                    onChange={(e) => updateTier(idx, "percent", e.target.value)}
                    disabled={!canManage}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => removeTier(idx)}
                    disabled={!canManage}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={addTier} disabled={!canManage}>
            {tt("expMkAddTier")}
          </button>
          <SubmitButton loading={saving} loadingLabel={tt("expMkSaving")} disabled={!canManage}>
            {tt("expMkSave")}
          </SubmitButton>
        </div>
      </form>

      <DataTable
        title={tt("expMkItemsTitle")}
        rows={items.map((x) => ({
          ...x,
          expiryLabel: x.expiryDate ? new Date(x.expiryDate).toLocaleDateString("en-GB") : "—",
          daysLabel: x.expired ? tt("expMkExpired") : `${x.daysToExpiry}`,
          markdownLabel: x.markdownPercent > 0 ? `${x.markdownPercent}%` : "—",
        }))}
        rowKey="batchId"
        searchableKeys={["productName", "batchCode", "sku"]}
        columns={[
          { key: "productName", label: tt("expMkColProduct") },
          { key: "batchCode", label: tt("expMkColBatch") },
          { key: "qtyOnHand", label: tt("expMkColQty") },
          { key: "expiryLabel", label: tt("expMkColExpiry") },
          {
            key: "daysLabel",
            label: tt("expMkColDays"),
            render: (v, row) => (row.expired ? <span style={{ color: "#b42318" }}>{v}</span> : v),
          },
          { key: "markdownLabel", label: tt("expMkColMarkdown") },
          { key: "originalPrice", label: tt("expMkColOriginal"), render: (v) => bdt(v) },
          {
            key: "markdownPrice",
            label: tt("expMkColNewPrice"),
            render: (v, row) =>
              row.markdownPercent > 0 ? <strong style={{ color: "#15803d" }}>{bdt(v)}</strong> : bdt(v),
          },
        ]}
      />
    </div>
  );
}

export default ExpiryMarkdown;
