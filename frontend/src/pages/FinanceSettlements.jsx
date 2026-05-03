import { useEffect, useState } from "react";
import api from "../services/api";
import { notifySuccess } from "../utils/notify";

export default function FinanceSettlements() {
  const [settlements, setSettlements] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [form, setForm] = useState({
    provider: "BKASH_SETTLEMENT",
    periodStart: "",
    periodEnd: "",
    grossAmount: "",
    feeAmount: "0",
    netAmount: "",
    externalRef: "",
    transactionsRaw: "",
  });

  const load = async () => {
    const [s, u] = await Promise.all([api.get("/finance/settlements"), api.get("/finance/settlements/unmatched-payments")]);
    setSettlements(s.data);
    setUnmatched(u.data);
  };

  useEffect(() => {
    load();
  }, []);

  const parseTransactions = (raw) => {
    const lines = String(raw || "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out = [];
    for (const line of lines) {
      if (line.includes(",")) {
        const [channel, amt] = line.split(",");
        out.push({ channel: channel.trim(), amount: Number(amt) });
      } else {
        out.push({ channel: line });
      }
    }
    return out;
  };

  const submit = async (e) => {
    e.preventDefault();
    const grossAmount = Number(form.grossAmount || 0);
    const feeAmount = Number(form.feeAmount || 0);
    const netAmount = form.netAmount !== "" ? Number(form.netAmount) : grossAmount - feeAmount;
    const transactions = parseTransactions(form.transactionsRaw);
    await api.post("/finance/settlements/import", {
      provider: form.provider,
      periodStart: form.periodStart || new Date().toISOString(),
      periodEnd: form.periodEnd || new Date().toISOString(),
      grossAmount,
      feeAmount,
      netAmount,
      externalRef: form.externalRef || null,
      transactions,
    });
    setForm((f) => ({ ...f, transactionsRaw: "", externalRef: "" }));
    load();
    notifySuccess("settlement imported and payments matched where channel equals transaction ID.");
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>MFS / card settlement reconciliation</h2>
      <p className="text-muted">
        Paste transaction reference IDs (one per line) to mark matching <code>SalePayment.channel</code> rows as reconciled.
      </p>

      <form onSubmit={submit} className="form-grid" style={{ maxWidth: 640, marginTop: 16 }}>
        <label>
          Provider key
          <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
        </label>
        <label>
          Period start
          <input type="datetime-local" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
        </label>
        <label>
          Period end
          <input type="datetime-local" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
        </label>
        <label>
          Gross
          <input type="number" value={form.grossAmount} onChange={(e) => setForm({ ...form, grossAmount: e.target.value })} />
        </label>
        <label>
          Fees
          <input type="number" value={form.feeAmount} onChange={(e) => setForm({ ...form, feeAmount: e.target.value })} />
        </label>
        <label>
          Net (optional — defaults gross − fees)
          <input type="number" value={form.netAmount} onChange={(e) => setForm({ ...form, netAmount: e.target.value })} />
        </label>
        <label>
          External ref / file id
          <input value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Transaction/channel IDs (one per line; optional amount after comma)
          <textarea
            rows={6}
            value={form.transactionsRaw}
            onChange={(e) => setForm({ ...form, transactionsRaw: e.target.value })}
            placeholder={"TRX987654321\nABC123,500"}
          />
        </label>
        <button type="submit">Import settlement &amp; match</button>
      </form>

      <h3 style={{ marginTop: 28 }}>Unmatched digital payments (has channel, not in a settlement)</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Sale</th>
            <th>Method</th>
            <th>Channel</th>
            <th>Amount</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {unmatched.slice(0, 100).map((p) => (
            <tr key={p.id}>
              <td>{p.sale?.invoiceNo || p.saleId}</td>
              <td>{p.method}</td>
              <td>{p.channel}</td>
              <td>{Number(p.amount || 0).toFixed(2)}</td>
              <td>{p.sale?.createdAt ? new Date(p.sale.createdAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 28 }}>Settlement batches</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Provider</th>
            <th>Net</th>
            <th>Payments</th>
            <th>Imported</th>
          </tr>
        </thead>
        <tbody>
          {settlements.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{s.provider}</td>
              <td>{Number(s.netAmount || 0).toFixed(2)}</td>
              <td>{s._count?.payments ?? "—"}</td>
              <td>{new Date(s.importedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
