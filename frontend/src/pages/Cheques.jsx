import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { getLang, t } from "../i18n";
import SearchSelect from "../components/SearchSelect";

const STATUS_OPTIONS = ["", "PENDING", "DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"];
const DIRECTION_OPTIONS = ["", "ISSUED", "RECEIVED"];
const LINKED_TYPES = ["", "SALE", "PURCHASE", "EXPENSE", "RECEIPT", "PAYMENT", "OTHER"];

const STATUS_BADGE = {
  PENDING: { bg: "#fef3c7", color: "#92400e" },
  DEPOSITED: { bg: "#dbeafe", color: "#1e40af" },
  CLEARED: { bg: "#dcfce7", color: "#15803d" },
  BOUNCED: { bg: "#fee2e2", color: "#b91c1c" },
  CANCELLED: { bg: "#f1f5f9", color: "#475569" },
};

function StatusBadge({ status, label }) {
  const s = STATUS_BADGE[status] || { bg: "#f1f5f9", color: "#475569" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label || status}
    </span>
  );
}

function emptyForm() {
  return {
    direction: "RECEIVED",
    chequeNo: "",
    bankName: "",
    bankBranch: "",
    accountName: "",
    accountNo: "",
    drawerName: "",
    payeeName: "",
    amount: "",
    chequeDate: new Date().toISOString().slice(0, 10),
    linkedType: "",
    linkedId: "",
    customerId: "",
    supplierId: "",
    notes: "",
  };
}

export default function Cheques() {
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
  const canManageCheques = hasPermission("cheque.manage");
  const canClearCheques = hasPermission("cheque.clear");

  const requireChequeManage = () => {
    if (canManageCheques) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "cheque.manage" }));
    return false;
  };
  const requireChequeClear = () => {
    if (canClearCheques) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "cheque.clear" }));
    return false;
  };

  const [tab, setTab] = useState("RECEIVED");
  const [summary, setSummary] = useState({ grouped: [], upcoming: [], overdueDeposit: [] });
  const [filters, setFilters] = useState({ status: "", from: "", to: "", q: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [actionFor, setActionFor] = useState(null); // { row, action }
  const [actionData, setActionData] = useState({});
  const [details, setDetails] = useState(null);
  const statusLabels = useMemo(
    () => ({
      PENDING: tt("chPending"),
      DEPOSITED: tt("chDeposited"),
      CLEARED: tt("chCleared"),
      BOUNCED: tt("chBounced"),
      CANCELLED: tt("chCancelled"),
    }),
    [tt]
  );
  const directionLabels = useMemo(
    () => ({
      RECEIVED: tt("chReceived"),
      ISSUED: tt("chIssued"),
    }),
    [tt]
  );
  const linkedTypeLabels = useMemo(
    () => ({
      SALE: tt("chLinkedSale"),
      PURCHASE: tt("chLinkedPurchase"),
      EXPENSE: tt("chLinkedExpense"),
      RECEIPT: tt("chLinkedReceipt"),
      PAYMENT: tt("chLinkedPayment"),
      OTHER: tt("chLinkedOther"),
    }),
    [tt]
  );

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchChequesPage = useCallback(async (q) => {
    const f = filtersRef.current || {};
    const res = await api.get("/cheques", {
      params: {
        paged: true,
        direction: tabRef.current,
        ...(f.status ? { status: f.status } : {}),
        ...(f.from ? { from: f.from } : {}),
        ...(f.to ? { to: f.to } : {}),
        ...(f.q ? { q: f.q } : {}),
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
  const chequesTable = useServerTable(fetchChequesPage, {
    pageSize: 10,
    sortKey: "chequeDate",
    sortDir: "desc",
  });
  const rows = chequesTable.rows;

  const fetchSummary = useCallback(async () => {
    const sum = await api.get("/cheques/summary");
    setSummary(sum.data);
  }, []);

  const load = useCallback(async () => {
    await Promise.all([chequesTable.refresh(), fetchSummary()]);
  }, [chequesTable, fetchSummary]);

  // Re-query the table (reset to page 1); used by the filter bar and tab switch.
  const applyFilters = useCallback(() => {
    chequesTable.setQuery((prev) => ({ ...prev, page: 1 }));
  }, [chequesTable]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const summaryByDirection = useMemo(() => {
    const result = { ISSUED: {}, RECEIVED: {} };
    for (const g of summary.grouped || []) {
      if (!result[g.direction]) result[g.direction] = {};
      result[g.direction][g.status] = {
        count: g._count?._all || 0,
        amount: g._sum?.amount || 0,
      };
    }
    return result;
  }, [summary.grouped]);

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!requireChequeManage()) return;
    if (!form.chequeNo || !form.bankName || !form.amount || !form.chequeDate) {
      notifyActionRequired(tt("chRequiredFields"));
      return;
    }
    const payload = {
      ...form,
      amount: Number(form.amount),
      linkedId: form.linkedId ? Number(form.linkedId) : null,
      customerId: form.customerId ? Number(form.customerId) : null,
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      linkedType: form.linkedType || null,
    };
    await api.post("/cheques", payload);
    setShowCreate(false);
    setForm(emptyForm());
    notifySuccess(tt("chRegistered"));
    load();
  };

  const performTransition = async (row, action) => {
    if (action === "CLEAR" || action === "BOUNCE") {
      if (!requireChequeClear()) return;
    } else if (!requireChequeManage()) return;
    const map = {
      DEPOSIT: "/deposit",
      CLEAR: "/clear",
      BOUNCE: "/bounce",
      CANCEL: "/cancel",
    };
    const url = `/cheques/${row.id}${map[action]}`;
    const body = {
      notes: actionData.notes || undefined,
      depositDate: actionData.depositDate || undefined,
      clearedDate: actionData.clearedDate || undefined,
      bounceDate: actionData.bounceDate || undefined,
      bounceReason: actionData.bounceReason || undefined,
      bounceFee: actionData.bounceFee != null && actionData.bounceFee !== "" ? Number(actionData.bounceFee) : undefined,
    };
    await api.post(url, body);
    setActionFor(null);
    setActionData({});
    notifySuccess(tt("chActionDone", { action: action.toLowerCase() }));
    load();
  };

  const openDetails = async (id) => {
    const res = await api.get(`/cheques/${id}`);
    setDetails(res.data);
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("cheques")}</div>
          <div className="page-subtitle">{tt("chSubtitle")}</div>
        </div>
        <div className="page-actions">
          <button type="button" disabled={!canManageCheques} onClick={() => { setForm({ ...emptyForm(), direction: tab }); setShowCreate(true); }}>
            + {tt("chRegisterCheque")}
          </button>
        </div>
      </div>

      {!canManageCheques ? <PermissionBanner show code="cheque.manage" tt={tt} /> : null}
      {!canClearCheques ? <PermissionBanner show code="cheque.clear" tt={tt} /> : null}

      <div className="metrics-grid" style={{ marginTop: 4 }}>
        {["RECEIVED", "ISSUED"].map((dir) => {
          const d = summaryByDirection[dir] || {};
          const pending = d.PENDING || { count: 0, amount: 0 };
          const cleared = d.CLEARED || { count: 0, amount: 0 };
          const bounced = d.BOUNCED || { count: 0, amount: 0 };
          return (
            <div key={dir} className="metric">
              <div className="metric-label">{dir === "RECEIVED" ? tt("chReceived") : tt("chIssued")}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                <span>{tt("chPending")}</span>
                <strong>{pending.count} · {Number(pending.amount).toFixed(2)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{tt("chCleared")}</span>
                <strong>{cleared.count} · {Number(cleared.amount).toFixed(2)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#b91c1c" }}>
                <span>{tt("chBounced")}</span>
                <strong>{bounced.count} · {Number(bounced.amount).toFixed(2)}</strong>
              </div>
            </div>
          );
        })}
        {summary.overdueDeposit?.length > 0 ? (
          <div style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 14, background: "#fef2f2" }}>
            <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>{tt("chOverdueToDeposit")}</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {tt("chOverdueToDepositText", { n: summary.overdueDeposit.length })}
            </div>
          </div>
        ) : null}
        {summary.upcoming?.length > 0 ? (
          <div style={{ border: "1px solid #fde68a", borderRadius: 8, padding: 14, background: "#fffbeb" }}>
            <div style={{ fontSize: 12, color: "#92400e", fontWeight: 600 }}>{tt("chUpcoming14d")}</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {tt("chUpcomingText", { n: summary.upcoming.length })}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: "1px solid #e2e8f0" }}>
        {["RECEIVED", "ISSUED"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setTab(d)}
            style={{
              padding: "8px 14px",
              border: "none",
              borderBottom: tab === d ? "2px solid #2563eb" : "2px solid transparent",
              background: "transparent",
              color: tab === d ? "#1e40af" : "#475569",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {d === "RECEIVED" ? tt("chReceivedFromCustomers") : tt("chIssuedToSuppliers")}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>{tt("colStatus")}</div>
          <SearchSelect
            className="form-select-sm"
            value={filters.status}
            onChange={(val) => setFilters({ ...filters, status: val })}
            placeholder={tt("chAll")}
            options={STATUS_OPTIONS.filter(Boolean).map((s) => ({
              value: s,
              label: statusLabels[s] || s,
            }))}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>{tt("accFrom")}</div>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>{tt("accTo")}</div>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{tt("searchMenu")}</div>
          <input
            placeholder={tt("chSearchPlaceholder")}
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
        <button type="button" onClick={applyFilters}>{tt("accApplyRange")}</button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => { setFilters({ status: "", from: "", to: "", q: "" }); setTimeout(applyFilters, 0); }}
        >
          {tt("settingsCancel")}
        </button>
      </div>

      <DataTable
        title={tt("cheques")}
        rows={rows}
        serverMode
        totalRows={chequesTable.total}
        loading={chequesTable.loading}
        onQueryChange={chequesTable.onQueryChange}
        initialSort="chequeDate"
        initialSortDir="desc"
        pageSize={10}
        columns={[
          {
            key: "chequeNo",
            label: tt("chChequeNoCol"),
            render: (v, r) => (
              <button type="button" className="btn-ghost" style={{ padding: 0 }} onClick={() => openDetails(r.id)}>
                {v}
              </button>
            ),
          },
          {
            key: "bankName",
            label: tt("chBank"),
            render: (v, r) => `${v}${r.bankBranch ? ` (${r.bankBranch})` : ""}`,
          },
          {
            key: "drawerName",
            label: tab === "RECEIVED" ? tt("chDrawer") : tt("chPayee"),
            searchable: false,
            render: (_, r) => (tab === "RECEIVED" ? (r.drawerName || r.customer?.name || "—") : (r.payeeName || r.supplier?.name || "—")),
          },
          {
            key: "amount",
            label: tt("accStatementAmount"),
            searchable: false,
            render: (v) => Number(v || 0).toFixed(2),
          },
          {
            key: "chequeDate",
            label: tt("chChequeDate"),
            searchable: false,
            render: (v) => new Date(v).toLocaleDateString(),
          },
          {
            key: "status",
            label: tt("colStatus"),
            searchable: false,
            render: (v) => <StatusBadge status={v} label={statusLabels[v]} />,
          },
          {
            key: "linkedType",
            label: tt("chLinked"),
            searchable: false,
            render: (v, r) => (v ? `${linkedTypeLabels[v] || v}#${r.linkedId || "?"}` : "—"),
          },
          {
            key: "actions",
            label: "",
            searchable: false,
            render: (_, r) => (
              <div style={{ whiteSpace: "nowrap" }}>
                {r.status === "PENDING" && r.direction === "RECEIVED" && (
                  <button className="btn-secondary btn-sm" disabled={!canManageCheques} onClick={() => { setActionFor({ row: r, action: "DEPOSIT" }); setActionData({}); }}>{tt("chDeposit")}</button>
                )}
                {(r.status === "PENDING" || r.status === "DEPOSITED") && (
                  <>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 4 }} disabled={!canClearCheques} onClick={() => { setActionFor({ row: r, action: "CLEAR" }); setActionData({}); }}>{tt("chClear")}</button>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 4 }} disabled={!canClearCheques} onClick={() => { setActionFor({ row: r, action: "BOUNCE" }); setActionData({}); }}>{tt("chBounce")}</button>
                  </>
                )}
                {r.status === "PENDING" && (
                  <button className="btn-ghost btn-sm" style={{ marginLeft: 4 }} disabled={!canManageCheques} onClick={() => { setActionFor({ row: r, action: "CANCEL" }); setActionData({}); }}>{tt("settingsCancel")}</button>
                )}
              </div>
            ),
          },
        ]}
      />

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title={tt("chRegisterNewCheque")}>
          <form onSubmit={submitCreate} className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <label>
              {tt("chDirection")}
              <SearchSelect
                className="form-select-sm"
                value={form.direction}
                onChange={(val) => setForm({ ...form, direction: val || "ISSUED" })}
                options={DIRECTION_OPTIONS.filter(Boolean).map((o) => ({
                  value: o,
                  label: directionLabels[o] || o,
                }))}
                isClearable={false}
              />
            </label>
            <label>
              {tt("chChequeNo")}
              <input value={form.chequeNo} onChange={(e) => setForm({ ...form, chequeNo: e.target.value })} required />
            </label>
            <label>
              {tt("chBank")}
              <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
            </label>
            <label>
              {tt("chBankBranch")}
              <input value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
            </label>
            <label>
              {tt("chAccountName")}
              <input value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
            </label>
            <label>
              {tt("chAccountNo")}
              <input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} />
            </label>
            {form.direction === "RECEIVED" ? (
              <>
                <label>
                  {tt("chDrawerNameOnCheque")}
                  <input value={form.drawerName} onChange={(e) => setForm({ ...form, drawerName: e.target.value })} />
                </label>
                <label>
                  {tt("chCustomerIdOptional")}
                  <input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} />
                </label>
              </>
            ) : (
              <>
                <label>
                  {tt("chPayeeName")}
                  <input value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} />
                </label>
                <label>
                  {tt("chSupplierIdOptional")}
                  <input value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} />
                </label>
              </>
            )}
            <label>
              {tt("chAmountBdt")}
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </label>
            <label>
              {tt("chChequeDate")}
              <input type="date" value={form.chequeDate} onChange={(e) => setForm({ ...form, chequeDate: e.target.value })} required />
            </label>
            <label>
              {tt("chLinkedDocumentType")}
              <SearchSelect
                className="form-select-sm"
                value={form.linkedType}
                onChange={(val) => setForm({ ...form, linkedType: val })}
                placeholder="—"
                options={LINKED_TYPES.filter(Boolean).map((o) => ({
                  value: o,
                  label: linkedTypeLabels[o] || o,
                }))}
              />
            </label>
            <label>
              {tt("chLinkedDocumentId")}
              <input value={form.linkedId} onChange={(e) => setForm({ ...form, linkedId: e.target.value })} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              {tt("expDescription")}
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>{tt("settingsCancel")}</button>
              <button type="submit" disabled={!canManageCheques}>{tt("chRegisterCheque")}</button>
            </div>
          </form>
        </Modal>
      )}

      {actionFor && (
        <Modal
          onClose={() => setActionFor(null)}
          title={tt("chActionChequeTitle", { action: tt(`chAction${actionFor.action}`), no: actionFor.row.chequeNo })}
        >
          <div style={{ display: "grid", gap: 10 }}>
            {actionFor.action === "DEPOSIT" && (
              <label>
                {tt("chDepositDate")}
                <input type="date" value={actionData.depositDate || ""} onChange={(e) => setActionData({ ...actionData, depositDate: e.target.value })} />
              </label>
            )}
            {actionFor.action === "CLEAR" && (
              <label>
                {tt("chClearedDate")}
                <input type="date" value={actionData.clearedDate || ""} onChange={(e) => setActionData({ ...actionData, clearedDate: e.target.value })} />
              </label>
            )}
            {actionFor.action === "BOUNCE" && (
              <>
                <label>
                  {tt("chBounceDate")}
                  <input type="date" value={actionData.bounceDate || ""} onChange={(e) => setActionData({ ...actionData, bounceDate: e.target.value })} />
                </label>
                <label>
                  {tt("chBounceReason")}
                  <input value={actionData.bounceReason || ""} onChange={(e) => setActionData({ ...actionData, bounceReason: e.target.value })} placeholder={tt("chBounceReasonPlaceholder")} />
                </label>
                <label>
                  {tt("chBounceFeeCharged")}
                  <input type="number" step="0.01" value={actionData.bounceFee || ""} onChange={(e) => setActionData({ ...actionData, bounceFee: e.target.value })} />
                </label>
              </>
            )}
            <label>
              {tt("expDescription")}
              <input value={actionData.notes || ""} onChange={(e) => setActionData({ ...actionData, notes: e.target.value })} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setActionFor(null)}>{tt("fpClose")}</button>
              <button type="button" onClick={() => performTransition(actionFor.row, actionFor.action)}>
                {tt("chConfirmAction", { action: tt(`chAction${actionFor.action}`).toLowerCase() })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {details && (
        <Modal onClose={() => setDetails(null)} title={`${tt("chCheque")} #${details.chequeNo}`} wide>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 13 }}>
            <Field label={tt("chDirection")} value={directionLabels[details.direction] || details.direction} />
            <Field label={tt("colStatus")} value={<StatusBadge status={details.status} label={statusLabels[details.status]} />} />
            <Field label={tt("chBank")} value={`${details.bankName}${details.bankBranch ? ` (${details.bankBranch})` : ""}`} />
            <Field label={tt("accStatementAmount")} value={Number(details.amount || 0).toFixed(2)} />
            <Field label={tt("chChequeDate")} value={new Date(details.chequeDate).toLocaleDateString()} />
            <Field label={tt("chDepositDate")} value={details.depositDate ? new Date(details.depositDate).toLocaleDateString() : "—"} />
            <Field label={tt("chClearedDate")} value={details.clearedDate ? new Date(details.clearedDate).toLocaleDateString() : "—"} />
            <Field label={tt("chBouncedDate")} value={details.bounceDate ? new Date(details.bounceDate).toLocaleDateString() : "—"} />
            <Field label={tt("chDrawerPayee")} value={details.direction === "RECEIVED" ? (details.drawerName || details.customer?.name || "—") : (details.payeeName || details.supplier?.name || "—")} />
            <Field label={tt("chAccountNo")} value={details.accountNo || "—"} />
            <Field label={tt("chLinked")} value={details.linkedType ? `${linkedTypeLabels[details.linkedType] || details.linkedType} #${details.linkedId || "?"}` : "—"} />
            <Field label={tt("chBounceReason")} value={details.bounceReason || "—"} />
            <Field label={tt("chBounceFee")} value={Number(details.bounceFee || 0).toFixed(2)} />
            <Field label={tt("expCreatedBy")} value={details.creator?.name || "—"} />
            <div style={{ gridColumn: "1 / -1" }}><Field label={tt("expDescription")} value={details.notes || "—"} /></div>
          </div>
          <h4 style={{ marginTop: 16, marginBottom: 6 }}>{tt("chStatusHistory")}</h4>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>{tt("chWhen")}</th>
                <th>{tt("chEvent")}</th>
                <th>{tt("chFromTo")}</th>
                <th>{tt("chBy")}</th>
                <th>{tt("expDescription")}</th>
              </tr>
            </thead>
            <tbody>
              {(details.events || []).map((ev) => (
                <tr key={ev.id}>
                  <td>{new Date(ev.createdAt).toLocaleString()}</td>
                  <td>{ev.eventType}</td>
                  <td>{ev.fromStatus || "—"} → {ev.toStatus || "—"}</td>
                  <td>{ev.actor?.name || "—"}</td>
                  <td>{ev.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose, title, wide }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 18,
          width: wide ? 760 : 540,
          maxWidth: "92vw",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: "2px 8px" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
