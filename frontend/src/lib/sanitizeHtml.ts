/**
 * Sanitize untrusted HTML before rendering with dangerouslySetInnerHTML.
 * Single import point for DOMPurify across the app.
 */
import DOMPurify from "dompurify";

export function sanitizeHtml(html: string | undefined | null): string {
    if (!html) return "";
    return DOMPurify.sanitize(html);
}

const SAFE_HREF_RE = /^(#|https?:\/\/|mailto:|tel:)/i;

/** Whitelists the protocols allowed for organizer-supplied hrefs (CTA buttons, social links). */
export function isSafeHref(href: string | undefined | null): boolean {
    if (!href) return false;
    return SAFE_HREF_RE.test(href.trim());
}
