const API_BASE = "http://127.0.0.1:50000";

export const getToken = () => localStorage.getItem("token");
export const setToken = (token) => localStorage.setItem("token", token);
export const clearToken = () => localStorage.removeItem("token");

const request = async (path, options = {}) => {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || "Request failed");
  }
  return res.json();
};

export const register = (payload) => request("/register", { method: "POST", body: JSON.stringify(payload) });
export const login = (payload) => request("/login", { method: "POST", body: JSON.stringify(payload) });
export const listAssets = () => request("/assets");
export const addAsset = (payload) => request("/assets", { method: "POST", body: JSON.stringify(payload) });
export const updateAsset = (id, payload) =>
  request(`/assets/${id}`, { method: "PUT", body: JSON.stringify(payload) });
export const deleteAsset = (id) => request(`/assets/${id}`, { method: "DELETE" });
export const refreshSummary = () => request("/refresh", { method: "POST" });
export const fetchSummary = () => request("/summary");
export const fetchTotals = (period = "daily", limit = 12, offset = 0) =>
  request(`/totals?period=${period}&limit=${limit}&offset=${offset}`);
export const fetchTotalsDetail = (period = "daily", limit = 10, offset = 0) =>
  request(`/totals/detail?period=${period}&limit=${limit}&offset=${offset}`);
export const snapshotTotals = () => request("/totals/snapshot", { method: "POST" });
