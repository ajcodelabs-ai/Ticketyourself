/**
 * Public-facing configuration constants.
 * Single source of truth for the customer-visible domain used in microsite URLs.
 */

// Base domain shown in the UI as the future subdomain home of every organizer.
// In production the real DNS will route `<slug>.ajcodelabs.ai` to the SPA.
// In preview environments we still need to fall back to `/o/<slug>` paths.
export const PUBLIC_DOMAIN = "ajcodelabs.ai";

// Returns the user-facing URL the organizer should communicate to the public,
// e.g. "eventos-quito.ajcodelabs.ai". Doesn't include scheme.
export function publicMicrositeHost(slug) {
    if (!slug) return PUBLIC_DOMAIN;
    return `${slug}.${PUBLIC_DOMAIN}`;
}

// Returns the actual link that works *today* in the preview environment.
// Once wildcard DNS is live this should switch to `https://<slug>.<PUBLIC_DOMAIN>`.
export function previewMicrositePath(slug) {
    if (!slug) return "/";
    return `/o/${slug}`;
}
