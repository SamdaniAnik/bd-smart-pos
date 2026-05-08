import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { consumeGlobalSubmitError, notifySuccess, notifyError } from "../utils/notify";

export default function IntegrationWebhooks() {
  const [rows, setRows] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [replayBusyId, setReplayBusyId] = useState(null);
  const [form, setForm] = useState({
    url: "",
    secret: "",
    events: "sale.created",
  });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await api.get("/integration/webhooks");
    setRows(res.data || []);
  };

  const loadDeliveries = async () => {
    const res = await api.get("/integration/webhooks/deliveries?limit=75");
    setDeliveries(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    load();
    loadDeliveries();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const evRaw = form.events.trim();
      await api.post("/integration/webhooks", {
        url: form.url.trim(),
        secret: form.secret,
        events: evRaw || "sale.created",
      });
      setForm({ url: "", secret: "", events: "sale.created" });
      load();
      loadDeliveries();
      notifySuccess("webhook saved.");
    } catch {
      consumeGlobalSubmitError();
    } finally {
      setBusy(false);
    }
  };

  const exportDeliveriesCsv = async () => {
    try {
      const res = await api.get("/integration/webhooks/deliveries/export.csv?limit=500", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "webhook-deliveries.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || "Export failed");
    }
  };

  const replayDelivery = async (row) => {
    if (!row?.canReplay) return;
    setReplayBusyId(row.id);
    try {
      await api.post(`/integration/webhooks/deliveries/${row.id}/replay`, {}, { skipGlobalErrorToast: true });
      notifySuccess("Replay webhook dispatched.");
      loadDeliveries();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || "Replay failed");
    } finally {
      setReplayBusyId(null);
    }
  };

  const toggle = async (row) => {
    await api.put(`/integration/webhooks/${row.id}`, { isActive: !row.isActive });
    load();
    loadDeliveries();
  };

  const remove = async (row) => {
    if (!window.confirm("Remove this webhook endpoint?")) return;
    await api.delete(`/integration/webhooks/${row.id}`);
    load();
    loadDeliveries();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Outbound webhooks</div>
          <div className="page-subtitle">
            Registers HTTPS endpoints that receive JSON POST payloads when events occur. Header{" "}
            <code>X-Bdpos-Signature</code> is HMAC-SHA256 of the JSON body using your secret (when secret is
            non-empty).
          </div>
        </div>
      </div>

      <form onSubmit={create} className="form-grid page-card" style={{ maxWidth: 640, marginTop: 16 }}>
        <label>
          HTTPS URL
          <input
            placeholder="https://example.com/hooks/bdpos"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            required
          />
        </label>
        <label>
          Secret (optional)
          <input
            placeholder="Shared secret"
            value={form.secret}
            onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
          />
        </label>
        <label>
          Events (comma-separated, or use * for all)
          <input
            value={form.events}
            onChange={(e) => setForm((f) => ({ ...f, events: e.target.value }))}
          />
        </label>
        <button type="submit" disabled={busy}>
          Add webhook
        </button>
      </form>

      <div style={{ marginTop: 24 }}>
        <h4>Active subscriptions</h4>
        {(rows || []).length ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id} className="page-card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>#{r.id}</strong>
                  <span style={{ opacity: r.isActive ? 1 : 0.55 }}>{r.isActive ? "Active" : "Paused"}</span>
                </div>
                <code style={{ display: "block", marginTop: 6, wordBreak: "break-all" }}>{r.url}</code>
                <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                  Events: {Array.isArray(r.events) ? r.events.join(", ") : JSON.stringify(r.events)}
                </p>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => toggle(r)}>
                    {r.isActive ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None yet.</p>
        )}
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>Recent deliveries</h4>
          <button type="button" className="btn-secondary btn-sm" onClick={exportDeliveriesCsv}>
            Export CSV
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={loadDeliveries}>
            Refresh log
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
          One row per outbound POST after each eligible event (e.g. <code>sale.created</code>). Failed rows keep the error message from the network or non-2xx response.
        </p>
        <DataTable
          title=""
          rows={deliveries.map((d) => ({
            ...d,
            createdLabel: d.createdAt ? new Date(d.createdAt).toLocaleString() : "—",
            statusLabel: d.ok ? "OK" : "Fail",
            subIdLabel: d.webhookSubscriptionId != null ? `#${d.webhookSubscriptionId}` : "—",
            httpLabel: d.statusCode != null ? String(d.statusCode) : "—",
            msLabel: d.durationMs != null ? `${d.durationMs} ms` : "—",
            urlShort: String(d.url || "").length > 72 ? `${String(d.url).slice(0, 72)}…` : String(d.url || ""),
          }))}
          pageSize={10}
          allowExport={false}
          searchableKeys={["event", "urlShort", "errorMessage", "subIdLabel"]}
          columns={[
            { key: "createdLabel", label: "Time" },
            { key: "event", label: "Event" },
            { key: "subIdLabel", label: "Hook #" },
            {
              key: "statusLabel",
              label: "Result",
              render: (v, row) => (
                <span style={{ color: row.ok ? "#15803d" : "#b42318", fontWeight: 600 }}>{v}</span>
              ),
            },
            { key: "httpLabel", label: "HTTP" },
            { key: "msLabel", label: "Latency" },
            {
              key: "urlShort",
              label: "URL",
              render: (v, row) => (
                <code style={{ fontSize: 11 }} title={row.url}>
                  {v}
                </code>
              ),
            },
            {
              key: "detail-actions",
              label: "",
              render: (_, row) => (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!row.canReplay || replayBusyId === row.id}
                  onClick={() => replayDelivery(row)}
                >
                  {replayBusyId === row.id ? "…" : "Replay"}
                </button>
              ),
            },
            {
              key: "errorMessage",
              label: "Detail",
              render: (v) => (
                <span style={{ fontSize: 12, color: v ? "#b42318" : "#64748b" }}>{v || "—"}</span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
