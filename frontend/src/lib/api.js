import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
    baseURL: API_BASE,
    headers: { "Content-Type": "application/json" },
    withCredentials: true,
});

// Global 401 handler — let the AuthContext handle redirect by emitting a
// CustomEvent that the provider listens to. We do NOT call router here.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error?.response?.status === 401) {
            window.dispatchEvent(new CustomEvent("tys:unauthorized"));
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
