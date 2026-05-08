import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { formatBDT } from "../utils/currency";
import { getLang, t } from "../i18n";

function Accounting() {
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

  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [trialBalance, setTrialBalance] = useState([]);
  const [pl, setPl] = useState({
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpense: 0,
    totalExpense: 0,
    expense: 0,
    netProfit: 0,
    period: null,
    revenueAccounts: [],
    cogsAccounts: [],
    operatingExpenseAccounts: [],
  });
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
  const [plFrom, setPlFrom] = useState("");
  const [plTo, setPlTo] = useState("");
  const [plLoading, setPlLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchProfitLoss = async (from, to) => {
    setPlLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const p = await api.get("/accounting/reports/profit-loss", { params: Object.keys(params).length ? params : undefined });
      setPl({
        revenue: Number(p.data.revenue) || 0,
        cogs: Number(p.data.cogs) || 0,
        grossProfit: Number(p.data.grossProfit) || 0,
        operatingExpense: Number(p.data.operatingExpense) || 0,
        totalExpense: Number(p.data.totalExpense ?? p.data.expense) || 0,
        expense: Number(p.data.expense ?? p.data.totalExpense) || 0,
        netProfit: Number(p.data.netProfit) || 0,
        period: p.data.period || null,
        revenueAccounts: p.data.revenueAccounts || [],
        cogsAccounts: p.data.cogsAccounts || [],
        operatingExpenseAccounts: p.data.operatingExpenseAccounts || [],
      });
    } finally {
      setPlLoading(false);
    }
  };

  const load = async () => {
    const [a, t, b, cc] = await Promise.all([
      api.get("/accounting/accounts"),
      api.get("/accounting/reports/trial-balance"),
      api.get("/accounting/reports/balance-sheet"),
      api.get("/cost-centers", { params: { active: 1 } }),
    ]);
    setAccounts(a.data);
    setTrialBalance(t.data);
    setBs(b.data);
    setCostCenters(Array.isArray(cc.data) ? cc.data : []);
    await fetchProfitLoss(plFrom, plTo);
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
      notifyActionRequired(tt("accNeedTwoLines"));
      return;
    }
    const debit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    if (Math.abs(debit - credit) > 0.001) {
      notifyActionRequired(tt("accNeedBalanced"));
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
      notifySuccess(tt("accJournalPosted"));
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

  const applyPlRange = () => fetchProfitLoss(plFrom, plTo);

  const setThisMonthPl = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const f = start.toISOString().slice(0, 10);
    const t = end.toISOString().slice(0, 10);
    setPlFrom(f);
    setPlTo(t);
    fetchProfitLoss(f, t);
  };

  const clearPlRange = () => {
    setPlFrom("");
    setPlTo("");
    fetchProfitLoss("", "");
  };

  const bdt = (v) => formatBDT(v, { decimals: 2, lang: uiLang });

  const plPeriodLabel = useMemo(() => {
    if (!pl.period?.from && !pl.period?.to) return tt("accPeriodAllTime");
    const fmt = (iso) => {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleDateString();
      } catch {
        return iso;
      }
    };
    if (pl.period?.from && pl.period?.to) return `${fmt(pl.period.from)} → ${fmt(pl.period.to)}`;
    if (pl.period?.from) return tt("accPeriodFrom", { date: fmt(pl.period.from) });
    return tt("accPeriodUntil", { date: fmt(pl.period?.to) });
  }, [pl.period, tt]);

  return (
    <div className="page-stack accounting-page">
      <div className="page-header accounting-header">
        <div>
          <div className="page-title">{tt("accounting")}</div>
          <div className="page-subtitle">{tt("accSubtitle")}</div>
        </div>
        <nav className="accounting-nav" role="tablist" aria-label={tt("accSectionsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            className={`accounting-nav__btn ${activeTab === "overview" ? "is-active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            {tt("accTabOverview")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "journal"}
            className={`accounting-nav__btn ${activeTab === "journal" ? "is-active" : ""}`}
            onClick={() => setActiveTab("journal")}
          >
            {tt("accTabJournal")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ledger"}
            className={`accounting-nav__btn ${activeTab === "ledger" ? "is-active" : ""}`}
            onClick={() => setActiveTab("ledger")}
          >
            {tt("accTabLedger")}
          </button>
        </nav>
      </div>

      {activeTab === "overview" && (
        <>
          <section className="accounting-panel" aria-labelledby="acct-pl-heading">
            <h2 id="acct-pl-heading" className="accounting-panel__title">
              {tt("accProfitLoss")}
            </h2>
            <p className="accounting-panel__lead">
              {tt("accProfitLossLead")}
            </p>

            <div className="accounting-toolbar">
              <div className="accounting-toolbar__dates">
                <label>
                  {tt("accFrom")}
                  <input type="date" value={plFrom} onChange={(e) => setPlFrom(e.target.value)} />
                </label>
                <label>
                  {tt("accTo")}
                  <input type="date" value={plTo} onChange={(e) => setPlTo(e.target.value)} />
                </label>
              </div>
              <div className="accounting-toolbar__actions">
                <button type="button" className="btn-secondary btn-sm" onClick={applyPlRange}>
                  {tt("accApplyRange")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={setThisMonthPl}>
                  {tt("accThisMonth")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={clearPlRange}>
                  {tt("accAllTime")}
                </button>
              </div>
            </div>

            <div className={`accounting-period-pill ${plLoading ? "is-loading" : ""}`}>
              <span style={{ fontWeight: 600, color: "var(--text-soft)" }}>{tt("accPeriod")}</span>
              <span>{plPeriodLabel}</span>
              {plLoading ? <span>{tt("dashUpdating")}</span> : null}
            </div>

            <div className="accounting-kpi-grid">
              <article className="accounting-kpi accounting-kpi--revenue">
                <span className="accounting-kpi__label">{tt("accRevenue")}</span>
                <span className="accounting-kpi__value">{bdt(pl.revenue)}</span>
              </article>
              <article className="accounting-kpi accounting-kpi--cogs">
                <span className="accounting-kpi__label">{tt("accCogs")}</span>
                <span className="accounting-kpi__value">{bdt(pl.cogs)}</span>
              </article>
              <article className="accounting-kpi accounting-kpi--gross">
                <span className="accounting-kpi__label">{tt("accGrossProfit")}</span>
                <span className="accounting-kpi__value">{bdt(pl.grossProfit)}</span>
              </article>
              <article className="accounting-kpi accounting-kpi--opex">
                <span className="accounting-kpi__label">{tt("accOperatingOther")}</span>
                <span className="accounting-kpi__value">{bdt(pl.operatingExpense)}</span>
              </article>
              <article className="accounting-kpi accounting-kpi--total-exp">
                <span className="accounting-kpi__label">{tt("accTotalExpense")}</span>
                <span className="accounting-kpi__value">{bdt(pl.totalExpense)}</span>
              </article>
              <article className={`accounting-kpi accounting-kpi--net ${pl.netProfit < 0 ? "is-negative" : ""}`}>
                <span className="accounting-kpi__label">{tt("accNetProfit")}</span>
                <span className="accounting-kpi__value">{bdt(pl.netProfit)}</span>
              </article>
            </div>

            <h3 className="accounting-panel__title" style={{ fontSize: 14, marginBottom: 12 }}>
              {tt("accBalanceSheet")}
            </h3>
            <div className="accounting-bs-grid" style={{ marginBottom: 28 }}>
              <div className="accounting-bs-card">
                <div className="accounting-bs-card__label">{tt("accAssets")}</div>
                <div className="accounting-bs-card__value">{bdt(bs.assets || 0)}</div>
              </div>
              <div className="accounting-bs-card">
                <div className="accounting-bs-card__label">{tt("accLiabilities")}</div>
                <div className="accounting-bs-card__value">{bdt(bs.liabilities || 0)}</div>
              </div>
              <div className="accounting-bs-card">
                <div className="accounting-bs-card__label">{tt("accEquity")}</div>
                <div className="accounting-bs-card__value">{bdt(bs.equity || 0)}</div>
              </div>
            </div>

            <h3 className="accounting-panel__title" style={{ fontSize: 14, marginBottom: 12 }}>
              {tt("accAccountBreakdown")}
            </h3>
            <div className="accounting-breakdown-grid">
              <DataTable
                title={tt("accRevenueAccounts")}
                rows={pl.revenueAccounts}
                searchableKeys={["code", "name"]}
                columns={[
                  { key: "code", label: tt("colCode") },
                  { key: "name", label: tt("accAccount") },
                  { key: "amount", label: tt("accPandL"), render: (v) => bdt(v) },
                ]}
              />
              <DataTable
                title={tt("accCogs510x")}
                rows={pl.cogsAccounts}
                searchableKeys={["code", "name"]}
                columns={[
                  { key: "code", label: tt("colCode") },
                  { key: "name", label: tt("accAccount") },
                  { key: "amount", label: tt("accPandL"), render: (v) => bdt(v) },
                ]}
              />
              <DataTable
                title={tt("accOperatingOtherExpenses")}
                rows={pl.operatingExpenseAccounts}
                searchableKeys={["code", "name"]}
                columns={[
                  { key: "code", label: tt("colCode") },
                  { key: "name", label: tt("accAccount") },
                  { key: "amount", label: tt("accPandL"), render: (v) => bdt(v) },
                ]}
              />
            </div>
          </section>
        </>
      )}

      {activeTab === "journal" && (
        <section className="accounting-panel accounting-journal-panel" aria-labelledby="acct-je-heading">
          <h2 id="acct-je-heading" className="accounting-panel__title">
            {tt("accManualJournalEntry")}
          </h2>
          <p className="accounting-panel__lead">{tt("accJournalLead")}</p>
          <form onSubmit={submitJournal}>
            <div className="form-grid">
              <label>
                {tt("accNarration")}
                <input
                  placeholder={tt("accPhNarration")}
                  value={journalForm.narration}
                  onChange={(e) => setJournalForm((p) => ({ ...p, narration: e.target.value }))}
                />
              </label>
              <label>
                {tt("accCostCenterOptional")}
                <select
                  className="form-select-sm"
                  value={journalForm.costCenterId}
                  onChange={(e) => setJournalForm((p) => ({ ...p, costCenterId: e.target.value }))}
                >
                  <option value="">{tt("accNone")}</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ gridColumn: "1 / -1" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{tt("accAccount")}</th>
                      <th style={{ width: 140 }}>{tt("accDebit")}</th>
                      <th style={{ width: 140 }}>{tt("accCredit")}</th>
                      <th style={{ width: 90 }} aria-label={tt("accRemoveRow")} />
                    </tr>
                  </thead>
                  <tbody>
                    {journalForm.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            className="form-select-sm"
                            value={line.accountId}
                            onChange={(e) => updateLine(idx, "accountId", e.target.value)}
                          >
                            <option value="">{tt("accSelectAccount")}</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name}
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
                            placeholder={tt("accZeroAmount")}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={line.credit}
                            onChange={(e) => updateLine(idx, "credit", e.target.value)}
                            placeholder={tt("accZeroAmount")}
                          />
                        </td>
                        <td>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => removeJournalLine(idx)}>
                            {tt("invRemoveLine")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="accounting-journal-foot">
                  <button type="button" className="btn-secondary btn-sm" onClick={addJournalLine}>
                    {tt("accAddLine")}
                  </button>
                  <span
                    className={`accounting-journal-balance ${totals.balanced ? "is-ok" : "is-bad"}`}
                  >
                    {tt("accJournalTotals", {
                      debit: bdt(totals.debit),
                      credit: bdt(totals.credit),
                      status: totals.balanced ? tt("accBalanced") : tt("accNotBalanced"),
                    })}
                  </span>
                  <button type="submit" disabled={posting}>
                    {posting ? tt("accPosting") : tt("accPostJournal")}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </section>
      )}

      {activeTab === "ledger" && (
        <div className="accounting-ledger-stack">
          <DataTable
            title={tt("accChartOfAccounts")}
            rows={accounts}
            searchableKeys={["code", "name", "type"]}
            filters={[
              {
                key: "type",
                label: tt("accType"),
                options: [...new Set(accounts.map((a) => a.type))].map((x) => ({ label: x, value: x })),
              },
            ]}
            columns={[
              { key: "id", label: tt("colId") },
              { key: "code", label: tt("colCode") },
              { key: "name", label: tt("colName") },
              { key: "type", label: tt("accType") },
            ]}
          />
          <DataTable
            title={tt("accTrialBalance")}
            rows={trialBalance.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
            searchableKeys={["code", "name"]}
            columns={[
              { key: "rowNo", label: "#" },
              { key: "code", label: tt("colCode") },
              { key: "name", label: tt("colName") },
              { key: "debit", label: tt("accDebit"), render: (v) => bdt(v) },
              { key: "credit", label: tt("accCredit"), render: (v) => bdt(v) },
              { key: "balance", label: tt("accBalance"), render: (v) => bdt(v) },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export default Accounting;
