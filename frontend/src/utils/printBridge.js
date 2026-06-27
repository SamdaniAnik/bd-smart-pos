/**
 * Local ESC/POS print-bridge client.
 *
 * Browsers cannot talk to USB/serial thermal printers directly, so shops run a
 * tiny local HTTP agent (print bridge) on the till machine that forwards raw
 * ESC/POS bytes to the printer. This module sends commands to that bridge.
 *
 * The bridge URL (e.g. http://localhost:9100/print) is stored per till in
 * localStorage. When unset, receipt printing falls back to window.print().
 */

const STORAGE_KEY = "bd_pos_print_bridge_url";
const AUTO_PRINT_KEY = "bd_pos_auto_print_receipt";
const STORE_SETTINGS_KEY = "bd-pos-store-settings";

// ESC p m t1 t2 — standard cash drawer kick pulse on pin 2 (25ms on / 250ms off)
const DRAWER_KICK_BYTES = [0x1b, 0x70, 0x00, 0x19, 0xfa];

const ESC = 0x1b;
const GS = 0x1d;

export function getPrintBridgeUrl() {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setPrintBridgeUrl(url) {
  try {
    const value = String(url || "").trim();
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function isPrintBridgeConfigured() {
  return Boolean(getPrintBridgeUrl());
}

export function getAutoPrintReceipt() {
  try {
    const raw = localStorage.getItem(AUTO_PRINT_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function setAutoPrintReceipt(enabled) {
  try {
    localStorage.setItem(AUTO_PRINT_KEY, enabled ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

function loadStoreSettings() {
  try {
    const raw = localStorage.getItem(STORE_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildDemoTestSale(labels = {}) {
  const walkIn = labels.walkInCustomer || "Walk-in";
  return {
    id: "TEST-001",
    invoiceNo: "TEST-PRINT",
    createdAt: new Date().toISOString(),
    paymentMethod: "Cash",
    paymentChannel: "",
    customer: { name: walkIn },
    subTotal: 450,
    vatAmount: 22.5,
    discount: 10,
    total: 462.5,
    paidAmount: 500,
    dueAmount: 0,
    items: [
      { productId: 1, qty: 2, price: 120, product: { name: "Demo Product A" } },
      { productId: 2, qty: 1, price: 210, product: { name: "Demo Product B" } },
    ],
  };
}

async function postToBridge(body) {
  const url = getPrintBridgeUrl();
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return data?.ok !== false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function postRawBytes(bytes) {
  if (!bytes?.length) return false;
  const dataBase64 = btoa(String.fromCharCode(...bytes));
  return postToBridge({ type: "raw", dataBase64 });
}

/** Build ESC/POS bytes from plain-text lines (UTF-8; Bangla may not render on all printers). */
export function buildEscPosBytesFromLines(lines, { cut = true } = {}) {
  const bytes = [ESC, 0x40];
  for (const line of lines || []) {
    const text = String(line ?? "");
    for (let i = 0; i < text.length; i++) {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
    bytes.push(0x0a);
  }
  bytes.push(0x0a);
  if (cut) bytes.push(GS, 0x56, 0x00);
  return bytes;
}

/**
 * Build a compact text receipt for 58/80mm thermal printers.
 * @param {object} sale
 * @param {{ store?: object, labels?: object, formatMoney?: (n)=>string, formatDate?: (d)=>string }} ctx
 */
export function buildSaleReceiptLines(sale, ctx = {}) {
  const store = ctx.store || {};
  const L = ctx.labels || {};
  const money = ctx.formatMoney || ((n) => `৳${Number(n || 0).toFixed(2)}`);
  const fmtDate =
    ctx.formatDate ||
    ((d) => {
      try {
        return new Date(d).toLocaleString();
      } catch {
        return String(d || "");
      }
    });

  const lines = [];
  const divider = "--------------------------------";
  if (store.storeName) lines.push(String(store.storeName).toUpperCase());
  if (store.storeAddress) lines.push(store.storeAddress);
  if (store.storePhone) lines.push(store.storePhone);
  lines.push(divider);
  lines.push(`${L.invoice || "Invoice"}: ${sale.invoiceNo || sale.id || "-"}`);
  lines.push(`${L.date || "Date"}: ${fmtDate(sale.createdAt)}`);
  lines.push(`${L.payment || "Payment"}: ${sale.paymentMethod || "-"}`);
  if (sale.paymentChannel) lines.push(`Ref: ${sale.paymentChannel}`);
  lines.push(`${L.customer || "Customer"}: ${sale.customer?.name || L.walkInCustomer || "Walk-in"}`);
  lines.push(divider);

  for (const item of sale.items || []) {
    const name = item.product?.name || `Item ${item.productId}`;
    const qty = item.qty ?? item.quantity ?? 1;
    const price = Number(item.price || 0);
    const lineTotal = Number(qty) * price;
    lines.push(name.slice(0, 32));
    lines.push(`  ${qty} x ${money(price)} = ${money(lineTotal)}`);
  }

  lines.push(divider);
  if (sale.subTotal != null) lines.push(`${L.subTotal || "Subtotal"}: ${money(sale.subTotal)}`);
  if (sale.vatAmount != null) lines.push(`${L.vat || "VAT"}: ${money(sale.vatAmount)}`);
  if (sale.discount != null) lines.push(`${L.discount || "Discount"}: ${money(sale.discount)}`);
  if (Number(sale.deliveryFee || 0) > 0) {
    lines.push(`${L.deliveryFee || "Delivery"}: ${money(sale.deliveryFee)}`);
  }
  lines.push(`${L.total || "Total"}: ${money(sale.total)}`);
  lines.push(`${L.paid || "Paid"}: ${money(sale.paidAmount)}`);
  lines.push(`${L.due || "Due"}: ${money(sale.dueAmount)}`);
  if (sale.efdFiscalInvoiceNo) lines.push(`EFD: ${sale.efdFiscalInvoiceNo}`);
  lines.push(divider);
  if (store.footerMessage) lines.push(store.footerMessage);
  lines.push("");
  return lines;
}

export async function printEscPosLines(lines) {
  return postRawBytes(buildEscPosBytesFromLines(lines));
}

/**
 * Print receipt: ESC/POS via bridge when configured, else browser print dialog.
 * @returns {'bridge'|'browser'|'failed'}
 */
export async function printReceipt({ sale, store, labels, formatMoney, formatDate, html }) {
  if (isPrintBridgeConfigured() && sale) {
    const lines = buildSaleReceiptLines(sale, { store, labels, formatMoney, formatDate });
    const ok = await printEscPosLines(lines);
    if (ok) return "bridge";
  }

  if (!html) return "failed";
  const printWin = window.open("", "_blank", "width=420,height=700");
  if (!printWin) return "failed";
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  printWin.print();
  return "browser";
}

/**
 * Open the cash drawer. Fire-and-forget: returns true when the bridge
 * accepted the command, false otherwise (no bridge configured, offline, etc.).
 */
export function kickCashDrawer() {
  return postRawBytes(DRAWER_KICK_BYTES);
}

/**
 * Print a demo receipt (Settings hardware test).
 * @returns {'bridge'|'browser'|'failed'}
 */
export async function printTestReceipt({ labels = {}, formatMoney, formatDate } = {}) {
  const store = {
    storeName: loadStoreSettings().storeName || "BD Smart POS",
    storeAddress: loadStoreSettings().storeAddress || "",
    storePhone: loadStoreSettings().storePhone || "",
    footerMessage: loadStoreSettings().footerMessage || "Thank you",
  };
  const money = formatMoney || ((n) => `৳${Number(n || 0).toFixed(2)}`);
  const fmtDate =
    formatDate ||
    ((d) => {
      try {
        return new Date(d).toLocaleString();
      } catch {
        return String(d || "");
      }
    });
  const sale = buildDemoTestSale(labels);
  const L = labels;
  const html = `<html><head><title>Test receipt</title><style>
    body{font-family:Arial,sans-serif;width:300px;margin:0 auto;padding:8px;font-size:12px}
    h2,p{margin:4px 0;text-align:center} table{width:100%;border-collapse:collapse}
    td{padding:3px 2px;border-bottom:1px dashed #ccc}.right{text-align:right}
  </style></head><body>
    <h2>${store.storeName}</h2>
    ${store.storeAddress ? `<p>${store.storeAddress}</p>` : ""}
    <p>${L.invoice || "Invoice"}: ${sale.invoiceNo}</p>
    <p>${L.date || "Date"}: ${fmtDate(sale.createdAt)}</p>
    <p>${L.total || "Total"}: ${money(sale.total)}</p>
    <p>${store.footerMessage}</p>
  </body></html>`;
  return printReceipt({ sale, store, labels, formatMoney: money, formatDate: fmtDate, html });
}
