import { useEffect, useState } from "react";
import api from "../services/api";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

export default function GiftCards() {
  const [rows, setRows] = useState([]);
  const [walletBalances, setWalletBalances] = useState([]);
  const [walletTxns, setWalletTxns] = useState([]);
  const [issueForm, setIssueForm] = useState({ code: "", initialAmount: "", customerId: "", expiresAt: "" });
  const [walletForm, setWalletForm] = useState({ customerId: "", amount: "", note: "" });
  const [cashOutForm, setCashOutForm] = useState({ customerId: "", amount: "", note: "" });
  const [txnFilter, setTxnFilter] = useState({ from: "", to: "", type: "ALL" });
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [submittingWallet, setSubmittingWallet] = useState(false);
  const [submittingCashOut, setSubmittingCashOut] = useState(false);
  const [submittingTxnFilter, setSubmittingTxnFilter] = useState(false);

  const load = async (filter = txnFilter) => {
    const q = new URLSearchParams();
    if (filter?.from) q.set("from", filter.from);
    if (filter?.to) q.set("to", filter.to);
    if (filter?.type && filter.type !== "ALL") q.set("type", filter.type);
    const txnUrl = q.toString() ? `/gift-cards/wallet-transactions?${q.toString()}` : "/gift-cards/wallet-transactions";
    const [cardsRes, walletRes, txnRes] = await Promise.all([
      api.get("/gift-cards"),
      api.get("/gift-cards/wallet-balances"),
      api.get(txnUrl),
    ]);
    setRows(cardsRes.data || []);
    setWalletBalances(walletRes.data || []);
    setWalletTxns(txnRes.data || []);
  };

  useEffect(() => {
    load(txnFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issue = async (e) => {
    e.preventDefault();
    const initialAmount = Number(issueForm.initialAmount);
    if (initialAmount <= 0) {
      notifyActionRequired("enter a positive initial amount.");
      return;
    }
    setSubmittingIssue(true);
    try {
      await api.post("/gift-cards/issue", {
        code: issueForm.code.trim() || undefined,
        initialAmount,
        customerId: issueForm.customerId ? Number(issueForm.customerId) : undefined,
        expiresAt: issueForm.expiresAt || undefined,
      });
      setIssueForm({ code: "", initialAmount: "", customerId: "", expiresAt: "" });
      await load(txnFilter);
      notifySuccess("Gift card issued.");
    } finally {
      setSubmittingIssue(false);
    }
  };

  const loadWallet = async (e) => {
    e.preventDefault();
    const customerId = Number(walletForm.customerId);
    const amount = Number(walletForm.amount);
    if (!customerId || amount <= 0) {
      notifyActionRequired("customer ID and amount are required.");
      return;
    }
    setSubmittingWallet(true);
    try {
      await api.post("/gift-cards/wallet-load", {
        customerId,
        amount,
        note: walletForm.note,
      });
      setWalletForm({ customerId: "", amount: "", note: "" });
      await load(txnFilter);
      notifySuccess("Wallet credited.");
    } finally {
      setSubmittingWallet(false);
    }
  };

  const cashOutWallet = async (e) => {
    e.preventDefault();
    const customerId = Number(cashOutForm.customerId);
    const amount = Number(cashOutForm.amount);
    if (!customerId || amount <= 0) {
      notifyActionRequired("customer ID and amount are required.");
      return;
    }
    setSubmittingCashOut(true);
    try {
      await api.post("/gift-cards/wallet-cash-out", {
        customerId,
        amount,
        note: cashOutForm.note,
      });
      setCashOutForm({ customerId: "", amount: "", note: "" });
      await load(txnFilter);
      notifySuccess("Wallet cashed out and moved to cash in hand.");
    } finally {
      setSubmittingCashOut(false);
    }
  };

  const applyTxnFilter = async (e) => {
    e.preventDefault();
    setSubmittingTxnFilter(true);
    try {
      await load(txnFilter);
    } finally {
      setSubmittingTxnFilter(false);
    }
  };

  const exportTxnCsv = async () => {
    const q = new URLSearchParams();
    if (txnFilter?.from) q.set("from", txnFilter.from);
    if (txnFilter?.to) q.set("to", txnFilter.to);
    if (txnFilter?.type && txnFilter.type !== "ALL") q.set("type", txnFilter.type);
    const url = q.toString()
      ? `/gift-cards/wallet-transactions/export.csv?${q.toString()}`
      : "/gift-cards/wallet-transactions/export.csv";
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "wallet-transactions.csv";
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Gift cards &amp; customer wallet</div>
          <div className="page-subtitle">Issuance, wallet load, cash-out, and transaction history</div>
        </div>
      </div>
      <p className="page-intro">Issue prepaid cards or load stored-value balance for a customer (same branch).</p>

      <div className="split-cards-grid">
        <form onSubmit={issue} className="form-grid section-card" style={{ marginBottom: 0 }}>
          <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>Issue gift card</h3>
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
          <SubmitButton loading={submittingIssue} loadingLabel="Issuing…">
            Issue card
          </SubmitButton>
        </form>

        <form onSubmit={loadWallet} className="form-grid section-card" style={{ marginBottom: 0 }}>
          <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>Load customer wallet</h3>
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
          <SubmitButton loading={submittingWallet} loadingLabel="Crediting…">
            Credit wallet
          </SubmitButton>
        </form>
      </div>

      <form
        onSubmit={cashOutWallet}
        className="form-grid section-card"
        style={{ marginTop: 16, maxWidth: 720 }}
      >
        <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>Cash out customer wallet → cash in hand</h3>
        <label>
          Customer ID
          <input
            value={cashOutForm.customerId}
            onChange={(e) => setCashOutForm({ ...cashOutForm, customerId: e.target.value })}
            required
          />
        </label>
        <label>
          Amount (BDT)
          <input
            type="number"
            value={cashOutForm.amount}
            onChange={(e) => setCashOutForm({ ...cashOutForm, amount: e.target.value })}
            required
          />
        </label>
        <label>
          Note
          <input value={cashOutForm.note} onChange={(e) => setCashOutForm({ ...cashOutForm, note: e.target.value })} />
        </label>
        <SubmitButton loading={submittingCashOut} loadingLabel="Posting…">
          Cash out wallet
        </SubmitButton>
      </form>

      <div className="transfer-history-head" style={{ marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>Recent cards</h3>
      </div>
      <div className="data-table-wrap">
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

      <div className="transfer-history-head" style={{ marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>Customer wallet balances</h3>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
        <thead>
          <tr>
            <th>Customer ID</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Wallet Balance</th>
          </tr>
        </thead>
        <tbody>
          {walletBalances.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name || "—"}</td>
              <td>{r.phone || "—"}</td>
              <td>{Number(r.storedValueBalance || 0).toFixed(2)}</td>
            </tr>
          ))}
          {!walletBalances.length ? (
            <tr>
              <td colSpan={4} className="text-muted">
                No wallet balances found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>

      <form onSubmit={applyTxnFilter} className="form-grid section-card" style={{ marginTop: 24, maxWidth: 880 }}>
        <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>Wallet transaction history</h3>
        <label>
          From date
          <input type="date" value={txnFilter.from} onChange={(e) => setTxnFilter((p) => ({ ...p, from: e.target.value }))} />
        </label>
        <label>
          To date
          <input type="date" value={txnFilter.to} onChange={(e) => setTxnFilter((p) => ({ ...p, to: e.target.value }))} />
        </label>
        <label>
          Type
          <select className="form-select-sm" value={txnFilter.type} onChange={(e) => setTxnFilter((p) => ({ ...p, type: e.target.value }))}>
            <option value="ALL">All</option>
            <option value="WALLET_LOAD">Wallet Load</option>
            <option value="WALLET_REDEEM">Wallet Redeem</option>
            <option value="WALLET_CASH_OUT">Wallet Cash Out</option>
            <option value="LOAD">Gift Card Load</option>
            <option value="REDEEM">Gift Card Redeem</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <SubmitButton loading={submittingTxnFilter} loadingLabel="Applying…">
            Apply filter
          </SubmitButton>
          <button type="button" className="btn-secondary" onClick={exportTxnCsv}>
            Export CSV
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={submittingTxnFilter}
            onClick={async () => {
              const next = { from: "", to: "", type: "ALL" };
              setTxnFilter(next);
              setSubmittingTxnFilter(true);
              try {
                await load(next);
              } finally {
                setSubmittingTxnFilter(false);
              }
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {walletTxns.map((t) => (
            <tr key={t.id}>
              <td>{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
              <td>
                {t.customer?.name || "—"} {t.customer?.id ? `(#${t.customer.id})` : ""}
              </td>
              <td>{t.type || "—"}</td>
              <td>{Number(t.amount || 0).toFixed(2)}</td>
              <td>{t.note || "—"}</td>
            </tr>
          ))}
          {!walletTxns.length ? (
            <tr>
              <td colSpan={5} className="text-muted">
                No wallet transactions found for selected range.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}
