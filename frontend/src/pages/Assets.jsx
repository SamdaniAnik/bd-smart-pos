import { useEffect, useState } from "react";
import api from "../services/api";
import { notifySuccess, notifyActionRequired } from "../utils/notify";

const emptyForm = {
  assetCode: "",
  name: "",
  category: "",
  purchaseDate: "",
  inServiceDate: "",
  cost: "",
  salvageValue: "0",
  usefulLifeMonths: "60",
  notes: "",
};

export default function Assets() {
  const [rows, setRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("ACTIVE");
  const [form, setForm] = useState(emptyForm);
  const [asOfDate, setAsOfDate] = useState("");
  const [running, setRunning] = useState(false);

  const load = async () => {
    const [assetsRes, entriesRes] = await Promise.all([
      api.get("/assets", { params: { ...(status ? { status } : {}) } }),
      api.get("/assets/depreciation/entries"),
    ]);
    setRows(Array.isArray(assetsRes.data) ? assetsRes.data : []);
    setEntries(Array.isArray(entriesRes.data) ? entriesRes.data : []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createAsset = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.purchaseDate || !form.inServiceDate) {
      notifyActionRequired("name, purchase date, and in-service date are required.");
      return;
    }
    await api.post("/assets", {
      ...form,
      name: form.name.trim(),
      assetCode: form.assetCode.trim() || undefined,
      category: form.category.trim() || undefined,
      cost: Number(form.cost),
      salvageValue: Number(form.salvageValue || 0),
      usefulLifeMonths: Number(form.usefulLifeMonths),
      notes: form.notes.trim() || undefined,
    });
    notifySuccess("asset registered.");
    setForm(emptyForm);
    load();
  };

  const runDepreciation = async () => {
    setRunning(true);
    try {
      const res = await api.post("/assets/depreciation/run", {
        asOfDate: asOfDate || undefined,
      });
      notifySuccess(`depreciation posted for ${Number(res.data?.postedCount || 0)} asset(s).`);
      setAsOfDate("");
      load();
    } finally {
      setRunning(false);
    }
  };

  const disposeAsset = async (id) => {
    const raw = window.prompt("Disposal proceeds amount (optional, default 0):", "0");
    if (raw == null) return;
    const disposalValue = Number(raw || 0);
    if (!Number.isFinite(disposalValue) || disposalValue < 0) {
      notifyActionRequired("enter a valid non-negative disposal amount.");
      return;
    }
    const res = await api.post(`/assets/${id}/dispose`, { disposalValue });
    const accounting = res.data?.disposalAccounting;
    if (accounting) {
      notifySuccess(
        `asset disposed. BV ${Number(accounting.bookValue || 0).toFixed(2)}, proceeds ${Number(
          accounting.proceeds || 0
        ).toFixed(2)}, gain ${Number(accounting.gain || 0).toFixed(2)}, loss ${Number(
          accounting.loss || 0
        ).toFixed(2)}.`
      );
    } else {
      notifySuccess("asset disposed.");
    }
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Asset register &amp; depreciation</div>
          <div className="page-subtitle">Fixed assets and monthly straight-line depreciation postings</div>
        </div>
      </div>

      <form onSubmit={createAsset} className="form-grid" style={{ marginBottom: 16 }}>
        <label>
          Asset code
          <input value={form.assetCode} onChange={(e) => setForm((p) => ({ ...p, assetCode: e.target.value }))} />
        </label>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
        </label>
        <label>
          Purchase date
          <input type="date" required value={form.purchaseDate} onChange={(e) => setForm((p) => ({ ...p, purchaseDate: e.target.value }))} />
        </label>
        <label>
          In-service date
          <input type="date" required value={form.inServiceDate} onChange={(e) => setForm((p) => ({ ...p, inServiceDate: e.target.value }))} />
        </label>
        <label>
          Cost
          <input type="number" step="0.01" required value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
        </label>
        <label>
          Salvage value
          <input type="number" step="0.01" value={form.salvageValue} onChange={(e) => setForm((p) => ({ ...p, salvageValue: e.target.value }))} />
        </label>
        <label>
          Useful life (months)
          <input type="number" min="1" required value={form.usefulLifeMonths} onChange={(e) => setForm((p) => ({ ...p, usefulLifeMonths: e.target.value }))} />
        </label>
        <label>
          Notes
          <input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit">Add Asset</button>
        </div>
      </form>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Status
          <select className="form-select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DISPOSED">Disposed</option>
          </select>
        </label>
        <label>
          Depreciation as of
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" className="btn-secondary" onClick={runDepreciation} disabled={running}>
            {running ? "Running..." : "Run Depreciation"}
          </button>
        </div>
      </div>

      <h3>Assets</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Status</th>
            <th>Cost</th>
            <th>Accum. Dep</th>
            <th>Book Value</th>
            <th>Disposal</th>
            <th>Life (m)</th>
            <th>Last Dep</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cost = Number(r.cost || 0);
            const dep = Number(r.accumulatedDepreciation || 0);
            const book = Math.max(0, cost - dep);
            return (
              <tr key={r.id}>
                <td>{r.assetCode || "-"}</td>
                <td>{r.name}</td>
                <td>{r.status}</td>
                <td>{cost.toFixed(2)}</td>
                <td>{dep.toFixed(2)}</td>
                <td>{book.toFixed(2)}</td>
                <td>
                  {r.status === "DISPOSED"
                    ? `${Number(r.disposalValue || 0).toFixed(2)} · ${r.disposedAt ? new Date(r.disposedAt).toLocaleDateString() : "-"}`
                    : "-"}
                </td>
                <td>{r.usefulLifeMonths}</td>
                <td>{r.lastDepreciationDate ? new Date(r.lastDepreciationDate).toLocaleDateString() : "-"}</td>
                <td>
                  {r.status === "ACTIVE" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => disposeAsset(r.id)}>
                      Dispose
                    </button>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={10} style={{ textAlign: "center", color: "#94a3b8" }}>
                No assets found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Recent depreciation entries</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Period</th>
            <th>Asset</th>
            <th>Amount</th>
            <th>Journal</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 100).map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.runDate).toLocaleDateString()}</td>
              <td>{e.periodKey}</td>
              <td>{e.asset?.assetCode ? `${e.asset.assetCode} - ${e.asset.name}` : e.asset?.name || e.assetId}</td>
              <td>{Number(e.amount || 0).toFixed(2)}</td>
              <td>{e.journalId || "-"}</td>
            </tr>
          ))}
          {!entries.length ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8" }}>
                No depreciation entries yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
