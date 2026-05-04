import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

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

function StatusBadge({ status }) {
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
      {status}
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
  const [tab, setTab] = useState("RECEIVED");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ grouped: [], upcoming: [], overdueDeposit: [] });
  const [filters, setFilters] = useState({ status: "", from: "", to: "", q: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [actionFor, setActionFor] = useState(null); // { row, action }
  const [actionData, setActionData] = useState({});
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.get("/cheques", {
          params: {
            direction: tab,
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.from ? { from: filters.from } : {}),
            ...(filters.to ? { to: filters.to } : {}),
            ...(filters.q ? { q: filters.q } : {}),
          },
        }),
        api.get("/cheques/summary"),
      ]);
      setRows(list.data);
      setSummary(sum.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
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
    if (!form.chequeNo || !form.bankName || !form.amount || !form.chequeDate) {
      notifyActionRequired("cheque no, bank, amount and cheque date are required.");
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
    notifySuccess("cheque registered.");
    load();
  };

  const performTransition = async (row, action) => {
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
    notifySuccess(`cheque ${action.toLowerCase()} done.`);
    load();
  };

  const openDetails = async (id) => {
    const res = await api.get(`/cheques/${id}`);
    setDetails(res.data);
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Cheque register</h2>
          <p className="text-muted" style={{ marginTop: 0 }}>
            Track issued and received cheques (incl. post-dated) through their full lifecycle.
          </p>
        </div>
        <button onClick={() => { setForm({ ...emptyForm(), direction: tab }); setShowCreate(true); }}>
          + Register cheque
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 16 }}>
        {["RECEIVED", "ISSUED"].map((dir) => {
          const d = summaryByDirection[dir] || {};
          const pending = d.PENDING || { count: 0, amount: 0 };
          const cleared = d.CLEARED || { count: 0, amount: 0 };
          const bounced = d.BOUNCED || { count: 0, amount: 0 };
          return (
            <div key={dir} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, background: "#fff" }}>
              <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>{dir}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                <span>Pending</span>
                <strong>{pending.count} · {Number(pending.amount).toFixed(2)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>Cleared</span>
                <strong>{cleared.count} · {Number(cleared.amount).toFixed(2)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#b91c1c" }}>
                <span>Bounced</span>
                <strong>{bounced.count} · {Number(bounced.amount).toFixed(2)}</strong>
              </div>
            </div>
          );
        })}
        {summary.overdueDeposit?.length > 0 ? (
          <div style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 14, background: "#fef2f2" }}>
            <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>OVERDUE TO DEPOSIT</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {summary.overdueDeposit.length} received cheque(s) past their date, still PENDING.
            </div>
          </div>
        ) : null}
        {summary.upcoming?.length > 0 ? (
          <div style={{ border: "1px solid #fde68a", borderRadius: 8, padding: 14, background: "#fffbeb" }}>
            <div style={{ fontSize: 12, color: "#92400e", fontWeight: 600 }}>UPCOMING (NEXT 14D)</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {summary.upcoming.length} pending cheque(s) due to clear/deposit soon.
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
            {d === "RECEIVED" ? "Received from customers" : "Issued to suppliers/payees"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>Status</div>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>From</div>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#64748b" }}>To</div>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Search</div>
          <input
            placeholder="cheque no / bank / drawer / payee / notes"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
        <button type="button" onClick={load}>Apply</button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => { setFilters({ status: "", from: "", to: "", q: "" }); setTimeout(load, 0); }}
        >
          Reset
        </button>
      </div>

      <table className="data-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Cheque #</th>
            <th>Bank</th>
            <th>{tab === "RECEIVED" ? "Drawer" : "Payee"}</th>
            <th>Amount</th>
            <th>Cheque date</th>
            <th>Status</th>
            <th>Linked</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8" }}>No cheques in this view.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="btn-ghost" style={{ padding: 0 }} onClick={() => openDetails(r.id)}>
                  {r.chequeNo}
                </button>
              </td>
              <td>{r.bankName}{r.bankBranch ? ` (${r.bankBranch})` : ""}</td>
              <td>{tab === "RECEIVED" ? (r.drawerName || r.customer?.name || "—") : (r.payeeName || r.supplier?.name || "—")}</td>
              <td>{Number(r.amount || 0).toFixed(2)}</td>
              <td>{new Date(r.chequeDate).toLocaleDateString()}</td>
              <td><StatusBadge status={r.status} /></td>
              <td>{r.linkedType ? `${r.linkedType}#${r.linkedId || "?"}` : "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.status === "PENDING" && r.direction === "RECEIVED" && (
                  <button className="btn-secondary btn-sm" onClick={() => { setActionFor({ row: r, action: "DEPOSIT" }); setActionData({}); }}>Deposit</button>
                )}
                {(r.status === "PENDING" || r.status === "DEPOSITED") && (
                  <>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => { setActionFor({ row: r, action: "CLEAR" }); setActionData({}); }}>Clear</button>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => { setActionFor({ row: r, action: "BOUNCE" }); setActionData({}); }}>Bounce</button>
                  </>
                )}
                {r.status === "PENDING" && (
                  <button className="btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => { setActionFor({ row: r, action: "CANCEL" }); setActionData({}); }}>Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Register new cheque">
          <form onSubmit={submitCreate} className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <label>
              Direction
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                {DIRECTION_OPTIONS.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label>
              Cheque no
              <input value={form.chequeNo} onChange={(e) => setForm({ ...form, chequeNo: e.target.value })} required />
            </label>
            <label>
              Bank
              <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
            </label>
            <label>
              Bank branch
              <input value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
            </label>
            <label>
              Account name
              <input value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
            </label>
            <label>
              Account no
              <input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} />
            </label>
            {form.direction === "RECEIVED" ? (
              <>
                <label>
                  Drawer name (on cheque)
                  <input value={form.drawerName} onChange={(e) => setForm({ ...form, drawerName: e.target.value })} />
                </label>
                <label>
                  Customer ID (optional)
                  <input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} />
                </label>
              </>
            ) : (
              <>
                <label>
                  Payee name
                  <input value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} />
                </label>
                <label>
                  Supplier ID (optional)
                  <input value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} />
                </label>
              </>
            )}
            <label>
              Amount (BDT)
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </label>
            <label>
              Cheque date
              <input type="date" value={form.chequeDate} onChange={(e) => setForm({ ...form, chequeDate: e.target.value })} required />
            </label>
            <label>
              Linked document type
              <select value={form.linkedType} onChange={(e) => setForm({ ...form, linkedType: e.target.value })}>
                {LINKED_TYPES.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
              </select>
            </label>
            <label>
              Linked document ID
              <input value={form.linkedId} onChange={(e) => setForm({ ...form, linkedId: e.target.value })} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit">Register cheque</button>
            </div>
          </form>
        </Modal>
      )}

      {actionFor && (
        <Modal onClose={() => setActionFor(null)} title={`${actionFor.action.toLowerCase().replace(/^./, (c) => c.toUpperCase())} cheque #${actionFor.row.chequeNo}`}>
          <div style={{ display: "grid", gap: 10 }}>
            {actionFor.action === "DEPOSIT" && (
              <label>
                Deposit date
                <input type="date" value={actionData.depositDate || ""} onChange={(e) => setActionData({ ...actionData, depositDate: e.target.value })} />
              </label>
            )}
            {actionFor.action === "CLEAR" && (
              <label>
                Cleared date
                <input type="date" value={actionData.clearedDate || ""} onChange={(e) => setActionData({ ...actionData, clearedDate: e.target.value })} />
              </label>
            )}
            {actionFor.action === "BOUNCE" && (
              <>
                <label>
                  Bounce date
                  <input type="date" value={actionData.bounceDate || ""} onChange={(e) => setActionData({ ...actionData, bounceDate: e.target.value })} />
                </label>
                <label>
                  Bounce reason
                  <input value={actionData.bounceReason || ""} onChange={(e) => setActionData({ ...actionData, bounceReason: e.target.value })} placeholder="Insufficient funds, signature mismatch, etc." />
                </label>
                <label>
                  Bounce fee charged (BDT)
                  <input type="number" step="0.01" value={actionData.bounceFee || ""} onChange={(e) => setActionData({ ...actionData, bounceFee: e.target.value })} />
                </label>
              </>
            )}
            <label>
              Notes
              <input value={actionData.notes || ""} onChange={(e) => setActionData({ ...actionData, notes: e.target.value })} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setActionFor(null)}>Close</button>
              <button type="button" onClick={() => performTransition(actionFor.row, actionFor.action)}>
                Confirm {actionFor.action.toLowerCase()}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {details && (
        <Modal onClose={() => setDetails(null)} title={`Cheque #${details.chequeNo}`} wide>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 13 }}>
            <Field label="Direction" value={details.direction} />
            <Field label="Status" value={<StatusBadge status={details.status} />} />
            <Field label="Bank" value={`${details.bankName}${details.bankBranch ? ` (${details.bankBranch})` : ""}`} />
            <Field label="Amount" value={Number(details.amount || 0).toFixed(2)} />
            <Field label="Cheque date" value={new Date(details.chequeDate).toLocaleDateString()} />
            <Field label="Deposit date" value={details.depositDate ? new Date(details.depositDate).toLocaleDateString() : "—"} />
            <Field label="Cleared date" value={details.clearedDate ? new Date(details.clearedDate).toLocaleDateString() : "—"} />
            <Field label="Bounced date" value={details.bounceDate ? new Date(details.bounceDate).toLocaleDateString() : "—"} />
            <Field label="Drawer / Payee" value={details.direction === "RECEIVED" ? (details.drawerName || details.customer?.name || "—") : (details.payeeName || details.supplier?.name || "—")} />
            <Field label="Account no" value={details.accountNo || "—"} />
            <Field label="Linked" value={details.linkedType ? `${details.linkedType} #${details.linkedId || "?"}` : "—"} />
            <Field label="Bounce reason" value={details.bounceReason || "—"} />
            <Field label="Bounce fee" value={Number(details.bounceFee || 0).toFixed(2)} />
            <Field label="Created by" value={details.creator?.name || "—"} />
            <div style={{ gridColumn: "1 / -1" }}><Field label="Notes" value={details.notes || "—"} /></div>
          </div>
          <h4 style={{ marginTop: 16, marginBottom: 6 }}>Status history</h4>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>From → To</th>
                <th>By</th>
                <th>Notes</th>
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
