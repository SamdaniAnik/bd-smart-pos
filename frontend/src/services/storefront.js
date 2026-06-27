import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5001/api";

export const STOREFRONT_ROUTE = "#/storefront";

const MFS_METHODS = new Set(["bKash", "Nagad", "Rocket", "Upay"]);

export function isStorefrontMfsMethod(method) {
  return MFS_METHODS.has(String(method || ""));
}

export function isStorefrontRoute(hash) {
  const value = String(hash || "");
  if (value === STOREFRONT_ROUTE) return true;
  return value.startsWith(`${STOREFRONT_ROUTE}?`);
}

function parseStorefrontParams(hash) {
  const value = String(hash || "");
  const idx = value.indexOf("?");
  if (idx < 0) return new URLSearchParams();
  return new URLSearchParams(value.slice(idx + 1));
}

export function parseStorefrontToken(hash) {
  return String(parseStorefrontParams(hash).get("token") || "").trim();
}

export function parseStorefrontTable(hash) {
  return String(parseStorefrontParams(hash).get("table") || "").trim();
}

export function buildStorefrontUrl(token, { table } = {}) {
  if (typeof window === "undefined" || !token) return "";
  const params = new URLSearchParams({ token });
  const tableCode = String(table || "").trim();
  if (tableCode) params.set("table", tableCode);
  return `${window.location.origin}${window.location.pathname}${STOREFRONT_ROUTE}?${params.toString()}`;
}

export function createStorefrontApi(token) {
  const client = axios.create({ baseURL: API_BASE });
  client.interceptors.request.use((config) => {
    config.headers["x-storefront-token"] = token;
    return config;
  });
  return client;
}

export async function initiateStorefrontMfs(api, { method, amount, invoiceRef }) {
  const res = await api.post("/storefront/mfs/initiate", { method, amount, invoiceRef });
  return res.data;
}

export async function verifyStorefrontMfs(api, { paymentId, trxId }) {
  const res = await api.post("/storefront/mfs/verify", { paymentId, trxId });
  return res.data;
}
