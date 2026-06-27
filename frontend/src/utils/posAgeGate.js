const AGE_VERIFIED_KEY = "bd_pos_age_verified_v1";
const MANAGER_PIN_KEY = "bd_pos_manager_pin";

export const AGE_RESTRICTED_CATEGORIES = new Set([
  "TOBACCO",
  "ALCOHOL",
  "CIGARETTES",
  "BEER_WINE",
  "LIQUOR",
  "SPIRITS",
]);

export function isAgeRestrictedCategory(category) {
  return AGE_RESTRICTED_CATEGORIES.has(
    String(category || "")
      .trim()
      .toUpperCase()
  );
}

export function isAgeVerificationSessionActive() {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(AGE_VERIFIED_KEY) === "1";
}

export function setAgeVerificationSession(active) {
  if (typeof sessionStorage === "undefined") return;
  if (active) {
    sessionStorage.setItem(AGE_VERIFIED_KEY, "1");
  } else {
    sessionStorage.removeItem(AGE_VERIFIED_KEY);
  }
}

export function clearAgeVerificationSession() {
  setAgeVerificationSession(false);
}

export function verifyManagerPinForAgeGate(pin) {
  const expected = String(
    typeof localStorage !== "undefined" ? localStorage.getItem(MANAGER_PIN_KEY) || "1234" : "1234"
  ).trim();
  return String(pin || "").trim() === expected;
}
