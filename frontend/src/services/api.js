import axios from "axios";
import { notifyError } from "../utils/notify";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5001/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bd_pos_token");
  const branchId = localStorage.getItem("bd_pos_branch_id") || "1";
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["x-branch-id"] = branchId;
  return config;
});

function getApiErrorMessage(error) {
  const fromResponse = error?.response?.data;
  if (typeof fromResponse === "string" && fromResponse.trim()) return fromResponse.trim();
  if (typeof fromResponse === "object" && fromResponse?.error) return String(fromResponse.error);
  if (error?.message) return String(error.message);
  return "Request failed";
}

/** Paths where 401 means bad credentials / validation, not an expired session. */
const AUTH_401_NO_SESSION_REDIRECT = ["/auth/login", "/auth/register"];

let sessionInvalidRedirectScheduled = false;

function clearSessionAndReload() {
  if (sessionInvalidRedirectScheduled) return;
  sessionInvalidRedirectScheduled = true;
  localStorage.removeItem("bd_pos_token");
  localStorage.removeItem("bd_pos_permissions");
  localStorage.removeItem("bd_pos_user");
  window.location.reload();
}

function shouldRedirect401OnResponse(error) {
  if (error?.response?.status !== 401) return false;
  if (error?.config?.skipAuthSessionRedirect) return false;
  const url = String(error?.config?.url || "");
  return !AUTH_401_NO_SESSION_REDIRECT.some((p) => url.includes(p));
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (shouldRedirect401OnResponse(error)) {
      clearSessionAndReload();
      return Promise.reject(error);
    }
    const method = String(error?.config?.method || "").toLowerCase();
    const shouldToast =
      ["post", "put", "patch", "delete"].includes(method) &&
      !Boolean(error?.config?.skipGlobalErrorToast);
    if (shouldToast) {
      notifyError(getApiErrorMessage(error));
    }
    return Promise.reject(error);
  }
);

export default api;