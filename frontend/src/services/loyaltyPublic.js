import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5001/api";

export const LOYALTY_ROUTE = "#/loyalty";

export function isLoyaltyRoute(hash) {
  const value = String(hash || "");
  return value === LOYALTY_ROUTE || value.startsWith(`${LOYALTY_ROUTE}?`);
}

export function parseLoyaltyCardToken(hash) {
  const value = String(hash || "");
  const idx = value.indexOf("?");
  if (idx < 0) return "";
  return String(new URLSearchParams(value.slice(idx + 1)).get("card") || "").trim();
}

export function buildLoyaltyCardUrl(cardToken) {
  if (typeof window === "undefined" || !cardToken) return "";
  return `${window.location.origin}${window.location.pathname}${LOYALTY_ROUTE}?card=${encodeURIComponent(cardToken)}`;
}

const publicClient = axios.create({ baseURL: API_BASE });

export async function fetchLoyaltyCardInfo(cardToken) {
  const res = await publicClient.get("/loyalty/public/card", { params: { token: cardToken } });
  return res.data;
}

export async function requestLoyaltyOtp({ cardToken, phone }) {
  const res = await publicClient.post("/loyalty/public/otp/request", { cardToken, phone });
  return res.data;
}

export async function verifyLoyaltyOtp({ cardToken, phone, otp }) {
  const res = await publicClient.post("/loyalty/public/otp/verify", { cardToken, phone, otp });
  return res.data;
}
