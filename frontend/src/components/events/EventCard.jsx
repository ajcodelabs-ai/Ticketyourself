/**
 * EventCard — used in microsite (public) and event lists.
 * Single visual contract so list / microsite / share previews stay aligned.
 */
import { Link } from "react-router-dom";
import { Calendar, MapPin, Ticket } from "lucide-react";
import { formatPriceLabel, formatEventDate, eventPublicPath } from "@/lib/events";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800";

export default function EventCard({ event, tenantSlug, primaryColor = "#4f46e5" }) {
    if (!event) return null;
    const slug = tenantSlug || event.tenant_slug;
    const href = eventPublicPath(slug, event.slug);
    return (
        <Link
            to={href}
            data-testid={`event-card-${event.slug}`}
            className="group block rounded-2xl overflow-hidden border bg-card hover:-translate-y-0.5 hover:shadow-lg transition-all"
        >
            <div className="aspect-[4/3] relative overflow-hidden bg-muted">
                <img
                    src={event.poster_url || FALLBACK_IMG}
                    alt={event.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition"
                    onError={(e) => {
                        e.currentTarget.src = FALLBACK_IMG;
                    }}
                />
                <span
                    className="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full text-white shadow"
                    style={{ background: primaryColor }}
                >
                    {formatPriceLabel(event)}
                </span>
            </div>
            <div className="p-4 space-y-2">
                <h3 className="font-semibold text-lg leading-tight line-clamp-2">
                    {event.title}
                </h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatEventDate(event.starts_at, event.timezone)}
                </p>
                {event.venue_name && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="line-clamp-1">
                            {event.venue_name}
                            {event.venue_city ? ` · ${event.venue_city}` : ""}
                        </span>
                    </p>
                )}
                {event.short_description && (
                    <p className="text-sm text-foreground/70 line-clamp-2 pt-1">
                        {event.short_description}
                    </p>
                )}
                <div
                    className="text-sm font-medium pt-1 inline-flex items-center gap-1"
                    style={{ color: primaryColor }}
                >
                    <Ticket className="h-3.5 w-3.5" />
                    Ver más →
                </div>
            </div>
        </Link>
    );
}
