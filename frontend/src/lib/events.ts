/**
 * Event helpers — categories, status meta, formatting, public URL builder.
 * Single source of truth so the editor + listing + microsite renderer stay in sync.
 */
import { previewMicrositePath } from "@/lib/config";

export const EVENT_CATEGORIES = [
    { code: "music", label: "Música y Conciertos" },
    { code: "theater", label: "Teatro y Artes Escénicas" },
    { code: "comedy", label: "Comedia y Stand Up" },
    { code: "festivals", label: "Festivales" },
    { code: "family", label: "Familiar e Infantil" },
    { code: "sports", label: "Deportivo" },
    { code: "educational", label: "Educativo y Capacitación" },
    { code: "corporate", label: "Corporativo y Networking" },
    { code: "fairs", label: "Ferias y Exposiciones" },
    { code: "conferences", label: "Congresos y Convenciones" },
    { code: "gastronomy", label: "Gastronomía y Degustaciones" },
    { code: "art_culture", label: "Arte y Cultura" },
    { code: "health_wellness", label: "Salud y Bienestar" },
    { code: "religious", label: "Religioso y Espiritual" },
    { code: "tourism", label: "Turismo y Experiencias" },
    { code: "technology", label: "Tecnología e Innovación" },
    { code: "fashion_beauty", label: "Moda y Belleza" },
    { code: "community", label: "Comunidad" },
    { code: "nightlife", label: "Vida Nocturna" },
    { code: "other", label: "Otros" },
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
    // Numbered/seated events price per locality, not via base_price_cents.
    if (event.venue_id && event.locality_pricing?.length) {
        const cents = event.locality_pricing.map((lp) => lp.price_cents || 0);
        const min = Math.min(...cents);
        const max = Math.max(...cents);
        const currency = event.currency || "USD";
        if (min === max) return `$${(min / 100).toFixed(2)} ${currency}`;
        return `$${(min / 100).toFixed(2)} – $${(max / 100).toFixed(2)} ${currency}`;
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
