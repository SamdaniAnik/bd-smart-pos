import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

function Accounting() {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [trialBalance, setTrialBalance] = useState([]);
  const [pl, setPl] = useState({ revenue: 0, expense: 0, netProfit: 0 });
  const [bs, setBs] = useState({ assets: 0, liabilities: 0, equity: 0 });
  const [journalForm, setJournalForm] = useState({
    narration: "",
    costCenterId: "",
    lines: [
      { accountId: "", debit: "", credit: "" },
      { accountId: "", debit: "", credit: "" },
    ],
  });
  const [posting, setPosting] = useState(false);

  const load = async () => {
    const [a, t, p, b, cc] = await Promise.all([
      api.get("/accounting/accounts"),
      api.get("/accounting/reports/trial-balance"),
      api.get("/accounting/reports/profit-loss"),
      api.get("/accounting/reports/balance-sheet"),
      api.get("/cost-centers", { params: { active: 1 } }),
    ]);
    setAccounts(a.data);
    setTrialBalance(t.data);
    setPl(p.data);
    setBs(b.data);
    setCostCenters(Array.isArray(cc.data) ? cc.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const debit = (journalForm.lines || []).reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const credit = (journalForm.lines || []).reduce((sum, l) => sum + Number(l.credit || 0), 0);
    return {
      debit,
      credit,
      balanced: Math.abs(debit - credit) <= 0.001,
    };
  }, [journalForm.lines]);

  const addJournalLine = () => {
    setJournalForm((prev) => ({
      ...prev,
      lines: [...prev.lines, { accountId: "", debit: "", credit: "" }],
    }));
  };

  const removeJournalLine = (idx) => {
    setJournalForm((prev) => {
      const next = prev.lines.filter((_, i) => i !== idx);
      return {
        ...prev,
        lines: next.length >= 2 ? next : [{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }],
      };
    });
  };

  const updateLine = (idx, key, value) => {
    setJournalForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === idx ? { ...line, [key]: value } : line)),
    }));
  };

  const submitJournal = async (e) => {
    e.preventDefault();
    const lines = (journalForm.lines || [])
      .map((l) => ({
        accountId: Number(l.accountId),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }))
      .filter((l) => Number.isFinite(l.accountId) && l.accountId > 0 && (l.debit > 0 || l.credit > 0));

    if (lines.length < 2) {
      notifyActionRequired("add at least two valid journal lines.");
      return;
    }
    const debit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    if (Math.abs(debit - credit) > 0.001) {
      notifyActionRequired("journal must be balanced (debit equals credit).");
      return;
    }

    setPosting(true);
    try {
      await api.post("/accounting/journals", {
        refType: "MANUAL",
        narration: journalForm.narration || "",
        costCenterId: journalForm.costCenterId ? Number(journalForm.costCenterId) : null,
        lines,
      });
      notifySuccess("journal posted.");
      setJournalForm({
        narration: "",
        costCenterId: "",
        lines: [
          { accountId: "", debit: "", credit: "" },
          { accountId: "", debit: "", credit: "" },
        ],
      });
      await load();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <h2>Accounting</h2>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h4>Manual Journal Entry</h4>
        <form onSubmit={submitJournal} className="form-grid">
          <label>
            Narration
            <input
              placeholder="Monthly adjustment, correction entry, etc."
              value={journalForm.narration}
              onChange={(e) => setJournalForm((p) => ({ ...p, narration: e.target.value }))}
            />
          </label>
          <label>
            Cost Center (optional)
            <select
              value={journalForm.costCenterId}
              onChange={(e) => setJournalForm((p) => ({ ...p, costCenterId: e.target.value }))}
            >
              <option value="">None</option>
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} - {cc.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {journalForm.lines.map((line, idx) => (
                  <tr key={idx}>
                    <td>
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(idx, "accountId", e.target.value)}
                      >
                        <option value="">Select account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} - {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) => updateLine(idx, "debit", e.target.value)}
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) => updateLine(idx, "credit", e.target.value)}
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => removeJournalLine(idx)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn-secondary btn-sm" onClick={addJournalLine}>
                + Add Line
              </button>
              <span className={totals.balanced ? "text-muted" : ""} style={{ color: totals.balanced ? "#15803d" : "#b91c1c" }}>
                Debit: ৳{totals.debit.toFixed(2)} | Credit: ৳{totals.credit.toFixed(2)} |{" "}
                {totals.balanced ? "Balanced" : "Not Balanced"}
              </span>
              <button type="submit" disabled={posting}>
                {posting ? "Posting..." : "Post Journal"}
              </button>
            </div>
          </div>
        </form>
      </div>
      <div className="quick-stats">
        <div className="stat">Revenue: ৳{pl.revenue?.toFixed?.(2) || 0}</div>
        <div className="stat">Expense: ৳{pl.expense?.toFixed?.(2) || 0}</div>
        <div className="stat">Net Profit: ৳{pl.netProfit?.toFixed?.(2) || 0}</div>
        <div className="stat">Assets: ৳{bs.assets?.toFixed?.(2) || 0}</div>
        <div className="stat">Liabilities: ৳{bs.liabilities?.toFixed?.(2) || 0}</div>
        <div className="stat">Equity: ৳{bs.equity?.toFixed?.(2) || 0}</div>
      </div>
      <DataTable
        title="Chart of Accounts"
        rows={accounts}
        searchableKeys={["code", "name", "type"]}
        filters={[
          {
            key: "type",
            label: "Type",
            options: [...new Set(accounts.map((a) => a.type))].map((x) => ({ label: x, value: x })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
        ]}
      />
      <DataTable
        title="Trial Balance"
        rows={trialBalance.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["code", "name"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "debit", label: "Debit", render: (v) => Number(v).toFixed(2) },
          { key: "credit", label: "Credit", render: (v) => Number(v).toFixed(2) },
          { key: "balance", label: "Balance", render: (v) => Number(v).toFixed(2) },
        ]}
      />
    </div>
  );
}

export default Accounting;
