/**
 * Public-facing configuration constants.
 * Single source of truth for the customer-visible domain used in microsite URLs.
 */

// Base domain shown in the UI as the future subdomain home of every organizer.
// In production the real DNS will route `<slug>.ajcodelabs.ai` to the SPA.
// In preview environments we still need to fall back to `/o/<slug>` paths.
export const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_DOMAIN || "ajcodelabs.ai";

// Returns the user-facing URL the organizer should communicate to the public,
// e.g. "eventos-quito.ajcodelabs.ai". Doesn't include scheme.
export function publicMicrositeHost(slug) {
    if (!slug) return PUBLIC_DOMAIN;
    return `${slug}.${PUBLIC_DOMAIN}`;
}

const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "app", "static", "assets", "staging", "tys-staging"]);

export function extractSubdomainFromHostname(hostname?: string): string | null {
    const h = hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
    const parts = h.split(".");
    if (parts.length < 3 || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
    const sub = parts[0].toLowerCase();
    if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
    return sub;
}

// Returns the actual link that works *today* in the preview environment.
// Once wildcard DNS is live this should switch to `https://<slug>.<PUBLIC_DOMAIN>`.
export function previewMicrositePath(slug) {
    if (!slug) return "/";
    if (extractSubdomainFromHostname() === slug) return "/";
    return `/o/${slug}`;
}

// True when the current page is actually served from PUBLIC_DOMAIN (or a subdomain
// of it) — i.e. wildcard DNS is confirmed live for this environment. False on
// localhost, IPs, and the Emergent preview domain, where subdomain links wouldn't
// resolve and we must fall back to `/o/<slug>` paths.
export function isOnPublicDomain() {
    if (typeof window === "undefined") return false;
    const h = window.location.hostname;
    if (h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
    return h === PUBLIC_DOMAIN || h.endsWith(`.${PUBLIC_DOMAIN}`);
}

// Full, shareable URL to an organizer's microsite — for copy/QR/share UI, not for
// in-app <Link> navigation (use previewMicrositePath for that). Uses the real
// `<scheme>://<slug>.<PUBLIC_DOMAIN>` subdomain when wildcard DNS is live (keeping
// the current page's protocol/port, so this also works over plain http on a local
// wildcard host like lvh.me), otherwise falls back to a same-origin `/o/<slug>` path.
export function publicMicrositeUrl(slug) {
    if (typeof window === "undefined") return "";
    if (!slug) return window.location.origin;
    if (isOnPublicDomain()) {
        const { protocol, port } = window.location;
        return `${protocol}//${publicMicrositeHost(slug)}${port ? `:${port}` : ""}`;
    }
    return `${window.location.origin}${previewMicrositePath(slug)}`;
}
