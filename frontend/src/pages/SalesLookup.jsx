import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyError, notifySuccess } from "../utils/notify";
import { formatBDT } from "../utils/currency";
import { formatSaleLineQtyDisplay, getBillingUnitsForSaleLine } from "../utils/formatSaleLineQty";
import { getLang, t } from "../i18n";
import {
  downloadMushak63XmlWithCompletenessHint,
  resolveSaleIdForMushak63Lookup,
  runMushak63CompletenessCheck,
} from "../services/nbrMushak63";
import SearchSelect from "../components/SearchSelect";

const reportLang = () =>
  typeof window !== "undefined" && localStorage.getItem("bd_pos_lang") === "bn" ? "bn" : "en";
const bdt = (v) => formatBDT(v, { lang: reportLang(), decimals: 2 });
const tt = (key, params) => t(reportLang(), key, params);

function SalesLookup() {
  const [panel, setPanel] = useState("sale");
  const [query, setQuery] = useState("");
  const [lookupMode, setLookupMode] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState(null);
  const [resolvedId, setResolvedId] = useState(null);
  const [serialQuery, setSerialQuery] = useState("");
  const [serialResult, setSerialResult] = useState(null);
  const [serialLoading, setSerialLoading] = useState(false);

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

  const findSerial = async () => {
    const q = serialQuery.trim();
    if (q.length < 8) {
      notifyError(tt("salesLookupSerialNotFound"));
      return;
    }
    setSerialLoading(true);
    setSerialResult(null);
    try {
      const res = await api.get("/serials/lookup", { params: { serial: q } });
      setSerialResult(res.data);
      notifySuccess(tt("salesLookupSerialLoaded", { saleId: res.data?.sale?.id || "" }));
    } catch (err) {
      notifyError(err?.response?.data?.error || tt("salesLookupSerialNotFound"));
    } finally {
      setSerialLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get("invoice");
    const sid = params.get("saleId");
    if (inv?.trim()) {
      const v = inv.trim();
      setPanel("sale");
      setLookupMode("invoice");
      setQuery(v);
      void findSale(v, "invoice");
      return;
    }
    if (sid?.trim()) {
      const v = sid.trim();
      setPanel("sale");
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
      ? sale.items.map((line, idx) => {
          const bill = getBillingUnitsForSaleLine(line);
          const revenue = bill * Number(line.price || 0);
          const unitCost = Number(line.cost || 0);
          const cogs = unitCost > 0 ? bill * unitCost : 0;
          const margin = revenue - cogs;
          const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
          const batchInfo = (line.batchAllocations || [])
            .map((b) => {
              const code = b.batch?.batchCode || `#${b.batchId}`;
              const exp = b.batch?.expiryDate
                ? new Date(b.batch.expiryDate).toLocaleDateString()
                : "";
              return exp ? `${code} (${exp})` : code;
            })
            .join(", ");
          const serialInfo = line.serialNumber ? `IMEI: ${line.serialNumber}` : "";
          const warrantyInfo =
            line.warrantyUntil && line.serialNumber
              ? new Date(line.warrantyUntil).toLocaleDateString()
              : "";
          return {
            sl: idx + 1,
            name: line.product?.name || `Product #${line.productId}`,
            qty: formatSaleLineQtyDisplay(line, tt),
            priceLabel: bdt(line.price),
            costLabel: unitCost > 0 ? bdt(unitCost) : "—",
            lineTotalLabel: bdt(revenue),
            marginLabel: unitCost > 0 ? bdt(margin) : "—",
            marginPctLabel: unitCost > 0 ? `${marginPct.toFixed(1)}%` : "—",
            batches: [batchInfo, serialInfo, warrantyInfo ? `Warranty: ${warrantyInfo}` : ""].filter(Boolean).join(" · ") || "—",
          };
        })
      : [];

  const warrantyLabel = () => {
    if (!serialResult?.warrantyUntil) return tt("salesLookupNoWarranty");
    const date = new Date(serialResult.warrantyUntil).toLocaleDateString();
    return serialResult.warrantyActive
      ? tt("salesLookupWarrantyActive", { date })
      : tt("salesLookupWarrantyExpired", { date });
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Sale lookup</div>
          <div className="page-subtitle">Find a completed sale by ID or invoice, then open VAT / Mushak tools</div>
        </div>
      </div>

      <div className="page-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className={`btn-secondary btn-sm${panel === "sale" ? " btn-primary" : ""}`}
            onClick={() => setPanel("sale")}
          >
            Sale / invoice
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm${panel === "serial" ? " btn-primary" : ""}`}
            onClick={() => setPanel("serial")}
          >
            {tt("salesLookupSerial")}
          </button>
        </div>

        {panel === "sale" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              Match by
              <SearchSelect
                className="form-select-sm"
                value={lookupMode}
                onChange={(val) => setLookupMode(val || "auto")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "saleId", label: "Sale ID" },
                  { value: "invoice", label: "Invoice number" },
                ]}
                isClearable={false}
              />
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
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder={tt("salesLookupSerialPlaceholder")}
              value={serialQuery}
              onChange={(e) => setSerialQuery(e.target.value)}
              style={{ width: 260 }}
              onKeyDown={(e) => e.key === "Enter" && findSerial()}
            />
            <button type="button" className="btn-primary btn-sm" onClick={findSerial} disabled={serialLoading}>
              {serialLoading ? "Loading…" : tt("salesLookupSerialFind")}
            </button>
          </div>
        )}
      </div>

      {panel === "serial" && serialResult ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>{serialResult.product?.name}</strong> · {serialResult.serialNumber}
          </p>
          <p className="text-muted" style={{ margin: "0 0 6px", fontSize: 13 }}>
            Sale #{serialResult.sale?.id}
            {serialResult.sale?.invoiceNo ? ` · ${serialResult.sale.invoiceNo}` : ""} ·{" "}
            {serialResult.soldAt ? new Date(serialResult.soldAt).toLocaleString() : ""}
          </p>
          {serialResult.sale?.customer ? (
            <p className="text-muted" style={{ margin: "0 0 6px", fontSize: 13 }}>
              {serialResult.sale.customer.name} · {serialResult.sale.customer.phone || "—"}
            </p>
          ) : null}
          <p style={{ margin: 0 }}>{warrantyLabel()}</p>
        </div>
      ) : null}

      {panel === "sale" && sale ? (
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
                Completeness check
              </button>
            </div>
          </div>

          <div className="page-card" style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Sale ID
                </div>
                <strong>{resolvedId}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Invoice
                </div>
                <strong>{sale.invoiceNo || "—"}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Total
                </div>
                <strong>{bdt(sale.totalAmount ?? sale.total)}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Date
                </div>
                <strong>{sale.createdAt ? new Date(sale.createdAt).toLocaleString() : "—"}</strong>
              </div>
            </div>
          </div>

          <DataTable
            columns={[
              { key: "sl", label: "#", width: 40 },
              { key: "name", label: "Product" },
              { key: "qty", label: "Qty" },
              { key: "priceLabel", label: "Price" },
              { key: "costLabel", label: "Cost" },
              { key: "lineTotalLabel", label: "Line total" },
              { key: "marginLabel", label: "Margin" },
              { key: "marginPctLabel", label: "Margin %" },
              { key: "batches", label: "Batch / serial" },
            ]}
            rows={lineRows}
            emptyMessage="No line items"
          />
        </>
      ) : null}
    </div>
  );
}

export default SalesLookup;
