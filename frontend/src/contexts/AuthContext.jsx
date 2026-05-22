import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";

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
        try {
            const { data } = await api.get("/auth/me");
            setSession(data);
        } catch {
            setSession(null);
        } finally {
            setLoading(false);
        }
    }, [setSession]);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    useEffect(() => {
        const handler = () => {
            setSession(null);
        };
        window.addEventListener("tys:unauthorized", handler);
        return () => window.removeEventListener("tys:unauthorized", handler);
    }, [setSession]);

    const login = useCallback(
        async (email, password) => {
            const { data } = await api.post("/auth/login", { email, password });
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
        } catch {
            /* ignore */
        }
        setSession(null);
        navigate("/login", { replace: true });
    }, [navigate, setSession]);

    const refreshOrganizer = useCallback(async () => {
        try {
            const { data } = await api.get("/organizers/me");
            setOrganizer(data);
        } catch {
            /* organizer might not be available */
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
