import { useEffect, useState } from "react";
import api from "../services/api";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

export default function GiftCards() {
  const [rows, setRows] = useState([]);
  const [issueForm, setIssueForm] = useState({ code: "", initialAmount: "", customerId: "", expiresAt: "" });
  const [walletForm, setWalletForm] = useState({ customerId: "", amount: "", note: "" });

  const load = async () => {
    const res = await api.get("/gift-cards");
    setRows(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const issue = async (e) => {
    e.preventDefault();
    const initialAmount = Number(issueForm.initialAmount);
    if (initialAmount <= 0) {
      notifyActionRequired("enter a positive initial amount.");
      return;
    }
    await api.post("/gift-cards/issue", {
      code: issueForm.code.trim() || undefined,
      initialAmount,
      customerId: issueForm.customerId ? Number(issueForm.customerId) : undefined,
      expiresAt: issueForm.expiresAt || undefined,
    });
    setIssueForm({ code: "", initialAmount: "", customerId: "", expiresAt: "" });
    load();
    notifySuccess("gift card issued.");
  };

  const loadWallet = async (e) => {
    e.preventDefault();
    const customerId = Number(walletForm.customerId);
    const amount = Number(walletForm.amount);
    if (!customerId || amount <= 0) {
      notifyActionRequired("customer ID and amount are required.");
      return;
    }
    await api.post("/gift-cards/wallet-load", {
      customerId,
      amount,
      note: walletForm.note,
    });
    setWalletForm({ customerId: "", amount: "", note: "" });
    notifySuccess("wallet credited.");
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Gift cards &amp; customer wallet</h2>
      <p className="text-muted">Issue prepaid cards or load stored-value balance for a customer (same branch).</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
        <form onSubmit={issue} className="form-grid" style={{ border: "1px solid #e2e8f0", padding: 16, borderRadius: 8 }}>
          <h3>Issue gift card</h3>
          <label>
            Code (optional — auto if empty)
            <input value={issueForm.code} onChange={(e) => setIssueForm({ ...issueForm, code: e.target.value })} />
          </label>
          <label>
            Initial amount (BDT)
            <input
              type="number"
              value={issueForm.initialAmount}
              onChange={(e) => setIssueForm({ ...issueForm, initialAmount: e.target.value })}
              required
            />
          </label>
          <label>
            Customer ID (optional link)
            <input value={issueForm.customerId} onChange={(e) => setIssueForm({ ...issueForm, customerId: e.target.value })} />
          </label>
          <label>
            Expires (optional, yyyy-mm-dd)
            <input type="date" value={issueForm.expiresAt} onChange={(e) => setIssueForm({ ...issueForm, expiresAt: e.target.value })} />
          </label>
          <button type="submit">Issue</button>
        </form>

        <form onSubmit={loadWallet} className="form-grid" style={{ border: "1px solid #e2e8f0", padding: 16, borderRadius: 8 }}>
          <h3>Load customer wallet</h3>
          <label>
            Customer ID
            <input
              value={walletForm.customerId}
              onChange={(e) => setWalletForm({ ...walletForm, customerId: e.target.value })}
              required
            />
          </label>
          <label>
            Amount (BDT)
            <input
              type="number"
              value={walletForm.amount}
              onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })}
              required
            />
          </label>
          <label>
            Note
            <input value={walletForm.note} onChange={(e) => setWalletForm({ ...walletForm, note: e.target.value })} />
          </label>
          <button type="submit">Credit wallet</button>
        </form>
      </div>

      <h3 style={{ marginTop: 24 }}>Recent cards</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Balance</th>
            <th>Status</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{Number(r.balance || 0).toFixed(2)}</td>
              <td>{r.status}</td>
              <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
