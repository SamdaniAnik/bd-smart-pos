import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Quotations() {
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
    if (!window.confirm(`Cancel quote ${row.quoteNo || row.id}?`)) return;
    try {
      await api.delete(`/sales/quotes/${row.id}`);
      load();
    } catch (e) {
      alert(e?.response?.data?.error || "Could not cancel");
    }
  };

  const duplicateQuote = async (row) => {
    try {
      const res = await api.post(`/sales/quotes/${row.id}/duplicate`);
      const newId = Number(res?.data?.id || 0);
      load();
      if (newId > 0) {
        openInPos(newId);
        return;
      }
      alert("Quote duplicated as a new OPEN quotation.");
    } catch (e) {
      alert(e?.response?.data?.error || "Could not duplicate quote");
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
        alert("Popup blocked. Please allow popups for preview, or use PDF download.");
        window.URL.revokeObjectURL(url);
        return;
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60 * 1000);
    } catch (e) {
      alert(e?.response?.data?.error || "Could not preview quote PDF");
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
      alert(e?.response?.data?.error || "Could not download quote PDF");
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
          const name = it?.product?.name || `Product#${it?.productId || ""}`;
          const qty = Number(it?.qty || 0);
          const price = Number(it?.price || 0);
          const amount = qty * price;
          return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${name}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qty}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${price.toFixed(2)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${amount.toFixed(2)}</td></tr>`;
        })
        .join("");
      const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Invoice ${sale?.invoiceNo || saleId}</title></head>
<body style="font-family:Arial,sans-serif;padding:18px;color:#0f172a;">
  <h2 style="margin:0 0 8px;">Sale Invoice</h2>
  <p style="margin:4px 0;"><strong>Invoice:</strong> ${sale?.invoiceNo || saleId}</p>
  <p style="margin:4px 0;"><strong>Date:</strong> ${sale?.createdAt ? new Date(sale.createdAt).toLocaleString() : "-"}</p>
  <p style="margin:4px 0;"><strong>Customer:</strong> ${sale?.customer?.name || "Walk-in"}</p>
  <p style="margin:4px 0 12px;"><strong>Phone:</strong> ${sale?.customer?.phone || "-"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #94a3b8;">Item</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">Qty</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">Rate</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #94a3b8;">Amount</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div style="margin-top:14px;font-size:13px;">
    <p style="margin:3px 0;text-align:right;"><strong>SubTotal:</strong> ${Number(sale?.subTotal || 0).toFixed(2)}</p>
    <p style="margin:3px 0;text-align:right;"><strong>VAT:</strong> ${Number(sale?.vatAmount || 0).toFixed(2)}</p>
    <p style="margin:3px 0;text-align:right;"><strong>Discount:</strong> ${Number(sale?.discount || 0).toFixed(2)}</p>
    <p style="margin:6px 0;text-align:right;font-size:15px;"><strong>Total:</strong> ${Number(sale?.total || 0).toFixed(2)}</p>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 120);
    });
  </script>
</body></html>`;
      const tab = window.open("", "_blank", "noopener,noreferrer");
      if (!tab) {
        alert("Popup blocked. Please allow popups.");
        return;
      }
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
    } catch (e) {
      alert(e?.response?.data?.error || "Could not open converted sale invoice");
    }
  };

  const shareQuoteWhatsApp = (row) => {
    const rawPhone = String(row.customerPhone || "").trim();
    if (!rawPhone) {
      alert("Customer phone is missing for this quote.");
      return;
    }
    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) {
      alert("Customer phone is invalid for WhatsApp sharing.");
      return;
    }
    let phone = digits;
    if (phone.startsWith("01")) phone = `88${phone}`;
    const msg =
      `Assalamu alaikum, your quotation is ready.\n` +
      `Quote: ${row.quoteNo || row.id}\n` +
      `Valid until: ${row.validUntil ? new Date(row.validUntil).toLocaleDateString() : "N/A"}\n` +
      `${row.followUpAt ? `Follow-up on: ${new Date(row.followUpAt).toLocaleDateString()}\n` : ""}` +
      `Thank you.`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    if (!tab) {
      alert("Popup blocked. Please allow popups to open WhatsApp.");
    }
  };

  const setFollowUp = async (row, mode) => {
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
    } catch (e) {
      alert(e?.response?.data?.error || "Could not set follow-up");
    }
  };

  const markFollowUpDone = async (row) => {
    try {
      await api.post(`/sales/quotes/${row.id}/follow-up-done`);
      load();
      loadSummary();
    } catch (e) {
      alert(e?.response?.data?.error || "Could not mark follow-up done");
    }
  };

  return (
    <div>
      <h2>Sales quotations</h2>
      <p className="pos-inline-note">Proforma quotes do not affect stock until you convert them on the POS at checkout.</p>
      <div className="metrics-grid" style={{ marginBottom: 10 }}>
        <div className="metric warning">
          <div className="metric-label">Overdue Follow-ups</div>
          <div className="metric-value">{Number(summary.overdue || 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Today</div>
          <div className="metric-value">{Number(summary.today || 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Tomorrow</div>
          <div className="metric-value">{Number(summary.tomorrow || 0)}</div>
        </div>
        <div className="metric success">
          <div className="metric-label">Follow-up Done</div>
          <div className="metric-value">{Number(summary.done || 0)}</div>
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 360 }}>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="EXPIRED">Expired</option>
            <option value="CONVERTED">Converted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <button type="button" className="btn-secondary" onClick={load}>
          Refresh
        </button>
        <label>
          Reminder
          <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
            <option value="">All</option>
            <option value="OVERDUE">Overdue</option>
            <option value="TODAY">Today</option>
            <option value="TOMORROW">Tomorrow</option>
            <option value="UPCOMING">Upcoming</option>
            <option value="NONE">No Reminder</option>
            <option value="DONE">Done</option>
          </select>
        </label>
      </div>
      <DataTable rows={rows} pageSize={15} allowExport columns={[
          { key: "id", label: "ID" },
          { key: "quoteNo", label: "Quote No" },
          { key: "status", label: "Status" },
          {
            key: "convertedSaleId",
            label: "Converted Sale",
            render: (v, row) =>
              row.status === "CONVERTED" && v ? `Sale #${v}` : "-",
          },
          {
            key: "duplicatedFromQuoteId",
            label: "From Quote",
            render: (v) => (v ? `#${v}` : "-"),
          },
          {
            key: "followUpStatus",
            label: "Follow-up",
            render: (v, row) => {
              const badgeClass = getFollowUpBadgeClass(v);
              if (v === "DONE") {
                const who = row.followUpDoneByName || (row.followUpDoneByUserId ? `User#${row.followUpDoneByUserId}` : "");
                const when = row.followUpDoneAt ? new Date(row.followUpDoneAt).toLocaleString() : "";
                return (
                  <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                    <span className={badgeClass}>DONE</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {who ? `by ${who}` : ""}{who && when ? " · " : ""}{when || ""}
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
            label: "Valid Until",
            render: (v, row) =>
              v
                ? `${new Date(v).toLocaleDateString()}${row.status === "EXPIRED" ? " (expired)" : ""}`
                : "-",
          },
          { key: "customerName", label: "Customer", render: (v) => v || "-" },
          { key: "customerPhone", label: "Phone", render: (v) => v || "-" },
          { key: "lineCount", label: "Lines" },
          { key: "createdByName", label: "Created By", render: (v) => v || "-" },
          {
            key: "createdAt",
            label: "Created",
            render: (v) => (v ? new Date(v).toLocaleString() : ""),
          },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn-secondary btn-sm" disabled={row.status !== "OPEN"} onClick={() => openInPos(row.id)}>
                  Open in POS
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => duplicateQuote(row)}>
                  Duplicate + Open
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => previewQuotePdf(row)}>
                  Preview
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => downloadQuotePdf(row)}>
                  Download
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => shareQuoteWhatsApp(row)}>
                  WhatsApp
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN"}
                  onClick={() => setFollowUp(row, "today")}
                >
                  Follow-up Today
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN"}
                  onClick={() => setFollowUp(row, "tomorrow")}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN"}
                  onClick={() => setFollowUp(row, "clear")}
                >
                  Clear Reminder
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "OPEN" || row.followUpStatus === "DONE"}
                  onClick={() => markFollowUpDone(row)}
                >
                  Follow-up Done
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={row.status !== "CONVERTED" || !row.convertedSaleId}
                  onClick={() => openSaleInvoice(row)}
                >
                  Open Sale Invoice
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={row.status !== "OPEN"} onClick={() => cancelQuote(row)}>
                  Cancel
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
