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
import { useTenant } from "@/contexts/TenantContext";

const AuthContext = createContext(null);

function persistTokens(data) {
    if (!data?.access_token) return;
    if (data.user?.role === "buyer") {
        tokenStore.set(
            { access_token: data.access_token, refresh_token: data.refresh_token },
            { kind: "buyer", tenantSlug: data.user.tenant_slug },
        );
    } else {
        tokenStore.set(
            { access_token: data.access_token, refresh_token: data.refresh_token },
            { kind: "platform" },
        );
    }
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [organizer, setOrganizer] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { tenantSlug } = useTenant();

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
    }, [checkSession, tenantSlug]);

    useEffect(() => {
        const onStorage = (e) => {
            if (
                e.key === "tys_access_token" ||
                (e.key && e.key.startsWith("tys_buyer_access."))
            ) {
                checkSession();
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [checkSession]);

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
        async (email, password, allowRole, options: { tenantSlug?: string } = {}) => {
            const body: { email: string; password: string; tenant_slug?: string } = {
                email,
                password,
            };
            if (options.tenantSlug) body.tenant_slug = options.tenantSlug;
            const { data } = await api.post("/auth/login", body);
            if (allowRole && !allowRole(data.user?.role)) {
                const err: Error & { roleRejected?: boolean } = new Error(
                    "Role not allowed for this login form",
                );
                err.roleRejected = true;
                throw err;
            }
            persistTokens(data);
            setSession(data);
            return data;
        },
        [setSession],
    );

    const register = useCallback(
        async (payload) => {
            const { data } = await api.post("/auth/register", payload);
            persistTokens(data);
            setSession(data);
            return data;
        },
        [setSession],
    );

    const registerBuyer = useCallback(
        async (payload) => {
            const { data } = await api.post("/auth/register-buyer", payload);
            persistTokens(data);
            setSession(data);
            return data;
        },
        [setSession],
    );

    const loginSocial = useCallback(
        async (payload) => {
            const { data } = await api.post("/auth/social", payload);
            persistTokens(data);
            setSession(data);
            return data;
        },
        [setSession],
    );

    const logout = useCallback(async () => {
        const wasAdmin = user?.role === "super_admin";
        const wasBuyer = user?.role === "buyer";
        try {
            await api.post("/auth/logout");
        } catch (err) {
            console.warn("Logout API call failed (clearing local session anyway):", err?.message);
        }
        if (wasBuyer) {
            tokenStore.clear({ kind: "buyer", tenantSlug: user?.tenant_slug || tenantSlug });
        } else {
            tokenStore.clear({ kind: "platform" });
        }
        setSession(null);
        navigate(wasAdmin ? "/admin/login" : wasBuyer ? "/" : "/login", { replace: true });
    }, [navigate, setSession, user, tenantSlug]);

    const refreshOrganizer = useCallback(async ({ throwOnError = false } = {}) => {
        try {
            const { data } = await api.get("/organizers/me");
            setOrganizer(data);
            syncPlanFeaturesCache(data?.plan_code);
            return data;
        } catch (err) {
            console.warn("refreshOrganizer failed:", err?.message);
            if (throwOnError) throw err;
        }
    }, [syncPlanFeaturesCache]);

    const belongsToCurrentTenant = useMemo(() => {
        if (!user || !tenantSlug) return false;
        if (user.role === "buyer") return user.tenant_slug === tenantSlug;
        if (user.role === "organizer") return organizer?.slug === tenantSlug;
        return false;
    }, [user, organizer, tenantSlug]);

    const value = useMemo(
        () => ({
            user,
            organizer,
            loading,
            isAuthenticated: !!user,
            isAdmin: user?.role === "super_admin",
            isOrganizer: user?.role === "organizer",
            isBuyer: user?.role === "buyer",
            belongsToCurrentTenant,
            login,
            register,
            registerBuyer,
            loginSocial,
            logout,
            refreshOrganizer,
            checkSession,
            formatApiError,
        }),
        [
            user,
            organizer,
            loading,
            belongsToCurrentTenant,
            login,
            register,
            registerBuyer,
            loginSocial,
            logout,
            refreshOrganizer,
            checkSession,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
