import axios, { type AxiosRequestHeaders } from "axios";

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
        if (!config.headers) {
            config.headers = {} as AxiosRequestHeaders;
        }
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

// Global auth handler — silent refresh on 401, then fallback to session clear.
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const status = error?.response?.status;

        if (status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            const refreshToken = tokenStore.refresh;
            if (refreshToken) {
                try {
                    const { data } = await axios.post(
                        `${API_BASE}/auth/refresh`,
                        {},
                        { headers: { Authorization: `Bearer ${refreshToken}` } },
                    );
                    if (data.access_token) {
                        tokenStore.set({
                            access_token: data.access_token,
                            refresh_token: data.refresh_token,
                        });
                        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
                        return api(originalRequest);
                    }
                } catch {
                    // refresh failed — fall through to unauthorized
                }
            }
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
