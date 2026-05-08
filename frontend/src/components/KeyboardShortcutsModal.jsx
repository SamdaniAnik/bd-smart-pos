import { useEffect, useMemo } from "react";
import { t } from "../i18n";

function ShortcutRow({ keys, description }) {
  return (
    <div className="shortcuts-row">
      <kbd className="shortcuts-keys">{keys}</kbd>
      <span className="shortcuts-desc">{description}</span>
    </div>
  );
}

export default function KeyboardShortcutsModal({ open, onClose, lang }) {
  const uiLang = lang === "bn" ? "bn" : "en";
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

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

  const title = tt("ksTitle");

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
            {tt("ksClose")}
          </button>
        </div>
        <p className="shortcuts-intro">{tt("ksIntro")}</p>
        <div className="shortcuts-section">
          <div className="shortcuts-section-title">{tt("ksApp")}</div>
          <ShortcutRow keys="⌘ / Ctrl + K" description={tt("ksMenuSearchFocus")} />
          <ShortcutRow keys="Enter" description={tt("ksMenuSearchEnter")} />
          <ShortcutRow keys="?" description={tt("ksQuestionPanel")} />
        </div>
        <div className="shortcuts-section">
          <div className="shortcuts-section-title">{tt("ksPos")}</div>
          <ShortcutRow keys="F2" description={tt("ksCheckout")} />
          <ShortcutRow keys="F4" description={tt("ksReprintLast")} />
          <ShortcutRow keys="F6" description={tt("ksHoldCart")} />
          <ShortcutRow keys="F7" description={tt("ksToggleHeldPanel")} />
        </div>
      </div>
    </div>
  );
}
