import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import SearchSelect from "../components/SearchSelect";
import { formatBDT } from "../utils/currency";
import { notifyError, notifyPermissionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";

const bdt = (v) => formatBDT(v, { lang: getLang(), decimals: 2 });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function previewSchedule({ principalAmount, downPayment, interestRate, installmentCount, frequency, startDate }) {
  const principal = Math.max(0, Number(principalAmount || 0));
  const down = Math.max(0, Number(downPayment || 0));
  const count = Math.max(1, Math.floor(Number(installmentCount || 0)));
  const rate = Math.max(0, Number(interestRate || 0));
  const financed = round2(principal - down);
  if (!(financed > 0) || !(count >= 1)) return null;
  const interest = round2((financed * rate) / 100);
  const totalPayable = round2(financed + interest);
  const base = round2(totalPayable / count);
  const start = startDate ? new Date(startDate) : new Date();
  const rows = [];
  let allocated = 0;
  for (let i = 0; i < count; i += 1) {
    const isLast = i === count - 1;
    const amount = isLast ? round2(totalPayable - allocated) : base;
    allocated = round2(allocated + amount);
    const due = new Date(start);
    if (frequency === "WEEKLY") due.setDate(due.getDate() + 7 * i);
    else due.setMonth(due.getMonth() + i);
    rows.push({ seqNo: i + 1, dueDate: due, amountDue: amount });
  }
  return { financed, interest, totalPayable, rows };
}

const EMPTY_FORM = {
  customerId: "",
  principalAmount: "",
  downPayment: "",
  interestRate: "",
  installmentCount: "3",
  frequency: "MONTHLY",
  startDate: new Date().toISOString().slice(0, 10),
  reference: "",
  note: "",
};

function Installments() {
  const tt = useMemo(() => (key, params) => t(getLang(), key, params), []);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("customer.view");
  const canManage = hasPermission("customer.create");

  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [dueRows, setDueRows] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selected, setSelected] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);

  const requireManage = () => {
    if (canManage) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "customer.create" }));
    return false;
  };

  const loadCustomers = async () => {
    try {
      const res = await api.get("/master/customers", { params: { page: 1, pageSize: 500 } });
      const rows = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  };

  const loadPlans = async () => {
    const [plansRes, dueRes] = await Promise.all([
      api.get("/installments"),
      api.get("/installments/due", { params: { withinDays: 7 } }),
    ]);
    setPlans(plansRes.data || []);
    setDueRows(dueRes.data || []);
  };

  useEffect(() => {
    if (!canView) return;
    loadCustomers();
    loadPlans().catch(() => {});
  }, [canView]);

  const refreshSelected = async (id) => {
    try {
      const res = await api.get(`/installments/${id}`);
      setSelected(res.data);
    } catch {
      setSelected(null);
    }
  };

  const schedulePreview = useMemo(() => previewSchedule(form), [form]);

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!requireManage()) return;
    if (!form.customerId) {
      notifyError(tt("instSelectCustomer"));
      return;
    }
    setCreating(true);
    try {
      const res = await api.post("/installments", {
        customerId: Number(form.customerId),
        principalAmount: Number(form.principalAmount || 0),
        downPayment: Number(form.downPayment || 0),
        interestRate: Number(form.interestRate || 0),
        installmentCount: Number(form.installmentCount || 1),
        frequency: form.frequency,
        startDate: form.startDate,
        reference: form.reference || null,
        note: form.note || null,
      });
      notifySuccess(tt("instPlanCreated"));
      setForm({ ...EMPTY_FORM });
      setSelected(res.data);
      await loadPlans();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("instPlanCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!requireManage() || !selected) return;
    const amount = Number(payAmount);
    if (!(amount > 0)) {
      notifyError(tt("instEnterAmount"));
      return;
    }
    setPaying(true);
    try {
      const res = await api.post(`/installments/${selected.id}/pay`, { amount, method: payMethod });
      setSelected(res.data);
      setPayAmount("");
      notifySuccess(tt("instPaymentRecorded"));
      await loadPlans();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("instPaymentFailed"));
    } finally {
      setPaying(false);
    }
  };

  const cancelPlan = async () => {
    if (!requireManage() || !selected) return;
    if (!window.confirm(tt("instCancelConfirm"))) return;
    try {
      await api.post(`/installments/${selected.id}/cancel`);
      notifySuccess(tt("instPlanCancelled"));
      await refreshSelected(selected.id);
      await loadPlans();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("instCancelFailed"));
    }
  };

  const sendReminders = async () => {
    if (!requireManage()) return;
    if (!window.confirm(tt("instReminderConfirm", { n: dueRows.length }))) return;
    setSendingReminders(true);
    try {
      const res = await api.post("/installments/reminders", { withinDays: 7 });
      const s = res.data?.summary || {};
      notifySuccess(
        `${String(res.data?.message || "").includes("simulated") ? tt("instReminderDoneSimulated") : tt("instReminderDone")} · ${tt(
          "instReminderResult",
          { sent: s.sent || 0, simulated: s.simulated || 0, failed: s.failed || 0 }
        )}`
      );
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("instReminderFailed"));
    } finally {
      setSendingReminders(false);
    }
  };

  const statusLabel = (status) => {
    const key = {
      ACTIVE: "instStatusActive",
      COMPLETED: "instStatusCompleted",
      CANCELLED: "instStatusCancelled",
      PENDING: "instStatusPending",
      PARTIAL: "instStatusPartial",
      PAID: "instStatusPaid",
      OVERDUE: "instStatusOverdue",
    }[status];
    return key ? tt(key) : status;
  };

  if (!canView) {
    return (
      <div className="page-stack">
        <PermissionBanner show code="customer.view" tt={tt} />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("instPageTitle")}</div>
          <div className="page-subtitle">{tt("instPageSubtitle")}</div>
        </div>
      </div>

      {!canManage ? <PermissionBanner show code="customer.create" tt={tt} /> : null}

      {dueRows.length ? (
        <div className="page-card" style={{ padding: 12, background: "#fffbeb" }}>
          <strong>{tt("instDueSmsTitle")}</strong>
          <p className="text-muted" style={{ margin: "6px 0 8px", fontSize: 13 }}>
            {tt("instDueSmsHelp", {
              count: dueRows.length,
              total: bdt(dueRows.reduce((sum, r) => sum + Number(r.remaining || 0), 0)),
            })}
          </p>
          <button type="button" className="btn-secondary" disabled={sendingReminders || !canManage} onClick={sendReminders}>
            {sendingReminders ? tt("instReminderSending") : tt("instReminderSend")}
          </button>
        </div>
      ) : null}

      <div className="page-card">
        <h4 style={{ marginTop: 0 }}>{tt("instNewPlanTitle")}</h4>
        <form onSubmit={submitCreate} className="form-grid">
          <SearchSelect
            className="form-select-sm"
            value={form.customerId}
            onChange={(val) => setForm({ ...form, customerId: val })}
            placeholder={tt("instSelectCustomer")}
            options={customers.map((c) => ({
              value: String(c.id),
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}`,
            }))}
          />
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder={tt("instPhPrincipal")}
            value={form.principalAmount}
            onChange={(e) => setForm({ ...form, principalAmount: e.target.value })}
            required
          />
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder={tt("instPhDownPayment")}
            value={form.downPayment}
            onChange={(e) => setForm({ ...form, downPayment: e.target.value })}
          />
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder={tt("instPhInterest")}
            value={form.interestRate}
            onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
          />
          <input
            type="number"
            min={1}
            max={120}
            placeholder={tt("instPhCount")}
            value={form.installmentCount}
            onChange={(e) => setForm({ ...form, installmentCount: e.target.value })}
            required
          />
          <SearchSelect
            className="form-select-sm"
            value={form.frequency}
            onChange={(val) => setForm({ ...form, frequency: val || "MONTHLY" })}
            options={[
              { value: "MONTHLY", label: tt("instFreqMonthly") },
              { value: "WEEKLY", label: tt("instFreqWeekly") },
            ]}
            isClearable={false}
          />
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            required
          />
          <input
            placeholder={tt("instPhReference")}
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
          <input
            placeholder={tt("instPhNote")}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <SubmitButton loading={creating} loadingLabel={tt("instCreating")} disabled={!canManage}>
            {tt("instCreatePlan")}
          </SubmitButton>
        </form>

        {schedulePreview ? (
          <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#f1f5f9" }}>
            <div className="quick-stats">
              <div className="stat">{tt("instLblFinanced")}: {bdt(schedulePreview.financed)}</div>
              <div className="stat">{tt("instLblInterest")}: {bdt(schedulePreview.interest)}</div>
              <div className="stat" style={{ background: "#dcfce7" }}>
                {tt("instLblTotalPayable")}: {bdt(schedulePreview.totalPayable)}
              </div>
              <div className="stat">
                {tt("instLblPerInstallment")}: {bdt(schedulePreview.rows[0]?.amountDue || 0)} × {schedulePreview.rows.length}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <DataTable
        title={tt("instPlansTitle")}
        rows={plans.map((p) => ({
          ...p,
          customerName: p.customer?.name || "-",
          startDateLabel: new Date(p.startDate).toLocaleDateString("en-GB"),
          statusLabel: statusLabel(p.status),
          nextDueLabel: p.nextDueDate ? new Date(p.nextDueDate).toLocaleDateString("en-GB") : "—",
        }))}
        searchableKeys={["customerName", "reference", "statusLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "customerName", label: tt("instColCustomer") },
          { key: "reference", label: tt("instColReference"), render: (v) => v || "—" },
          { key: "totalPayable", label: tt("instColTotal"), render: (v) => bdt(v) },
          { key: "paidAmount", label: tt("instColPaid"), render: (v) => bdt(v) },
          { key: "outstanding", label: tt("instColOutstanding"), render: (v) => bdt(v) },
          {
            key: "overdueAmount",
            label: tt("instColOverdue"),
            render: (v) => (Number(v) > 0 ? <span style={{ color: "#b42318" }}>{bdt(v)}</span> : "—"),
          },
          { key: "nextDueLabel", label: tt("instColNextDue") },
          { key: "statusLabel", label: tt("instColStatus") },
          {
            key: "actions",
            label: "",
            searchable: false,
            render: (_v, row) => (
              <button type="button" className="btn-secondary btn-sm" onClick={() => refreshSelected(row.id)}>
                {tt("instViewDetails")}
              </button>
            ),
          },
        ]}
      />

      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>
            {tt("instPlanDetailTitle", { id: selected.id })} — {selected.customer?.name || ""}
          </h4>
          <div className="quick-stats" style={{ marginBottom: 8 }}>
            <div className="stat">{tt("instLblTotalPayable")}: {bdt(selected.totalPayable)}</div>
            <div className="stat">{tt("instColPaid")}: {bdt(selected.paidAmount)}</div>
            <div className="stat" style={{ background: "#fee2e2" }}>{tt("instColOutstanding")}: {bdt(selected.outstanding)}</div>
            <div className="stat">{tt("instColStatus")}: {statusLabel(selected.status)}</div>
          </div>

          <DataTable
            rows={(selected.payments || []).map((p) => ({
              ...p,
              dueLabel: new Date(p.dueDate).toLocaleDateString("en-GB"),
              statusLabel: statusLabel(p.displayStatus),
            }))}
            rowKey="id"
            columns={[
              { key: "seqNo", label: "#" },
              { key: "dueLabel", label: tt("instColDueDate") },
              { key: "amountDue", label: tt("instColDue"), render: (v) => bdt(v) },
              { key: "amountPaid", label: tt("instColPaid"), render: (v) => bdt(v) },
              { key: "remaining", label: tt("instColRemaining"), render: (v) => bdt(v) },
              {
                key: "statusLabel",
                label: tt("instColStatus"),
                render: (v, row) =>
                  row.displayStatus === "OVERDUE" ? <span style={{ color: "#b42318" }}>{v}</span> : v,
              },
            ]}
          />

          {selected.status === "ACTIVE" ? (
            <form onSubmit={submitPayment} className="form-grid" style={{ marginTop: 12 }}>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder={tt("instPhPayAmount")}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
              <SearchSelect
                className="form-select-sm"
                value={payMethod}
                onChange={(val) => setPayMethod(val || "Cash")}
                options={[
                  { value: "Cash", label: "Cash" },
                  { value: "Bank", label: "Bank" },
                  { value: "bKash", label: "bKash" },
                  { value: "Nagad", label: "Nagad" },
                  { value: "Rocket", label: "Rocket" },
                  { value: "Card", label: "Card" },
                ]}
                isClearable={false}
              />
              <SubmitButton loading={paying} loadingLabel={tt("instRecording")} disabled={!canManage}>
                {tt("instRecordPayment")}
              </SubmitButton>
              <button type="button" className="btn-secondary" disabled={!canManage} onClick={cancelPlan}>
                {tt("instCancelPlan")}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default Installments;
