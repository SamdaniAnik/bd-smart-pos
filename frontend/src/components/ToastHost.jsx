import { useEffect, useMemo, useState } from "react";
import { NOTIFY_EVENT } from "../utils/notify";

const AUTO_CLOSE_MS = 4200;

function makeId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toneFromPrefix(prefix) {
  const p = String(prefix || "").toLowerCase();
  if (p.includes("error")) return "error";
  if (p.includes("permission")) return "warning";
  if (p.includes("action")) return "info";
  return "success";
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const [closingIds, setClosingIds] = useState(new Set());
  const [copiedToastId, setCopiedToastId] = useState("");

  const closeToast = (id) => {
    setClosingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setCopiedToastId((prev) => (prev === id ? "" : prev));
    }, 180);
  };

  const copyMessage = async (id, prefix, message) => {
    const text = `${prefix}: ${message}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedToastId(id);
    window.setTimeout(() => {
      setCopiedToastId((prev) => (prev === id ? "" : prev));
    }, 1200);
  };

  useEffect(() => {
    const onNotify = (event) => {
      const prefix = String(event?.detail?.prefix || "").trim();
      const message = String(event?.detail?.message || "").trim();
      if (!prefix || !message) return;
      const id = makeId();
      setToasts((prev) => [...prev, { id, prefix, message, tone: toneFromPrefix(prefix) }].slice(-6));
      window.setTimeout(() => {
        closeToast(id);
      }, AUTO_CLOSE_MS);
    };
    window.addEventListener(NOTIFY_EVENT, onNotify);
    return () => window.removeEventListener(NOTIFY_EVENT, onNotify);
  }, []);

  const visibleToasts = useMemo(() => toasts, [toasts]);
  if (!visibleToasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {visibleToasts.map((t) => (
        <div
          key={t.id}
          className={`toast-item toast-${t.tone} ${closingIds.has(t.id) ? "toast-item-leave" : "toast-item-enter"}`}
        >
          <div className="toast-text">
            <strong>{t.prefix}:</strong> {t.message}
          </div>
          {String(t.message || "").length > 100 ? (
            <button
              type="button"
              className="toast-copy"
              onClick={() => copyMessage(t.id, t.prefix, t.message)}
            >
              {copiedToastId === t.id ? "Copied" : "Copy"}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            onClick={() => closeToast(t.id)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
