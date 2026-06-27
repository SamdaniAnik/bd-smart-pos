import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SearchSelect from "../components/SearchSelect";
import { getLang, t } from "../i18n";
import { formatSaleLineQtyDisplay, getBillingUnitsForSaleLine } from "../utils/formatSaleLineQty";
import {
  consumeGlobalSubmitError,
  notifyActionRequired,
  notifyError,
  notifyPermissionRequired,
} from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";

function Quotations() {
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
  const canManageQuotes = hasPermission("sale.create");

  const requireSaleCreate = () => {
    if (canManageQuotes) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "sale.create" }));
    return false;
  };

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("OPEN");
  const [reminder, setReminder] = useState("");
  const [summary, setSummary] = useState({ overdue: 0, today: 0, tomorrow: 0, upcoming: 0, done: 0 });
  const getFollowUpBadgeClass = (statusCode) => {
    if (statusCode === "OVERDUE") return "badge badge-danger";
    if (statusCode === "TODAY") return "badge badge-warning";
    if (statusCode === "TOMORROW") return "badge badge-info";
    if (statusCode === "UPCOMING") return "badge badge-primary";
    if (statusCode === "DONE") return "badge badge-success";
    return "badge";
  };

  useEffect(() => {
    const preset = localStorage.getItem("bd_pos_quote_reminder_filter");
    if (!preset) return;
    localStorage.removeItem("bd_pos_quote_reminder_filter");
    setReminder(String(preset).toUpperCase());
    setStatus("OPEN");
  }, []);

  const load = async () => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (reminder) query.set("reminder", reminder);
    const q = query.toString() ? `?${query.toString()}` : "";
    const res = await api.get(`/sales/quotes${q}`);
    setRows(res.data || []);
  };

  const loadSummary = async () => {
    const res = await api.get("/sales/quotes/reminders/summary");
    setSummary(res.data || { overdue: 0, today: 0, tomorrow: 0, upcoming: 0, done: 0 });
  };

  useEffect(() => {
    load();
    loadSummary();
  }, [status, reminder]);

  const openInPos = (id) => {
    localStorage.setItem("bd_pos_load_quote_id", String(id));
    window.dispatchEvent(new CustomEvent("bd_pos_navigate", { detail: { view: "pos" } }));
  };

  const cancelQuote = async (row) => {
    if (!requireSaleCreate()) return;
    if (!window.confirm(tt("quoConfirmCancel", { id: row.quoteNo || row.id }))) return;
    try {
      await api.delete(`/sales/quotes/${row.id}`);
      load();
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const duplicateQuote = async (row) => {
    if (!requireSaleCreate()) return;
    try {
      const res = await api.post(`/sales/quotes/${row.id}/duplicate`);
      const newId = Number(res?.data?.id || 0);
      load();
      if (newId > 0) {
        openInPos(newId);
        return;
      }
      notifySuccess(tt("quoDupSuccess"));
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const fetchQuotePdfBlob = async (row) => {
    const res = await api.get(`/sales/quotes/${row.id}/pdf`, { responseType: "blob" });
    return new Blob([res.data], { type: "application/pdf" });
  };

  const previewQuotePdf = async (row) => {
    try {
      const blob = await fetchQuotePdfBlob(row);
      const url = window.URL.createObjectURL(blob);
      const tab = window.open(url, "_blank", "noopener,noreferrer");
      if (!tab) {
        notifyActionRequired(tt("quoPopupPreviewBlocked"));
        window.URL.revokeObjectURL(url);
        return;
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60 * 1000);
    } catch (e) {
      notifyError(e?.response?.data?.error || tt("quoPreviewFailed"));
    }
  };

  const downloadQuotePdf = async (row) => {
    try {
      const blob = await fetchQuotePdfBlob(row);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.quoteNo || `quote-${row.id}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      notifyError(e?.response?.data?.error || tt("quoDownloadFailed"));
    }
  };

  const openSaleInvoice = async (row) => {
    try {
      const saleId = Number(row.convertedSaleId || 0);
      if (!saleId) return;
      const res = await api.get(`/sales/${saleId}/invoice`);
      const sale = res.data;
      const items = Array.isArray(sale?.items) ? sale.items : [];
      const lines = items
        .map((it) => {
          const name = it?.product?.name || tt("quoProductNum", { n: it?.productId || "" });
          const bill = getBillingUnitsForSaleLine(it);
          const qtyLabel = formatSaleLineQtyDisplay(it, tt);
          const price = Number(it?.price || 0);
          const amount = bill * price;
          return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${name}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyLabel}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${price.toFixed(2)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${amount.toFixed(2)}</td></tr>`;
        })
        .join("");
      const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${tt("quoInvoiceTitle")} ${sale?.invoiceNo || saleId}</title></head>
<body style="font-family:Arial,sans-serif;padding:18px;color:#0f172a;">
  <h2 style="margin:0 0 8px;">${tt("quoSaleInvoice")}</h2>
  <p style="margin:4px 0;"><strong>${tt("receiptInvoice")}:</strong> ${sale?.invoiceNo || saleId}</p>
  <p style="margin:4px 0;"><strong>${tt("receiptDate")}:</strong> ${sale?.createdAt ? new Date(sale.createdAt).toLocaleString() : "-"}</p>
  <p style="margin:4px 0;"><strong>${tt("receiptCustomer")}:</strong> ${sale?.customer?.name || tt("receiptWalkIn")}</p>
  <p style="margin:4px 0 12px;"><strong>${tt("colPhone")}:</strong> ${sale?.customer?.phone || "-"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #94a3b8;">${tt("receiptItem")}</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">${tt("receiptQty")}</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">${tt("receiptRate")}</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">${tt("receiptAmount")}</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div style="margin-top:14px;font-size:13px;">
    <p style="margin:3px 0;text-align:right;"><strong>${tt("receiptSubTotal")}:</strong> ${Number(sale?.subTotal || 0).toFixed(2)}</p>
    <p style="margin:3px 0;text-align:right;"><strong>${tt("receiptVat")}:</strong> ${Number(sale?.vatAmount || 0).toFixed(2)}</p>
    <p style="margin:3px 0;text-align:right;"><strong>${tt("receiptDiscount")}:</strong> ${Number(sale?.discount || 0).toFixed(2)}</p>
    <p style="margin:6px 0;text-align:right;font-size:15px;"><strong>${tt("receiptTotal")}:</strong> ${Number(sale?.total || 0).toFixed(2)}</p>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 120);
    });
  </script>
</body></html>`;
      const tab = window.open("", "_blank", "noopener,noreferrer");
      if (!tab) {
        notifyActionRequired(tt("quoPopupBlocked"));
        return;
      }
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
    } catch (e) {
      notifyError(e?.response?.data?.error || tt("quoInvoiceOpenFailed"));
    }
  };

  const shareQuoteWhatsApp = (row) => {
    const rawPhone = String(row.customerPhone || "").trim();
    if (!rawPhone) {
      notifyActionRequired(tt("quoPhoneMissing"));
      return;
    }
    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) {
      notifyActionRequired(tt("quoPhoneInvalid"));
      return;
    }
    let phone = digits;
    if (phone.startsWith("01")) phone = `88${phone}`;
    const msg =
      `${tt("quoWaGreeting")}\n` +
      `${tt("quoWaQuote")}: ${row.quoteNo || row.id}\n` +
      `${tt("quoWaValidUntil")}: ${row.validUntil ? new Date(row.validUntil).toLocaleDateString() : tt("quoNa")}\n` +
      `${row.followUpAt ? `${tt("quoWaFollowUpOn")}: ${new Date(row.followUpAt).toLocaleDateString()}\n` : ""}` +
      `${tt("quoWaThanks")}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    if (!tab) {
      notifyActionRequired(tt("quoPopupWhatsAppBlocked"));
    }
  };

  const setFollowUp = async (row, mode) => {
    if (!requireSaleCreate()) return;
    try {
      let followUpAt = null;
      if (mode === "today") {
        const d = new Date();
        d.setHours(10, 0, 0, 0);
        followUpAt = d.toISOString();
      } else if (mode === "tomorrow") {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(10, 0, 0, 0);
        followUpAt = d.toISOString();
      }
      await api.post(`/sales/quotes/${row.id}/follow-up`, { followUpAt });
      load();
      loadSummary();
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const markFollowUpDone = async (row) => {
    if (!requireSaleCreate()) return;
    try {
      await api.post(`/sales/quotes/${row.id}/follow-up-done`);
      load();
      loadSummary();
    } catch {
      consumeGlobalSubmitError();
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("quoTitle")}</div>
          <div className="page-subtitle">
            {tt("quoSubtitle")}
          </div>
        </div>
      </div>
      <PermissionBanner show={!canManageQuotes} code="sale.create" tt={tt} />
      <div className="metrics-grid" style={{ marginBottom: 10 }}>
        <div className="metric warning">
          <div className="metric-label">{tt("quoMetricOverdue")}</div>
          <div className="metric-value">{Number(summary.overdue || 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">{tt("quoMetricToday")}</div>
          <div className="metric-value">{Number(summary.today || 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">{tt("quoMetricTomorrow")}</div>
          <div className="metric-value">{Number(summary.tomorrow || 0)}</div>
        </div>
        <div className="metric success">
          <div className="metric-label">{tt("quoMetricDone")}</div>
          <div className="metric-value">{Number(summary.done || 0)}</div>
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 360 }}>
        <label>
          {tt("quoFilterStatus")}
          <SearchSelect
            className="form-select-sm"
            value={status}
            onChange={(val) => setStatus(val)}
            placeholder={tt("quoAll")}
            options={[
              { value: "OPEN", label: tt("quoStatusOpen") },
              { value: "EXPIRED", label: tt("quoStatusExpired") },
              { value: "CONVERTED", label: tt("quoStatusConverted") },
              { value: "CANCELLED", label: tt("quoStatusCancelled") },
            ]}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={load}>
          {tt("dashRefresh")}
        </button>
        <label>
          {tt("quoFilterReminder")}
          <SearchSelect
            className="form-select-sm"
            value={reminder}
            onChange={(val) => setReminder(val)}
            placeholder={tt("quoAll")}
            options={[
              { value: "OVERDUE", label: tt("quoRemOverdue") },
              { value: "TODAY", label: tt("quoRemToday") },
              { value: "TOMORROW", label: tt("quoRemTomorrow") },
              { value: "UPCOMING", label: tt("quoRemUpcoming") },
              { value: "NONE", label: tt("quoRemNone") },
              { value: "DONE", label: tt("quoRemDone") },
            ]}
          />
        </label>
      </div>
      <DataTable rows={rows} pageSize={15} allowExport columns={[
          { key: "id", label: tt("colId") },
          { key: "quoteNo", label: tt("quoColQuoteNo") },
          { key: "status", label: tt("colStatus") },
          {
            key: "convertedSaleId",
            label: tt("quoColConvertedSale"),
            render: (v, row) =>
              row.status === "CONVERTED" && v ? tt("quoSaleNum", { n: v }) : "-",
          },
          {
            key: "duplicatedFromQuoteId",
            label: tt("quoColFromQuote"),
            render: (v) => (v ? `#${v}` : "-"),
          },
          {
            key: "followUpStatus",
            label: tt("quoColFollowUp"),
            render: (v, row) => {
              const badgeClass = getFollowUpBadgeClass(v);
              if (v === "DONE") {
                const who = row.followUpDoneByName || (row.followUpDoneByUserId ? tt("quoUserNum", { n: row.followUpDoneByUserId }) : "");
                const when = row.followUpDoneAt ? new Date(row.followUpDoneAt).toLocaleString() : "";
                return (
                  <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                    <span className={badgeClass}>{tt("quoRemDone")}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {who ? `${tt("quoBy")} ${who}` : ""}{who && when ? " · " : ""}{when || ""}
                    </span>
                  </span>
                );
              }
              if (!row.followUpAt) return "-";
              return (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                  <span className={badgeClass}>{v}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {new Date(row.followUpAt).toLocaleDateString()}
                  </span>
                </span>
              );
            },
          },
          {
            key: "validUntil",
            label: tt("quoColValidUntil"),
            render: (v, row) =>
              v
                ? `${new Date(v).toLocaleDateString()}${row.status === "EXPIRED" ? ` (${tt("quoExpiredInline")})` : ""}`
                : "-",
          },
          { key: "customerName", label: tt("receiptCustomer"), render: (v) => v || "-" },
          { key: "customerPhone", label: tt("colPhone"), render: (v) => v || "-" },
          { key: "lineCount", label: tt("quoColLines") },
          { key: "createdByName", label: tt("quoColCreatedBy"), render: (v) => v || "-" },
          {
            key: "createdAt",
            label: tt("quoColCreatedAt"),
            render: (v) => (v ? new Date(v).toLocaleString() : ""),
          },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn-secondary btn-sm" disabled={row.status !== "OPEN"} onClick={() => openInPos(row.id)}>
                  {tt("quoBtnOpenPos")}
                </button>
                <button type="button" className="btn-secondary btn-sm" disabled={!canManageQuotes} onClick={() => duplicateQuote(row)}>
                  {tt("quoBtnDuplicateOpen")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => previewQuotePdf(row)}>
                  {tt("quoBtnPreview")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => downloadQuotePdf(row)}>
                  {tt("quoBtnDownload")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => shareQuoteWhatsApp(row)}>
                  {tt("quoBtnWhatsApp")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN" || !canManageQuotes}
                  onClick={() => setFollowUp(row, "today")}
                >
                  {tt("quoBtnFollowUpToday")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN" || !canManageQuotes}
                  onClick={() => setFollowUp(row, "tomorrow")}
                >
                  {tt("quoBtnTomorrow")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN" || !canManageQuotes}
                  onClick={() => setFollowUp(row, "clear")}
                >
                  {tt("quoBtnClearReminder")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN" || row.followUpStatus === "DONE" || !canManageQuotes}
                  onClick={() => markFollowUpDone(row)}
                >
                  {tt("quoBtnFollowUpDone")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "CONVERTED" || !row.convertedSaleId}
                  onClick={() => openSaleInvoice(row)}
                >
                  {tt("quoBtnOpenSaleInvoice")}
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={row.status !== "OPEN" || !canManageQuotes} onClick={() => cancelQuote(row)}>
                  {tt("quoBtnCancel")}
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Quotations;
