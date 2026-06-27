/**
 * Customer Display channel.
 *
 * The cashier's POS publishes the live cart/totals here. The Customer Display
 * page (opened on a second monitor or tablet) subscribes and renders a
 * customer-facing screen.
 *
 * Three transports are used together so it works in every common scenario:
 *
 *   1. BroadcastChannel  - same-browser, multi-tab/window, instant.
 *   2. localStorage event - cross-tab fallback for older browsers.
 *   3. socket.io (room "customer-display:branch:<id>") - cross-device,
 *      e.g. a tablet on the counter on the same network/server.
 *
 * The latest state is also persisted under `STORAGE_KEY` so the display can
 * hydrate on first paint and survive a reload.
 */
import socket from "./socket";

const STORAGE_KEY = "bd_pos_customer_display_state_v1";
const CHANNEL_NAME = "bd-pos-customer-display";

const STATUS_IDLE = "idle";
const STATUS_SHOPPING = "shopping";
const STATUS_COMPLETED = "completed";
const STATUS_CLEARED = "cleared";

export const CUSTOMER_DISPLAY_STATUS = Object.freeze({
  IDLE: STATUS_IDLE,
  SHOPPING: STATUS_SHOPPING,
  COMPLETED: STATUS_COMPLETED,
  CLEARED: STATUS_CLEARED,
});

let broadcastChannel = null;

function getChannel() {
  if (typeof window === "undefined") return null;
  if (typeof window.BroadcastChannel !== "function") return null;
  if (broadcastChannel) return broadcastChannel;
  try {
    broadcastChannel = new window.BroadcastChannel(CHANNEL_NAME);
    return broadcastChannel;
  } catch {
    broadcastChannel = null;
    return null;
  }
}

function safeWrite(state) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or disabled - ignore */
  }
}

export function readCustomerDisplayState() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readBranchId() {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem("bd_pos_branch_id");
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function emitOverSocket(state) {
  try {
    if (!socket || !socket.connected) return;
    const branchId = state.branchId || readBranchId();
    if (!branchId) return;
    socket.emit("customerDisplay:state", { ...state, branchId });
  } catch {
    /* socket may not be initialized in some contexts (e.g. tests) */
  }
}

export function publishCustomerDisplayState(partial) {
  const previous = readCustomerDisplayState() || {};
  const next = {
    ...previous,
    ...partial,
    branchId: partial?.branchId || previous.branchId || readBranchId() || null,
    updatedAt: Date.now(),
  };
  safeWrite(next);
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(next);
    } catch {
      /* serialization failure - ignore, storage event will still fire */
    }
  }
  emitOverSocket(next);
  return next;
}

export function publishCustomerDisplayCleared(extra = {}) {
  return publishCustomerDisplayState({
    status: STATUS_CLEARED,
    cart: [],
    totals: {
      subTotal: 0,
      vatAmount: 0,
      totalDiscount: 0,
      promoSavings: 0,
      total: 0,
      paid: 0,
      due: 0,
    },
    ...extra,
  });
}

export function publishCustomerDisplayCompleted(extra = {}) {
  return publishCustomerDisplayState({
    status: STATUS_COMPLETED,
    completedAt: Date.now(),
    ...extra,
  });
}

/**
 * Subscribe to display updates.
 *
 * @param {(state: object) => void} listener
 * @param {{ branchId?: number | string }} [options] - when provided, also
 *   subscribes to the cross-device socket.io room for that branch.
 * @returns {() => void} unsubscribe
 */
export function subscribeCustomerDisplay(listener, options = {}) {
  if (typeof listener !== "function") return () => {};
  const ch = getChannel();
  const onMessage = (event) => {
    if (event && event.data) listener(event.data);
  };
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY) return;
    if (!event.newValue) {
      listener({ status: STATUS_IDLE });
      return;
    }
    try {
      listener(JSON.parse(event.newValue));
    } catch {
      /* ignore malformed */
    }
  };

  if (ch) ch.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);

  const branchId = Number(options.branchId || readBranchId() || 0);
  let onSocketState = null;
  let onSocketConnect = null;
  if (branchId > 0 && socket) {
    onSocketState = (payload) => {
      if (!payload) return;
      if (Number(payload.branchId || 0) !== branchId) return;
      safeWrite(payload);
      listener(payload);
    };
    onSocketConnect = () => {
      try {
        socket.emit("customerDisplay:join", { branchId });
      } catch {
        /* ignore */
      }
    };
    socket.on("customerDisplay:state", onSocketState);
    socket.on("connect", onSocketConnect);
    if (socket.connected) onSocketConnect();
  }

  return () => {
    if (ch) ch.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    if (onSocketState) socket.off("customerDisplay:state", onSocketState);
    if (onSocketConnect) socket.off("connect", onSocketConnect);
    if (branchId > 0 && socket) {
      try {
        socket.emit("customerDisplay:leave", { branchId });
      } catch {
        /* ignore */
      }
    }
  };
}

export const CUSTOMER_DISPLAY_ROUTE = "#/customer-display";

/** Match the route prefix even when an extra `?branch=` query string follows. */
export function isCustomerDisplayRoute(hash) {
  const value = String(hash || "");
  if (value === CUSTOMER_DISPLAY_ROUTE) return true;
  return value.startsWith(`${CUSTOMER_DISPLAY_ROUTE}?`);
}

export function parseCustomerDisplayBranchId(hash) {
  const value = String(hash || "");
  const idx = value.indexOf("?");
  if (idx < 0) return null;
  const params = new URLSearchParams(value.slice(idx + 1));
  const id = Number(params.get("branch") || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Open the Customer Display in a new browser window.
 * Returns the window reference (or null when blocked by popup policy).
 */
export function openCustomerDisplayWindow(options = {}) {
  if (typeof window === "undefined") return null;
  const branchId =
    Number(options.branchId || readBranchId() || 0) > 0
      ? Number(options.branchId || readBranchId())
      : null;
  const route = branchId
    ? `${CUSTOMER_DISPLAY_ROUTE}?branch=${branchId}`
    : CUSTOMER_DISPLAY_ROUTE;
  const url = `${window.location.origin}${window.location.pathname}${route}`;
  const features = [
    "popup=yes",
    "noopener=no",
    "width=900",
    "height=1100",
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
  ].join(",");
  return window.open(url, "bd_pos_customer_display", features);
}
