import { useEffect } from "react";

function ShortcutRow({ keys, description }) {
  return (
    <div className="shortcuts-row">
      <kbd className="shortcuts-keys">{keys}</kbd>
      <span className="shortcuts-desc">{description}</span>
    </div>
  );
}

export default function KeyboardShortcutsModal({ open, onClose, lang }) {
  const bn = lang === "bn";

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = bn ? "কীবোর্ড শর্টকাট" : "Keyboard shortcuts";

  return (
    <div
      className="shortcuts-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            {bn ? "বন্ধ" : "Close"}
          </button>
        </div>
        <p className="shortcuts-intro">
          {bn
            ? "ইনপুট বা টেক্সট এরিয়াতে টাইপ করার সময় ? খুলবে না।"
            : "Press ? when focus is not in an input or textarea to open this panel."}
        </p>
        <div className="shortcuts-section">
          <div className="shortcuts-section-title">{bn ? "অ্যাপ" : "App"}</div>
          <ShortcutRow
            keys="⌘ / Ctrl + K"
            description={
              bn ? "সাইডবার মেনু সার্চ ফোকাস" : "Focus sidebar menu search"
            }
          />
          <ShortcutRow
            keys="Enter"
            description={
              bn
                ? "মেনু সার্চ ফোকাসে থাকলে প্রথম ফলাফল খুলুন"
                : "While menu search is focused, open the first match"
            }
          />
          <ShortcutRow
            keys="?"
            description={
              bn ? "এই প্যানেল (ইনপুটে না থাকলে)" : "Open this panel (when not typing)"
            }
          />
        </div>
        <div className="shortcuts-section">
          <div className="shortcuts-section-title">POS</div>
          <ShortcutRow
            keys="F2"
            description={
              bn
                ? "চেকআউট (কার্ট খালি না হলে)"
                : "Checkout (when cart has lines)"
            }
          />
          <ShortcutRow
            keys="F4"
            description={
              bn ? "সর্বশেষ ইনভয়েস পুনঃপ্রিন্ট" : "Reprint last invoice"
            }
          />
          <ShortcutRow
            keys="F6"
            description={
              bn ? "কার্ট হোল্ড (কার্ট খালি না হলে)" : "Hold cart (when cart has lines)"
            }
          />
          <ShortcutRow
            keys="F7"
            description={
              bn ? "হোল্ড করা কার্ট প্যানেল খুলুন/বন্ধ" : "Toggle held-cart panel"
            }
          />
        </div>
      </div>
    </div>
  );
}
