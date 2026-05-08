import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyError, notifySuccess } from "../utils/notify";
import { formatBDT } from "../utils/currency";
import {
  downloadMushak63XmlWithCompletenessHint,
  resolveSaleIdForMushak63Lookup,
  runMushak63CompletenessCheck,
} from "../services/nbrMushak63";

const reportLang = () =>
  typeof window !== "undefined" && localStorage.getItem("bd_pos_lang") === "bn" ? "bn" : "en";
const bdt = (v) => formatBDT(v, { lang: reportLang(), decimals: 2 });

function SalesLookup() {
  const [query, setQuery] = useState("");
  const [lookupMode, setLookupMode] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState(null);
  const [resolvedId, setResolvedId] = useState(null);

  const findSale = async (overrideQuery, overrideMode) => {
    const q = String(overrideQuery != null ? overrideQuery : query).trim();
    const mode = overrideMode != null ? overrideMode : lookupMode;
    setLoading(true);
    setSale(null);
    setResolvedId(null);
    try {
      const target = await resolveSaleIdForMushak63Lookup(q, mode);
      if (!target) {
        notifyError(
          mode === "saleId"
            ? "Enter a numeric sale ID"
            : mode === "invoice"
              ? "Enter an invoice number"
              : "Enter a sale ID or invoice number"
        );
        return;
      }
      const res = await api.get(`/sales/${target.saleId}/invoice`);
      setSale(res.data);
      setResolvedId(target.saleId);
      notifySuccess(`Loaded sale #${target.saleId}${res.data.invoiceNo ? ` · ${res.data.invoiceNo}` : ""}`);
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get("invoice");
    const sid = params.get("saleId");
    if (inv?.trim()) {
      const v = inv.trim();
      setLookupMode("invoice");
      setQuery(v);
      void findSale(v, "invoice");
      return;
    }
    if (sid?.trim()) {
      const v = sid.trim();
      setLookupMode("saleId");
      setQuery(v);
      void findSale(v, "saleId");
      return;
    }
    try {
      const raw = sessionStorage.getItem("bd_pos_sales_lookup_prefill");
      if (!raw) return;
      sessionStorage.removeItem("bd_pos_sales_lookup_prefill");
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return;
      const nextQ = o.query != null ? String(o.query).trim() : "";
      const nextMode = ["auto", "saleId", "invoice"].includes(o.mode) ? o.mode : "auto";
      if (nextQ) setQuery(nextQ);
      setLookupMode(nextMode);
      if (o.autoSearch && nextQ) {
        void findSale(nextQ, nextMode);
      }
    } catch {
      sessionStorage.removeItem("bd_pos_sales_lookup_prefill");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot navigation / URL prefill
  }, []);

  const openMushakPdf = async () => {
    if (!resolvedId) return;
    try {
      const res = await api.get(`/sales/${resolvedId}/mushak-pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      notifyError(err?.response?.data?.error || "Unable to open Mushak PDF");
    }
  };

  const downloadMushakXml = async () => {
    if (!resolvedId) return;
    try {
      await downloadMushak63XmlWithCompletenessHint(resolvedId, sale?.mushakDocumentNo);
    } catch (err) {
      notifyError(err?.response?.data?.error || "Unable to download Mushak 6.3 XML");
    }
  };

  const checkCompleteness = async () => {
    if (!resolvedId) return;
    try {
      await runMushak63CompletenessCheck(resolvedId);
    } catch (err) {
      notifyError(err?.response?.data?.error || "Completeness check failed");
    }
  };

  const lineRows =
    sale && Array.isArray(sale.items)
      ? sale.items.map((line, idx) => ({
          sl: idx + 1,
          name: line.product?.name || `Product #${line.productId}`,
          qty: line.qty,
          priceLabel: bdt(line.price),
          lineTotalLabel: bdt(Number(line.qty || 0) * Number(line.price || 0)),
        }))
      : [];

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Sale lookup</div>
          <div className="page-subtitle">Find a completed sale by ID or invoice, then open VAT / Mushak tools</div>
        </div>
      </div>

      <div className="page-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            Match by
            <select className="form-select-sm" value={lookupMode} onChange={(e) => setLookupMode(e.target.value)} style={{ minWidth: 140 }}>
              <option value="auto">Auto</option>
              <option value="saleId">Sale ID</option>
              <option value="invoice">Invoice number</option>
            </select>
          </label>
          <input
            type="text"
            placeholder={
              lookupMode === "saleId"
                ? "Sale ID"
                : lookupMode === "invoice"
                  ? "Invoice number"
                  : "Sale ID or invoice no."
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 220 }}
            onKeyDown={(e) => e.key === "Enter" && findSale()}
          />
          <button type="button" className="btn-primary btn-sm" onClick={() => findSale()} disabled={loading}>
            {loading ? "Loading…" : "Find sale"}
          </button>
        </div>
      </div>

      {sale ? (
        <>
          <div className="page-card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="btn-secondary btn-sm" onClick={openMushakPdf}>
                Mushak PDF
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={downloadMushakXml}>
                Mushak 6.3 XML
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={checkCompleteness}>
                Check Mushak completeness
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
              Internal sale id: <strong>{resolvedId}</strong>
              {sale.mushakDocumentNo ? (
                <>
                  {" "}
                  · Mushak ref: <strong>{sale.mushakDocumentNo}</strong>
                </>
              ) : null}
            </p>
            <div className="quick-stats" style={{ marginTop: 8 }}>
              <div className="stat">Invoice: {sale.invoiceNo || "—"}</div>
              <div className="stat">Date: {new Date(sale.createdAt).toLocaleString()}</div>
              <div className="stat">Payment: {sale.paymentMethod || "—"}</div>
              <div className="stat">Customer: {sale.customer?.name || "Walk-in"}</div>
            </div>
            <div className="quick-stats" style={{ marginTop: 8 }}>
              <div className="stat">Subtotal: {bdt(sale.subTotal)}</div>
              <div className="stat">VAT: {bdt(sale.vatAmount)}</div>
              <div className="stat">Discount: {bdt(sale.discount)}</div>
              <div className="stat" style={{ background: "#dcfce7" }}>
                Total: {bdt(sale.total)}
              </div>
              <div className="stat">Paid: {bdt(sale.paidAmount)}</div>
              <div className="stat">Due: {bdt(sale.dueAmount)}</div>
            </div>
            {sale.buyerBinOrNidNote ? (
              <p style={{ fontSize: 13, marginTop: 8 }}>
                <strong>Buyer BIN / NID note:</strong> {sale.buyerBinOrNidNote}
              </p>
            ) : null}
          </div>

          <DataTable
            title="Line items"
            rows={lineRows}
            pageSize={10}
            allowExport={false}
            searchableKeys={["name"]}
            columns={[
              { key: "sl", label: "SL" },
              { key: "name", label: "Product" },
              { key: "qty", label: "Qty" },
              { key: "priceLabel", label: "Price" },
              { key: "lineTotalLabel", label: "Line total" },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

export default SalesLookup;
