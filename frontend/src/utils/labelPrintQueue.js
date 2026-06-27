const QUEUE_KEY = "bd_pos_label_queue_v1";
const TAB_KEY = "bd_pos_products_tab";
const AISLE_KEY = "bd_pos_label_aisle_filter";
const PENDING_KEY = "bd_pos_label_queue_pending";

export function readLabelQueue() {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const [id, qty] of Object.entries(parsed)) {
      const n = Math.max(0, Math.floor(Number(qty || 0)));
      if (n > 0) out[String(id)] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLabelQueue(map) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(map || {}));
  } catch {
    /* ignore */
  }
}

export function mergeIntoLabelQueue(entries = []) {
  const next = { ...readLabelQueue() };
  for (const row of entries) {
    const id = String(row?.productId ?? row?.id ?? "").trim();
    if (!id) continue;
    const add = Math.max(1, Math.floor(Number(row?.qty || 1)));
    next[id] = Math.max(Number(next[id] || 0), add);
  }
  writeLabelQueue(next);
  return next;
}

export function clearLabelQueue() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(QUEUE_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(TAB_KEY);
    sessionStorage.removeItem(AISLE_KEY);
  } catch {
    /* ignore */
  }
}

export function navigateToLabelQueue({ aisle = "", queueMap = null } = {}) {
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(TAB_KEY, "labels");
      if (aisle) sessionStorage.setItem(AISLE_KEY, String(aisle).trim().toUpperCase());
      else sessionStorage.removeItem(AISLE_KEY);
      const map = queueMap || readLabelQueue();
      if (Object.keys(map).length) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(map));
      }
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(
    new CustomEvent("bd_pos_navigate", {
      detail: { view: "products", productsTab: "labels", labelAisleFilter: aisle || undefined },
    })
  );
}

export function consumePendingLabelQueue() {
  if (typeof sessionStorage === "undefined") return { tab: "", aisle: "", queue: {} };
  let queue = {};
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) queue = JSON.parse(raw) || {};
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    queue = readLabelQueue();
  }
  const tab = sessionStorage.getItem(TAB_KEY) || "";
  const aisle = sessionStorage.getItem(AISLE_KEY) || "";
  if (tab) sessionStorage.removeItem(TAB_KEY);
  if (aisle) sessionStorage.removeItem(AISLE_KEY);
  return { tab, aisle, queue };
}
