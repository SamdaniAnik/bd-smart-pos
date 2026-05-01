import { useEffect, useRef, useState } from "react";

function ManagerPinModal({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onClose }) {
  const [pin, setPin] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPin("");
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="page-card" role="dialog" aria-modal style={{ width: "min(400px, 92vw)", padding: "18px 20px" }}>
        <h4 style={{ marginTop: 0 }}>{title || "Manager approval"}</h4>
        {message ? (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>{message}</p>
        ) : null}
        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>PIN</label>
        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm?.(pin);
            }
          }}
          style={{ width: "100%", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={() => onClose?.()}>
            {cancelLabel}
          </button>
          <button type="button" onClick={() => onConfirm?.(pin)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ManagerPinModal;
