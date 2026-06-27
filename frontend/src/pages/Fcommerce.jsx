import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import usePermissions from "../hooks/usePermissions";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";

function Fcommerce() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("fcommerce.manage") || hasPermission("branch.manage");

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

  const [monitor, setMonitor] = useState(null);
  const [configMeta, setConfigMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    autoReplyEnabled: true,
    smsFallback: true,
    metaVerifyToken: "",
    metaAccessToken: "",
    whatsappPhoneNumberId: "",
    messengerPageId: "",
  });

  const load = async () => {
    const [monRes, cfgRes] = await Promise.all([
      api.get("/fcommerce/monitor").catch(() => ({ data: null })),
      api.get("/fcommerce/config").catch(() => ({ data: null })),
    ]);
    setMonitor(monRes.data);
    setConfigMeta(cfgRes.data);
    if (cfgRes.data?.config) {
      setForm((prev) => ({
        ...prev,
        enabled: Boolean(cfgRes.data.config.enabled),
        autoReplyEnabled: Boolean(cfgRes.data.config.autoReplyEnabled),
        smsFallback: Boolean(cfgRes.data.config.smsFallback),
        whatsappPhoneNumberId: cfgRes.data.config.whatsappPhoneNumberId || "",
        messengerPageId: cfgRes.data.config.messengerPageId || "",
      }));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveConfig = async (e) => {
    e.preventDefault();
    if (!canManage) {
      notifyActionRequired("You need fcommerce.manage permission");
      return;
    }
    setSaving(true);
    try {
      await api.put("/fcommerce/config", {
        config: {
          enabled: form.enabled,
          autoReplyEnabled: form.autoReplyEnabled,
          smsFallback: form.smsFallback,
          whatsappPhoneNumberId: form.whatsappPhoneNumberId.trim(),
          messengerPageId: form.messengerPageId.trim(),
          // Tokens only sent when filled; backend preserves existing on blank.
          ...(form.metaVerifyToken.trim() ? { metaVerifyToken: form.metaVerifyToken.trim() } : {}),
          ...(form.metaAccessToken.trim() ? { metaAccessToken: form.metaAccessToken.trim() } : {}),
        },
      });
      setForm((prev) => ({ ...prev, metaVerifyToken: "", metaAccessToken: "" }));
      await load();
      notifySuccess("F-commerce settings saved");
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const webhookFullUrl = `${window.location.origin.replace(/:\d+$/, "")}${configMeta?.webhookUrl || "/api/fcommerce/meta/webhook"}`;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">F-commerce</div>
          <div className="page-subtitle">WhatsApp & Messenger order inbox monitoring</div>
        </div>
      </div>

      <div className="quick-stats">
        <div className="stat">
          Provider: <strong>{monitor?.provider || "—"}</strong> {monitor?.live ? "(live)" : "(simulated)"}
        </div>
        <div className="stat" style={{ background: monitor?.enabled ? "#dcfce7" : "#fee2e2" }}>
          {monitor?.enabled ? "Enabled" : "Disabled"}
        </div>
        <div className="stat">WhatsApp: {monitor?.hasWhatsApp ? "configured" : "—"}</div>
        <div className="stat">Messenger: {monitor?.hasMessenger ? "configured" : "—"}</div>
        <div className="stat">Auto-reply: {monitor?.autoReplyEnabled ? "on" : "off"}</div>
        <div className="stat">SMS fallback: {monitor?.smsFallback ? "on" : "off"}</div>
      </div>

      {monitor?.byPlatform?.length ? (
        <div className="quick-stats">
          {monitor.byPlatform.map((p) => (
            <div className="stat" key={p.platform}>
              {p.platform}: <strong>{p.count}</strong>
            </div>
          ))}
          {monitor.statusCounts?.map((s) => (
            <div className="stat" key={s.status} style={{ background: "#eef2ff" }}>
              {s.status}: <strong>{s.count}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={saveConfig} className="page-card form-grid">
          <h4 style={{ margin: 0, gridColumn: "1 / -1" }}>Channel configuration</h4>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.autoReplyEnabled}
              onChange={(e) => setForm({ ...form, autoReplyEnabled: e.target.checked })}
            />
            Auto-reply
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.smsFallback}
              onChange={(e) => setForm({ ...form, smsFallback: e.target.checked })}
            />
            SMS fallback
          </label>
          <input
            placeholder="WhatsApp Phone Number ID"
            value={form.whatsappPhoneNumberId}
            onChange={(e) => setForm({ ...form, whatsappPhoneNumberId: e.target.value })}
          />
          <input
            placeholder="Messenger Page ID"
            value={form.messengerPageId}
            onChange={(e) => setForm({ ...form, messengerPageId: e.target.value })}
          />
          <input
            placeholder="Meta verify token (leave blank to keep)"
            value={form.metaVerifyToken}
            onChange={(e) => setForm({ ...form, metaVerifyToken: e.target.value })}
          />
          <input
            placeholder="Meta access token (leave blank to keep)"
            value={form.metaAccessToken}
            onChange={(e) => setForm({ ...form, metaAccessToken: e.target.value })}
          />
          <div style={{ gridColumn: "1 / -1", fontSize: 12 }} className="text-muted">
            Webhook URL (set in Meta App): <code>{webhookFullUrl}</code>
          </div>
          <SubmitButton loading={saving} loadingLabel={tt("settingsSaving")}>
            Save settings
          </SubmitButton>
        </form>
      ) : null}

      <div className="page-card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <strong>Recent inbound orders (WhatsApp / Messenger)</strong>
          <button type="button" className="btn-secondary btn-sm" onClick={load}>
            {tt("settingsRefreshReadiness") || "Refresh"}
          </button>
        </div>
        <DataTable
          rows={monitor?.recent || []}
          columns={[
            { key: "orderNo", label: "Order", render: (v, row) => v || `#${row.id}` },
            { key: "externalPlatform", label: "Channel" },
            { key: "customerName", label: tt("colName") },
            { key: "customerPhone", label: tt("colPhone"), render: (v) => v || "—" },
            { key: "status", label: tt("colStatus") },
            {
              key: "createdAt",
              label: tt("colDate"),
              render: (v) => (v ? new Date(v).toLocaleString() : "—"),
            },
            {
              key: "open",
              label: tt("colActions"),
              render: () => (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "orderInbox" } }));
                  }}
                >
                  Open inbox
                </button>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

export default Fcommerce;
