import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

const emptyFundForm = {
  name: "",
  custodianName: "",
  imprestAmount: "",
  currentBalance: "",
  note: "",
  isActive: true,
};

const emptyTxnForm = {
  fundId: "",
  type: "SPEND",
  amount: "",
  txnDate: "",
  description: "",
};

const emptyClaimForm = {
  fundId: "",
  txnId: "",
  amount: "",
  claimDate: "",
  description: "",
  attachmentNote: "",
};

export default function PettyCash() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canManagePettyCash = hasPermission("pettycash.manage");

  const requirePettyCashManage = () => {
    if (canManagePettyCash) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "pettycash.manage" }));
    return false;
  };

  const [funds, setFunds] = useState([]);
  const [txns, setTxns] = useState([]);
  const [claims, setClaims] = useState([]);
  const [fundForm, setFundForm] = useState(emptyFundForm);
  const [txnForm, setTxnForm] = useState(emptyTxnForm);
  const [claimForm, setClaimForm] = useState(emptyClaimForm);
  const [fundFilter, setFundFilter] = useState("");
  const [claimStatusFilter, setClaimStatusFilter] = useState("");

  const load = async () => {
    const [fundRes, txnRes, claimRes] = await Promise.all([
      api.get("/petty-cash/funds"),
      api.get("/petty-cash/transactions", {
        params: {
          ...(fundFilter ? { fundId: Number(fundFilter) } : {}),
        },
      }),
      api.get("/petty-cash/claims", {
        params: {
          ...(fundFilter ? { fundId: Number(fundFilter) } : {}),
          ...(claimStatusFilter ? { status: claimStatusFilter } : {}),
        },
      }),
    ]);
    const fundRows = Array.isArray(fundRes.data) ? fundRes.data : [];
    setFunds(fundRows);
    setTxns(Array.isArray(txnRes.data) ? txnRes.data : []);
    setClaims(Array.isArray(claimRes.data) ? claimRes.data : []);
    if (!txnForm.fundId && fundRows.length) {
      const firstActive = fundRows.find((x) => x.isActive) || fundRows[0];
      setTxnForm((p) => ({ ...p, fundId: String(firstActive.id) }));
      setClaimForm((p) => ({ ...p, fundId: String(firstActive.id) }));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundFilter, claimStatusFilter]);

  const metrics = useMemo(() => {
    const totalImprest = funds.reduce((sum, row) => sum + Number(row.imprestAmount || 0), 0);
    const totalBalance = funds.reduce((sum, row) => sum + Number(row.currentBalance || 0), 0);
    const activeFundCount = funds.filter((x) => x.isActive).length;
    return { totalImprest, totalBalance, activeFundCount };
  }, [funds]);

  const createFund = async (e) => {
    e.preventDefault();
    if (!requirePettyCashManage()) return;
    if (!fundForm.name.trim()) {
      notifyActionRequired("fund name is required.");
      return;
    }
    await api.post("/petty-cash/funds", {
      name: fundForm.name.trim(),
      custodianName: fundForm.custodianName.trim() || undefined,
      imprestAmount: Number(fundForm.imprestAmount || 0),
      currentBalance:
        fundForm.currentBalance === "" ? undefined : Number(fundForm.currentBalance || 0),
      note: fundForm.note.trim() || undefined,
      isActive: Boolean(fundForm.isActive),
    });
    notifySuccess("petty cash fund created.");
    setFundForm(emptyFundForm);
    load();
  };

  const toggleFund = async (fund) => {
    if (!requirePettyCashManage()) return;
    await api.patch(`/petty-cash/funds/${fund.id}`, { isActive: !fund.isActive });
    notifySuccess("fund status updated.");
    load();
  };

  const postTxn = async (e) => {
    e.preventDefault();
    if (!requirePettyCashManage()) return;
    if (!txnForm.fundId) {
      notifyActionRequired("select a fund.");
      return;
    }
    if (!(Number(txnForm.amount) > 0)) {
      notifyActionRequired("enter amount greater than 0.");
      return;
    }
    const res = await api.post("/petty-cash/transactions", {
      fundId: Number(txnForm.fundId),
      type: txnForm.type,
      amount: Number(txnForm.amount),
      txnDate: txnForm.txnDate || undefined,
      description: txnForm.description.trim() || undefined,
    });
    notifySuccess(`${txnForm.type.toLowerCase()} posted. New balance ${Number(res.data?.nextBalance || 0).toFixed(2)}.`);
    setTxnForm((p) => ({ ...emptyTxnForm, fundId: p.fundId }));
    load();
  };

  const submitClaim = async (e) => {
    e.preventDefault();
    if (!requirePettyCashManage()) return;
    if (!claimForm.fundId) {
      notifyActionRequired("select a fund for claim.");
      return;
    }
    if (!(Number(claimForm.amount) > 0)) {
      notifyActionRequired("claim amount must be greater than 0.");
      return;
    }
    await api.post("/petty-cash/claims", {
      fundId: Number(claimForm.fundId),
      txnId: claimForm.txnId ? Number(claimForm.txnId) : undefined,
      amount: Number(claimForm.amount),
      claimDate: claimForm.claimDate || undefined,
      description: claimForm.description.trim() || undefined,
      attachmentNote: claimForm.attachmentNote.trim() || undefined,
    });
    notifySuccess("reimbursement claim submitted for approval.");
    setClaimForm((p) => ({ ...emptyClaimForm, fundId: p.fundId }));
    load();
  };

  const approveClaim = async (row) => {
    if (!requirePettyCashManage()) return;
    const remark = (window.prompt("Approval remark (optional):") || "").trim();
    await api.post(`/petty-cash/claims/${row.id}/approve`, { remark });
    notifySuccess("claim approved and reimbursement journal posted.");
    load();
  };

  const rejectClaim = async (row) => {
    if (!requirePettyCashManage()) return;
    const remark = (window.prompt("Rejection reason:") || "").trim();
    if (!remark) {
      notifyActionRequired("rejection reason is required.");
      return;
    }
    await api.post(`/petty-cash/claims/${row.id}/reject`, { remark });
    notifySuccess("claim rejected.");
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Petty cash (imprest)</div>
          <div className="page-subtitle">Funds, spends, claims, and replenishment with automatic journals</div>
        </div>
      </div>

      <PermissionBanner show={!canManagePettyCash} code="pettycash.manage" tt={tt} />

      <div className="summary-cards" style={{ marginBottom: 12 }}>
        <div className="summary-card">
          <div className="summary-label">Active Funds</div>
          <div className="summary-value">{metrics.activeFundCount}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Total Imprest</div>
          <div className="summary-value">{metrics.totalImprest.toFixed(2)}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Total Balance</div>
          <div className="summary-value">{metrics.totalBalance.toFixed(2)}</div>
        </div>
      </div>

      <form onSubmit={createFund} className="form-grid" style={{ marginBottom: 14 }}>
        <label>
          Fund Name
          <input required value={fundForm.name} onChange={(e) => setFundForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label>
          Custodian
          <input value={fundForm.custodianName} onChange={(e) => setFundForm((p) => ({ ...p, custodianName: e.target.value }))} />
        </label>
        <label>
          Imprest Amount
          <input type="number" min="0" step="0.01" value={fundForm.imprestAmount} onChange={(e) => setFundForm((p) => ({ ...p, imprestAmount: e.target.value }))} />
        </label>
        <label>
          Opening Balance
          <input type="number" min="0" step="0.01" value={fundForm.currentBalance} onChange={(e) => setFundForm((p) => ({ ...p, currentBalance: e.target.value }))} />
        </label>
        <label>
          Note
          <input value={fundForm.note} onChange={(e) => setFundForm((p) => ({ ...p, note: e.target.value }))} />
        </label>
        <label style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <input type="checkbox" checked={Boolean(fundForm.isActive)} onChange={(e) => setFundForm((p) => ({ ...p, isActive: e.target.checked }))} />
          Active
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManagePettyCash}>Create Fund</button>
        </div>
      </form>

      <h3>Funds</h3>
      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Custodian</th>
            <th>Imprest</th>
            <th>Current Balance</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {funds.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.custodianName || "-"}</td>
              <td>{Number(f.imprestAmount || 0).toFixed(2)}</td>
              <td>{Number(f.currentBalance || 0).toFixed(2)}</td>
              <td>{f.isActive ? "Active" : "Inactive"}</td>
              <td>
                <button type="button" className="btn-secondary btn-sm" disabled={!canManagePettyCash} onClick={() => toggleFund(f)}>
                  {f.isActive ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
          {!funds.length ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>
                No petty cash funds found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3>Post Transaction</h3>
      <form onSubmit={postTxn} className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Fund
          <SearchSelect
            className="form-select-sm"
            value={txnForm.fundId}
            onChange={(val) => setTxnForm((p) => ({ ...p, fundId: val }))}
            placeholder="Select"
            options={funds.filter((x) => x.isActive).map((f) => ({ value: String(f.id), label: f.name }))}
          />
        </label>
        <label>
          Type
          <SearchSelect
            className="form-select-sm"
            value={txnForm.type}
            onChange={(val) => setTxnForm((p) => ({ ...p, type: val || "SPEND" }))}
            options={[
              { value: "SPEND", label: "Spend" },
              { value: "TOPUP", label: "Top-up" },
              { value: "REPLENISH", label: "Replenish" },
            ]}
            isClearable={false}
          />
        </label>
        <label>
          Amount
          <input type="number" min="0" step="0.01" required value={txnForm.amount} onChange={(e) => setTxnForm((p) => ({ ...p, amount: e.target.value }))} />
        </label>
        <label>
          Date
          <input type="date" value={txnForm.txnDate} onChange={(e) => setTxnForm((p) => ({ ...p, txnDate: e.target.value }))} />
        </label>
        <label>
          Description
          <input value={txnForm.description} onChange={(e) => setTxnForm((p) => ({ ...p, description: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManagePettyCash}>Post</button>
        </div>
      </form>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          Filter by fund
          <SearchSelect
            className="form-select-sm"
            value={fundFilter}
            onChange={(val) => setFundFilter(val)}
            placeholder="All Funds"
            options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
          />
        </label>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Fund</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Description</th>
            <th>Journal</th>
            <th>User</th>
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.txnDate).toLocaleDateString()}</td>
              <td>{t.fund?.name || t.fundId}</td>
              <td>{t.type}</td>
              <td>{Number(t.amount || 0).toFixed(2)}</td>
              <td>{t.description || "-"}</td>
              <td>{t.journalId || "-"}</td>
              <td>{t.createdBy?.name || t.createdBy?.email || "-"}</td>
            </tr>
          ))}
          {!txns.length ? (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "#94a3b8" }}>
                No petty cash transactions found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Reimbursement Claims</h3>
      <form onSubmit={submitClaim} className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Fund
          <SearchSelect
            className="form-select-sm"
            value={claimForm.fundId}
            onChange={(val) => setClaimForm((p) => ({ ...p, fundId: val }))}
            placeholder="Select"
            options={funds.filter((x) => x.isActive).map((f) => ({ value: String(f.id), label: f.name }))}
          />
        </label>
        <label>
          Linked Spend (optional)
          <SearchSelect
            className="form-select-sm"
            value={claimForm.txnId}
            onChange={(val) => setClaimForm((p) => ({ ...p, txnId: val }))}
            placeholder="None"
            options={txns
              .filter((x) => x.type === "SPEND" && Number(x.fundId) === Number(claimForm.fundId || 0))
              .map((t) => ({
                value: String(t.id),
                label: `#${t.id} - ${Number(t.amount || 0).toFixed(2)} on ${new Date(t.txnDate).toLocaleDateString()}`,
              }))}
          />
        </label>
        <label>
          Claim Amount
          <input type="number" min="0" step="0.01" required value={claimForm.amount} onChange={(e) => setClaimForm((p) => ({ ...p, amount: e.target.value }))} />
        </label>
        <label>
          Claim Date
          <input type="date" value={claimForm.claimDate} onChange={(e) => setClaimForm((p) => ({ ...p, claimDate: e.target.value }))} />
        </label>
        <label>
          Description
          <input value={claimForm.description} onChange={(e) => setClaimForm((p) => ({ ...p, description: e.target.value }))} />
        </label>
        <label>
          Attachment Note
          <input value={claimForm.attachmentNote} onChange={(e) => setClaimForm((p) => ({ ...p, attachmentNote: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManagePettyCash}>Submit Claim</button>
        </div>
      </form>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label>
          Claim Status
          <SearchSelect
            className="form-select-sm"
            value={claimStatusFilter}
            onChange={(val) => setClaimStatusFilter(val)}
            placeholder="All"
            options={[
              { value: "PENDING", label: "Pending" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
            ]}
          />
        </label>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Fund</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Description</th>
            <th>Remark</th>
            <th>Journal</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td>{new Date(c.claimDate).toLocaleDateString()}</td>
              <td>{c.fund?.name || c.fundId}</td>
              <td>{Number(c.amount || 0).toFixed(2)}</td>
              <td>{c.status}</td>
              <td>{c.description || "-"}</td>
              <td>{c.reviewRemark || "-"}</td>
              <td>{c.journalId || "-"}</td>
              <td>
                {c.status === "PENDING" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn-secondary btn-sm" disabled={!canManagePettyCash} onClick={() => approveClaim(c)}>
                      Approve
                    </button>
                    <button type="button" className="btn-danger btn-sm" disabled={!canManagePettyCash} onClick={() => rejectClaim(c)}>
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
          {!claims.length ? (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", color: "#94a3b8" }}>
                No reimbursement claims found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
