/**
 * Sanitize untrusted HTML before rendering with dangerouslySetInnerHTML.
 * Single import point for DOMPurify across the app.
 */
import DOMPurify from "dompurify";

export function sanitizeHtml(html: string | undefined | null): string {
    if (!html) return "";
    return DOMPurify.sanitize(html);
}
