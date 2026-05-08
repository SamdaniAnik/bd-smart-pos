import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired } from "../utils/notify";

/** Bangladesh Taka denominations for drawer close counts */
const BDT_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

function emptyDenomState() {
  return Object.fromEntries(BDT_DENOMINATIONS.map((v) => [v, ""]));
}

function denomTotal(counts) {
  return BDT_DENOMINATIONS.reduce((sum, d) => sum + d * Math.max(0, Number(counts[d] || 0)), 0);
}

function denomPayload(counts) {
  return BDT_DENOMINATIONS.filter((d) => Number(counts[d] || 0) > 0).map((denomination) => ({
    denomination,
    count: Math.floor(Number(counts[d] || 0)),
  }));
}

function Shifts() {
  const [currentShift, setCurrentShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [denomCounts, setDenomCounts] = useState(() => emptyDenomState());
  const [manualClosingCash, setManualClosingCash] = useState(false);
  const [varianceReason, setVarianceReason] = useState("");
  const [managerApprovalPin, setManagerApprovalPin] = useState("");
  const [movementType, setMovementType] = useState("IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const currentAnomalies = currentShift?.anomalies || null;

  const load = useCallback(async () => {
    const [currentRes, historyRes] = await Promise.all([
      api.get("/shifts/current"),
      api.get("/shifts/history"),
    ]);
    setCurrentShift(currentRes.data);
    setHistory(historyRes.data);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (manualClosingCash) return;
    const hasAny = BDT_DENOMINATIONS.some((d) => String(denomCounts[d]).trim() !== "");
    if (!hasAny) {
      setClosingCash("");
      return;
    }
    const t = denomTotal(denomCounts);
    setClosingCash(Number(t.toFixed(2)).toFixed(2));
  }, [denomCounts, manualClosingCash]);

  const openShift = async (e) => {
    e.preventDefault();
    await api.post("/shifts/open", { openingCash: Number(openingCash || 0) });
    setOpeningCash("");
    load();
  };

  const closeShift = async (e) => {
    e.preventDefault();
    const payload = denomPayload(denomCounts);
    const counted = denomTotal(denomCounts);
    const closingNum = Number(closingCash || 0);
    if (payload.length && Math.abs(counted - closingNum) > 0.02) {
      notifyActionRequired(
        "Bill and coin counted total must match closing cash. Clear counts, sync from bills, or fix the mismatch."
      );
      return;
    }
    await api.post("/shifts/close", {
      closingCash: closingNum,
      varianceReason: varianceReason.trim(),
      managerApprovalPin: managerApprovalPin.trim(),
      ...(payload.length ? { closingDenomination: payload } : {}),
    });
    setClosingCash("");
    setDenomCounts(emptyDenomState());
    setManualClosingCash(false);
    setVarianceReason("");
    setManagerApprovalPin("");
    load();
  };

  const addMovement = async (e) => {
    e.preventDefault();
    await api.post("/shifts/movement", {
      type: movementType,
      amount: Number(movementAmount || 0),
      reason: movementReason,
    });
    setMovementAmount("");
    setMovementReason("");
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Shift &amp; cash reconciliation</div>
          <div className="page-subtitle">Open and close registers, reconcile cash, and review anomalies</div>
        </div>
      </div>
      {currentShift ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <h4>Open Shift</h4>
          <p><strong>Register:</strong> {currentShift.register?.name || "-"}</p>
          <p><strong>Opened:</strong> {new Date(currentShift.openedAt).toLocaleString()}</p>
          <p><strong>Opening Cash:</strong> ৳{Number(currentShift.openingCash || 0).toFixed(2)}</p>
          <p><strong>Cash Sales:</strong> ৳{Number(currentShift.cashSales || 0).toFixed(2)}</p>
          <p><strong>Cash In:</strong> ৳{Number(currentShift.cashIn || 0).toFixed(2)}</p>
          <p><strong>Cash Out:</strong> ৳{Number(currentShift.cashOut || 0).toFixed(2)}</p>
          <p><strong>Expected Cash:</strong> ৳{Number(currentShift.expectedCash || 0).toFixed(2)}</p>
          {currentAnomalies ? (
            <div className="page-card" style={{ marginBottom: 10, borderColor: "#334155" }}>
              <h5 style={{ marginTop: 0, marginBottom: 6 }}>Shift Anomaly Alerts</h5>
              <div className="quick-stats">
                <div className="stat">Risk: {currentAnomalies.riskBand}</div>
                <div className="stat">Score: {Number(currentAnomalies.anomalyScore || 0).toFixed(2)}</div>
                <div className="stat">Discount%: {Number(currentAnomalies.discountPct || 0).toFixed(2)}%</div>
                <div className="stat">Return%: {Number(currentAnomalies.returnPct || 0).toFixed(2)}%</div>
                <div className="stat">Override Approvals: {Number(currentAnomalies.overrideApprovalCount || 0)}</div>
                <div className="stat">Manager Approvals: {Number(currentAnomalies.approvalCount || 0)}</div>
              </div>
              <div style={{ marginTop: 6, color: "var(--muted)" }}>
                Flags:{" "}
                {currentAnomalies.flags?.highDiscountRate ? "High discount rate; " : ""}
                {currentAnomalies.flags?.highReturnRate ? "High return rate; " : ""}
                {currentAnomalies.flags?.highOverrideCount ? "Frequent override approvals; " : ""}
                {currentAnomalies.flags?.frequentManagerApprovals ? "Frequent manager approvals; " : ""}
                {!currentAnomalies.flags?.highDiscountRate &&
                !currentAnomalies.flags?.highReturnRate &&
                !currentAnomalies.flags?.highOverrideCount &&
                !currentAnomalies.flags?.frequentManagerApprovals
                  ? "No anomaly flag."
                  : ""}
              </div>
            </div>
          ) : null}
          <form onSubmit={addMovement} className="form-grid" style={{ marginBottom: 12 }}>
            <select className="form-select-sm" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
              <option value="IN">Cash In</option>
              <option value="OUT">Cash Out</option>
            </select>
            <input
              type="number"
              placeholder="Movement amount"
              value={movementAmount}
              onChange={(e) => setMovementAmount(e.target.value)}
            />
            <input
              placeholder="Reason (petty cash, withdraw, top-up)"
              value={movementReason}
              onChange={(e) => setMovementReason(e.target.value)}
            />
            <button type="submit">Record Movement</button>
          </form>
          <div style={{ margin: "8px 0 12px" }}>
            <strong>Recent Movements:</strong>
            {Array.isArray(currentShift.movements) && currentShift.movements.length ? (
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {currentShift.movements.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    {new Date(m.createdAt).toLocaleTimeString()} - {m.type} ৳{Number(m.amount || 0).toFixed(2)} ({m.reason})
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "6px 0 0" }}>No drawer movements yet.</p>
            )}
          </div>
          <div
            className="page-card"
            style={{
              marginBottom: 12,
              padding: 12,
              borderStyle: "dashed",
              borderColor: "#cbd5e1",
              background: "linear-gradient(180deg, rgba(248, 250, 252, 0.95), #fff)",
            }}
          >
            <h5 style={{ marginTop: 0, marginBottom: 8 }}>Bill &amp; coin count (৳)</h5>
            <p className="pos-inline-note" style={{ marginBottom: 10 }}>
              Enter pieces per denomination; counted total fills &quot;Closing cash&quot; unless you use manual entry.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
                gap: 10,
                marginBottom: 10,
              }}
            >
              {BDT_DENOMINATIONS.map((d) => (
                <label key={d} style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>৳{d}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    value={denomCounts[d]}
                    onChange={(e) =>
                      setDenomCounts((prev) => ({
                        ...prev,
                        [d]: e.target.value === "" ? "" : String(Math.max(0, Math.floor(Number(e.target.value) || 0))),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700 }}>
                Counted from bills/coins: ৳{Number(denomTotal(denomCounts).toFixed(2)).toFixed(2)}
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setDenomCounts(emptyDenomState());
                  if (!manualClosingCash) setClosingCash("");
                }}
              >
                Clear counts
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={manualClosingCash}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setManualClosingCash(on);
                    if (!on) {
                      const t = denomTotal(denomCounts);
                      setClosingCash(Number(t.toFixed(2)).toFixed(2));
                    }
                  }}
                />
                <span style={{ fontSize: 13 }}>Enter closing cash manually</span>
              </label>
            </div>
          </div>
          <form onSubmit={closeShift} className="form-grid">
            <input
              type="number"
              placeholder="Counted closing cash"
              value={closingCash}
              onChange={(e) => {
                setManualClosingCash(true);
                setClosingCash(e.target.value);
              }}
            />
            <input
              placeholder="Variance reason (required if mismatch)"
              value={varianceReason}
              onChange={(e) => setVarianceReason(e.target.value)}
            />
            <input
              type="password"
              placeholder="Manager PIN (if large variance)"
              value={managerApprovalPin}
              onChange={(e) => setManagerApprovalPin(e.target.value)}
            />
            <button type="submit">Close Shift</button>
          </form>
        </div>
      ) : (
        <form onSubmit={openShift} className="form-grid" style={{ marginBottom: 12 }}>
          <input
            type="number"
            placeholder="Opening cash"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
          />
          <button type="submit">Open Shift</button>
        </form>
      )}

      <DataTable
        title="Recent Shift History"
        rows={history.map((row) => ({
          ...row,
          openedAtLabel: new Date(row.openedAt).toLocaleString(),
          closedAtLabel: row.closedAt ? new Date(row.closedAt).toLocaleString() : "Open",
        }))}
        searchableKeys={["openedAtLabel", "closedAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "openedAtLabel", label: "Opened At" },
          { key: "closedAtLabel", label: "Closed At" },
          { key: "openingCash", label: "Opening", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashSales", label: "Cash Sales", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashIn", label: "Cash In", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashOut", label: "Cash Out", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "expectedCash", label: "Expected", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "closingCash", label: "Counted", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "variance", label: "Variance", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "anomalyScore", label: "Anomaly Score", render: (v) => Number(v || 0).toFixed(2) },
          {
            key: "anomalyRiskBand",
            label: "Risk",
            render: (v) => {
              const risk = String(v || "LOW").toUpperCase();
              const color = risk === "HIGH" ? "#b91c1c" : risk === "MEDIUM" ? "#d97706" : "#15803d";
              return (
                <span style={{ color: "#fff", background: color, borderRadius: 999, padding: "2px 8px" }}>
                  {risk}
                </span>
              );
            },
          },
          { key: "varianceReason", label: "Variance Reason" },
          {
            key: "closingDenomination",
            label: "Cash count",
            render: (v) =>
              Array.isArray(v) && v.length ? (
                <span title={JSON.stringify(v)} style={{ color: "#15803d", fontWeight: 700 }}>
                  Saved
                </span>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </div>
  );
}

export default Shifts;
