const KEY = "bd_pos_touch_mode";

export function getTouchMode() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setTouchMode(enabled) {
  try {
    if (enabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
    document.documentElement.classList.toggle("touch-mode", enabled);
    window.dispatchEvent(new CustomEvent("bd_pos_touch_mode_changed", { detail: { enabled } }));
  } catch {
    /* ignore */
  }
}

export function applyTouchModeClass() {
  document.documentElement.classList.toggle("touch-mode", getTouchMode());
}
