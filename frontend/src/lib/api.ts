import axios from "axios";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const ACCESS_KEY = "tys_access_token";
const REFRESH_KEY = "tys_refresh_token";

export const tokenStore = {
    get access() {
        return localStorage.getItem(ACCESS_KEY);
    },
    get refresh() {
        return localStorage.getItem(REFRESH_KEY);
    },
    set({ access_token, refresh_token }) {
        if (access_token) localStorage.setItem(ACCESS_KEY, access_token);
        if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
    },
    clear() {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
    },
};

const api = axios.create({
    baseURL: API_BASE,
    headers: { "Content-Type": "application/json" },
    // No withCredentials: the platform ingress overrides CORS headers with "*",
    // which is incompatible with cookies. We rely on Bearer tokens instead.
});

// Attach Bearer token on every request when available.
// Also: when the body is FormData, strip any forced Content-Type so axios
// regenerates the correct multipart/form-data header with its boundary param.
api.interceptors.request.use((config) => {
    const token = tokenStore.access;
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
        if (config.headers) {
            delete config.headers["Content-Type"];
            delete config.headers["content-type"];
        }
    }
    return config;
});

// Global 401 handler — let the AuthContext clear session via custom event.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        if (status === 401) {
            window.dispatchEvent(new CustomEvent("tys:unauthorized"));
        } else if (status === 403) {
            window.dispatchEvent(new CustomEvent("tys:forbidden"));
        }
        return Promise.reject(error);
    },
);

export function formatApiError(detail) {
    if (detail == null) return "Algo salió mal. Intentalo de nuevo.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
        return detail
            .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
            .filter(Boolean)
            .join(" · ");
    if (detail && typeof detail.msg === "string") return detail.msg;
    return String(detail);
}

export default api;
