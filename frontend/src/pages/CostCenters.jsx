import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { getLang, t } from "../i18n";
import SearchSelect from "../components/SearchSelect";

const emptyForm = { code: "", name: "", isActive: true };
const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

export default function CostCenters() {
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
  const canManageCostCenters = hasPermission("costcenter.manage");

  const requireCostCenterManage = () => {
    if (canManageCostCenters) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "costcenter.manage" }));
    return false;
  };

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetVsActual, setBudgetVsActual] = useState([]);
  const [budgetAlertSummary, setBudgetAlertSummary] = useState({
    totalAlertedCostCenters: 0,
    expenseAlerts: 0,
    revenueAlerts: 0,
  });
  const [alertThresholdPct, setAlertThresholdPct] = useState(10);
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [periodKey, setPeriodKey] = useState(thisMonth);
  const [budgetForm, setBudgetForm] = useState({
    costCenterId: "",
    expenseBudget: "",
    revenueBudget: "",
    note: "",
  });

  const load = async () => {
    const [ccRes, sumRes, budgetRes, bvaRes] = await Promise.all([
      api.get("/cost-centers"),
      api.get("/cost-centers/summary/report", {
        params: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      }),
      api.get("/cost-centers/budgets", { params: { periodKey } }),
      api.get("/cost-centers/budget-vs-actual", {
        params: { periodKey, thresholdPct: alertThresholdPct },
      }),
    ]);
    const rowData = Array.isArray(ccRes.data) ? ccRes.data : [];
    setRows(rowData);
    setSummary(Array.isArray(sumRes.data) ? sumRes.data : []);
    setBudgets(Array.isArray(budgetRes.data) ? budgetRes.data : []);
    const bvaPayload = bvaRes?.data;
    if (Array.isArray(bvaPayload)) {
      setBudgetVsActual(bvaPayload);
      setBudgetAlertSummary({
        totalAlertedCostCenters: 0,
        expenseAlerts: 0,
        revenueAlerts: 0,
      });
    } else {
      setBudgetVsActual(Array.isArray(bvaPayload?.rows) ? bvaPayload.rows : []);
      setBudgetAlertSummary({
        totalAlertedCostCenters: Number(bvaPayload?.summary?.totalAlertedCostCenters || 0),
        expenseAlerts: Number(bvaPayload?.summary?.expenseAlerts || 0),
        revenueAlerts: Number(bvaPayload?.summary?.revenueAlerts || 0),
      });
    }
    if (!budgetForm.costCenterId && rowData.length) {
      const firstActive = rowData.find((x) => x.isActive) || rowData[0];
      setBudgetForm((p) => ({ ...p, costCenterId: String(firstActive.id) }));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, periodKey, alertThresholdPct]);

  const create = async (e) => {
    e.preventDefault();
    if (!requireCostCenterManage()) return;
    await api.post("/cost-centers", {
      code: form.code,
      name: form.name,
      isActive: form.isActive,
    });
    setForm(emptyForm);
    notifySuccess(tt("ccNotifyCreated"));
    load();
  };

  const toggleActive = async (row) => {
    if (!requireCostCenterManage()) return;
    await api.patch(`/cost-centers/${row.id}`, {
      isActive: !row.isActive,
    });
    notifySuccess(tt("ccNotifyUpdated"));
    load();
  };

  const saveBudget = async (e) => {
    e.preventDefault();
    if (!requireCostCenterManage()) return;
    await api.post("/cost-centers/budgets", {
      costCenterId: Number(budgetForm.costCenterId),
      periodKey,
      expenseBudget: Number(budgetForm.expenseBudget || 0),
      revenueBudget: Number(budgetForm.revenueBudget || 0),
      note: budgetForm.note || null,
    });
    notifySuccess(tt("ccNotifyBudgetSaved"));
    setBudgetForm((p) => ({ ...p, expenseBudget: "", revenueBudget: "", note: "" }));
    load();
  };

  const exportBudgetVsActual = async (format) => {
    const params = new URLSearchParams();
    if (periodKey) params.set("periodKey", periodKey);
    if (alertThresholdPct != null && alertThresholdPct !== "") {
      params.set("thresholdPct", String(alertThresholdPct));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const endpoint =
      format === "csv"
        ? `/cost-centers/budget-vs-actual/export.csv${suffix}`
        : `/cost-centers/budget-vs-actual/export.pdf${suffix}`;
    const filename =
      format === "csv"
        ? `cost-center-budget-vs-actual-${periodKey || "all"}.csv`
        : `cost-center-budget-vs-actual-${periodKey || "all"}.pdf`;
    const res = await api.get(endpoint, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const filteredBudgetVsActual = showOnlyAlerts
    ? budgetVsActual.filter((x) => Boolean(x.hasAlert))
    : budgetVsActual;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("costCenters")}</div>
          <div className="page-subtitle">{tt("hintCostCenters")}</div>
        </div>
      </div>

      <PermissionBanner show={!canManageCostCenters} code="costcenter.manage" tt={tt} />

      <form onSubmit={create} className="form-grid" style={{ marginBottom: 14 }}>
        <label>
          {tt("colCode")}
          <input required value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
        </label>
        <label>
          {tt("colName")}
          <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(form.isActive)}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
          />
          {tt("statusActive")}
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManageCostCenters}>{tt("ccCreateCostCenter")}</button>
        </div>
      </form>

      <h3>{tt("ccMaster")}</h3>
      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>{tt("colCode")}</th>
            <th>{tt("colName")}</th>
            <th>{tt("colStatus")}</th>
            <th>{tt("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.isActive ? tt("statusActive") : tt("statusInactive")}</td>
              <td>
                <button type="button" className="btn-secondary btn-sm" disabled={!canManageCostCenters} onClick={() => toggleActive(r)}>
                  {r.isActive ? tt("invDeactivate") : tt("invActivate")}
                </button>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8" }}>
                {tt("ccNoCostCentersFound")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          {tt("accFrom")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {tt("accTo")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <h3>{tt("ccFinancialSummary")}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>{tt("colCode")}</th>
            <th>{tt("colName")}</th>
            <th>{tt("ccLines")}</th>
            <th>{tt("ccTotalDebit")}</th>
            <th>{tt("ccTotalCredit")}</th>
            <th>{tt("ccExpenseNet")}</th>
            <th>{tt("ccRevenueNet")}</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.costCenterId}>
              <td>{s.code}</td>
              <td>{s.name}</td>
              <td>{s.lineCount}</td>
              <td>{Number(s.totalDebit || 0).toFixed(2)}</td>
              <td>{Number(s.totalCredit || 0).toFixed(2)}</td>
              <td>{Number(s.expenseDebit || 0).toFixed(2)}</td>
              <td>{Number(s.revenueCredit || 0).toFixed(2)}</td>
            </tr>
          ))}
          {!summary.length ? (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "#94a3b8" }}>
                {tt("ccNoTaggedJournalData")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <hr style={{ margin: "20px 0" }} />
      <h3>{tt("ccMonthlyBudgetVsActual")}</h3>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          {tt("accPeriod")}
          <input type="month" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
        </label>
        <label>
          {tt("ccAlertThresholdPct")}
          <input
            type="number"
            min="0"
            step="0.1"
            value={alertThresholdPct}
            onChange={(e) => setAlertThresholdPct(Number(e.target.value || 0))}
          />
        </label>
        <label style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <input
            type="checkbox"
            checked={showOnlyAlerts}
            onChange={(e) => setShowOnlyAlerts(e.target.checked)}
          />
          {tt("ccShowOnlyAlerts")}
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={() => exportBudgetVsActual("csv")}>
          {tt("ccExportBudgetVsActualCsv")}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => exportBudgetVsActual("pdf")}>
          {tt("ccExportBudgetVsActualPdf")}
        </button>
      </div>
      <div style={{ marginBottom: 12, color: "#334155", fontWeight: 600 }}>
        {tt("ccAlertedCostCenters")}: {budgetAlertSummary.totalAlertedCostCenters} | {tt("ccExpenseAlerts")}:{" "}
        {budgetAlertSummary.expenseAlerts} | {tt("ccRevenueAlerts")}: {budgetAlertSummary.revenueAlerts}
      </div>
      <form onSubmit={saveBudget} className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          {tt("expCostCenter")}
          <SearchSelect
            className="form-select-sm"
            value={budgetForm.costCenterId}
            onChange={(val) => setBudgetForm((p) => ({ ...p, costCenterId: val }))}
            placeholder={tt("ccSelect")}
            options={rows
              .filter((r) => r.isActive)
              .map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` }))}
          />
        </label>
        <label>
          {tt("ccExpenseBudget")}
          <input
            type="number"
            min="0"
            step="0.01"
            value={budgetForm.expenseBudget}
            onChange={(e) => setBudgetForm((p) => ({ ...p, expenseBudget: e.target.value }))}
          />
        </label>
        <label>
          {tt("ccRevenueBudget")}
          <input
            type="number"
            min="0"
            step="0.01"
            value={budgetForm.revenueBudget}
            onChange={(e) => setBudgetForm((p) => ({ ...p, revenueBudget: e.target.value }))}
          />
        </label>
        <label>
          {tt("accNarration")}
          <input value={budgetForm.note} onChange={(e) => setBudgetForm((p) => ({ ...p, note: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManageCostCenters}>{tt("ccSaveBudget")}</button>
        </div>
      </form>

      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>{tt("expCostCenter")}</th>
            <th>{tt("accPeriod")}</th>
            <th>{tt("ccExpenseBudget")}</th>
            <th>{tt("ccRevenueBudget")}</th>
            <th>{tt("accNarration")}</th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((b) => (
            <tr key={b.id}>
              <td>
                {b.costCenter?.code} - {b.costCenter?.name}
              </td>
              <td>{b.periodKey}</td>
              <td>{Number(b.expenseBudget || 0).toFixed(2)}</td>
              <td>{Number(b.revenueBudget || 0).toFixed(2)}</td>
              <td>{b.note || "-"}</td>
            </tr>
          ))}
          {!budgets.length ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8" }}>
                {tt("ccNoBudgetsForPeriod")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="data-table">
        <thead>
          <tr>
            <th>{tt("colCode")}</th>
            <th>{tt("colName")}</th>
            <th>{tt("ccExpenseBudget")}</th>
            <th>{tt("ccExpenseActual")}</th>
            <th>{tt("ccExpenseVariance")}</th>
            <th>{tt("ccRevenueBudget")}</th>
            <th>{tt("ccRevenueActual")}</th>
            <th>{tt("ccRevenueVariance")}</th>
          </tr>
        </thead>
        <tbody>
          {filteredBudgetVsActual.map((r) => (
            <tr key={`${r.costCenterId}-${r.periodKey}`}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{Number(r.expenseBudget || 0).toFixed(2)}</td>
              <td>{Number(r.expenseActual || 0).toFixed(2)}</td>
              <td style={{ color: Number(r.expenseVariance || 0) > 0 ? "#dc2626" : "#15803d" }}>
                {Number(r.expenseVariance || 0).toFixed(2)} ({Number(r.expenseVariancePct || 0).toFixed(2)}%)
                {r.expenseAlert ? " ⚠" : ""}
              </td>
              <td>{Number(r.revenueBudget || 0).toFixed(2)}</td>
              <td>{Number(r.revenueActual || 0).toFixed(2)}</td>
              <td style={{ color: Number(r.revenueVariance || 0) >= 0 ? "#15803d" : "#dc2626" }}>
                {Number(r.revenueVariance || 0).toFixed(2)} ({Number(r.revenueVariancePct || 0).toFixed(2)}%)
                {r.revenueAlert ? " ⚠" : ""}
              </td>
            </tr>
          ))}
          {!filteredBudgetVsActual.length ? (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", color: "#94a3b8" }}>
                {tt("ccNoComparisonRows")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
