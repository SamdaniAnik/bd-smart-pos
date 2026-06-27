import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { formatBDT } from "../utils/currency";
import { getLang, t } from "../i18n";
import SearchSelect from "../components/SearchSelect";

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
  const { hasPermission } = usePermissions();
  const canPostJournal = hasPermission("accounting.journal.create");

  const requireJournalCreate = () => {
    if (canPostJournal) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "accounting.journal.create" }));
    return false;
  };

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
  const [cf, setCf] = useState({
    openingCash: 0,
    operating: 0,
    investing: 0,
    financing: 0,
    netIncrease: 0,
    closingCash: 0,
    period: null,
  });
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
  const [cfLoading, setCfLoading] = useState(false);
  const [cfFrom, setCfFrom] = useState("");
  const [cfTo, setCfTo] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [cfTrend, setCfTrend] = useState([]);

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
    await fetchCashFlow(cfFrom, cfTo);
    await fetchCashFlowTrend();
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
    if (!requireJournalCreate()) return;
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
      const res = await api.post("/accounting/journals", {
        refType: "MANUAL",
        narration: journalForm.narration || "",
        costCenterId: journalForm.costCenterId ? Number(journalForm.costCenterId) : null,
        lines,
      });
      if (res.data?.requiresApproval) {
        notifyActionRequired(`Journal submitted for approval (#${res.data.approvalId}).`);
        return;
      }
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

  const exportProfitLoss = async (format) => {
    const params = new URLSearchParams();
    if (plFrom) params.set("from", plFrom);
    if (plTo) params.set("to", plTo);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const endpoint =
      format === "csv"
        ? `/accounting/reports/profit-loss/export.csv${suffix}`
        : `/accounting/reports/profit-loss/export.pdf${suffix}`;
    const filename =
      format === "csv" ? "profit-loss-statement.csv" : "profit-loss-statement.pdf";
    const res = await api.get(endpoint, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const fetchCashFlow = async (from, to) => {
    setCfLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get("/accounting/reports/cash-flow", {
        params: Object.keys(params).length ? params : undefined,
      });
      setCf({
        openingCash: Number(res.data?.openingCash || 0),
        operating: Number(res.data?.operating || 0),
        investing: Number(res.data?.investing || 0),
        financing: Number(res.data?.financing || 0),
        netIncrease: Number(res.data?.netIncrease || 0),
        closingCash: Number(res.data?.closingCash || 0),
        period: res.data?.period || null,
      });
    } finally {
      setCfLoading(false);
    }
  };

  const fetchCashFlowTrend = async () => {
    const res = await api.get("/accounting/reports/cash-flow/trend", { params: { months: 12 } });
    setCfTrend(Array.isArray(res.data?.rows) ? res.data.rows : []);
  };

  const applyCfRange = () => fetchCashFlow(cfFrom, cfTo);

  const setThisMonthCf = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const f = start.toISOString().slice(0, 10);
    const t = end.toISOString().slice(0, 10);
    setCfFrom(f);
    setCfTo(t);
    fetchCashFlow(f, t);
  };

  const clearCfRange = () => {
    setCfFrom("");
    setCfTo("");
    fetchCashFlow("", "");
  };

  const exportCashFlow = async (format) => {
    const params = new URLSearchParams();
    if (cfFrom) params.set("from", cfFrom);
    if (cfTo) params.set("to", cfTo);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const endpoint =
      format === "csv"
        ? `/accounting/reports/cash-flow/export.csv${suffix}`
        : `/accounting/reports/cash-flow/export.pdf${suffix}`;
    const filename = format === "csv" ? "cash-flow-statement.csv" : "cash-flow-statement.pdf";
    const res = await api.get(endpoint, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
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

  const cfPeriodLabel = useMemo(() => {
    if (!cf.period?.from && !cf.period?.to) return tt("accPeriodAllTime");
    const fmt = (iso) => {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleDateString();
      } catch {
        return iso;
      }
    };
    if (cf.period?.from && cf.period?.to) return `${fmt(cf.period.from)} → ${fmt(cf.period.to)}`;
    if (cf.period?.from) return tt("accPeriodFrom", { date: fmt(cf.period.from) });
    return tt("accPeriodUntil", { date: fmt(cf.period?.to) });
  }, [cf.period, tt]);

  const cfTrendMax = useMemo(() => {
    const maxVal = Math.max(...cfTrend.map((x) => Math.abs(Number(x.netIncrease || 0))), 0);
    return maxVal > 0 ? maxVal : 1;
  }, [cfTrend]);

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
                <button type="button" className="btn-secondary btn-sm" onClick={() => exportProfitLoss("csv")}>
                  {tt("accExportPlCsv")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => exportProfitLoss("pdf")}>
                  {tt("accExportPlPdf")}
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

            <DataTable
              title={tt("accPlStatementTitle")}
              rows={[
                { line: tt("accRevenue"), amount: pl.revenue },
                { line: tt("accCogs"), amount: -Math.abs(pl.cogs) },
                { line: tt("accGrossProfit"), amount: pl.grossProfit },
                { line: tt("accOperatingOther"), amount: -Math.abs(pl.operatingExpense) },
                { line: tt("accTotalExpense"), amount: -Math.abs(pl.totalExpense) },
                { line: tt("accNetProfit"), amount: pl.netProfit },
              ]}
              searchableKeys={["line"]}
              columns={[
                { key: "line", label: tt("accStatementLine") },
                { key: "amount", label: tt("accStatementAmount"), render: (v) => bdt(v) },
              ]}
            />

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
              {tt("accCashFlow")}
            </h3>
            <div className="accounting-toolbar">
              <div className="accounting-toolbar__dates">
                <label>
                  {tt("accFrom")}
                  <input type="date" value={cfFrom} onChange={(e) => setCfFrom(e.target.value)} />
                </label>
                <label>
                  {tt("accTo")}
                  <input type="date" value={cfTo} onChange={(e) => setCfTo(e.target.value)} />
                </label>
              </div>
              <div className="accounting-toolbar__actions">
                <button type="button" className="btn-secondary btn-sm" onClick={applyCfRange}>
                  {tt("accApplyRange")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={setThisMonthCf}>
                  {tt("accThisMonth")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={clearCfRange}>
                  {tt("accAllTime")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => exportCashFlow("csv")}>
                  {tt("accExportCfCsv")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => exportCashFlow("pdf")}>
                  {tt("accExportCfPdf")}
                </button>
              </div>
            </div>
            <div className={`accounting-period-pill ${cfLoading ? "is-loading" : ""}`}>
              <span style={{ fontWeight: 600, color: "var(--text-soft)" }}>{tt("accPeriod")}</span>
              <span>{cfPeriodLabel}</span>
              {cfLoading ? <span>{tt("dashUpdating")}</span> : null}
            </div>
            <div className="accounting-kpi-grid" style={{ marginBottom: 16 }}>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfOpeningCash")}</span>
                <span className="accounting-kpi__value">{bdt(cf.openingCash)}</span>
              </article>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfOperating")}</span>
                <span className="accounting-kpi__value">{bdt(cf.operating)}</span>
              </article>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfInvesting")}</span>
                <span className="accounting-kpi__value">{bdt(cf.investing)}</span>
              </article>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfFinancing")}</span>
                <span className="accounting-kpi__value">{bdt(cf.financing)}</span>
              </article>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfNetChange")}</span>
                <span className="accounting-kpi__value">{bdt(cf.netIncrease)}</span>
              </article>
              <article className="accounting-kpi">
                <span className="accounting-kpi__label">{tt("accCfClosingCash")}</span>
                <span className="accounting-kpi__value">{bdt(cf.closingCash)}</span>
              </article>
            </div>
            <DataTable
              title={tt("accCfStatementTitle")}
              rows={[
                { line: tt("accCfOpeningCash"), amount: cf.openingCash },
                { line: tt("accCfOperating"), amount: cf.operating },
                { line: tt("accCfInvesting"), amount: cf.investing },
                { line: tt("accCfFinancing"), amount: cf.financing },
                { line: tt("accCfNetChange"), amount: cf.netIncrease },
                { line: tt("accCfClosingCash"), amount: cf.closingCash },
              ]}
              searchableKeys={["line"]}
              columns={[
                { key: "line", label: tt("accStatementLine") },
                { key: "amount", label: tt("accStatementAmount"), render: (v) => bdt(v) },
              ]}
            />
            <h3 className="accounting-panel__title" style={{ fontSize: 14, marginBottom: 12 }}>
              {tt("accCfTrendTitle")}
            </h3>
            <div className="page-card" style={{ marginBottom: 20 }}>
              {!cfTrend.length ? (
                <div className="text-muted">{tt("accCfNoTrendData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {cfTrend.map((row) => {
                    const net = Number(row.netIncrease || 0);
                    const widthPct = Math.max(3, Math.round((Math.abs(net) / cfTrendMax) * 100));
                    const positive = net >= 0;
                    return (
                      <div
                        key={row.periodKey}
                        style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px", alignItems: "center", gap: 10 }}
                      >
                        <div style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>{row.periodKey}</div>
                        <div style={{ background: "#e2e8f0", borderRadius: 999, height: 10, overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${widthPct}%`,
                              height: "100%",
                              background: positive ? "#16a34a" : "#dc2626",
                            }}
                          />
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 600, color: positive ? "#166534" : "#991b1b" }}>
                          {bdt(net)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
          <PermissionBanner show={!canPostJournal} code="accounting.journal.create" tt={tt} />
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
                <SearchSelect
                  className="form-select-sm"
                  value={journalForm.costCenterId}
                  onChange={(val) => setJournalForm((p) => ({ ...p, costCenterId: val }))}
                  placeholder={tt("accNone")}
                  options={costCenters.map((cc) => ({
                    value: String(cc.id),
                    label: `${cc.code} — ${cc.name}`,
                  }))}
                />
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
                          <SearchSelect
                            className="form-select-sm"
                            value={line.accountId}
                            onChange={(val) => updateLine(idx, "accountId", val)}
                            placeholder={tt("accSelectAccount")}
                            options={accounts.map((a) => ({
                              value: String(a.id),
                              label: `${a.code} — ${a.name}`,
                            }))}
                          />
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
                  <button type="submit" disabled={posting || !canPostJournal}>
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
