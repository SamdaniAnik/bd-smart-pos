import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { getLang, t } from "../i18n";
import SearchSelect from "../components/SearchSelect";

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
  const canManageShift = hasPermission("sale.create");

  const requireSaleCreate = () => {
    if (canManageShift) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "sale.create" }));
    return false;
  };

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
    if (!requireSaleCreate()) return;
    await api.post("/shifts/open", { openingCash: Number(openingCash || 0) });
    setOpeningCash("");
    load();
  };

  const closeShift = async (e) => {
    e.preventDefault();
    if (!requireSaleCreate()) return;
    const payload = denomPayload(denomCounts);
    const counted = denomTotal(denomCounts);
    const closingNum = Number(closingCash || 0);
    if (payload.length && Math.abs(counted - closingNum) > 0.02) {
      notifyActionRequired(
        tt("shMismatchCountedClosing")
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
    if (!requireSaleCreate()) return;
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
          <div className="page-title">{tt("shTitle")}</div>
          <div className="page-subtitle">{tt("shSubtitle")}</div>
        </div>
      </div>
      <PermissionBanner show={!canManageShift} code="sale.create" tt={tt} />
      {currentShift ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <h4>{tt("shOpenShift")}</h4>
          <p><strong>{tt("shRegister")}:</strong> {currentShift.register?.name || "-"}</p>
          <p><strong>{tt("shOpened")}:</strong> {new Date(currentShift.openedAt).toLocaleString()}</p>
          <p><strong>{tt("shOpeningCash")}:</strong> ৳{Number(currentShift.openingCash || 0).toFixed(2)}</p>
          <p><strong>{tt("shCashSales")}:</strong> ৳{Number(currentShift.cashSales || 0).toFixed(2)}</p>
          <p><strong>{tt("shCashIn")}:</strong> ৳{Number(currentShift.cashIn || 0).toFixed(2)}</p>
          <p><strong>{tt("shCashOut")}:</strong> ৳{Number(currentShift.cashOut || 0).toFixed(2)}</p>
          <p><strong>{tt("shExpectedCash")}:</strong> ৳{Number(currentShift.expectedCash || 0).toFixed(2)}</p>
          {currentAnomalies ? (
            <div className="page-card" style={{ marginBottom: 10, borderColor: "#334155" }}>
              <h5 style={{ marginTop: 0, marginBottom: 6 }}>{tt("shAnomalyAlerts")}</h5>
              <div className="quick-stats">
                <div className="stat">{tt("shRisk")}: {currentAnomalies.riskBand}</div>
                <div className="stat">{tt("shScore")}: {Number(currentAnomalies.anomalyScore || 0).toFixed(2)}</div>
                <div className="stat">{tt("shDiscountPct")}: {Number(currentAnomalies.discountPct || 0).toFixed(2)}%</div>
                <div className="stat">{tt("shReturnPct")}: {Number(currentAnomalies.returnPct || 0).toFixed(2)}%</div>
                <div className="stat">{tt("shOverrideApprovals")}: {Number(currentAnomalies.overrideApprovalCount || 0)}</div>
                <div className="stat">{tt("shManagerApprovals")}: {Number(currentAnomalies.approvalCount || 0)}</div>
              </div>
              <div style={{ marginTop: 6, color: "var(--muted)" }}>
                {tt("shFlags")}:{" "}
                {currentAnomalies.flags?.highDiscountRate ? `${tt("shFlagHighDiscountRate")}; ` : ""}
                {currentAnomalies.flags?.highReturnRate ? `${tt("shFlagHighReturnRate")}; ` : ""}
                {currentAnomalies.flags?.highOverrideCount ? `${tt("shFlagFrequentOverrideApprovals")}; ` : ""}
                {currentAnomalies.flags?.frequentManagerApprovals ? `${tt("shFlagFrequentManagerApprovals")}; ` : ""}
                {!currentAnomalies.flags?.highDiscountRate &&
                !currentAnomalies.flags?.highReturnRate &&
                !currentAnomalies.flags?.highOverrideCount &&
                !currentAnomalies.flags?.frequentManagerApprovals
                  ? tt("shNoAnomalyFlag")
                  : ""}
              </div>
            </div>
          ) : null}
          <form onSubmit={addMovement} className="form-grid" style={{ marginBottom: 12 }}>
            <SearchSelect
              className="form-select-sm"
              value={movementType}
              onChange={(val) => setMovementType(val || "IN")}
              options={[
                { value: "IN", label: tt("shCashIn") },
                { value: "OUT", label: tt("shCashOut") },
              ]}
              isClearable={false}
            />
            <input
              type="number"
              placeholder={tt("shMovementAmount")}
              value={movementAmount}
              onChange={(e) => setMovementAmount(e.target.value)}
            />
            <input
              placeholder={tt("shMovementReason")}
              value={movementReason}
              onChange={(e) => setMovementReason(e.target.value)}
            />
            <button type="submit" disabled={!canManageShift}>{tt("shRecordMovement")}</button>
          </form>
          <div style={{ margin: "8px 0 12px" }}>
            <strong>{tt("shRecentMovements")}:</strong>
            {Array.isArray(currentShift.movements) && currentShift.movements.length ? (
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {currentShift.movements.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    {new Date(m.createdAt).toLocaleTimeString()} - {m.type} ৳{Number(m.amount || 0).toFixed(2)} ({m.reason})
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "6px 0 0" }}>{tt("shNoDrawerMovementsYet")}</p>
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
            <h5 style={{ marginTop: 0, marginBottom: 8 }}>{tt("shBillCoinCount")}</h5>
            <p className="pos-inline-note" style={{ marginBottom: 10 }}>
              {tt("shBillCoinHelp")}
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
                    placeholder={tt("shZero")}
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
                {tt("shCountedFromBillsCoins")}: ৳{Number(denomTotal(denomCounts).toFixed(2)).toFixed(2)}
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setDenomCounts(emptyDenomState());
                  if (!manualClosingCash) setClosingCash("");
                }}
              >
                {tt("shClearCounts")}
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
                <span style={{ fontSize: 13 }}>{tt("shEnterClosingCashManually")}</span>
              </label>
            </div>
          </div>
          <form onSubmit={closeShift} className="form-grid">
            <input
              type="number"
              placeholder={tt("shCountedClosingCash")}
              value={closingCash}
              onChange={(e) => {
                setManualClosingCash(true);
                setClosingCash(e.target.value);
              }}
            />
            <input
              placeholder={tt("shVarianceReasonReq")}
              value={varianceReason}
              onChange={(e) => setVarianceReason(e.target.value)}
            />
            <input
              type="password"
              placeholder={tt("shManagerPinLargeVariance")}
              value={managerApprovalPin}
              onChange={(e) => setManagerApprovalPin(e.target.value)}
            />
            <button type="submit" disabled={!canManageShift}>{tt("shCloseShift")}</button>
          </form>
        </div>
      ) : (
        <form onSubmit={openShift} className="form-grid" style={{ marginBottom: 12 }}>
          <input
            type="number"
            placeholder={tt("shOpeningCashInput")}
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
          />
          <button type="submit" disabled={!canManageShift}>{tt("shOpenShiftAction")}</button>
        </form>
      )}

      <DataTable
        title={tt("shRecentShiftHistory")}
        rows={history.map((row) => ({
          ...row,
          openedAtLabel: new Date(row.openedAt).toLocaleString(),
          closedAtLabel: row.closedAt ? new Date(row.closedAt).toLocaleString() : tt("shOpen"),
        }))}
        searchableKeys={["openedAtLabel", "closedAtLabel"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "openedAtLabel", label: tt("shOpenedAt") },
          { key: "closedAtLabel", label: tt("shClosedAt") },
          { key: "openingCash", label: tt("shOpening"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashSales", label: tt("shCashSales"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashIn", label: tt("shCashIn"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "cashOut", label: tt("shCashOut"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "expectedCash", label: tt("shExpected"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "closingCash", label: tt("shCounted"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "variance", label: tt("shVariance"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "anomalyScore", label: tt("shAnomalyScore"), render: (v) => Number(v || 0).toFixed(2) },
          {
            key: "anomalyRiskBand",
            label: tt("shRisk"),
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
          { key: "varianceReason", label: tt("shVarianceReason") },
          {
            key: "closingDenomination",
            label: tt("shCashCount"),
            render: (v) =>
              Array.isArray(v) && v.length ? (
                <span title={JSON.stringify(v)} style={{ color: "#15803d", fontWeight: 700 }}>
                  {tt("shSaved")}
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
