import { useEffect, useState } from "react";
import api from "../services/api";
import { notifySuccess } from "../utils/notify";

const emptyForm = { code: "", name: "", isActive: true };
const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

export default function CostCenters() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetVsActual, setBudgetVsActual] = useState([]);
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
      api.get("/cost-centers/budget-vs-actual", { params: { periodKey } }),
    ]);
    const rowData = Array.isArray(ccRes.data) ? ccRes.data : [];
    setRows(rowData);
    setSummary(Array.isArray(sumRes.data) ? sumRes.data : []);
    setBudgets(Array.isArray(budgetRes.data) ? budgetRes.data : []);
    setBudgetVsActual(Array.isArray(bvaRes.data) ? bvaRes.data : []);
    if (!budgetForm.costCenterId && rowData.length) {
      const firstActive = rowData.find((x) => x.isActive) || rowData[0];
      setBudgetForm((p) => ({ ...p, costCenterId: String(firstActive.id) }));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, periodKey]);

  const create = async (e) => {
    e.preventDefault();
    await api.post("/cost-centers", {
      code: form.code,
      name: form.name,
      isActive: form.isActive,
    });
    setForm(emptyForm);
    notifySuccess("cost center created.");
    load();
  };

  const toggleActive = async (row) => {
    await api.patch(`/cost-centers/${row.id}`, {
      isActive: !row.isActive,
    });
    notifySuccess("cost center updated.");
    load();
  };

  const saveBudget = async (e) => {
    e.preventDefault();
    await api.post("/cost-centers/budgets", {
      costCenterId: Number(budgetForm.costCenterId),
      periodKey,
      expenseBudget: Number(budgetForm.expenseBudget || 0),
      revenueBudget: Number(budgetForm.revenueBudget || 0),
      note: budgetForm.note || null,
    });
    notifySuccess("budget saved.");
    setBudgetForm((p) => ({ ...p, expenseBudget: "", revenueBudget: "", note: "" }));
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Cost Centers</h2>
      <p className="text-muted">Create departments/projects and analyze tagged journals by cost center.</p>

      <form onSubmit={create} className="form-grid" style={{ marginBottom: 14 }}>
        <label>
          Code
          <input required value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
        </label>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(form.isActive)}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
          />
          Active
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit">Create Cost Center</button>
        </div>
      </form>

      <h3>Master</h3>
      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.isActive ? "Active" : "Inactive"}</td>
              <td>
                <button type="button" className="btn-secondary btn-sm" onClick={() => toggleActive(r)}>
                  {r.isActive ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8" }}>
                No cost centers found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <h3>Cost Center Financial Summary</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Lines</th>
            <th>Total Debit</th>
            <th>Total Credit</th>
            <th>Expense (net)</th>
            <th>Revenue (net)</th>
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
                No tagged journal data found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <hr style={{ margin: "20px 0" }} />
      <h3>Monthly Budget vs Actual</h3>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          Period
          <input type="month" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
        </label>
      </div>
      <form onSubmit={saveBudget} className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Cost Center
          <select
            required
            value={budgetForm.costCenterId}
            onChange={(e) => setBudgetForm((p) => ({ ...p, costCenterId: e.target.value }))}
          >
            <option value="">Select</option>
            {rows
              .filter((r) => r.isActive)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} - {r.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Expense Budget
          <input
            type="number"
            min="0"
            step="0.01"
            value={budgetForm.expenseBudget}
            onChange={(e) => setBudgetForm((p) => ({ ...p, expenseBudget: e.target.value }))}
          />
        </label>
        <label>
          Revenue Budget
          <input
            type="number"
            min="0"
            step="0.01"
            value={budgetForm.revenueBudget}
            onChange={(e) => setBudgetForm((p) => ({ ...p, revenueBudget: e.target.value }))}
          />
        </label>
        <label>
          Note
          <input value={budgetForm.note} onChange={(e) => setBudgetForm((p) => ({ ...p, note: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit">Save Budget</button>
        </div>
      </form>

      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Cost Center</th>
            <th>Period</th>
            <th>Expense Budget</th>
            <th>Revenue Budget</th>
            <th>Note</th>
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
                No budgets set for this period.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Expense Budget</th>
            <th>Expense Actual</th>
            <th>Expense Variance</th>
            <th>Revenue Budget</th>
            <th>Revenue Actual</th>
            <th>Revenue Variance</th>
          </tr>
        </thead>
        <tbody>
          {budgetVsActual.map((r) => (
            <tr key={`${r.costCenterId}-${r.periodKey}`}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{Number(r.expenseBudget || 0).toFixed(2)}</td>
              <td>{Number(r.expenseActual || 0).toFixed(2)}</td>
              <td style={{ color: Number(r.expenseVariance || 0) > 0 ? "#dc2626" : "#15803d" }}>
                {Number(r.expenseVariance || 0).toFixed(2)}
              </td>
              <td>{Number(r.revenueBudget || 0).toFixed(2)}</td>
              <td>{Number(r.revenueActual || 0).toFixed(2)}</td>
              <td style={{ color: Number(r.revenueVariance || 0) >= 0 ? "#15803d" : "#dc2626" }}>
                {Number(r.revenueVariance || 0).toFixed(2)}
              </td>
            </tr>
          ))}
          {!budgetVsActual.length ? (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", color: "#94a3b8" }}>
                No comparison rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
