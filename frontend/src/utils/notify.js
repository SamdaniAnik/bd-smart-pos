const NOTIFY_EVENT = "bd_pos_notify";
let lastShownMessage = "";
let lastShownAt = 0;
const DEDUPE_WINDOW_MS = 900;

function showAlert(prefix, message) {
  const text = String(message || "").trim();
  if (!text) return;
  const finalText = `${prefix}: ${text}`;
  const now = Date.now();
  if (finalText === lastShownMessage && now - lastShownAt < DEDUPE_WINDOW_MS) return;
  lastShownMessage = finalText;
  lastShownAt = now;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(NOTIFY_EVENT, {
        detail: { prefix, message: text },
      })
    );
    return;
  }
  alert(finalText);
}

export function notifySuccess(message) {
  showAlert("Success", message);
}

export function notifyError(message) {
  showAlert("Error", message);
}

export function notifyActionRequired(message) {
  showAlert("Action required", message);
}

export function notifyPermissionRequired(permissionMessage) {
  showAlert("Permission required", permissionMessage);
}

export function consumeGlobalSubmitError() {
  // Intentionally empty: submit errors are already shown by the API interceptor.
}

export { NOTIFY_EVENT };
