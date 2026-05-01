import axios from "axios";

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

export default api;