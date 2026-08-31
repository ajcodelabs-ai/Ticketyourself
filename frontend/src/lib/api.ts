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
        const headers = config.headers;
        // AxiosHeaders.delete is required; `delete obj[key]` is a no-op on it.
        if (headers && typeof headers.delete === "function") {
            headers.delete("Content-Type");
        } else if (headers) {
            delete headers["Content-Type"];
            delete headers["content-type"];
        }
    }
    return config;
});

// Refresh tokens are single-use server-side (each /auth/refresh call rotates
// them). If two requests 401 at nearly the same time — e.g. the mount and
// focus checkSession() calls firing together right after a reload — they
// must not each spend the same refresh token: the loser would get "revoked"
// and clear out the winner's freshly-set session. Sharing one in-flight
// promise coalesces concurrent 401s into a single refresh call.
let refreshPromise: Promise<string> | null = null;

function doRefresh(refreshToken: string): Promise<string> {
    if (!refreshPromise) {
        refreshPromise = axios
            .post(
                `${API_BASE}/auth/refresh`,
                {},
                { headers: { Authorization: `Bearer ${refreshToken}` } },
            )
            .then(({ data }) => {
                if (!data.access_token) throw new Error("Refresh response missing access_token");
                tokenStore.set({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                });
                return data.access_token;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
}

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
                    const newAccessToken = await doRefresh(refreshToken);
                    originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                    return api(originalRequest);
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

// Human-friendly labels for field names that show up in Pydantic's
// `loc` (e.g. ["body", "phone"]) so validation errors read as
// "Teléfono: ..." instead of the raw Python field name.
const FIELD_LABELS: Record<string, string> = {
    email: "Email",
    password: "Contraseña",
    name: "Nombre",
    company_name: "Nombre de la empresa",
    legal_id: "RUC/Cédula",
    org_type: "Tipo de organización",
    phone: "Teléfono",
    country: "País",
    contact_email: "Email de contacto",
    title: "Título",
    starts_at: "Fecha de inicio",
    ends_at: "Fecha de fin",
    venue_name: "Nombre del lugar",
    duration_preset: "Duración",
    base_price_cents: "Precio base",
    poster_url: "Imagen principal",
    category: "Categoría",
    timezone: "Zona horaria",
};

// Friendlier Spanish translations for the most common Pydantic v2
// error types. Falls back to the raw `msg` for anything not listed.
function translateValidationError(entry) {
    const loc = Array.isArray(entry?.loc) ? entry.loc : [];
    const field = loc[loc.length - 1];
    const label = (typeof field === "string" && FIELD_LABELS[field]) || null;

    let msg = typeof entry?.msg === "string" ? entry.msg : null;
    switch (entry?.type) {
        case "missing":
            msg = "Este campo es obligatorio.";
            break;
        case "string_too_short":
            msg = `Debe tener al menos ${entry?.ctx?.min_length ?? ""} caracteres.`.replace("  ", " ");
            break;
        case "string_too_long":
            msg = `No puede tener más de ${entry?.ctx?.max_length ?? ""} caracteres.`.replace("  ", " ");
            break;
        case "value_error":
        case "string_pattern_mismatch":
            msg = "El valor ingresado no es válido.";
            break;
        case "string_type":
        case "int_type":
        case "float_type":
            msg = "El valor ingresado no tiene el formato correcto.";
            break;
        case "literal_error":
        case "enum":
            msg = "Elige una de las opciones disponibles.";
            break;
        default:
            break;
    }
    if (!msg) msg = entry && typeof entry === "object" ? JSON.stringify(entry) : String(entry);
    return label ? `${label}: ${msg}` : msg;
}

export function formatApiError(detail) {
    if (detail == null) return "Algo salió mal. Inténtalo de nuevo.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
        return detail
            .map((e) => (e && typeof e === "object" ? translateValidationError(e) : String(e)))
            .filter(Boolean)
            .join(" · ");
    if (detail && typeof detail === "object") {
        if (typeof detail.message === "string" && detail.message.trim()) {
            return detail.message;
        }
        if (typeof detail.msg === "string") return detail.msg;
        if (typeof detail.detail === "string") return detail.detail;
        if (Array.isArray(detail.detail)) return formatApiError(detail.detail);
    }
    return String(detail);
}

export default api;
