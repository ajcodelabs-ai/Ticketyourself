/**
 * /admin/eventos/:id — read-only event file for super-admin + suspend.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
    ArrowLeft,
    Ban,
    ExternalLink,
    FileText,
    Loader2,
    Pause,
    Play,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import api, { formatApiError } from "@/lib/api";
import {
    EVENT_CATEGORIES,
    EVENT_STATUS_META,
    PRICING_LABELS,
    formatEventDate,
    formatPriceLabel,
} from "@/lib/events";
import { formatCents, ORDER_STATUS_META, PAYMENT_METHOD_META } from "@/lib/orders";

const FALLBACK_IMG =
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800";

function categoryLabel(code) {
    return EVENT_CATEGORIES.find((c) => c.code === code)?.label || code || "—";
}

function methodLabel(code) {
    return PAYMENT_METHOD_META[code]?.label || code;
}

function enabledCodes(event) {
    const pm = event?.payment_methods || {};
    if (Array.isArray(pm.enabled_codes) && pm.enabled_codes.length) {
        return pm.enabled_codes;
    }
    return Object.entries(pm)
        .filter(([, v]) => v && typeof v === "object" && v.enabled)
        .map(([k]) => k);
}

export default function AdminEventDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [suspendOpen, setSuspendOpen] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [comment, setComment] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/admin/events/${id}`);
            setEvent(data);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo cargar el evento.");
            navigate("/admin/eventos", { replace: true });
        } finally {
            setLoading(false);
        }
    }, [id, navigate]);

    useEffect(() => {
        load();
    }, [load]);

    const posterSrc = event?.poster_url
        ? `${import.meta.env.VITE_BACKEND_URL || ""}${event.poster_url}`
        : FALLBACK_IMG;

    const statusMeta = EVENT_STATUS_META[event?.status] || EVENT_STATUS_META.draft;
    const cat = categoryLabel(event?.category);

    const publicHref = event?.organizer?.slug && event?.slug
        ? `/o/${event.organizer.slug}/e/${event.slug}`
        : null;

    const canSuspend = event && event.status !== "suspended" && event.status !== "cancelled";
    const canUnsuspend = event?.status === "suspended";
    const canCancel = event && event.status !== "cancelled";

    const act = async (fn, okMsg) => {
        setActing(true);
        try {
            await fn();
            toast.success(okMsg);
            setSuspendOpen(false);
            setCancelOpen(false);
            setRejectOpen(false);
            setComment("");
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setActing(false);
        }
    };

    const suspend = () => {
        const reason = comment.trim();
        if (reason.length < 3) {
            toast.error("Escribí el motivo (mínimo 3 caracteres).");
            return;
        }
        return act(
            () => api.post(`/admin/events/${event.id}/suspend`, { comment: reason }),
            "Evento suspendido — ya no aparece en venta",
        );
    };

    const unsuspend = () => {
        if (!window.confirm("¿Reactivar este evento al estado anterior?")) return;
        return act(
            () => api.post(`/admin/events/${event.id}/unsuspend`),
            "Evento reactivado",
        );
    };

    const forceCancel = () => {
        return act(
            () =>
                api.post(`/admin/events/${event.id}/force-cancel`, {
                    comment: comment.trim(),
                }),
            "Evento cancelado",
        );
    };

    const markFee = () =>
        act(
            () => api.post(`/admin/events/${event.id}/mark-pre-event-fee-paid`),
            "Cargo pre-evento marcado como pagado",
        );

    const acceptAppeal = () => {
        if (!window.confirm("¿Aceptar la apelación y reactivar el evento?")) return;
        return act(
            () =>
                api.post(`/admin/events/${event.id}/suspension-appeal/accept`, {
                    comment: comment.trim(),
                }),
            "Apelación aceptada — evento reactivado",
        );
    };

    const rejectAppeal = () => {
        const note = comment.trim();
        if (note.length < 3) {
            toast.error("Indicá por qué se rechaza.");
            return;
        }
        return act(
            () =>
                api.post(`/admin/events/${event.id}/suspension-appeal/reject`, {
                    comment: note,
                }),
            "Apelación rechazada",
        );
    };

    const downloadAppeal = async (file) => {
        try {
            const res = await api.get(
                `/admin/events/${event.id}/suspension-appeal/files/${file.id}`,
                { responseType: "blob" },
            );
            const url = window.URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.original_filename || "evidencia";
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
    };

    if (loading || !event) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const sales = event.sales || {};
    const localities = event.locality_pricing || [];
    const types = event.ticket_types || [];
    const functions = event.functions || [];
    const orders = event.recent_orders || [];
    const layout = event.venue_layout_summary || {};

    return (
        <div className="space-y-5" data-testid="admin-event-detail">
            <Button variant="ghost" onClick={() => navigate("/admin/eventos")} className="-ml-2">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Todos los eventos
            </Button>

            {event.status === "suspended" && (
                <Card className="border-orange-200 bg-orange-50">
                    <CardContent className="py-4 text-sm text-orange-950">
                        Suspendido
                        {event.suspended_at
                            ? ` el ${new Date(event.suspended_at).toLocaleString("es-EC")}`
                            : ""}
                        {event.suspended_reason ? ` — ${event.suspended_reason}` : ""}.
                        No se lista en el microsite ni acepta compras.
                    </CardContent>
                </Card>
            )}

            {(event.suspension_appeal?.status === "pending" ||
                event.suspension_appeal?.status === "rejected" ||
                event.suspension_appeal?.message) && (
                <Card
                    className="border-sky-200"
                    data-testid="admin-event-appeal"
                >
                    <CardHeader>
                        <CardTitle className="text-base">
                            Respuesta del organizador
                            {event.suspension_appeal.status === "pending" && (
                                <Badge className="ml-2 bg-sky-100 text-sky-900">Pendiente</Badge>
                            )}
                            {event.suspension_appeal.status === "rejected" && (
                                <Badge className="ml-2 bg-red-100 text-red-800">Rechazada</Badge>
                            )}
                            {event.suspension_appeal.status === "accepted" && (
                                <Badge className="ml-2 bg-emerald-100 text-emerald-800">
                                    Aceptada
                                </Badge>
                            )}
                        </CardTitle>
                        <CardDescription>
                            Puede haber corregido precios u otros datos y adjuntado evidencia.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {event.suspension_appeal.message && (
                            <p className="whitespace-pre-wrap text-sm rounded-md border bg-muted/40 px-3 py-2">
                                {event.suspension_appeal.message}
                            </p>
                        )}
                        {event.suspension_appeal.admin_note && (
                            <p className="text-sm text-muted-foreground">
                                Nota interna: {event.suspension_appeal.admin_note}
                            </p>
                        )}
                        {(event.suspension_appeal.files || []).map((f) => (
                            <Button
                                key={f.id}
                                variant="outline"
                                size="sm"
                                onClick={() => downloadAppeal(f)}
                            >
                                <FileText className="h-3.5 w-3.5 mr-1.5" />
                                {f.original_filename || "archivo"}
                            </Button>
                        ))}
                        {event.status === "suspended" &&
                            event.suspension_appeal.status === "pending" && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button
                                        onClick={acceptAppeal}
                                        disabled={acting}
                                        data-testid="admin-accept-appeal"
                                    >
                                        Aceptar y reactivar
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="text-red-600"
                                        onClick={() => {
                                            setComment("");
                                            setRejectOpen(true);
                                        }}
                                        data-testid="admin-reject-appeal"
                                    >
                                        Rechazar
                                    </Button>
                                </div>
                            )}
                    </CardContent>
                </Card>
            )}

            <div className="grid lg:grid-cols-[minmax(0,280px)_1fr] gap-5">
                <img
                    src={posterSrc}
                    alt={event.title}
                    className="w-full rounded-2xl border shadow-sm aspect-[4/5] object-cover"
                    onError={(ev) => {
                        ev.currentTarget.src = FALLBACK_IMG;
                    }}
                />
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                        <Badge variant="outline">
                            {PRICING_LABELS[event.pricing_type] || formatPriceLabel(event)}
                        </Badge>
                        <Badge variant="outline">{cat}</Badge>
                    </div>
                    <h1 className="text-3xl font-semibold leading-tight">{event.title}</h1>
                    <p className="text-muted-foreground">
                        {formatEventDate(event.starts_at, event.timezone)}
                        {event.ends_at
                            ? ` → ${formatEventDate(event.ends_at, event.timezone)}`
                            : ""}
                    </p>
                    <p className="text-muted-foreground">
                        {event.venue_name || "Sin venue"}
                        {event.venue_city ? ` · ${event.venue_city}` : ""}
                        {event.venue_address ? ` · ${event.venue_address}` : ""}
                    </p>
                    {event.organizer && (
                        <p className="text-sm">
                            Organizador:{" "}
                            <Link
                                to={`/admin/organizadores/${event.organizer.id}`}
                                className="font-medium hover:text-primary"
                            >
                                {event.organizer.company_name}
                            </Link>
                            <span className="text-muted-foreground">
                                {" "}
                                · {event.organizer.email} · plan {event.organizer.plan_code || "—"}
                            </span>
                        </p>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                        <Stat label="Vendidos" value={sales.tickets_sold || 0} />
                        <Stat label="Capacidad" value={event.capacity ?? "Sin límite"} />
                        <Stat label="GMV pagado" value={formatCents(sales.gmv_cents)} />
                        <Stat label="Comisión TYS" value={formatCents(sales.fees_cents)} />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                        {canSuspend && (
                            <Button
                                variant="outline"
                                className="text-orange-700"
                                onClick={() => {
                                    setComment("");
                                    setSuspendOpen(true);
                                }}
                                data-testid="admin-event-suspend"
                            >
                                <Pause className="h-4 w-4 mr-1.5" />
                                Suspender evento
                            </Button>
                        )}
                        {canUnsuspend && (
                            <Button
                                onClick={unsuspend}
                                disabled={acting}
                                data-testid="admin-event-unsuspend"
                            >
                                <Play className="h-4 w-4 mr-1.5" />
                                Reactivar
                            </Button>
                        )}
                        {event.pre_event_fee_status === "pending" && (
                            <Button variant="outline" onClick={markFee} disabled={acting}>
                                Marcar cargo pagado
                            </Button>
                        )}
                        {canCancel && (
                            <Button
                                variant="outline"
                                className="text-red-600"
                                onClick={() => {
                                    setComment("");
                                    setCancelOpen(true);
                                }}
                            >
                                <Ban className="h-4 w-4 mr-1.5" />
                                Cancelar
                            </Button>
                        )}
                        {publicHref && event.status === "published" && (
                            <Button asChild variant="ghost" size="sm">
                                <a href={publicHref} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-1.5" />
                                    Página pública
                                </a>
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {event.short_description || event.description ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Descripción</CardTitle>
                        {event.short_description && (
                            <CardDescription>{event.short_description}</CardDescription>
                        )}
                    </CardHeader>
                    {event.description && (
                        <CardContent>
                            <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">
                                {event.description}
                            </p>
                        </CardContent>
                    )}
                </Card>
            ) : null}

            <div className="grid md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Configuración</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                        <Row k="Slug" v={event.slug} />
                        <Row k="Visibilidad" v={event.visibility} />
                        <Row
                            k="Comisión TYS la paga"
                            v={
                                event.platform_fee_bearer === "organizer"
                                    ? "El organizador"
                                    : "El comprador"
                            }
                        />
                        <Row
                            k="Cargo pre-evento"
                            v={`${event.pre_event_fee_status || "none"} · ${formatCents(event.pre_event_fee_cents)}`}
                        />
                        <Row
                            k="Mapa numerado"
                            v={
                                layout.has_layout
                                    ? `Sí · ${layout.localities_count} localidad(es)`
                                    : event.venue_id
                                      ? "Vinculado"
                                      : "No"
                            }
                        />
                        <Row
                            k="Medios de pago"
                            v={
                                enabledCodes(event).map(methodLabel).join(", ") || "—"
                            }
                        />
                        <Row
                            k="Órdenes"
                            v={`${sales.orders_paid || 0} pagadas · ${sales.orders_pending || 0} pendientes`}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Localidades / precios</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {localities.length === 0 && types.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                Precio base {formatPriceLabel(event)}
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nombre</TableHead>
                                        <TableHead className="text-right">Precio</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {localities.map((lp) => (
                                        <TableRow key={lp.locality_id || lp.name}>
                                            <TableCell>{lp.name || lp.locality_id}</TableCell>
                                            <TableCell className="text-right">
                                                {formatCents(lp.price_cents)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {types.map((t) => (
                                        <TableRow key={t.id}>
                                            <TableCell>{t.name}</TableCell>
                                            <TableCell className="text-right">
                                                {formatCents(t.price_cents)}
                                                {t.capacity != null ? ` · cupo ${t.capacity}` : ""}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>

            {functions.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Funciones / subeventos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nombre</TableHead>
                                    <TableHead>Inicio</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Vendidos</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {functions.map((f) => (
                                    <TableRow key={f.id}>
                                        <TableCell>{f.name}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {formatEventDate(f.starts_at, f.timezone || event.timezone)}
                                        </TableCell>
                                        <TableCell>{f.status}</TableCell>
                                        <TableCell className="text-right">
                                            {f.tickets_sold || 0}
                                            {f.capacity ? ` / ${f.capacity}` : ""}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Últimas órdenes</CardTitle>
                    <CardDescription>
                        Las 20 más recientes. El inbox de cobros está en Pagos.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {orders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin órdenes.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Orden</TableHead>
                                    <TableHead>Comprador</TableHead>
                                    <TableHead>Método</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orders.map((o) => {
                                    const meta = ORDER_STATUS_META[o.status] || {};
                                    return (
                                        <TableRow key={o.id}>
                                            <TableCell className="font-mono text-xs">
                                                {o.order_number}
                                            </TableCell>
                                            <TableCell className="text-sm">{o.buyer_email}</TableCell>
                                            <TableCell className="text-xs">
                                                {methodLabel(o.payment_method)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={meta.className || ""}>
                                                    {meta.label || o.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {formatCents(o.total_cents)}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Suspender evento</DialogTitle>
                        <DialogDescription>
                            Sale del microsite y se cortan las compras. Los tickets ya
                            emitidos siguen válidos. Podés reactivarlo después.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="suspend-reason">Motivo</Label>
                        <Textarea
                            id="suspend-reason"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            rows={3}
                            placeholder="Por qué se suspende…"
                            data-testid="admin-event-suspend-reason"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSuspendOpen(false)}>
                            Volver
                        </Button>
                        <Button onClick={suspend} disabled={acting} data-testid="admin-event-suspend-confirm">
                            {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Suspender"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cancelar evento</DialogTitle>
                        <DialogDescription>
                            Cancelar es definitivo (no se reactiva como publicado). Para
                            bajarlo temporalmente usá Suspender.
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={3}
                        placeholder="Comentario (opcional)"
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelOpen(false)}>
                            Volver
                        </Button>
                        <Button variant="destructive" onClick={forceCancel} disabled={acting}>
                            Cancelar evento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rechazar apelación</DialogTitle>
                        <DialogDescription>
                            El evento sigue suspendido. El organizador va a ver este motivo
                            y puede volver a responder.
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={3}
                        placeholder="Por qué no se reactiva…"
                        data-testid="admin-reject-appeal-note"
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectOpen(false)}>
                            Volver
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={rejectAppeal}
                            disabled={acting}
                            data-testid="admin-reject-appeal-confirm"
                        >
                            Rechazar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-lg border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
            <div className="text-lg font-semibold leading-tight">{value}</div>
        </div>
    );
}

function Row({ k, v }) {
    return (
        <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right font-medium">{v}</span>
        </div>
    );
}
