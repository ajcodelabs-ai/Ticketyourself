import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { extractSubdomainFromHostname } from "@/lib/config";
import { useTenant } from "@/contexts/TenantContext";

/** Keep TenantContext in sync with /o/:slug and wildcard subdomains. */
export function TenantRouteSync() {
    const { pathname } = useLocation();
    const { tenantSlug, applySlug } = useTenant();
    const subdomain = extractSubdomainFromHostname();
    const fromPath = pathname.match(/^\/o\/([^/]+)/)?.[1];
    const desired = subdomain || fromPath;

    useEffect(() => {
        if (desired && desired !== tenantSlug) {
            applySlug?.(desired);
        }
    }, [desired, tenantSlug, applySlug]);

    return null;
}
