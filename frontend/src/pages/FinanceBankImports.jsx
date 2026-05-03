import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { consumeGlobalSubmitError, notifySuccess } from "../utils/notify";

export default function FinanceBankImports() {
  const [imports, setImports] = useState([]);
  const [selectedImportId, setSelectedImportId] = useState(null);
  const [linesPack, setLinesPack] = useState({ import: null, lines: [] });
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

  useEffect(() => {
    loadLines(selectedImportId);
  }, [selectedImportId]);

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
                  <button type="button" className="btn-secondary btn-sm" onClick={() => matchLine(row)}>
                    Link SalePayment…
                  </button>
                ) : (
                  <button type="button" className="btn-danger btn-sm" onClick={() => unmatchLine(row)}>
                    Unmatch
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
