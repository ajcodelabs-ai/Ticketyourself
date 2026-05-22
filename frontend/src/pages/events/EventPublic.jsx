/**
 * /o/{slug}/e/{event_slug} — public event detail page (no auth).
 * Buy button opens "Próximamente" modal — purchases land in Phase 4.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
    Loader2,
    Frown,
    Calendar,
    MapPin,
    Ticket,
    Share2,
    ArrowLeft,
    ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import ShareModal from "@/components/microsite/ShareModal";
import PurchaseModal from "@/components/orders/PurchaseModal";
import {
    formatEventDate,
    formatPriceLabel,
    googleMapsUrl,
    eventPublicUrl,
} from "@/lib/events";
import { previewMicrositePath } from "@/lib/config";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200";

export default function EventPublic() {
    const { slug, event_slug } = useParams();
    const [event, setEvent] = useState(null);
    const [state, setState] = useState("loading");
    const [shareOpen, setShareOpen] = useState(false);
    const [buyOpen, setBuyOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        setState("loading");
        api.get(`/public/events/${slug}/${event_slug}`)
            .then((r) => {
                if (!alive) return;
                setEvent(r.data);
                setState("ready");
                document.title = `${r.data.title} · ${r.data.organizer?.company_name || slug}`;
            })
            .catch((e) => {
                if (!alive) return;
                setState(e?.response?.status === 404 ? "notfound" : "error");
            });
        return () => {
            alive = false;
        };
    }, [slug, event_slug]);

    const url = useMemo(() => eventPublicUrl(slug, event_slug), [slug, event_slug]);

    if (state === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (state !== "ready") {
        return (
            <div
                className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
                data-testid="event-public-notfound"
            >
                <Frown className="h-12 w-12 text-muted-foreground mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Evento no disponible</h1>
                <p className="text-muted-foreground max-w-md">
                    Puede que ya no esté publicado o que el link sea incorrecto.
                </p>
                <Link
                    to={previewMicrositePath(slug)}
                    className="mt-6 inline-flex items-center gap-1 underline text-primary"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Ver otros eventos del organizador
                </Link>
            </div>
        );
    }

    const heroBg = event.banner_url || event.poster_url || FALLBACK_IMG;
    const fullSrc = (u) => (u ? `${process.env.REACT_APP_BACKEND_URL || ""}${u}` : FALLBACK_IMG);

    return (
        <div data-testid="event-public-page">
            <section
                className="relative py-20 md:py-32 px-6 text-white"
                style={{
                    background: `linear-gradient(rgba(15,15,40,.6), rgba(15,15,40,.6)), url(${
                        event.banner_url ? fullSrc(event.banner_url) : event.poster_url ? fullSrc(event.poster_url) : heroBg
                    }) center/cover`,
                }}
            >
                <div className="max-w-4xl mx-auto space-y-3">
                    <Link
                        to={previewMicrositePath(slug)}
                        className="text-sm opacity-80 hover:opacity-100 inline-flex items-center gap-1"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {event.organizer?.company_name || slug}
                    </Link>
                    <h1
                        className="text-4xl md:text-6xl font-bold"
                        data-testid="event-public-title"
                    >
                        {event.title}
                    </h1>
                    <p className="text-lg md:text-xl text-white/90 max-w-2xl">
                        {event.short_description}
                    </p>
                </div>
            </section>

            <section className="max-w-4xl mx-auto px-6 -mt-12 relative z-10">
                <div className="rounded-2xl border bg-card shadow-xl p-6 grid sm:grid-cols-3 gap-4">
                    <Stat
                        icon={<Calendar className="h-5 w-5 text-primary" />}
                        label="Fecha"
                        value={formatEventDate(event.starts_at, event.timezone)}
                    />
                    <Stat
                        icon={<MapPin className="h-5 w-5 text-primary" />}
                        label="Ubicación"
                        value={
                            <a
                                href={googleMapsUrl(event)}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline inline-flex items-center gap-1"
                            >
                                {event.venue_name}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        }
                    />
                    <Stat
                        icon={<Ticket className="h-5 w-5 text-primary" />}
                        label="Precio"
                        value={
                            <Badge variant="outline" className="text-base font-semibold">
                                {formatPriceLabel(event)}
                            </Badge>
                        }
                    />
                </div>
            </section>

            {event.description && (
                <section className="max-w-3xl mx-auto px-6 py-12">
                    <h2 className="text-2xl font-semibold mb-4">Sobre el evento</h2>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/85 text-lg">
                        {event.description}
                    </p>
                </section>
            )}

            <section className="max-w-3xl mx-auto px-6 pb-16">
                <div className="rounded-2xl border bg-secondary/30 p-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            {event.capacity != null
                                ? `Capacidad: ${event.capacity} entradas`
                                : "Capacidad sin límite"}
                        </p>
                        <p className="text-2xl font-bold">{formatPriceLabel(event)}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            onClick={() => setShareOpen(true)}
                            variant="outline"
                            data-testid="event-public-share-btn"
                        >
                            <Share2 className="h-4 w-4 mr-1.5" />
                            Compartir
                        </Button>
                        <Button
                            onClick={() => setBuyOpen(true)}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            size="lg"
                            data-testid="event-public-buy-btn"
                        >
                            <Ticket className="h-4 w-4 mr-1.5" />
                            Comprar entradas
                        </Button>
                    </div>
                </div>
            </section>

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={url}
                companyName={event.title}
                heroSubtitle={event.short_description}
            />

            <PurchaseModal
                open={buyOpen}
                onOpenChange={setBuyOpen}
                event={event}
                tenantSlug={slug}
            />
        </div>
    );
}

function Stat({ icon, label, value }) {
    return (
        <div className="flex gap-3">
            <div className="mt-0.5 shrink-0">{icon}</div>
            <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="font-medium text-foreground">{value}</div>
            </div>
        </div>
    );
}
