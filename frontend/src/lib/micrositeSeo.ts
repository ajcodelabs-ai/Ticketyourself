/**
 * SEO helpers for microsite public pages and editor preview.
 */
import { assetUrl } from "@/lib/microsite";

export interface MicrositeSeo {
    meta_title?: string;
    meta_description?: string;
    og_image_url?: string | null;
}

export function resolveSeo(
    microsite: {
        seo?: MicrositeSeo;
        content?: { hero_title?: string; hero_subtitle?: string };
        company_name?: string;
        branding?: { banner_url?: string; logo_url?: string };
    },
    publicUrl?: string,
) {
    const seo = microsite.seo || {};
    const content = microsite.content || {};
    const branding = microsite.branding || {};
    const company = microsite.company_name || content.hero_title || "Ticket Yourself";

    const title = (seo.meta_title || company).trim();
    const description = (
        seo.meta_description ||
        content.hero_subtitle ||
        `Eventos y tickets de ${company}`
    ).trim();

    const ogImage =
        assetUrl(seo.og_image_url) ||
        assetUrl(branding.banner_url) ||
        assetUrl(branding.logo_url) ||
        null;

    return { title, description, ogImage, url: publicUrl || window.location.href };
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
    if (!content) return;
    let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

/** Apply document title + Open Graph / Twitter meta tags. */
export function applyMicrositeHead({
    title,
    description,
    ogImage,
    url,
}: {
    title: string;
    description: string;
    ogImage: string | null;
    url: string;
}) {
    document.title = title.includes("Ticket Yourself") ? title : `${title} · Ticket Yourself`;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:url", url);
    if (ogImage) upsertMeta("property", "og:image", ogImage);
    upsertMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    if (ogImage) upsertMeta("name", "twitter:image", ogImage);
}

export const CUSTOM_CSS_PLANS = new Set(["profesional", "enterprise"]);

export function canUseCustomCss(planCode: string | undefined | null): boolean {
    return Boolean(planCode && CUSTOM_CSS_PLANS.has(planCode));
}
