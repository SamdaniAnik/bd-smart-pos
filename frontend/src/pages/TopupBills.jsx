import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { printEscPosLines, isPrintBridgeConfigured } from "../utils/printBridge";
import {
  MOBILE_OPERATORS,
  UTILITY_BILLERS,
  RECHARGE_TYPES,
  PAY_METHODS,
  MFS_CHANNELS,
  suggestRechargeCommission,
  suggestBillCommission,
} from "../constants/billers";
import SearchSelect from "../components/SearchSelect";

const EMPTY_RECHARGE = {
  operatorOrBiller: "GP",
  rechargeType: "PREPAID",
  accountOrMsisdn: "",
  faceAmount: "",
  commission: "",
  serviceCharge: "",
  payMethod: "Cash",
  payChannel: "",
  notifyPhone: "",
  note: "",
};

const EMPTY_BILL = {
  operatorOrBiller: "DESCO",
  accountOrMsisdn: "",
  faceAmount: "",
  commission: "",
  serviceCharge: "",
  payMethod: "Cash",
  payChannel: "",
  notifyPhone: "",
  note: "",
};

export default function TopupBills() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("topup.create");
  const canManageFloat = hasPermission("topup.manage");

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState({ from: "", to: "", type: "ALL", status: "ALL" });
  const [rechargeForm, setRechargeForm] = useState(EMPTY_RECHARGE);
  const [billForm, setBillForm] = useState(EMPTY_BILL);
  const [floatForm, setFloatForm] = useState({ amount: "", source: "Cash", note: "" });
  const [submittingRecharge, setSubmittingRecharge] = useState(false);
  const [submittingBill, setSubmittingBill] = useState(false);
  const [submittingFloat, setSubmittingFloat] = useState(false);
  const [submittingFilter, setSubmittingFilter] = useState(false);
  const [inquiring, setInquiring] = useState(false);
  const [billInquiry, setBillInquiry] = useState(null);
  const [reversingId, setReversingId] = useState(null);

  const loadSummary = async () => {
    try {
      const res = await api.get("/topup/summary");
      setSummary(res.data || null);
    } catch {
      /* keep prior */
    }
  };

  const loadRows = async (f = filter) => {
    const q = new URLSearchParams();
    if (f?.from) q.set("from", f.from);
    if (f?.to) q.set("to", f.to);
    if (f?.type && f.type !== "ALL") q.set("type", f.type);
    if (f?.status && f.status !== "ALL") q.set("status", f.status);
    const url = q.toString() ? `/topup?${q.toString()}` : "/topup";
    const res = await api.get(url);
    setRows(res.data || []);
  };

  useEffect(() => {
    loadSummary();
    loadRows(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rechargeCommissionHint = useMemo(
    () => suggestRechargeCommission(rechargeForm.operatorOrBiller, rechargeForm.faceAmount),
    [rechargeForm.operatorOrBiller, rechargeForm.faceAmount]
  );
  const billCommissionHint = useMemo(
    () => suggestBillCommission(billForm.operatorOrBiller, billForm.faceAmount),
    [billForm.operatorOrBiller, billForm.faceAmount]
  );

  const printSlip = async (txn) => {
    const lines = [
      "BD SMART POS",
      txn.type === "RECHARGE" ? tt("topupRecharge") : tt("topupBillPay"),
      "--------------------------------",
      `${txn.operatorOrBiller}  ${txn.accountOrMsisdn}`,
      `${tt("topupAmount")}: ${Number(txn.faceAmount || 0).toFixed(2)}`,
      `${tt("topupCommission")}: ${Number(txn.commission || 0).toFixed(2)}`,
      `Ref: ${txn.providerRef || "-"}`,
    ];
    if (txn.token) {
      lines.push("--------------------------------");
      lines.push(`Token: ${txn.token}`);
    }
    lines.push("--------------------------------");
    lines.push(new Date(txn.createdAt || Date.now()).toLocaleString());
    lines.push("");
    const ok = await printEscPosLines(lines);
    if (!ok) notifyActionRequired(tt("topupPrintBridgeMissing"));
  };

  const submitRecharge = async (e) => {
    e.preventDefault();
    if (!canCreate) return;
    const faceAmount = Number(rechargeForm.faceAmount);
    if (!rechargeForm.accountOrMsisdn.trim() || !(faceAmount > 0)) {
      notifyActionRequired(tt("topupNeedNumberAmount"));
      return;
    }
    setSubmittingRecharge(true);
    try {
      const res = await api.post("/topup/recharge", {
        operatorOrBiller: rechargeForm.operatorOrBiller,
        rechargeType: rechargeForm.rechargeType,
        accountOrMsisdn: rechargeForm.accountOrMsisdn.trim(),
        faceAmount,
        commission: rechargeForm.commission !== "" ? Number(rechargeForm.commission) : undefined,
        serviceCharge: rechargeForm.serviceCharge !== "" ? Number(rechargeForm.serviceCharge) : undefined,
        payMethod: rechargeForm.payMethod,
        payChannel: rechargeForm.payMethod === "MFS" ? rechargeForm.payChannel || undefined : undefined,
        notifyPhone: rechargeForm.notifyPhone || undefined,
        note: rechargeForm.note || undefined,
      });
      setRechargeForm(EMPTY_RECHARGE);
      await Promise.all([loadSummary(), loadRows(filter)]);
      notifySuccess(tt("topupRechargeDone"));
      if (res.data?.transaction) printSlip(res.data.transaction);
    } finally {
      setSubmittingRecharge(false);
    }
  };

  const inquireBill = async () => {
    if (!canCreate) return;
    if (!billForm.accountOrMsisdn.trim()) {
      notifyActionRequired(tt("topupNeedAccountAmount"));
      return;
    }
    setInquiring(true);
    setBillInquiry(null);
    try {
      const res = await api.post("/topup/inquiry", {
        operatorOrBiller: billForm.operatorOrBiller,
        accountOrMsisdn: billForm.accountOrMsisdn.trim(),
      });
      setBillInquiry(res.data || null);
      if (res.data?.dueAmount != null) {
        setBillForm((prev) => ({
          ...prev,
          faceAmount: String(res.data.dueAmount),
          commission: res.data.suggestedCommission != null ? String(res.data.suggestedCommission) : prev.commission,
        }));
      }
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("topupInquiryFailed"));
    } finally {
      setInquiring(false);
    }
  };

  const reverseTransaction = async (txn) => {
    if (!canManageFloat) return;
    if (!window.confirm(tt("topupReverseConfirm"))) return;
    const reason = window.prompt(tt("topupReverseReason"), "") || undefined;
    setReversingId(txn.id);
    try {
      await api.post(`/topup/${txn.id}/reverse`, { reason });
      await Promise.all([loadSummary(), loadRows(filter)]);
      notifySuccess(tt("topupReversed"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Reversal failed");
    } finally {
      setReversingId(null);
    }
  };

  const submitBill = async (e) => {
    e.preventDefault();
    if (!canCreate) return;
    const faceAmount = Number(billForm.faceAmount);
    if (!billForm.accountOrMsisdn.trim() || !(faceAmount > 0)) {
      notifyActionRequired(tt("topupNeedAccountAmount"));
      return;
    }
    setSubmittingBill(true);
    try {
      const res = await api.post("/topup/bill-pay", {
        operatorOrBiller: billForm.operatorOrBiller,
        accountOrMsisdn: billForm.accountOrMsisdn.trim(),
        faceAmount,
        commission: billForm.commission !== "" ? Number(billForm.commission) : undefined,
        serviceCharge: billForm.serviceCharge !== "" ? Number(billForm.serviceCharge) : undefined,
        payMethod: billForm.payMethod,
        payChannel: billForm.payMethod === "MFS" ? billForm.payChannel || undefined : undefined,
        notifyPhone: billForm.notifyPhone || undefined,
        note: billForm.note || undefined,
      });
      setBillForm(EMPTY_BILL);
      setBillInquiry(null);
      await Promise.all([loadSummary(), loadRows(filter)]);
      notifySuccess(tt("topupBillDone"));
      if (res.data?.transaction) printSlip(res.data.transaction);
    } finally {
      setSubmittingBill(false);
    }
  };

  const submitFloat = async (e) => {
    e.preventDefault();
    if (!canManageFloat) return;
    const amount = Number(floatForm.amount);
    if (!(amount > 0)) {
      notifyActionRequired(tt("topupNeedAmount"));
      return;
    }
    setSubmittingFloat(true);
    try {
      await api.post("/topup/float-load", {
        amount,
        source: floatForm.source,
        note: floatForm.note || undefined,
      });
      setFloatForm({ amount: "", source: "Cash", note: "" });
      await loadSummary();
      notifySuccess(tt("topupFloatLoaded"));
    } finally {
      setSubmittingFloat(false);
    }
  };

  const applyFilter = async (e) => {
    e.preventDefault();
    setSubmittingFilter(true);
    try {
      await loadRows(filter);
    } finally {
      setSubmittingFilter(false);
    }
  };

  const exportCsv = async () => {
    const q = new URLSearchParams();
    if (filter?.from) q.set("from", filter.from);
    if (filter?.to) q.set("to", filter.to);
    if (filter?.type && filter.type !== "ALL") q.set("type", filter.type);
    if (filter?.status && filter.status !== "ALL") q.set("status", filter.status);
    const url = q.toString() ? `/topup/export.csv?${q.toString()}` : "/topup/export.csv";
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "topup-transactions.csv";
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("topupTitle")}</div>
          <div className="page-subtitle">{tt("topupSubtitle")}</div>
        </div>
        {summary?.provider === "log" ? (
          <span className="branch-pill" title={tt("topupSimulatedBadge")}>
            {tt("topupSimulatedBadge")}
          </span>
        ) : null}
      </div>

      <PermissionBanner show={!canCreate} code="topup.create" tt={tt} />

      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi-card section-card">
          <div className="kpi-label">{tt("topupFloatBalance")}</div>
          <div className="kpi-value">৳{Number(summary?.floatBalance || 0).toFixed(2)}</div>
        </div>
        <div className="kpi-card section-card">
          <div className="kpi-label">{tt("topupTodayCount")}</div>
          <div className="kpi-value">{Number(summary?.today?.count || 0)}</div>
        </div>
        <div className="kpi-card section-card">
          <div className="kpi-label">{tt("topupTodayCommission")}</div>
          <div className="kpi-value">৳{Number(summary?.today?.commissionTotal || 0).toFixed(2)}</div>
        </div>
      </div>

      <div className="split-cards-grid">
        <form onSubmit={submitRecharge} className="form-grid section-card" style={{ marginBottom: 0 }}>
          <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>{tt("topupRecharge")}</h3>
          <label>
            {tt("topupOperator")}
            <SearchSelect
              className="form-select-sm"
              value={rechargeForm.operatorOrBiller}
              onChange={(val) => setRechargeForm({ ...rechargeForm, operatorOrBiller: val || "GP" })}
              options={MOBILE_OPERATORS.map((o) => ({
                value: o.code,
                label: lang === "bn" ? o.nameBn : o.name,
              }))}
              isClearable={false}
            />
          </label>
          <label>
            {tt("topupRechargeType")}
            <SearchSelect
              className="form-select-sm"
              value={rechargeForm.rechargeType}
              onChange={(val) => setRechargeForm({ ...rechargeForm, rechargeType: val || "PREPAID" })}
              options={RECHARGE_TYPES.map((rt) => ({ value: rt, label: rt }))}
              isClearable={false}
            />
          </label>
          <label>
            {tt("topupNumber")}
            <input
              value={rechargeForm.accountOrMsisdn}
              onChange={(e) => setRechargeForm({ ...rechargeForm, accountOrMsisdn: e.target.value })}
              placeholder="01XXXXXXXXX"
              required
            />
          </label>
          <label>
            {tt("topupAmount")}
            <input
              type="number"
              value={rechargeForm.faceAmount}
              onChange={(e) => setRechargeForm({ ...rechargeForm, faceAmount: e.target.value })}
              required
            />
          </label>
          <label>
            {tt("topupCommission")}
            <input
              type="number"
              value={rechargeForm.commission}
              onChange={(e) => setRechargeForm({ ...rechargeForm, commission: e.target.value })}
              placeholder={String(rechargeCommissionHint.toFixed(2))}
            />
          </label>
          <label>
            {tt("topupServiceCharge")}
            <input
              type="number"
              value={rechargeForm.serviceCharge}
              onChange={(e) => setRechargeForm({ ...rechargeForm, serviceCharge: e.target.value })}
            />
          </label>
          <label>
            {tt("topupPayMethod")}
            <SearchSelect
              className="form-select-sm"
              value={rechargeForm.payMethod}
              onChange={(val) => setRechargeForm({ ...rechargeForm, payMethod: val || "Cash" })}
              options={PAY_METHODS.map((m) => ({ value: m, label: m }))}
              isClearable={false}
            />
          </label>
          {rechargeForm.payMethod === "MFS" ? (
            <label>
              {tt("topupPayChannel")}
              <SearchSelect
                className="form-select-sm"
                value={rechargeForm.payChannel}
                onChange={(val) => setRechargeForm({ ...rechargeForm, payChannel: val })}
                placeholder="—"
                options={MFS_CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            </label>
          ) : null}
          <label>
            {tt("topupNote")}
            <input value={rechargeForm.note} onChange={(e) => setRechargeForm({ ...rechargeForm, note: e.target.value })} />
          </label>
          <SubmitButton loading={submittingRecharge} loadingLabel="…" disabled={!canCreate}>
            {tt("topupDoRecharge")}
          </SubmitButton>
        </form>

        <form onSubmit={submitBill} className="form-grid section-card" style={{ marginBottom: 0 }}>
          <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>{tt("topupBillPay")}</h3>
          <label>
            {tt("topupBiller")}
            <SearchSelect
              className="form-select-sm"
              value={billForm.operatorOrBiller}
              onChange={(val) => setBillForm({ ...billForm, operatorOrBiller: val })}
              options={UTILITY_BILLERS.map((b) => ({
                value: b.code,
                label: lang === "bn" ? b.nameBn : b.name,
              }))}
              isClearable={false}
            />
          </label>
          <label>
            {tt("topupAccountNo")}
            <input
              value={billForm.accountOrMsisdn}
              onChange={(e) => {
                setBillForm({ ...billForm, accountOrMsisdn: e.target.value });
                setBillInquiry(null);
              }}
              required
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={inquireBill}
              disabled={!canCreate || inquiring}
            >
              {inquiring ? tt("topupInquiring") : tt("topupInquire")}
            </button>
          </div>
          {billInquiry ? (
            <div
              className="section-card"
              style={{ gridColumn: "1 / -1", padding: 10, background: "#f0fdf4", fontSize: 13 }}
            >
              <strong>{tt("topupDueAmount")}: ৳{Number(billInquiry.dueAmount || 0).toFixed(2)}</strong>
              {billInquiry.customerName ? <span> · {tt("topupBillFor")}: {billInquiry.customerName}</span> : null}
              {billInquiry.billMonth ? <span> · {tt("topupBillMonth")}: {billInquiry.billMonth}</span> : null}
              {billInquiry.simulated ? <span className="text-muted"> · {tt("topupSimulatedBadge")}</span> : null}
            </div>
          ) : null}
          <label>
            {tt("topupAmount")}
            <input
              type="number"
              value={billForm.faceAmount}
              onChange={(e) => setBillForm({ ...billForm, faceAmount: e.target.value })}
              required
            />
          </label>
          <label>
            {tt("topupCommission")}
            <input
              type="number"
              value={billForm.commission}
              onChange={(e) => setBillForm({ ...billForm, commission: e.target.value })}
              placeholder={String(billCommissionHint.toFixed(2))}
            />
          </label>
          <label>
            {tt("topupServiceCharge")}
            <input
              type="number"
              value={billForm.serviceCharge}
              onChange={(e) => setBillForm({ ...billForm, serviceCharge: e.target.value })}
            />
          </label>
          <label>
            {tt("topupPayMethod")}
            <SearchSelect
              className="form-select-sm"
              value={billForm.payMethod}
              onChange={(val) => setBillForm({ ...billForm, payMethod: val || "Cash" })}
              options={PAY_METHODS.map((m) => ({ value: m, label: m }))}
              isClearable={false}
            />
          </label>
          {billForm.payMethod === "MFS" ? (
            <label>
              {tt("topupPayChannel")}
              <SearchSelect
                className="form-select-sm"
                value={billForm.payChannel}
                onChange={(val) => setBillForm({ ...billForm, payChannel: val })}
                placeholder="—"
                options={MFS_CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            </label>
          ) : null}
          <label>
            {tt("topupNotifyPhone")}
            <input value={billForm.notifyPhone} onChange={(e) => setBillForm({ ...billForm, notifyPhone: e.target.value })} placeholder="01XXXXXXXXX" />
          </label>
          <SubmitButton loading={submittingBill} loadingLabel="…" disabled={!canCreate}>
            {tt("topupDoBillPay")}
          </SubmitButton>
        </form>
      </div>

      {canManageFloat ? (
        <form onSubmit={submitFloat} className="form-grid section-card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>{tt("topupFloatLoad")}</h3>
          <label>
            {tt("topupAmount")}
            <input
              type="number"
              value={floatForm.amount}
              onChange={(e) => setFloatForm({ ...floatForm, amount: e.target.value })}
              required
            />
          </label>
          <label>
            {tt("topupFloatSource")}
            <SearchSelect
              className="form-select-sm"
              value={floatForm.source}
              onChange={(val) => setFloatForm({ ...floatForm, source: val || "Cash" })}
              options={[
                { value: "Cash", label: "Cash" },
                { value: "Bank", label: "Bank" },
              ]}
              isClearable={false}
            />
          </label>
          <label>
            {tt("topupNote")}
            <input value={floatForm.note} onChange={(e) => setFloatForm({ ...floatForm, note: e.target.value })} />
          </label>
          <SubmitButton loading={submittingFloat} loadingLabel="…" disabled={!canManageFloat}>
            {tt("topupDoFloatLoad")}
          </SubmitButton>
        </form>
      ) : null}

      <form onSubmit={applyFilter} className="form-grid section-card" style={{ marginTop: 24, maxWidth: 980 }}>
        <h3 style={{ gridColumn: "1 / -1", margin: "0 0 4px" }}>{tt("topupRecent")}</h3>
        <label>
          {tt("topupFrom")}
          <input type="date" value={filter.from} onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))} />
        </label>
        <label>
          {tt("topupTo")}
          <input type="date" value={filter.to} onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))} />
        </label>
        <label>
          {tt("topupType")}
          <SearchSelect
            className="form-select-sm"
            value={filter.type}
            onChange={(val) => setFilter((p) => ({ ...p, type: val || "ALL" }))}
            options={[
              { value: "ALL", label: "All" },
              { value: "RECHARGE", label: "Recharge" },
              { value: "BILL", label: "Bill" },
            ]}
            isClearable={false}
          />
        </label>
        <label>
          {tt("topupStatus")}
          <SearchSelect
            className="form-select-sm"
            value={filter.status}
            onChange={(val) => setFilter((p) => ({ ...p, status: val || "ALL" }))}
            options={[
              { value: "ALL", label: "All" },
              { value: "SUCCESS", label: "Success" },
              { value: "PENDING", label: "Pending" },
              { value: "FAILED", label: "Failed" },
            ]}
            isClearable={false}
          />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <SubmitButton loading={submittingFilter} loadingLabel="…">
            {tt("topupApplyFilter")}
          </SubmitButton>
          <button type="button" className="btn-secondary" onClick={exportCsv}>
            {tt("topupExportCsv")}
          </button>
        </div>
      </form>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{tt("topupColTime")}</th>
              <th>{tt("topupColType")}</th>
              <th>{tt("topupColOperator")}</th>
              <th>{tt("topupColAccount")}</th>
              <th>{tt("topupColAmount")}</th>
              <th>{tt("topupColCommission")}</th>
              <th>{tt("topupColPay")}</th>
              <th>{tt("topupColStatus")}</th>
              <th>{tt("topupColRef")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                <td>{r.type}</td>
                <td>{r.operatorOrBiller}</td>
                <td>{r.accountOrMsisdn}</td>
                <td>{Number(r.faceAmount || 0).toFixed(2)}</td>
                <td>{(Number(r.commission || 0) + Number(r.serviceCharge || 0)).toFixed(2)}</td>
                <td>{r.payMethod}{r.payChannel ? ` (${r.payChannel})` : ""}</td>
                <td>{r.status}</td>
                <td>
                  {r.providerRef || "—"}
                  {r.token ? <div style={{ fontSize: 11, opacity: 0.75 }}>{r.token}</div> : null}
                </td>
                <td>
                  {r.status === "SUCCESS" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => printSlip(r)}>
                        {tt("topupPrintSlip")}
                      </button>
                      {canManageFloat ? (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => reverseTransaction(r)}
                          disabled={reversingId === r.id}
                        >
                          {reversingId === r.id ? tt("topupReversing") : tt("topupReverse")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={10} className="text-muted">
                  {tt("topupNoTxns")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!isPrintBridgeConfigured() ? (
        <p className="text-muted" style={{ fontSize: 12 }}>
          {tt("topupPrintBridgeHint")}
        </p>
      ) : null}
    </div>
  );
}
