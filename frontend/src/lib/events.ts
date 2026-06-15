/**
 * Event helpers — categories, status meta, formatting, public URL builder.
 * Single source of truth so the editor + listing + microsite renderer stay in sync.
 */
import { previewMicrositePath } from "@/lib/config";

export const EVENT_CATEGORIES = [
    { code: "educational", label: "Educativo" },
    { code: "entertainment", label: "Entretenimiento" },
    { code: "corporate", label: "Corporativo" },
    { code: "sports", label: "Deportes" },
    { code: "fairs", label: "Ferias" },
    { code: "family", label: "Familiar" },
];

export const EVENT_STATUS_META = {
    draft: { label: "Borrador", className: "bg-slate-100 text-slate-700" },
    published: { label: "Publicado", className: "bg-emerald-100 text-emerald-800" },
    sold_out: { label: "Agotado", className: "bg-violet-100 text-violet-800" },
    ended: { label: "Finalizado", className: "bg-zinc-200 text-zinc-700" },
    cancelled: { label: "Cancelado", className: "bg-red-100 text-red-800" },
};

export const PRICING_LABELS = {
    free: "Gratis",
    paid: "Pago",
    donation: "Aporte voluntario",
};

export function formatPriceLabel(event) {
    if (!event) return "";
    if (event.pricing_type === "free") return "Gratis";
    if (event.pricing_type === "donation") {
        return event.base_price_cents > 0
            ? `Aporta desde $${(event.base_price_cents / 100).toFixed(0)}`
            : "Aporta lo que quieras";
    }
    return `$${(event.base_price_cents / 100).toFixed(2)} ${event.currency || "USD"}`;
}

export function formatEventDate(iso, timezone = "America/Guayaquil") {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("es-EC", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: timezone,
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}

export function eventPublicPath(tenantSlug, eventSlug) {
    if (!tenantSlug || !eventSlug) return "/";
    return `${previewMicrositePath(tenantSlug)}/e/${eventSlug}`;
}

export function eventPublicUrl(tenantSlug, eventSlug) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${eventPublicPath(tenantSlug, eventSlug)}`;
}

export function googleMapsUrl(event) {
    if (!event) return "";
    const parts = [event.venue_name, event.venue_address, event.venue_city, event.venue_country].filter(
        Boolean,
    );
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

// Convert ISO datetime → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">.
export function isoToLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(local) {
    if (!local) return null;
    return new Date(local).toISOString();
}
