import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { consumeGlobalSubmitError, notifySuccess } from "../utils/notify";

export default function FinanceBankImports() {
  const [imports, setImports] = useState([]);
  const [selectedImportId, setSelectedImportId] = useState(null);
  const [linesPack, setLinesPack] = useState({ import: null, lines: [] });
  const [chequePack, setChequePack] = useState({ import: null, lines: [], cheques: [], suggestions: [] });
  const [postingAdjust, setPostingAdjust] = useState(false);
  const [togglingClose, setTogglingClose] = useState(false);
  const [runningAutoMatch, setRunningAutoMatch] = useState(false);
  const [autoMatchReport, setAutoMatchReport] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewSelection, setPreviewSelection] = useState({});
  const [previewMinConfidence, setPreviewMinConfidence] = useState(70);
  const [snapshotFilter, setSnapshotFilter] = useState({ status: "ALL", from: "", to: "", overdueOnly: false, exceptionSlaHours: 24 });
  const [snapshotData, setSnapshotData] = useState({ summary: null, rows: [] });
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [rawJson, setRawJson] = useState(`{\n  "label": "Jan bank export",\n  "lines": [\n    { "txnDate": "2026-05-01T10:00:00.000Z", "amount": 1500.5, "direction": "CREDIT", "description": "Bkash settle", "reference": "trx-001" }\n  ]\n}\n`);
  const [busy, setBusy] = useState(false);

  const loadImports = async () => {
    const res = await api.get("/finance/bank/imports");
    setImports(res.data || []);
  };

  useEffect(() => {
    loadImports();
  }, []);

  const loadLines = async (importId) => {
    if (!importId) {
      setLinesPack({ import: null, lines: [] });
      return;
    }
    const res = await api.get(`/finance/bank/imports/${importId}/lines`);
    setLinesPack({ import: res.data?.import || null, lines: res.data?.lines || [] });
  };

  const loadChequeWorkspace = async (importId) => {
    if (!importId) {
      setChequePack({ import: null, lines: [], cheques: [], suggestions: [] });
      return;
    }
    const res = await api.get(`/finance/bank/imports/${importId}/cheque-workspace`);
    setChequePack({
      import: res.data?.import || null,
      lines: res.data?.lines || [],
      cheques: res.data?.cheques || [],
      suggestions: res.data?.suggestions || [],
      summary: res.data?.summary || null,
      suggestedJournal: res.data?.suggestedJournal || null,
    });
  };

  useEffect(() => {
    loadLines(selectedImportId);
    loadChequeWorkspace(selectedImportId);
  }, [selectedImportId]);

  const loadSnapshot = async (nextFilter = snapshotFilter) => {
    setLoadingSnapshot(true);
    try {
      const params = {
        status: nextFilter.status || "ALL",
        ...(nextFilter.from ? { from: nextFilter.from } : {}),
        ...(nextFilter.to ? { to: nextFilter.to } : {}),
        ...(nextFilter.overdueOnly ? { overdueOnly: "true" } : {}),
        exceptionSlaHours: Number(nextFilter.exceptionSlaHours || 24),
      };
      const res = await api.get("/finance/bank/reconciliation-snapshot", { params });
      setSnapshotData({ summary: res.data?.summary || null, rows: res.data?.rows || [] });
    } finally {
      setLoadingSnapshot(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, []);

  const submitImport = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const parsed = JSON.parse(rawJson || "{}");
      await api.post("/finance/bank/imports", parsed);
      await loadImports();
      notifySuccess("imported bank rows.");
    } catch {
      consumeGlobalSubmitError();
    } finally {
      setBusy(false);
    }
  };

  const matchLine = async (line) => {
    const payIdStr = window.prompt("SalePayment id to link (from sale detail / settlements):");
    if (!payIdStr) return;
    const salePaymentId = Number(payIdStr);
    if (Number.isNaN(salePaymentId)) return;
    await api.post(`/finance/bank/lines/${line.id}/match`, { salePaymentId });
    await loadLines(selectedImportId);
    notifySuccess("line linked.");
  };

  const unmatchLine = async (line) => {
    if (!window.confirm("Remove match?")) return;
    await api.delete(`/finance/bank/lines/${line.id}/match`);
    await loadLines(selectedImportId);
  };

  const matchCheque = async (line) => {
    const suggested = (chequePack.suggestions || []).find((s) => Number(s.lineId) === Number(line.id))?.suggestedChequeId;
    const defaultValue = suggested ? String(suggested) : "";
    const chequeIdStr = window.prompt("Cheque id to link:", defaultValue);
    if (!chequeIdStr) return;
    const chequeId = Number(chequeIdStr);
    if (Number.isNaN(chequeId)) return;
    await api.post(`/finance/bank/lines/${line.id}/match-cheque`, { chequeId });
    await loadChequeWorkspace(selectedImportId);
    notifySuccess("line linked to cheque.");
  };

  const unmatchCheque = async (line) => {
    if (!window.confirm("Remove cheque match?")) return;
    await api.delete(`/finance/bank/lines/${line.id}/match-cheque`);
    await loadChequeWorkspace(selectedImportId);
  };

  const postAdjustmentJournal = async () => {
    if (!selectedImportId) return;
    if (!window.confirm("Post suggested reconciliation adjustment journal now?")) return;
    setPostingAdjust(true);
    try {
      await api.post(`/finance/bank/imports/${selectedImportId}/reconcile-adjustment-journal`, {});
      await loadChequeWorkspace(selectedImportId);
      notifySuccess("reconciliation adjustment journal posted.");
    } finally {
      setPostingAdjust(false);
    }
  };

  const allocateLine = async (line) => {
    const targetRaw = window.prompt("Allocation target type: SALE_PAYMENT or CHEQUE", "CHEQUE");
    if (!targetRaw) return;
    const targetType = String(targetRaw || "").trim().toUpperCase();
    if (!["SALE_PAYMENT", "CHEQUE"].includes(targetType)) return;
    const idPrompt = targetType === "SALE_PAYMENT" ? "SalePayment ID" : "Cheque ID";
    const idStr = window.prompt(idPrompt);
    if (!idStr) return;
    const amountStr = window.prompt("Allocation amount", String(Number(line.remainingAmount || line.amount || 0).toFixed(2)));
    if (!amountStr) return;
    const payload = {
      targetType,
      amount: Number(amountStr),
      ...(targetType === "SALE_PAYMENT" ? { salePaymentId: Number(idStr) } : { chequeId: Number(idStr) }),
    };
    await api.post(`/finance/bank/lines/${line.id}/allocations`, payload);
    await loadChequeWorkspace(selectedImportId);
    notifySuccess("allocation added.");
  };

  const removeAllocation = async (allocId) => {
    if (!window.confirm("Remove this allocation?")) return;
    await api.delete(`/finance/bank/allocations/${allocId}`);
    await loadChequeWorkspace(selectedImportId);
    notifySuccess("allocation removed.");
  };

  const flagException = async (line) => {
    const reason = window.prompt("Exception reason (required):", line.exceptionReason || "");
    if (!reason) return;
    const note = window.prompt("Exception note (optional):", line.exceptionNote || "") || "";
    await api.post(`/finance/bank/lines/${line.id}/exception`, { reason, note });
    await Promise.all([loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
    notifySuccess("exception flagged.");
  };

  const resolveException = async (line) => {
    const note = window.prompt("Resolution note (optional):", "") || "";
    await api.post(`/finance/bank/lines/${line.id}/exception/resolve`, { note });
    await Promise.all([loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
    notifySuccess("exception resolved.");
  };

  const isClosed = String(chequePack.import?.status || linesPack.import?.status || "OPEN").toUpperCase() === "CLOSED";

  const closeImport = async () => {
    if (!selectedImportId) return;
    const closingNote = window.prompt("Closing note (optional):", "") || "";
    if (!window.confirm("Close this import batch? Matching/allocation/edit actions will be locked.")) return;
    setTogglingClose(true);
    try {
      await api.post(`/finance/bank/imports/${selectedImportId}/close`, { closingNote });
      await Promise.all([loadImports(), loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
      notifySuccess("import batch closed.");
    } finally {
      setTogglingClose(false);
    }
  };

  const reopenImport = async () => {
    if (!selectedImportId) return;
    if (!window.confirm("Reopen this import batch?")) return;
    setTogglingClose(true);
    try {
      await api.post(`/finance/bank/imports/${selectedImportId}/reopen`, {});
      await Promise.all([loadImports(), loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
      notifySuccess("import batch reopened.");
    } finally {
      setTogglingClose(false);
    }
  };

  const runAutoMatch = async () => {
    if (!selectedImportId) return;
    const tolStr = window.prompt("Amount tolerance for auto-match", "0.01");
    if (!tolStr) return;
    const amountTolerance = Number(tolStr);
    if (!Number.isFinite(amountTolerance) || amountTolerance < 0) return;
    setRunningAutoMatch(true);
    try {
      const res = await api.post(`/finance/bank/imports/${selectedImportId}/auto-match`, { amountTolerance });
      setAutoMatchReport(res.data || null);
      await Promise.all([loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
      notifySuccess("auto-match completed.");
    } finally {
      setRunningAutoMatch(false);
    }
  };

  const runAutoMatchPreview = async () => {
    if (!selectedImportId) return;
    const tolStr = window.prompt("Preview amount tolerance", "0.01");
    if (!tolStr) return;
    const amountTolerance = Number(tolStr);
    if (!Number.isFinite(amountTolerance) || amountTolerance < 0) return;
    setPreviewBusy(true);
    try {
      const res = await api.post(`/finance/bank/imports/${selectedImportId}/auto-match/preview`, { amountTolerance });
      const rows = res.data?.rows || [];
      setPreviewRows(rows);
      setPreviewSelection(Object.fromEntries(rows.map((r) => [String(r.lineId), true])));
      notifySuccess(`preview generated (${rows.length} candidates).`);
    } finally {
      setPreviewBusy(false);
    }
  };

  const applySelectedPreview = async () => {
    if (!selectedImportId) return;
    const selections = (previewRows || [])
      .filter((r) => Number(r.confidence || 0) >= Number(previewMinConfidence || 0))
      .filter((r) => previewSelection[String(r.lineId)])
      .map((r) => ({ lineId: r.lineId, type: r.type, targetId: r.targetId }));
    if (!selections.length) return;
    if (!window.confirm(`Apply ${selections.length} selected preview matches?`)) return;
    setApplyingPreview(true);
    try {
      const res = await api.post(`/finance/bank/imports/${selectedImportId}/auto-match/apply-selected`, { selections });
      await Promise.all([loadLines(selectedImportId), loadChequeWorkspace(selectedImportId)]);
      notifySuccess(`applied ${Number(res.data?.applied || 0)} matches.`);
      setPreviewRows([]);
      setPreviewSelection({});
    } finally {
      setApplyingPreview(false);
    }
  };

  const getConfidenceBadgeStyle = (confidence) => {
    const c = Number(confidence || 0);
    if (c >= 85) return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 999, padding: "2px 8px", fontSize: 12 };
    if (c >= 70) return { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047", borderRadius: 999, padding: "2px 8px", fontSize: 12 };
    return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: 999, padding: "2px 8px", fontSize: 12 };
  };

  const exportSnapshotCSV = async () => {
    const params = new URLSearchParams();
    params.set("status", snapshotFilter.status || "ALL");
    if (snapshotFilter.from) params.set("from", snapshotFilter.from);
    if (snapshotFilter.to) params.set("to", snapshotFilter.to);
    if (snapshotFilter.overdueOnly) params.set("overdueOnly", "true");
    params.set("exceptionSlaHours", String(Number(snapshotFilter.exceptionSlaHours || 24)));
    const res = await api.get(`/finance/bank/reconciliation-snapshot/export.csv?${params.toString()}`, {
      responseType: "blob",
    });
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bank-reconciliation-snapshot.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Bank CSV / JSON reconciliation</h2>
      <p className="text-muted">
        Import statement lines via JSON, then link each CREDIT row to an existing SalePayment row by id for audit trail.
      </p>

      <form onSubmit={submitImport} className="page-card" style={{ marginTop: 16 }}>
        <h4>New import payload</h4>
        <textarea
          rows={14}
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
        />
        <button type="submit" className="btn-secondary" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      <div style={{ marginTop: 24 }}>
        <label>
          Selected batch:&nbsp;
          <select
            value={selectedImportId != null ? String(selectedImportId) : ""}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedImportId(v ? Number(v) : null);
            }}
          >
            <option value="">— Choose —</option>
            {(imports || []).map((row) => (
              <option key={row.id} value={row.id}>
                #{row.id} · {row.label || "Untitled"} · {row.importedAt ? new Date(row.importedAt).toLocaleString() : ""} (
                {(row._count && row._count.lines) ?? row.rowCount ?? 0} rows)
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedImportId ? (
        <div className="page-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <strong>Status:</strong>{" "}
            <span className={isClosed ? "badge bg-danger-subtle text-danger" : "badge bg-success-subtle text-success"}>
              {isClosed ? "CLOSED" : "OPEN"}
            </span>
            {chequePack.import?.closedAt ? (
              <span className="text-muted" style={{ marginLeft: 8 }}>
                Closed at {new Date(chequePack.import.closedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-secondary btn-sm" disabled={isClosed || runningAutoMatch} onClick={runAutoMatch}>
              {runningAutoMatch ? "Auto-matching..." : "Run Auto-Match"}
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={isClosed || previewBusy} onClick={runAutoMatchPreview}>
              {previewBusy ? "Preparing Preview..." : "Preview Auto-Match"}
            </button>
            {!isClosed ? (
              <button type="button" className="btn-danger btn-sm" disabled={togglingClose} onClick={closeImport}>
                {togglingClose ? "Closing..." : "Close Batch"}
              </button>
            ) : (
              <button type="button" className="btn-secondary btn-sm" disabled={togglingClose} onClick={reopenImport}>
                {togglingClose ? "Reopening..." : "Reopen Batch"}
              </button>
            )}
          </div>
        </div>
      ) : null}
      {autoMatchReport ? (
        <div className="page-card" style={{ marginTop: 10, padding: 12 }}>
          <strong>Auto-match result:</strong>{" "}
          Scanned {Number(autoMatchReport.scannedLines || 0)}, matched cheque {Number(autoMatchReport.matchedCheque || 0)},
          matched payment {Number(autoMatchReport.matchedSalePayment || 0)}, skipped allocated {Number(autoMatchReport.skippedWithAllocations || 0)},
          no candidate {Number(autoMatchReport.noCandidate || 0)}.
        </div>
      ) : null}
      {previewRows.length > 0 ? (
        <div className="page-card" style={{ marginTop: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <strong>
              Auto-match Preview (
              {(previewRows || []).filter((r) => Number(r.confidence || 0) >= Number(previewMinConfidence || 0)).length}
              /{previewRows.length} at {previewMinConfidence}%+)
            </strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Min confidence
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={previewMinConfidence}
                  onChange={(e) => setPreviewMinConfidence(Math.max(0, Math.min(100, Number(e.target.value || 0))))}
                  style={{ width: 80 }}
                />
              </label>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  setPreviewSelection((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                      (previewRows || [])
                        .filter((r) => Number(r.confidence || 0) >= Number(previewMinConfidence || 0))
                        .map((r) => [String(r.lineId), true])
                    ),
                  }))
                }
              >
                Select Filtered
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setPreviewSelection({})}>
                Clear Selection
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={applyingPreview || isClosed} onClick={applySelectedPreview}>
              {applyingPreview ? "Applying..." : "Apply Selected"}
            </button>
            </div>
          </div>
          <DataTable
            title=""
            rows={previewRows
              .filter((r) => Number(r.confidence || 0) >= Number(previewMinConfidence || 0))
              .map((r) => ({ ...r, selected: !!previewSelection[String(r.lineId)] }))}
            columns={[
              {
                key: "selected",
                label: "",
                render: (v, row) => (
                  <input
                    type="checkbox"
                    checked={!!v}
                    onChange={(e) => setPreviewSelection((prev) => ({ ...prev, [String(row.lineId)]: e.target.checked }))}
                  />
                ),
              },
              { key: "lineId", label: "Line" },
              { key: "lineAmount", label: "Amount", render: (v) => Number(v || 0).toFixed(2) },
              { key: "lineReference", label: "Ref", render: (v) => v || "-" },
              { key: "type", label: "Target Type" },
              { key: "targetLabel", label: "Candidate" },
              {
                key: "confidence",
                label: "Confidence",
                render: (v) => <span style={getConfidenceBadgeStyle(v)}>{Number(v || 0)}%</span>,
              },
            ]}
          />
        </div>
      ) : null}

      <DataTable
        title={`Lines ${linesPack.import?.id ? `for import ${linesPack.import.id}` : ""}`}
        rows={(linesPack.lines || []).map((ln) => ({
          ...ln,
          saleInvoice: ln.matchedSalePayment?.sale?.invoiceNo || ln.matchedSalePayment?.saleId || "",
          matchStatus: ln.matchedSalePaymentId ? "MATCHED" : "OPEN",
        }))}
        columns={[
          { key: "id", label: "Line" },
          { key: "txnDate", label: "Date", render: (v) => (v ? new Date(v).toLocaleDateString() : "") },
          { key: "direction", label: "Dir" },
          { key: "amount", label: "Amount", render: (v) => Number(v || 0).toFixed(2) },
          { key: "description", label: "Description", render: (v) => v || "-" },
          { key: "reference", label: "Ref", render: (v) => v || "-" },
          { key: "matchStatus", label: "Match" },
          {
            key: "saleInvoice",
            label: "Sale",
            render: (v, r) => r.matchedSalePayment?.sale?.invoiceNo || v || "-",
          },
          {
            key: "actions",
            label: "",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                {!row.matchedSalePaymentId ? (
                  <button type="button" className="btn-secondary btn-sm" disabled={isClosed} onClick={() => matchLine(row)}>
                    Link SalePayment…
                  </button>
                ) : (
                  <button type="button" className="btn-danger btn-sm" disabled={isClosed} onClick={() => unmatchLine(row)}>
                    Unmatch
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <DataTable
        title={`Cheque Reconciliation Workspace ${chequePack.import?.id ? `(import ${chequePack.import.id})` : ""}`}
        rows={(chequePack.lines || [])
          .filter((ln) => ln.direction === "CREDIT")
          .map((ln) => {
            const allocatedAmount = (ln.allocations || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
            const remainingAmount = Number((Number(ln.amount || 0) - allocatedAmount).toFixed(2));
            const suggestedChequeId =
              (chequePack.suggestions || []).find((s) => Number(s.lineId) === Number(ln.id))?.suggestedChequeId || null;
            const suggestedCheque = (chequePack.cheques || []).find((c) => Number(c.id) === Number(suggestedChequeId));
            return {
              ...ln,
              matchStatus: remainingAmount <= 0.001 ? "FULLY_ALLOCATED" : allocatedAmount > 0 ? "PARTIAL" : ln.matchedChequeId ? "MATCHED" : "OPEN",
              exceptionStatus: ln.exceptionStatus || "NONE",
              exceptionAgeHours: Number(ln.exceptionAgeHours || 0),
              isExceptionOverdue: !!ln.isExceptionOverdue,
              chequeNo: ln.matchedCheque?.chequeNo || "",
              suggestedChequeId,
              suggestedChequeNo: suggestedCheque?.chequeNo || "",
              allocatedAmount,
              remainingAmount,
            };
          })}
        columns={[
          { key: "id", label: "Line" },
          { key: "txnDate", label: "Date", render: (v) => (v ? new Date(v).toLocaleDateString() : "") },
          { key: "amount", label: "Amount", render: (v) => Number(v || 0).toFixed(2) },
          { key: "allocatedAmount", label: "Allocated", render: (v) => Number(v || 0).toFixed(2) },
          { key: "remainingAmount", label: "Remaining", render: (v) => Number(v || 0).toFixed(2) },
          { key: "reference", label: "Ref", render: (v) => v || "-" },
          { key: "description", label: "Description", render: (v) => v || "-" },
          { key: "matchStatus", label: "Match" },
          {
            key: "exceptionStatus",
            label: "Exception",
            render: (v, r) => {
              if (String(v || "NONE") !== "OPEN") return v || "NONE";
              return r.isExceptionOverdue ? "OPEN (OVERDUE)" : "OPEN";
            },
          },
          { key: "chequeNo", label: "Linked Cheque", render: (v) => v || "-" },
          { key: "suggestedChequeNo", label: "Suggested", render: (v, r) => (v ? `${v} (#${r.suggestedChequeId})` : "-") },
          {
            key: "allocations",
            label: "Allocations",
            render: (_, row) => {
              const items = row.allocations || [];
              if (!items.length) return "-";
              return items
                .map((a) => {
                  const name =
                    a.targetType === "CHEQUE"
                      ? `CHQ#${a.cheque?.chequeNo || a.chequeId}`
                      : `PAY#${a.salePayment?.id || a.salePaymentId}`;
                  return `${name}:${Number(a.amount || 0).toFixed(2)}`;
                })
                .join(", ");
            },
          },
          {
            key: "actions",
            label: "",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {!row.matchedChequeId ? (
                  <button type="button" className="btn-secondary btn-sm" disabled={isClosed} onClick={() => matchCheque(row)}>
                    Link Cheque…
                  </button>
                ) : (
                  <button type="button" className="btn-danger btn-sm" disabled={isClosed} onClick={() => unmatchCheque(row)}>
                    Unmatch Cheque
                  </button>
                )}
                <button type="button" className="btn-secondary btn-sm" onClick={() => allocateLine(row)} disabled={isClosed || Number(row.remainingAmount || 0) <= 0.001}>
                  Allocate…
                </button>
                {(row.allocations || []).length > 0 ? (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={isClosed}
                    onClick={() => removeAllocation(row.allocations[0].id)}
                    title="Removes the latest allocation entry"
                  >
                    Undo Last Allocation
                  </button>
                ) : null}
                {String(row.exceptionStatus || "NONE") !== "OPEN" ? (
                  <button type="button" className="btn-secondary btn-sm" disabled={isClosed} onClick={() => flagException(row)}>
                    Flag Exception
                  </button>
                ) : (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => resolveException(row)}>
                    Resolve Exception
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <DataTable
        title="Exception Queue"
        rows={(chequePack.lines || [])
          .filter((ln) => String(ln.exceptionStatus || "NONE") === "OPEN")
          .map((ln) => ({
            ...ln,
            resolvedByName: ln.exceptionResolvedBy?.name || "-",
          }))}
        columns={[
          { key: "id", label: "Line" },
          { key: "txnDate", label: "Date", render: (v) => (v ? new Date(v).toLocaleDateString() : "") },
          { key: "amount", label: "Amount", render: (v) => Number(v || 0).toFixed(2) },
          { key: "reference", label: "Ref", render: (v) => v || "-" },
          { key: "exceptionReason", label: "Reason", render: (v) => v || "-" },
          { key: "exceptionNote", label: "Note", render: (v) => v || "-" },
          { key: "exceptionAgeHours", label: "Age (hrs)", render: (v) => Number(v || 0).toFixed(1) },
          {
            key: "isExceptionOverdue",
            label: "SLA",
            render: (v) => (v ? "OVERDUE" : "ON TIME"),
          },
          { key: "exceptionRaisedAt", label: "Raised", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
          {
            key: "actions",
            label: "",
            render: (_, row) => (
              <button type="button" className="btn-secondary btn-sm" onClick={() => resolveException(row)}>
                Resolve
              </button>
            ),
          },
        ]}
      />

      {chequePack.summary ? (
        <div className="page-card" style={{ marginTop: 14 }}>
          <h4 style={{ marginTop: 0 }}>Reconciliation Summary</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
            <div className="stat">Credits: {Number(chequePack.summary.credits || 0).toFixed(2)}</div>
            <div className="stat">Debits: {Number(chequePack.summary.debits || 0).toFixed(2)}</div>
            <div className="stat">Matched Known: {Number(chequePack.summary.matchedKnown || 0).toFixed(2)}</div>
            <div className="stat">Unmatched Net: {Number(chequePack.summary.unmatchedNet || 0).toFixed(2)}</div>
          </div>
          {chequePack.suggestedJournal ? (
            <div style={{ marginTop: 10 }}>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Suggested adjustment: {chequePack.suggestedJournal.direction} {Number(chequePack.suggestedJournal.amount || 0).toFixed(2)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={postAdjustmentJournal} disabled={postingAdjust || isClosed}>
                  {postingAdjust ? "Posting..." : "Post Adjustment Journal"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-muted" style={{ marginTop: 10 }}>No adjustment needed.</div>
          )}
        </div>
      ) : null}

      <div className="page-card" style={{ marginTop: 16, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Bank Reconciliation Snapshot</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            Status
            <select value={snapshotFilter.status} onChange={(e) => setSnapshotFilter((s) => ({ ...s, status: e.target.value }))}>
              <option value="ALL">All</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={snapshotFilter.from} onChange={(e) => setSnapshotFilter((s) => ({ ...s, from: e.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={snapshotFilter.to} onChange={(e) => setSnapshotFilter((s) => ({ ...s, to: e.target.value }))} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!snapshotFilter.overdueOnly}
              onChange={(e) => setSnapshotFilter((s) => ({ ...s, overdueOnly: e.target.checked }))}
            />
            Overdue exceptions only
          </label>
          <label>
            Exception SLA (hrs)
            <input
              type="number"
              min="1"
              value={snapshotFilter.exceptionSlaHours}
              onChange={(e) => setSnapshotFilter((s) => ({ ...s, exceptionSlaHours: Number(e.target.value || 24) }))}
              style={{ width: 100 }}
            />
          </label>
          <button type="button" className="btn-secondary btn-sm" onClick={() => loadSnapshot(snapshotFilter)} disabled={loadingSnapshot}>
            {loadingSnapshot ? "Loading..." : "Refresh Snapshot"}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={exportSnapshotCSV}>
            Export CSV
          </button>
        </div>
        {snapshotData.summary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 8, marginTop: 10 }}>
            <div className="stat">Imports: {Number(snapshotData.summary.importCount || 0)}</div>
            <div className="stat">Closed: {Number(snapshotData.summary.closedCount || 0)}</div>
            <div className="stat">Adjusted: {Number(snapshotData.summary.adjustedCount || 0)}</div>
            <div className="stat">Matched %: {Number(snapshotData.summary.matchedPct || 0).toFixed(2)}%</div>
            <div className="stat">Unmatched: {Number(snapshotData.summary.totalUnmatched || 0).toFixed(2)}</div>
            <div className="stat">Open Exceptions: {Number(snapshotData.summary.openExceptionCount || 0)}</div>
            <div className="stat">Overdue Exceptions: {Number(snapshotData.summary.overdueExceptionCount || 0)}</div>
          </div>
        ) : null}
        <DataTable
          title=""
          rows={snapshotData.rows || []}
          columns={[
            { key: "importId", label: "Import" },
            { key: "label", label: "Label", render: (v) => v || "-" },
            { key: "status", label: "Status" },
            { key: "lineCount", label: "Lines" },
            { key: "matchedPct", label: "Matched %", render: (v) => `${Number(v || 0).toFixed(2)}%` },
            { key: "unmatchedAmount", label: "Unmatched", render: (v) => Number(v || 0).toFixed(2) },
            { key: "openExceptionCount", label: "Open Ex" },
            { key: "overdueExceptionCount", label: "Overdue Ex" },
            { key: "adjustmentPosted", label: "Adjust", render: (v, r) => (v ? `YES #${r.adjustmentJournalId}` : "NO") },
            { key: "importedAt", label: "Imported", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
          ]}
        />
      </div>
    </div>
  );
}
