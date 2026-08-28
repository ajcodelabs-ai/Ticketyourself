import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import api, { formatApiError, tokenStore } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [organizer, setOrganizer] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Tracks the plan_code we last saw so a resync only drops the cached
    // plan-features permissions when the plan actually changed (an admin
    // edit, a completed checkout, or switching to a different organizer
    // account) — not on every focus/storage resync, which would defeat the
    // point of usePlanFeatures' staleTime.
    const planCodeRef = useRef(null);
    const syncPlanFeaturesCache = useCallback(
        (planCode) => {
            const next = planCode ?? null;
            if (next === planCodeRef.current) return;
            planCodeRef.current = next;
            queryClient.invalidateQueries({ queryKey: queryKeys.plans.features });
        },
        [queryClient],
    );

    const setSession = useCallback(
        (data) => {
            setUser(data?.user || null);
            setOrganizer(data?.organizer || null);
            syncPlanFeaturesCache(data?.organizer?.plan_code);
        },
        [syncPlanFeaturesCache],
    );

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
            if (e.key === "tys_access_token") {
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

    // `allowRole`, when given, is checked BEFORE any token/session is
    // persisted — a wrong-role login (e.g. an organizer on /admin/login)
    // never touches localStorage or React state, so there's no window where
    // a rejected session is briefly live (readable by this tab's own UI, or
    // broadcast to other open tabs via the storage event).
    const login = useCallback(
        async (email, password, allowRole) => {
            const { data } = await api.post("/auth/login", { email, password });
            if (allowRole && !allowRole(data.user?.role)) {
                const err: Error & { roleRejected?: boolean } = new Error(
                    "Role not allowed for this login form",
                );
                err.roleRejected = true;
                throw err;
            }
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

    const register = useCallback(
        async (payload) => {
            const { data } = await api.post("/auth/register", payload);
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

    const logout = useCallback(async () => {
        // Capture before clearing — super_admin has its own login entry
        // point (/admin/login), so logging out from the admin panel must
        // land there, not on the organizer form.
        const wasAdmin = user?.role === "super_admin";
        try {
            await api.post("/auth/logout");
        } catch (err) {
            // Server-side logout is best-effort; we always clear the local
            // session below so the user ends up logged out either way.
            console.warn("Logout API call failed (clearing local session anyway):", err?.message);
        }
        tokenStore.clear();
        setSession(null);
        navigate(wasAdmin ? "/admin/login" : "/login", { replace: true });
    }, [navigate, setSession, user]);

    // Swallows errors by default (most callers just want a best-effort UI
    // sync after an action that already succeeded on its own). Callers that
    // need to know the refresh actually landed before proceeding — e.g. any
    // flow that navigates somewhere gated on the fresh organizer state —
    // should pass `{ throwOnError: true }` instead of treating a resolved
    // promise as success.
    const refreshOrganizer = useCallback(async ({ throwOnError = false } = {}) => {
        try {
            const { data } = await api.get("/organizers/me");
            setOrganizer(data);
            syncPlanFeaturesCache(data?.plan_code);
            return data;
        } catch (err) {
            // Organizer profile is optional (e.g. super-admin user).
            // Surface to dev console without spamming the user.
            console.warn("refreshOrganizer failed:", err?.message);
            if (throwOnError) throw err;
        }
    }, [syncPlanFeaturesCache]);

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
