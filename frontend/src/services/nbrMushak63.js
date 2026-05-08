import api from "./api";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

async function resolveByInvoiceNo(invoiceNo) {
  const res = await api.get(`/sales/lookup/by-invoice?invoiceNo=${encodeURIComponent(invoiceNo)}`);
  return {
    saleId: Number(res.data.saleId),
    invoiceNo: res.data.invoiceNo || null,
    mushakDocumentNo: res.data.mushakDocumentNo || null,
  };
}

/**
 * Resolve Mushak 6.3 manual lookup.
 * - `saleId`: parse positive integer only.
 * - `invoice`: always call invoice lookup (supports numeric-only invoice numbers).
 * - `auto`: digits-only → sale ID; otherwise invoice lookup.
 */
export async function resolveSaleIdForMushak63Lookup(raw, mode = "auto") {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = mode === "saleId" || mode === "invoice" ? mode : "auto";

  if (m === "saleId") {
    const id = Number(s);
    return Number.isFinite(id) && id > 0 ? { saleId: Math.floor(id), invoiceNo: null, mushakDocumentNo: null } : null;
  }

  if (m === "invoice") {
    return resolveByInvoiceNo(s);
  }

  if (/^\d+$/.test(s)) {
    const id = Number(s);
    return id > 0 ? { saleId: id, invoiceNo: null, mushakDocumentNo: null } : null;
  }

  return resolveByInvoiceNo(s);
}

export async function getMushak63Completeness(saleId) {
  const res = await api.get(`/nbr/sales/${saleId}/mushak63/completeness`);
  return res.data;
}

export function toastMushak63Issues(issues, mushakDocumentNo) {
  if (!issues?.length) return;
  const label = mushakDocumentNo ? ` (${mushakDocumentNo})` : "";
  notifyActionRequired(
    `Mushak 6.3${label} — ${issues.length} issue(s): ${issues.slice(0, 5).join(" · ")}${issues.length > 5 ? " …" : ""}`
  );
}

export async function runMushak63CompletenessCheck(saleId) {
  const data = await getMushak63Completeness(saleId);
  const issues = data?.issues || [];
  if (issues.length) toastMushak63Issues(issues, data?.mushakDocumentNo);
  else notifySuccess("Mushak 6.3 completeness OK — no blocking issues reported.");
  return data;
}

export async function downloadMushak63XmlFile(saleId, mushakDocumentNoHint) {
  const res = await api.get(`/nbr/sales/${saleId}/mushak63.xml`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  const ref = mushakDocumentNoHint
    ? String(mushakDocumentNoHint).replace(/[^\w.-]+/g, "_")
    : String(saleId);
  a.download = `mushak-6.3-${ref}.xml`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadMushak63XmlWithCompletenessHint(saleId, mushakDocumentNoHint) {
  let docHint = mushakDocumentNoHint;
  try {
    const data = await getMushak63Completeness(saleId);
    docHint = docHint || data?.mushakDocumentNo;
    toastMushak63Issues(data?.issues, data?.mushakDocumentNo);
  } catch {
    /* XML endpoint may still regenerate; ignore completeness failures */
  }
  await downloadMushak63XmlFile(saleId, docHint);
}
