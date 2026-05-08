import { useEffect, useRef, useState } from "react";
import {
  CUSTOMER_DISPLAY_STATUS,
  parseCustomerDisplayBranchId,
  readCustomerDisplayState,
  subscribeCustomerDisplay,
} from "../services/customerDisplay";

const DEFAULT_STORE = {
  name: "BD Smart POS",
  address: "",
  phone: "",
  logoDataUrl: "",
};

const EMPTY_TOTALS = {
  subTotal: 0,
  vatAmount: 0,
  totalDiscount: 0,
  total: 0,
  paid: 0,
  due: 0,
};

function formatCurrency(value, locale) {
  return new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-US", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const STYLES = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #312e81 100%)",
    color: "#e2e8f0",
    display: "flex",
    flexDirection: "column",
    fontFamily:
      '"Inter", "Segoe UI", Roboto, "Hind Siliguri", "Noto Sans Bengali", sans-serif',
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  storeBlock: { display: "flex", alignItems: "center", gap: 16 },
  storeLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
    display: "grid",
    placeItems: "center",
    color: "#fff",
    fontWeight: 800,
    fontSize: 22,
    boxShadow: "0 8px 24px rgba(59,130,246,0.35)",
  },
  storeName: { fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 },
  storeMeta: { color: "rgba(255,255,255,0.65)", fontSize: 13, marginTop: 2 },
  clock: { textAlign: "right" },
  clockTime: { fontSize: 28, fontWeight: 700, color: "#fff", lineHeight: 1 },
  clockDate: { color: "rgba(255,255,255,0.65)", fontSize: 13, marginTop: 4 },
  body: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr",
    gap: 24,
    padding: 24,
  },
  cartCard: {
    background: "rgba(15,23,42,0.55)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 24,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  cartHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cartTitle: { fontSize: 18, color: "#fff", margin: 0 },
  cartCount: {
    background: "rgba(59,130,246,0.18)",
    color: "#bfdbfe",
    border: "1px solid rgba(59,130,246,0.4)",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
  },
  itemList: { flex: 1, overflowY: "auto", paddingRight: 4 },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "center",
    gap: 14,
    padding: "14px 12px",
    borderRadius: 12,
    transition: "background 200ms",
  },
  itemRowAlt: { background: "rgba(255,255,255,0.03)" },
  itemRowFresh: {
    background: "rgba(34,197,94,0.12)",
    boxShadow: "inset 0 0 0 1px rgba(34,197,94,0.35)",
  },
  itemName: { fontSize: 16, color: "#f8fafc", fontWeight: 600 },
  itemMeta: { fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 },
  itemQty: {
    fontSize: 14,
    color: "rgba(255,255,255,0.78)",
    minWidth: 70,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  itemAmount: {
    fontSize: 18,
    color: "#fff",
    fontWeight: 700,
    minWidth: 120,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    gap: 12,
  },
  emptyEmoji: { fontSize: 56 },
  totalsCard: {
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 24,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  totalsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 4px",
  },
  totalsLabel: { color: "rgba(255,255,255,0.65)", fontSize: 14 },
  totalsValue: {
    color: "#f8fafc",
    fontSize: 16,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
  },
  grandTotalCard: {
    marginTop: "auto",
    background: "linear-gradient(135deg,#16a34a 0%,#0ea5e9 100%)",
    borderRadius: 18,
    padding: 22,
    color: "#fff",
    boxShadow: "0 12px 36px rgba(14,165,233,0.4)",
  },
  grandTotalLabel: {
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 2,
    opacity: 0.85,
  },
  grandTotalValue: {
    fontSize: 48,
    fontWeight: 800,
    marginTop: 4,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  payChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.18)",
    fontSize: 13,
    fontWeight: 600,
    marginTop: 12,
    color: "#fff",
  },
  customerCard: {
    background: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: "14px 16px",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  thankYouOverlay: {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(circle at center, rgba(22,163,74,0.95) 0%, rgba(15,118,110,0.95) 100%)",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    fontFamily: "inherit",
    zIndex: 100,
    animation: "cd-fade-in 320ms ease-out",
  },
  thankYouIcon: { fontSize: 96 },
  thankYouTitle: { fontSize: 56, fontWeight: 800, margin: 0 },
  thankYouMeta: { fontSize: 18, opacity: 0.9 },
  footer: {
    padding: "12px 32px",
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  connectionDot: (live) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: live ? "#22c55e" : "#f97316",
    boxShadow: live
      ? "0 0 0 4px rgba(34,197,94,0.18)"
      : "0 0 0 4px rgba(249,115,22,0.18)",
  }),
};

const KEYFRAMES = `
@keyframes cd-fade-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes cd-pop {
  0%   { transform: scale(0.92); }
  60%  { transform: scale(1.04); }
  100% { transform: scale(1); }
}
.cd-item-fresh { animation: cd-pop 320ms ease-out; }
.cd-item-list::-webkit-scrollbar { width: 8px; }
.cd-item-list::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 4px;
}
`;

function CustomerDisplay() {
  const [state, setState] = useState(() => readCustomerDisplayState());
  const [lastSeenAt, setLastSeenAt] = useState(() => Date.now());
  const [newestLineId, setNewestLineId] = useState(null);
  const lastLineCountRef = useRef(0);
  const now = useNow(1000);
  const lang = state?.lang === "bn" ? "bn" : "en";
  const locale = lang === "bn" ? "bn-BD" : "en-US";

  useEffect(() => {
    const branchId =
      typeof window !== "undefined"
        ? parseCustomerDisplayBranchId(window.location.hash)
        : null;
    const unsub = subscribeCustomerDisplay(
      (next) => {
        setState(next);
        setLastSeenAt(Date.now());
      },
      { branchId }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const cart = Array.isArray(state?.cart) ? state.cart : [];
    if (cart.length > lastLineCountRef.current) {
      setNewestLineId(cart[cart.length - 1]?.lineId || null);
      const t = setTimeout(() => setNewestLineId(null), 800);
      lastLineCountRef.current = cart.length;
      return () => clearTimeout(t);
    }
    lastLineCountRef.current = cart.length;
    return undefined;
  }, [state?.cart]);

  const status = state?.status || CUSTOMER_DISPLAY_STATUS.IDLE;
  const cart = Array.isArray(state?.cart) ? state.cart : [];
  const totals = { ...EMPTY_TOTALS, ...(state?.totals || {}) };
  const store = { ...DEFAULT_STORE, ...(state?.store || {}) };
  const customer = state?.customer || null;
  const paymentMethod = state?.paymentMethod || "Cash";
  const completedAt = state?.completedAt || null;

  const isLive = lastSeenAt && now.getTime() - lastSeenAt < 30_000;

  const itemCount = cart.reduce(
    (sum, line) => sum + Math.max(0, Number(line.qty || 0)),
    0
  );

  const text = lang === "bn"
    ? {
        welcome: "স্বাগতম",
        scanToStart: "শুরু করতে পণ্য স্ক্যান করুন",
        items: "পণ্য",
        qty: "পরিমাণ",
        amount: "মূল্য",
        subTotal: "সাবটোটাল",
        vat: "ভ্যাট",
        discount: "ডিসকাউন্ট",
        total: "সর্বমোট",
        paid: "পরিশোধিত",
        due: "বাকি",
        thankYou: "ধন্যবাদ!",
        comeAgain: "আবার আসবেন",
        payment: "পেমেন্ট",
        customer: "কাস্টমার",
        live: "লাইভ",
        offline: "সংযোগ বিচ্ছিন্ন",
      }
    : {
        welcome: "Welcome",
        scanToStart: "Scan a product to start",
        items: "Items",
        qty: "Qty",
        amount: "Amount",
        subTotal: "Sub Total",
        vat: "VAT",
        discount: "Discount",
        total: "Total",
        paid: "Paid",
        due: "Due",
        thankYou: "Thank you!",
        comeAgain: "Please come again",
        payment: "Payment",
        customer: "Customer",
        live: "Live",
        offline: "Disconnected",
      };

  const showThankYou =
    status === CUSTOMER_DISPLAY_STATUS.COMPLETED &&
    completedAt &&
    now.getTime() - completedAt < 12_000;

  return (
    <div style={STYLES.page}>
      <style>{KEYFRAMES}</style>

      <header style={STYLES.topBar}>
        <div style={STYLES.storeBlock}>
          {store.logoDataUrl ? (
            <img
              src={store.logoDataUrl}
              alt="store"
              style={{ ...STYLES.storeLogo, objectFit: "cover" }}
            />
          ) : (
            <div style={STYLES.storeLogo}>BD</div>
          )}
          <div>
            <h1 style={STYLES.storeName}>{store.name || "BD Smart POS"}</h1>
            <div style={STYLES.storeMeta}>
              {[store.address, store.phone].filter(Boolean).join(" · ") || text.welcome}
            </div>
          </div>
        </div>
        <div style={STYLES.clock}>
          <div style={STYLES.clockTime}>
            {now.toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div style={STYLES.clockDate}>
            {now.toLocaleDateString(locale, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "2-digit",
            })}
          </div>
        </div>
      </header>

      <main style={STYLES.body}>
        <section style={STYLES.cartCard}>
          <div style={STYLES.cartHeader}>
            <h2 style={STYLES.cartTitle}>{text.items}</h2>
            <span style={STYLES.cartCount}>
              {itemCount} {text.items}
            </span>
          </div>

          {cart.length === 0 ? (
            <div style={STYLES.emptyState}>
              <div style={STYLES.emptyEmoji}>🛒</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#f8fafc" }}>
                {text.welcome}
              </div>
              <div>{text.scanToStart}</div>
            </div>
          ) : (
            <div style={STYLES.itemList} className="cd-item-list">
              {cart.map((line, idx) => {
                const isNewest = newestLineId === line.lineId;
                const rowStyle = {
                  ...STYLES.itemRow,
                  ...(idx % 2 === 1 ? STYLES.itemRowAlt : {}),
                  ...(isNewest ? STYLES.itemRowFresh : {}),
                };
                const qtyText = line.sellByWeight
                  ? `${Number(line.weightKg || 0).toFixed(3)} kg`
                  : `× ${Number(line.qty || 0)}`;
                return (
                  <div
                    key={line.lineId || `${line.id}-${idx}`}
                    style={rowStyle}
                    className={isNewest ? "cd-item-fresh" : ""}
                  >
                    <div>
                      <div style={STYLES.itemName}>
                        {line.name}
                        {line.variantLabel ? ` (${line.variantLabel})` : ""}
                      </div>
                      {line.unitPrice ? (
                        <div style={STYLES.itemMeta}>
                          @ {formatCurrency(line.unitPrice, lang)}
                        </div>
                      ) : null}
                    </div>
                    <div style={STYLES.itemQty}>{qtyText}</div>
                    <div style={STYLES.itemAmount}>
                      {formatCurrency(line.lineTotal, lang)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside style={STYLES.totalsCard}>
          <div style={STYLES.totalsRow}>
            <span style={STYLES.totalsLabel}>{text.subTotal}</span>
            <span style={STYLES.totalsValue}>
              {formatCurrency(totals.subTotal, lang)}
            </span>
          </div>
          <div style={STYLES.totalsRow}>
            <span style={STYLES.totalsLabel}>{text.vat}</span>
            <span style={STYLES.totalsValue}>
              {formatCurrency(totals.vatAmount, lang)}
            </span>
          </div>
          {totals.totalDiscount > 0 ? (
            <div style={STYLES.totalsRow}>
              <span style={STYLES.totalsLabel}>{text.discount}</span>
              <span style={{ ...STYLES.totalsValue, color: "#fca5a5" }}>
                − {formatCurrency(totals.totalDiscount, lang)}
              </span>
            </div>
          ) : null}
          {totals.paid > 0 ? (
            <div style={STYLES.totalsRow}>
              <span style={STYLES.totalsLabel}>{text.paid}</span>
              <span style={STYLES.totalsValue}>
                {formatCurrency(totals.paid, lang)}
              </span>
            </div>
          ) : null}
          {totals.due > 0 ? (
            <div style={STYLES.totalsRow}>
              <span style={{ ...STYLES.totalsLabel, color: "#fda4af" }}>
                {text.due}
              </span>
              <span style={{ ...STYLES.totalsValue, color: "#fda4af" }}>
                {formatCurrency(totals.due, lang)}
              </span>
            </div>
          ) : null}

          {customer && (customer.name || customer.phone) ? (
            <div style={STYLES.customerCard}>
              <div style={STYLES.totalsLabel}>{text.customer}</div>
              <div style={{ ...STYLES.totalsValue, marginTop: 4 }}>
                {[customer.name, customer.phone].filter(Boolean).join(" · ")}
              </div>
            </div>
          ) : null}

          <div style={STYLES.grandTotalCard}>
            <div style={STYLES.grandTotalLabel}>{text.total}</div>
            <div style={STYLES.grandTotalValue}>
              {formatCurrency(totals.total, lang)}
            </div>
            <div style={STYLES.payChip}>
              <span>💳</span>
              <span>
                {text.payment}: {paymentMethod}
              </span>
            </div>
          </div>
        </aside>
      </main>

      {showThankYou ? (
        <div style={STYLES.thankYouOverlay}>
          <div style={STYLES.thankYouIcon}>✅</div>
          <h2 style={STYLES.thankYouTitle}>{text.thankYou}</h2>
          <div style={STYLES.thankYouMeta}>
            {state?.invoice?.number
              ? `${
                  lang === "bn" ? "ইনভয়েস" : "Invoice"
                } ${state.invoice.number}`
              : ""}
          </div>
          <div style={{ ...STYLES.thankYouMeta, fontSize: 26, fontWeight: 700 }}>
            {formatCurrency(totals.total, lang)}
          </div>
          <div style={STYLES.thankYouMeta}>{text.comeAgain}</div>
        </div>
      ) : null}

      <footer style={STYLES.footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={STYLES.connectionDot(isLive)} />
          <span>{isLive ? text.live : text.offline}</span>
        </div>
        <div>BD Smart POS · Customer Display</div>
      </footer>
    </div>
  );
}

export default CustomerDisplay;
