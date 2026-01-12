const normalizeApiBase = (value) => (value ? value.replace(/\/+$/, "") : "");
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE) || "http://127.0.0.1:50000";
let didLogBase = false;

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
  if (!didLogBase && import.meta.env.MODE !== "test") {
    console.info("[api] API_BASE:", API_BASE);
    didLogBase = true;
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    const reason = err instanceof Error && err.message ? err.message : "서버에 연결할 수 없습니다.";
    throw new Error(`네트워크 오류: ${reason}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data.detail || data.message || "";
    } catch (err) {
      detail = await res.text().catch(() => "");
    }
    const reason = detail || res.statusText || "Request failed";
    throw new Error(reason);
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
export const refreshAsset = (id) => request(`/assets/${id}/refresh`, { method: "POST" });
export const refreshSummary = () => request("/refresh", { method: "POST" });
export const fetchSummary = () => request("/summary");
export const fetchTotals = (period = "daily", limit = 12, offset = 0) =>
  request(`/totals?period=${period}&limit=${limit}&offset=${offset}`);
export const fetchTotalsDetail = (period = "daily", limit = 10, offset = 0) =>
  request(`/totals/detail?period=${period}&limit=${limit}&offset=${offset}`);
export const snapshotTotals = () => request("/totals/snapshot", { method: "POST" });
