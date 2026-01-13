const normalizeApiBase = (value) => (value ? value.replace(/\/+$/, "") : "");
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE) || "http://127.0.0.1:50000";
let didLogBase = false;

export const getToken = () => localStorage.getItem("token");
export const setToken = (token) => localStorage.setItem("token", token);
export const clearToken = () => localStorage.removeItem("token");

// JWT 토큰에서 만료 시간 추출 (초 단위 Unix timestamp)
const parseTokenExp = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp || null;
  } catch {
    return null;
  }
};

// 토큰 만료까지 남은 시간 (밀리초), 만료된 경우 음수 반환
export const getTokenTimeRemaining = () => {
  const token = getToken();
  if (!token) return null;
  const exp = parseTokenExp(token);
  if (!exp) return null;
  return exp * 1000 - Date.now();
};

// 토큰이 곧 만료되는지 확인 (기본: 5분 이내)
export const isTokenExpiringSoon = (thresholdMs = 5 * 60 * 1000) => {
  const remaining = getTokenTimeRemaining();
  if (remaining === null) return false;
  return remaining > 0 && remaining < thresholdMs;
};

// 토큰이 이미 만료되었는지 확인
export const isTokenExpired = () => {
  const remaining = getTokenTimeRemaining();
  if (remaining === null) return true;
  return remaining <= 0;
};

// 로그아웃 처리 - 토큰 삭제 및 로그인 페이지로 리다이렉트
export const logout = () => {
  clearToken();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
};

// 토큰 갱신 진행 중인지 추적 (중복 요청 방지)
let isRefreshing = false;
let refreshPromise = null;

// 토큰 갱신 API 호출
export const refreshTokenApi = async () => {
  // 이미 갱신 중이면 기존 Promise 반환
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const token = getToken();
  if (!token) {
    throw new Error("No token available");
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          logout();
          throw new Error("Session expired");
        }
        throw new Error("Token refresh failed");
      }

      const data = await res.json();
      setToken(data.access_token);
      return data.access_token;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// API 요청 전 토큰 만료 여부 확인 및 자동 갱신
const ensureValidToken = async () => {
  const token = getToken();
  if (!token) return;

  // 토큰이 이미 만료된 경우 로그아웃
  if (isTokenExpired()) {
    logout();
    throw new Error("Session expired");
  }

  // 토큰이 곧 만료되는 경우 (5분 이내) 자동 갱신 시도
  if (isTokenExpiringSoon()) {
    try {
      await refreshTokenApi();
    } catch (err) {
      // 갱신 실패 시 에러 로그만 남기고 계속 진행 (기존 토큰으로 시도)
      console.warn("[api] Token refresh failed:", err.message);
    }
  }
};

const request = async (path, options = {}) => {
  // 로그인/회원가입이 아닌 경우 토큰 유효성 확인
  if (path !== "/login" && path !== "/register") {
    await ensureValidToken();
  }

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
    // 401 에러: 토큰 만료 또는 인증 실패 - 자동 로그아웃
    if (res.status === 401) {
      // 로그인/회원가입 요청이 아닌 경우에만 자동 로그아웃
      if (path !== "/login" && path !== "/register") {
        logout();
      }
      throw new Error("세션이 만료되었습니다. 다시 로그인해주세요.");
    }

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
