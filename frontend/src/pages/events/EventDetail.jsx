/**
 * /eventos/:id — organizer-facing detail. Shows poster + stats + actions (edit,
 * unpublish, cancel, share). Editing happens inline via EventForm.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Loader2,
    Edit3,
    ExternalLink,
    Share2,
    Trash2,
    XCircle,
    EyeOff,
    Eye,
    ArrowLeft,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import EventForm from "@/components/events/EventForm";
import ShareModal from "@/components/microsite/ShareModal";
import EventSalesTabs from "@/components/events/EventSalesTabs";
import {
    EVENT_STATUS_META,
    formatEventDate,
    formatPriceLabel,
    eventPublicPath,
    eventPublicUrl,
} from "@/lib/events";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800";

export default function EventDetail() {
    const { event_id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);

    const load = async () => {
        try {
            const { data } = await api.get(`/events/me/${event_id}`);
            setEvent(data);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            navigate("/app/eventos", { replace: true });
        } finally {
            setLoading(false);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [event_id]);

    const publicUrl = useMemo(
        () => (event ? eventPublicUrl(event.tenant_slug, event.slug) : ""),
        [event],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!event) return null;

    const status = EVENT_STATUS_META[event.status] || EVENT_STATUS_META.draft;

    const doAction = async (path, msg) => {
        try {
            await api.post(`/events/me/${event.id}${path}`);
            toast.success(msg);
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const doDelete = async () => {
        if (!window.confirm("¿Eliminar este borrador? No se puede deshacer.")) return;
        try {
            await api.delete(`/events/me/${event.id}`);
            toast.success("Evento eliminado");
            navigate("/app/eventos");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    if (editMode) {
        return (
            <div className="space-y-4 max-w-3xl mx-auto">
                <Button
                    variant="ghost"
                    onClick={() => setEditMode(false)}
                    className="-ml-2"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" /> Volver al detalle
                </Button>
                <h1 className="text-2xl font-semibold">Editar evento</h1>
                <EventForm
                    initial={event}
                    mode="edit"
                    onSaved={() => {
                        load();
                        setEditMode(false);
                    }}
                />
            </div>
        );
    }

    const posterSrc = event.poster_url
        ? `${process.env.REACT_APP_BACKEND_URL || ""}${event.poster_url}`
        : FALLBACK_IMG;

    return (
        <div className="space-y-5" data-testid="event-detail-page">
            <Button variant="ghost" onClick={() => navigate("/app/eventos")} className="-ml-2">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver
            </Button>

            <div className="grid lg:grid-cols-[1fr_2fr] gap-5">
                <img
                    src={posterSrc}
                    alt={event.title}
                    className="w-full rounded-2xl border shadow-sm aspect-[4/5] object-cover"
                    onError={(ev) => {
                        ev.currentTarget.src = FALLBACK_IMG;
                    }}
                />
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge className={status.className}>{status.label}</Badge>
                        <Badge variant="outline">{formatPriceLabel(event)}</Badge>
                    </div>
                    <h1 className="text-3xl font-semibold leading-tight">{event.title}</h1>
                    <p className="text-muted-foreground">
                        {formatEventDate(event.starts_at, event.timezone)}
                    </p>
                    <p className="text-muted-foreground">
                        {event.venue_name}
                        {event.venue_city ? ` · ${event.venue_city}` : ""}
                    </p>

                    <div className="grid grid-cols-3 gap-3 pt-2">
                        <Stat label="Tickets vendidos" value={event.tickets_sold || 0} />
                        <Stat
                            label="Capacidad"
                            value={event.capacity ?? "Sin límite"}
                        />
                        <Stat
                            label="Categoría"
                            value={event.category}
                            small
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-3">
                        <Button onClick={() => setEditMode(true)} data-testid="event-edit-btn">
                            <Edit3 className="h-4 w-4 mr-1.5" />
                            Editar
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShareOpen(true)}
                            data-testid="event-share-btn"
                        >
                            <Share2 className="h-4 w-4 mr-1.5" />
                            Compartir
                        </Button>
                        {event.status === "published" && (
                            <Button
                                variant="outline"
                                asChild
                                data-testid="event-public-link"
                            >
                                <Link
                                    to={eventPublicPath(event.tenant_slug, event.slug)}
                                    target="_blank"
                                >
                                    <ExternalLink className="h-4 w-4 mr-1.5" />
                                    Ver público
                                </Link>
                            </Button>
                        )}
                        {event.status === "draft" && (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => doAction("/publish", "Evento publicado")}
                                    data-testid="event-publish-action"
                                >
                                    <Eye className="h-4 w-4 mr-1.5" />
                                    Publicar
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={doDelete}
                                    className="text-red-600 hover:text-red-700"
                                    data-testid="event-delete-btn"
                                >
                                    <Trash2 className="h-4 w-4 mr-1.5" />
                                    Eliminar
                                </Button>
                            </>
                        )}
                        {event.status === "published" && (
                            <Button
                                variant="outline"
                                onClick={() => doAction("/unpublish", "Pasado a borrador")}
                                data-testid="event-unpublish-btn"
                            >
                                <EyeOff className="h-4 w-4 mr-1.5" />
                                Despublicar
                            </Button>
                        )}
                        {event.status !== "cancelled" && (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    if (window.confirm("¿Cancelar este evento?")) {
                                        doAction("/cancel", "Evento cancelado");
                                    }
                                }}
                                className="text-red-600 hover:text-red-700"
                                data-testid="event-cancel-btn"
                            >
                                <XCircle className="h-4 w-4 mr-1.5" />
                                Cancelar
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {event.description && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Descripción</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">
                            {event.description}
                        </p>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Ventas y tickets</CardTitle>
                </CardHeader>
                <CardContent>
                    <EventSalesTabs event={event} />
                </CardContent>
            </Card>

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={publicUrl}
                companyName={event.title}
                heroSubtitle={event.short_description}
            />
        </div>
    );
}

function Stat({ label, value, small }) {
    return (
        <div className="rounded-lg border bg-secondary/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`font-semibold ${small ? "text-sm capitalize" : "text-xl"}`}>
                {value}
            </div>
        </div>
    );
}
