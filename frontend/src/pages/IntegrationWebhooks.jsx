import { useEffect, useState } from "react";
import api from "../services/api";
import { consumeGlobalSubmitError, notifySuccess } from "../utils/notify";

export default function IntegrationWebhooks() {
  const [rows, setRows] = useState([]);
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

  useEffect(() => {
    load();
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
      notifySuccess("webhook saved.");
    } catch {
      consumeGlobalSubmitError();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row) => {
    await api.put(`/integration/webhooks/${row.id}`, { isActive: !row.isActive });
    load();
  };

  const remove = async (row) => {
    if (!window.confirm("Remove this webhook endpoint?")) return;
    await api.delete(`/integration/webhooks/${row.id}`);
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Outbound webhooks</h2>
      <p className="text-muted">
        Registers HTTPS endpoints that receive JSON POST payloads when events occur. Header <code>X-Bdpos-Signature</code> is HMAC-
        SHA256 of the JSON body using your secret (when secret is non-empty).
      </p>

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
    </div>
  );
}
