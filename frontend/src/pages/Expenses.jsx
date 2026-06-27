import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { getLang, t } from "../i18n";
import SearchSelect from "../components/SearchSelect";

function Expenses() {
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
  const canManageExpenses = hasPermission("expense.create");

  const requireExpenseCreate = () => {
    if (canManageExpenses) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "expense.create" }));
    return false;
  };

  const [costCenters, setCostCenters] = useState([]);
  const [form, setForm] = useState({
    category: "",
    description: "",
    amount: "",
    paymentMethod: "Cash",
    costCenterId: "",
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const branchIdForFiscal = typeof window !== "undefined" ? localStorage.getItem("bd_pos_branch_id") || "1" : "1";
  const { data: fiscalGateData } = useQuery({
    queryKey: ["fiscal-gate", branchIdForFiscal],
    queryFn: async () => (await api.get("/fiscal/fiscal-period-status")).data,
    staleTime: 45_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const fiscalBlocked = Boolean(fiscalGateData && fiscalGateData.ok === false);

  const fetchExpensePage = useCallback(async (q) => {
    const res = await api.get("/expenses", {
      params: {
        paged: true,
        page: q.page,
        pageSize: q.pageSize,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
        search: JSON.stringify(q.search || {}),
        filters: JSON.stringify(q.filters || {}),
      },
    });
    return { data: res.data?.data || [], total: res.data?.total || 0 };
  }, []);
  const expensesTable = useServerTable(fetchExpensePage, {
    pageSize: 10,
    sortKey: "expenseDate",
    sortDir: "desc",
  });
  const rows = expensesTable.rows;
  const load = expensesTable.refresh;

  useEffect(() => {
    api.get("/cost-centers", { params: { active: 1 } }).then((ccRes) => {
      setCostCenters(Array.isArray(ccRes.data) ? ccRes.data : []);
    });
  }, []);

  const resetForm = () => {
    setForm({
      category: "",
      description: "",
      amount: "",
      paymentMethod: "Cash",
      costCenterId: "",
      expenseDate: new Date().toISOString().slice(0, 10),
    });
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!requireExpenseCreate()) return;
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posFiscalNoPeriod"));
      return;
    }
    const payload = {
      category: form.category,
      description: form.description || null,
      amount: Number(form.amount),
      paymentMethod: form.paymentMethod,
      costCenterId: form.costCenterId ? Number(form.costCenterId) : null,
      expenseDate: form.expenseDate,
    };
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/expenses/${editingId}`, payload);
        notifySuccess(tt("expUpdated"));
      } else {
        await api.post("/expenses", payload);
        notifySuccess(tt("expRecorded"));
      }
      resetForm();
      setSelected(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      category: row.category || "",
      description: row.description || "",
      amount: row.amount ?? "",
      paymentMethod: row.paymentMethod || "Cash",
      costCenterId: row.costCenterId ? String(row.costCenterId) : "",
      expenseDate: new Date(row.expenseDate).toISOString().slice(0, 10),
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/expenses/${row.id}`);
    setSelected(res.data);
  };

  const handleDelete = async (row) => {
    if (!requireExpenseCreate()) return;
    if (!window.confirm(tt("expConfirmDelete", { id: row.id }))) return;
    await api.delete(`/expenses/${row.id}`);
    if (editingId === row.id) resetForm();
    if (selected?.id === row.id) setSelected(null);
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Expenses</div>
          <div className="page-title">{tt("expenses")}</div>
          <div className="page-subtitle">{tt("expSubtitle")}</div>
        </div>
      </div>
      {fiscalBlocked ? (
        <div className="page-card fiscal-banner">
          <strong>{tt("expFiscalBlockedTitle")}</strong>
          <p>{fiscalGateData?.message || tt("posFiscalNoPeriod")}</p>
        </div>
      ) : null}
      <PermissionBanner show={!canManageExpenses} code="expense.create" tt={tt} />
      <form onSubmit={submit} className="form-grid">
        <input
          placeholder={tt("expPhCategory")}
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder={tt("receiptAmount")}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required
        />
        <SearchSelect
          className="form-select-sm"
          value={form.paymentMethod}
          onChange={(val) => setForm({ ...form, paymentMethod: val || "Cash" })}
          options={[
            { value: "Cash", label: tt("dashMethodCash") },
            { value: "Bank", label: tt("expMethodBank") },
            { value: "bKash", label: "bKash" },
            { value: "Nagad", label: "Nagad" },
            { value: "Card", label: tt("dashMethodCard") },
          ]}
          isClearable={false}
        />
        <input
          type="date"
          value={form.expenseDate}
          onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
        />
        <SearchSelect
          className="form-select-sm"
          value={form.costCenterId}
          onChange={(val) => setForm({ ...form, costCenterId: val })}
          placeholder={tt("expPhCostCenterOptional")}
          options={costCenters.map((cc) => ({ value: cc.id, label: `${cc.code} - ${cc.name}` }))}
        />
        <input
          placeholder={tt("expPhDescriptionOptional")}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <SubmitButton loading={submitting} loadingLabel={editingId ? tt("settingsUpdating") : tt("settingsSaving")} disabled={!canManageExpenses || fiscalBlocked}>
          {editingId ? tt("expBtnUpdate") : tt("expBtnAdd")}
        </SubmitButton>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={resetForm}>
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>

      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>{tt("expDetailsTitle")}</h4>
          <p><strong>{tt("colId")}:</strong> {selected.id}</p>
          <p><strong>{tt("expCategory")}:</strong> {selected.category}</p>
          <p><strong>{tt("receiptAmount")}:</strong> ৳{Number(selected.amount || 0).toFixed(2)}</p>
          <p><strong>{tt("expPaymentMethod")}:</strong> {selected.paymentMethod}</p>
          <p>
            <strong>{tt("expCostCenter")}:</strong>{" "}
            {selected.costCenter ? `${selected.costCenter.code} - ${selected.costCenter.name}` : "-"}
          </p>
          <p><strong>{tt("receiptDate")}:</strong> {new Date(selected.expenseDate).toLocaleDateString()}</p>
          <p><strong>{tt("expDescription")}:</strong> {selected.description || "-"}</p>
          <p><strong>{tt("expCreatedBy")}:</strong> {selected.creator?.name || selected.creator?.email || "-"}</p>
        </div>
      ) : null}

      <DataTable
        title={tt("expListTitle")}
        serverMode
        totalRows={expensesTable.total}
        loading={expensesTable.loading}
        onQueryChange={expensesTable.onQueryChange}
        initialSort="expenseDate"
        initialSortDir="desc"
        pageSize={10}
        rows={rows.map((r) => ({
          ...r,
          expenseDateLabel: new Date(r.expenseDate).toLocaleDateString(),
          createdByName: r.creator?.name || r.creator?.email || "-",
          costCenterLabel: r.costCenter ? `${r.costCenter.code} - ${r.costCenter.name}` : "-",
        }))}
        filters={[
          {
            key: "paymentMethod",
            label: tt("expPaymentMethod"),
            options: [
              { value: "Cash", label: tt("dashMethodCash") },
              { value: "Bank", label: tt("expMethodBank") },
              { value: "bKash", label: "bKash" },
              { value: "Nagad", label: "Nagad" },
              { value: "Card", label: tt("dashMethodCard") },
            ],
          },
        ]}
        columns={[
          { key: "id", label: tt("colId"), searchable: false },
          { key: "expenseDateLabel", label: tt("receiptDate"), searchable: false },
          { key: "category", label: tt("expCategory") },
          { key: "amount", label: tt("receiptAmount"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "paymentMethod", label: tt("expPayment") },
          { key: "costCenterLabel", label: tt("expCostCenter"), searchable: false },
          { key: "createdByName", label: tt("expCreatedBy"), searchable: false },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>{tt("supBtnDetails")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)} disabled={!canManageExpenses}>{tt("actionEdit")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)} disabled={!canManageExpenses}>{tt("actionDelete")}</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Expenses;
