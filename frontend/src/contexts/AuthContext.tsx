import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, tokenStore } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [organizer, setOrganizer] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const setSession = useCallback((data) => {
        setUser(data?.user || null);
        setOrganizer(data?.organizer || null);
    }, []);

    const checkSession = useCallback(async () => {
        // Skip /me when there is no token; saves a 401 round-trip on cold load.
        if (!tokenStore.access) {
            setSession(null);
            setLoading(false);
            return;
        }
        try {
            const { data } = await api.get("/auth/me");
            setSession(data);
        } catch {
            tokenStore.clear();
            setSession(null);
        } finally {
            setLoading(false);
        }
    }, [setSession]);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    // Re-sync when another tab changes tokens (login/logout there).
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === "tys_access_token" || e.key === "tys_refresh_token") {
                checkSession();
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [checkSession]);

    // Re-sync when returning to a tab that may show stale role state.
    useEffect(() => {
        const onFocus = () => {
            if (tokenStore.access) checkSession();
        };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [checkSession]);

    useEffect(() => {
        const handler = () => {
            checkSession();
        };
        window.addEventListener("tys:forbidden", handler);
        return () => window.removeEventListener("tys:forbidden", handler);
    }, [checkSession]);

    useEffect(() => {
        const handler = () => {
            tokenStore.clear();
            setSession(null);
        };
        window.addEventListener("tys:unauthorized", handler);
        return () => window.removeEventListener("tys:unauthorized", handler);
    }, [setSession]);

    const login = useCallback(
        async (email, password) => {
            const { data } = await api.post("/auth/login", { email, password });
            if (data.access_token) {
                tokenStore.set({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                });
            }
            setSession(data);
            return data;
        },
        [setSession],
    );

    const register = useCallback(async (payload) => {
        const { data } = await api.post("/auth/register", payload);
        return data;
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post("/auth/logout");
        } catch (err) {
            // Server-side logout is best-effort; we always clear the local
            // session below so the user ends up logged out either way.
            console.warn("Logout API call failed (clearing local session anyway):", err?.message);
        }
        tokenStore.clear();
        setSession(null);
        navigate("/login", { replace: true });
    }, [navigate, setSession]);

    const refreshOrganizer = useCallback(async () => {
        try {
            const { data } = await api.get("/organizers/me");
            setOrganizer(data);
        } catch (err) {
            // Organizer profile is optional (e.g. super-admin user).
            // Surface to dev console without spamming the user.
            console.warn("refreshOrganizer failed:", err?.message);
        }
    }, []);

    const value = useMemo(
        () => ({
            user,
            organizer,
            loading,
            isAuthenticated: !!user,
            isAdmin: user?.role === "super_admin",
            isOrganizer: user?.role === "organizer",
            login,
            register,
            logout,
            refreshOrganizer,
            checkSession,
            formatApiError,
        }),
        [user, organizer, loading, login, register, logout, refreshOrganizer, checkSession],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
