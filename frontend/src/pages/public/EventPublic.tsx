/**
 * /o/{slug}/e/{event_slug} — public event detail page (no auth).
 * Buy button opens "Próximamente" modal — purchases land in Phase 4.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSlug } from "@/contexts/TenantContext";
import {
    Loader2,
    Frown,
    Calendar,
    MapPin,
    Ticket,
    Share2,
    ArrowLeft,
    ExternalLink,
    ChevronLeft,
    ChevronRight,
    X,
    CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import ShareModal from "@/components/microsite/ShareModal";
import PurchaseModal from "@/components/orders/PurchaseModal";
import NumberedSeatSection from "@/components/events/NumberedSeatSection";
import EventContentDisplay from "@/components/events/EventContentDisplay";
import { assetUrl } from "@/lib/microsite";
import {
    formatEventDate,
    formatPriceLabel,
    googleMapsUrl,
    eventPublicUrl,
} from "@/lib/events";
import { previewMicrositePath } from "@/lib/config";
import { PAYMENT_METHOD_META } from "@/lib/orders";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200";

export default function EventPublic() {
    const { event_slug } = useParams();
    const slug = useSlug();
    const [event, setEvent] = useState(null);
    const [state, setState] = useState("loading");
    const [shareOpen, setShareOpen] = useState(false);
    const [buyOpen, setBuyOpen] = useState(false);
    const [seatHoldsInfo, setSeatHoldsInfo] = useState(null);
    const [lightbox, setLightbox] = useState(-1); // index in gallery, -1 = closed
    const [functions, setFunctions] = useState([]);
    const [selectedFunctionId, setSelectedFunctionId] = useState(null);

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

    // Numbered multi-función events: each función has its own independent
    // seat pool, so the buyer must pick a función before the seat map (which
    // función-scopes its availability) can render.
    useEffect(() => {
        if (!event?.is_multi_function || !event?.venue_id) return;
        let alive = true;
        api.get(`/public/events/${event.id}/functions`)
            .then((r) => alive && setFunctions((r.data || []).filter((f) => f.status !== "cancelled")))
            .catch(() => alive && setFunctions([]));
        return () => { alive = false; };
    }, [event?.id, event?.is_multi_function, event?.venue_id]);

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
    const fullSrc = (u) => (u ? `${import.meta.env.VITE_BACKEND_URL || ""}${u}` : FALLBACK_IMG);

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

            {event.gallery_urls?.length > 0 && (
                <section
                    className="max-w-5xl mx-auto px-6 pt-10"
                    data-testid="event-public-gallery"
                >
                    <h2 className="text-2xl font-semibold mb-4">Galería</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {event.gallery_urls.map((url, i) => (
                            <button
                                key={`${url}-${i}`}
                                type="button"
                                className="aspect-square overflow-hidden rounded-lg border bg-secondary group"
                                onClick={() => setLightbox(i)}
                                data-testid={`gallery-thumb-${i}`}
                            >
                                <img
                                    src={assetUrl(url)}
                                    alt={`${event.title} galería ${i + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition"
                                    loading="lazy"
                                />
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {event.description && (
                <section className="max-w-3xl mx-auto px-6 py-12">
                    <h2 className="text-2xl font-semibold mb-4">Sobre el evento</h2>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/85 text-lg">
                        {event.description}
                    </p>
                </section>
            )}

            {event.content && (
                <section className="max-w-3xl mx-auto px-6 pb-12">
                    <EventContentDisplay content={event.content} />
                </section>
            )}

            {/* ── Active payment methods (skipped for free events) ─────── */}
            {event.pricing_type !== "free" && (() => {
                const pm = event.payment_methods || {};
                const active = ["stripe", "transfer", "cash"].filter(
                    (k) => pm[k]?.enabled,
                );
                if (active.length === 0) return null;
                return (
                    <section
                        className="max-w-3xl mx-auto px-6 pb-2"
                        data-testid="event-public-payment-methods"
                    >
                        <div className="rounded-2xl border bg-card p-5">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Métodos de pago aceptados
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {active.map((m) => {
                                    const meta = PAYMENT_METHOD_META[m];
                                    return (
                                        <div
                                            key={m}
                                            className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm"
                                            data-testid={`event-payment-chip-${m}`}
                                        >
                                            <span className="text-lg leading-none">
                                                {meta.icon}
                                            </span>
                                            <span className="font-medium">{meta.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                );
            })()}

            <section className="max-w-3xl mx-auto px-6 pb-16">
                {event.venue_id ? null : (
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
                )}
                {event.venue_id && (
                    <div className="flex justify-end pb-2">
                        <Button
                            onClick={() => setShareOpen(true)}
                            variant="outline"
                            size="sm"
                            data-testid="event-public-share-btn"
                        >
                            <Share2 className="h-4 w-4 mr-1.5" />
                            Compartir
                        </Button>
                    </div>
                )}
            </section>

            {event.venue_id && event.is_multi_function && functions.length > 0 && !selectedFunctionId && (
                <section className="max-w-3xl mx-auto px-6 pb-10" data-testid="event-public-function-picker">
                    <h2 className="text-2xl font-semibold mb-4">Elegí una función</h2>
                    <div className="space-y-2">
                        {functions.map((fn) => (
                            <button
                                key={fn.id}
                                type="button"
                                onClick={() => setSelectedFunctionId(fn.id)}
                                className="w-full flex items-start gap-3 rounded-lg border p-4 text-left hover:bg-secondary/40 transition"
                                data-testid={`public-fn-option-${fn.id}`}
                            >
                                <CalendarRange className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-medium">{fn.name}</div>
                                    {fn.starts_at && (
                                        <div className="text-sm text-muted-foreground">
                                            {formatEventDate(fn.starts_at, event.timezone)}
                                            {fn.venue_name ? ` · ${fn.venue_name}` : ""}
                                        </div>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {event.venue_id && event.is_multi_function && functions.length > 0 && selectedFunctionId && (
                <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 flex justify-end">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFunctionId(null)}
                        data-testid="public-fn-change"
                    >
                        Cambiar función
                    </Button>
                </div>
            )}

            {event.venue_id && (!event.is_multi_function || !functions.length || selectedFunctionId) && (
                <NumberedSeatSection
                    tenantSlug={slug}
                    event={event}
                    functionId={selectedFunctionId || ""}
                    functionName={functions.find((f) => f.id === selectedFunctionId)?.name || ""}
                    localityPricing={functions.find((f) => f.id === selectedFunctionId)?.locality_pricing}
                    onLaunchPurchase={(info) => {
                        setSeatHoldsInfo(info);
                        setBuyOpen(true);
                    }}
                />
            )}

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={url}
                companyName={event.title}
                heroSubtitle={event.short_description}
            />

            <PurchaseModal
                open={buyOpen}
                onOpenChange={(v) => {
                    setBuyOpen(v);
                    if (!v) setSeatHoldsInfo(null);
                }}
                event={event}
                tenantSlug={slug}
                seatHoldsInfo={seatHoldsInfo}
            />

            {/* Lightbox for gallery */}
            <Dialog
                open={lightbox >= 0}
                onOpenChange={(v) => {
                    if (!v) setLightbox(-1);
                }}
            >
                <DialogContent
                    className="max-w-4xl p-0 bg-black/95 border-0"
                    data-testid="gallery-lightbox"
                >
                    {lightbox >= 0 && event.gallery_urls && (
                        <div className="relative">
                            <img
                                src={assetUrl(event.gallery_urls[lightbox])}
                                alt={`Galería ${lightbox + 1}`}
                                className="w-full max-h-[80vh] object-contain"
                            />
                            <button
                                type="button"
                                aria-label="Cerrar"
                                className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5"
                                onClick={() => setLightbox(-1)}
                                data-testid="lightbox-close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                            {lightbox > 0 && (
                                <button
                                    type="button"
                                    aria-label="Anterior"
                                    className="absolute top-1/2 left-2 -translate-y-1/2 bg-white/90 rounded-full p-2"
                                    onClick={() => setLightbox((i) => i - 1)}
                                    data-testid="lightbox-prev"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </button>
                            )}
                            {lightbox < (event.gallery_urls.length - 1) && (
                                <button
                                    type="button"
                                    aria-label="Siguiente"
                                    className="absolute top-1/2 right-2 -translate-y-1/2 bg-white/90 rounded-full p-2"
                                    onClick={() => setLightbox((i) => i + 1)}
                                    data-testid="lightbox-next"
                                >
                                    <ChevronRight className="h-5 w-5" />
                                </button>
                            )}
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-white/90 rounded-full px-3 py-1 text-xs font-medium">
                                {lightbox + 1} / {event.gallery_urls.length}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
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
