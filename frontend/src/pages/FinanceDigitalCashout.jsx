import { useEffect, useState } from "react";
import api from "../services/api";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import SearchSelect from "../components/SearchSelect";

const TRANSFER_METHOD_OPTIONS = ["Cash", "bKash", "Nagad", "Rocket", "Card", "Wallet"];

export default function FinanceDigitalCashout() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState({ from: "", to: "" });
  const [form, setForm] = useState({ fromMethod: "bKash", toMethod: "Cash", amount: "", note: "" });
  const sameMethod = String(form.fromMethod || "").trim().toLowerCase() === String(form.toMethod || "").trim().toLowerCase();
  const [submitting, setSubmitting] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);

  const load = async (nextFilter = filter) => {
    const q = new URLSearchParams();
    if (nextFilter.from) q.set("from", nextFilter.from);
    if (nextFilter.to) q.set("to", nextFilter.to);
    const url = q.toString()
      ? `/finance/settlements/digital-cash-out?${q.toString()}`
      : "/finance/settlements/digital-cash-out";
    const res = await api.get(url);
    setRows(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount || 0);
    if (!(amount > 0)) {
      notifyActionRequired("enter a positive amount.");
      return;
    }
    if (!String(form.fromMethod || "").trim()) {
      notifyActionRequired("choose source method.");
      return;
    }
    if (!String(form.toMethod || "").trim()) {
      notifyActionRequired("choose destination method.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/finance/settlements/digital-cash-out", {
        fromMethod: form.fromMethod,
        toMethod: form.toMethod,
        amount,
        note: form.note || null,
      });
      setForm((p) => ({ ...p, amount: "", note: "" }));
      await load(filter);
      notifySuccess("Transfer posted. Dashboard settlement totals update automatically.");
    } finally {
      setSubmitting(false);
    }
  };

  const applyFilter = async () => {
    setFilterBusy(true);
    try {
      await load(filter);
    } finally {
      setFilterBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Digital / cash transfer</div>
          <div className="page-subtitle">Reconcile movement between cash drawer and mobile wallets</div>
        </div>
      </div>
      <p className="page-intro">
        Transfer between methods (Digital → Cash or Cash → Digital). Amounts flow into today&apos;s settlement breakdown on the
        dashboard.
      </p>

      <form onSubmit={submit} className="form-grid page-card section-card" style={{ maxWidth: 720 }}>
        <label>
          From method
          <SearchSelect
            className="form-select-sm"
            value={form.fromMethod}
            onChange={(val) => setForm((p) => ({ ...p, fromMethod: val || "bKash" }))}
            options={TRANSFER_METHOD_OPTIONS.map((m) => ({ value: m, label: m }))}
            isClearable={false}
          />
        </label>
        <label>
          To method
          <SearchSelect
            className="form-select-sm"
            value={form.toMethod}
            onChange={(val) => setForm((p) => ({ ...p, toMethod: val || "Cash" }))}
            options={TRANSFER_METHOD_OPTIONS.map((m) => ({ value: m, label: m }))}
            isClearable={false}
          />
        </label>
        {sameMethod ? (
          <p style={{ gridColumn: "1 / -1", margin: 0, color: "#b42318", fontSize: 13, fontWeight: 600 }}>
            From method and To method cannot be the same.
          </p>
        ) : null}
        <label>
          Amount
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            required
            min={0}
            step="0.01"
          />
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Optional reference" />
        </label>
        <SubmitButton loading={submitting} loadingLabel="Posting…" disabled={sameMethod}>
          Post transfer
        </SubmitButton>
      </form>

      <div className="page-card section-card" style={{ maxWidth: 720, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--text-soft)" }}>History filters</div>
        <div className="form-grid" style={{ marginBottom: 0, padding: 0, border: "none", boxShadow: "none", background: "transparent" }}>
          <label>
            From date
            <input type="date" value={filter.from} onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))} />
          </label>
          <label>
            To date
            <input type="date" value={filter.to} onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))} />
          </label>
          <button type="button" className="btn-secondary" disabled={filterBusy} onClick={() => applyFilter()}>
            {filterBusy ? "Loading…" : "Apply filter"}
          </button>
        </div>
      </div>

      <div className="transfer-history-head">
        <h3 style={{ margin: 0 }}>Transfer history</h3>
        <span className="badge badge-primary">{rows.length} entries</span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>User</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                <td>{r.payload?.fromMethod || "—"}</td>
                <td>{r.payload?.toMethod || "—"}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{Number(r.payload?.amount || 0).toFixed(2)}</td>
                <td>{r.user?.name || r.user?.email || "—"}</td>
                <td>{r.payload?.note || "—"}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: "28px 16px" }}>
                  No transfer entries for this range yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
