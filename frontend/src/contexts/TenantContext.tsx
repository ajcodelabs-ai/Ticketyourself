import {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useMemo,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { extractSubdomainFromHostname } from "@/lib/config";

const STORAGE_KEY = "tys.tenant_slug";
const DEFAULT_PREVIEW_SLUG = "demo-org";

const TenantContext = createContext({
    tenantSlug: null,
    tenant: null,
    loading: true,
    setTenantSlug: (_slug: string) => {},
    refresh: () => {},
});

export function TenantProvider({ children }) {
    const [searchParams, setSearchParams] = useSearchParams();

    // Initial slug:
    //   1. Subdomain from hostname (e.g. demo-org.ajcodelabs.ai → "demo-org")
    //   2. ?tenant=... in URL
    //   3. localStorage
    //   4. default "demo-org" for preview convenience
    const initialSlug =
        extractSubdomainFromHostname() ||
        searchParams.get("tenant") ||
        (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) ||
        DEFAULT_PREVIEW_SLUG;

    const [tenantSlug, setTenantSlugState] = useState(initialSlug);
    const [tenant, setTenant] = useState(null);
    const [loading, setLoading] = useState(true);

    const persistSlug = useCallback((slug) => {
        if (slug) {
            localStorage.setItem(STORAGE_KEY, slug);
        }
    }, []);

    const fetchTenant = useCallback(async (slug) => {
        if (!slug) {
            setTenant(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const { data } = await api.get("/tenants/resolve", {
                params: { tenant: slug },
            });
            setTenant(data?.tenant || null);
        } catch (_e) {
            setTenant(null);
        } finally {
            setLoading(false);
        }
    }, []);

    // Sync ?tenant= → state on URL changes.
    useEffect(() => {
        const urlSlug = searchParams.get("tenant");
        if (urlSlug && urlSlug !== tenantSlug) {
            setTenantSlugState(urlSlug);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Persist + fetch whenever slug changes.
    useEffect(() => {
        persistSlug(tenantSlug);
        fetchTenant(tenantSlug);
    }, [tenantSlug, persistSlug, fetchTenant]);

    const setTenantSlug = useCallback(
        (slug) => {
            const clean = (slug || "").trim().toLowerCase();
            setTenantSlugState(clean);
            persistSlug(clean);
            // Keep URL in sync so links can be shared.
            const next = new URLSearchParams(searchParams);
            if (clean) {
                next.set("tenant", clean);
            } else {
                next.delete("tenant");
            }
            setSearchParams(next, { replace: true });
        },
        [persistSlug, searchParams, setSearchParams],
    );

    const refresh = useCallback(
        () => fetchTenant(tenantSlug),
        [fetchTenant, tenantSlug],
    );

    const value = useMemo(
        () => ({ tenantSlug, tenant, loading, setTenantSlug, refresh }),
        [tenantSlug, tenant, loading, setTenantSlug, refresh],
    );

    return (
        <TenantContext.Provider value={value}>
            {children}
        </TenantContext.Provider>
    );
}

export function useTenant() {
    const ctx = useContext(TenantContext);
    if (!ctx) throw new Error("useTenant must be used within TenantProvider");
    return ctx;
}

export function useSlug() {
    const { slug, tenantSlug: ts } = useParams();
    const { tenantSlug } = useTenant();
    return slug || ts || tenantSlug || undefined;
}

export function useTenantSlug() {
    const { tenantSlug: paramSlug } = useParams();
    const { tenantSlug } = useTenant();
    return paramSlug || tenantSlug || undefined;
}
