/**
 * /cuenta — buyer dashboard: upcoming/past events and their tickets.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    Calendar,
    Download,
    ExternalLink,
    FileText,
    Loader2,
    MapPin,
    Ticket as TicketIcon,
    Frown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import api from "@/lib/api";
import { formatEventDate } from "@/lib/events";
import {
    formatCents,
    orderSuccessPath,
    ticketPdfUrl,
    ORDER_STATUS_META,
} from "@/lib/orders";
import { previewMicrositeSubpath } from "@/lib/config";
import { formatEinvoiceError, invoiceStatusMeta } from "@/lib/einvoice";
import { assetUrl } from "@/lib/microsite";
import { useAuth } from "@/contexts/AuthContext";

function isUpcoming(item) {
    const starts = item.function?.starts_at || item.event?.starts_at;
    if (!starts) return item.order?.status !== "paid";
    return new Date(starts).getTime() >= Date.now();
}

export default function BuyerAccount() {
    const { user } = useAuth();
    const [state, setState] = useState("loading");
    const [items, setItems] = useState([]);
    const [passes, setPasses] = useState([]);

    useEffect(() => {
        let alive = true;
        Promise.all([
            api.get("/buyer/me/orders"),
            api.get("/buyer/me/passes").catch(() => ({ data: { items: [] } })),
        ])
            .then(([ordersRes, passesRes]) => {
                if (!alive) return;
                setItems(ordersRes.data?.items || []);
                setPasses(passesRes.data?.items || []);
                setState("ready");
            })
            .catch(() => {
                if (!alive) return;
                setState("error");
            });
        return () => {
            alive = false;
        };
    }, []);

    const upcoming = useMemo(() => items.filter(isUpcoming), [items]);
    const past = useMemo(() => items.filter((i) => !isUpcoming(i)), [items]);

    if (state === "loading") {
        return (
            <div className="min-h-[50vh] grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (state === "error") {
        return (
            <div className="max-w-lg mx-auto px-5 py-16 text-center" data-testid="cuenta-error">
                <Frown className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <h1 className="text-xl font-semibold mb-2">No pudimos cargar tus entradas</h1>
                <p className="text-muted-foreground text-sm">Probá de nuevo en un momento.</p>
            </div>
        );
    }

    const greeting = user?.display_name || user?.email || "";

    return (
        <div className="mx-auto max-w-5xl px-5 sm:px-8 py-8 space-y-8" data-testid="cuenta-page">
            <header>
                <p className="text-sm text-muted-foreground">Hola{greeting ? `, ${greeting}` : ""}</p>
                <h1 className="text-3xl font-semibold tracking-tight mt-1">Tus eventos y entradas</h1>
            </header>

            <Tabs defaultValue="upcoming">
                <TabsList>
                    <TabsTrigger value="upcoming" data-testid="cuenta-tab-upcoming">
                        Próximos ({upcoming.length})
                    </TabsTrigger>
                    <TabsTrigger value="past" data-testid="cuenta-tab-past">
                        Anteriores ({past.length})
                    </TabsTrigger>
                    {passes.length > 0 && (
                        <TabsTrigger value="passes" data-testid="cuenta-tab-passes">
                            Abonos ({passes.length})
                        </TabsTrigger>
                    )}
                </TabsList>
                <TabsContent value="upcoming" className="mt-6">
                    <OrderList items={upcoming} empty="Todavía no tenés entradas para eventos próximos." />
                </TabsContent>
                <TabsContent value="past" className="mt-6">
                    <OrderList items={past} empty="No hay eventos anteriores." />
                </TabsContent>
                {passes.length > 0 && (
                    <TabsContent value="passes" className="mt-6">
                        <PassList passes={passes} />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}

function OrderList({ items, empty }) {
    if (!items.length) {
        return (
            <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground" data-testid="cuenta-empty">
                {empty}
            </div>
        );
    }
    return (
        <div className="space-y-5">
            {items.map((item) => (
                <OrderCard key={item.order.id} item={item} />
            ))}
        </div>
    );
}

function OrderCard({ item }) {
    const { order, event, organizer, function: fn, tickets, invoice } = item;
    const statusMeta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending;
    const eventPath = organizer?.slug && event?.slug
        ? previewMicrositeSubpath(organizer.slug, `/e/${event.slug}`)
        : null;
    const starts = fn?.starts_at || event?.starts_at;
    const poster = event?.poster_url ? assetUrl(event.poster_url) : null;

    return (
        <article
            className="rounded-2xl border bg-card overflow-hidden"
            data-testid={`cuenta-order-${order.order_number}`}
        >
            <div className="flex flex-col sm:flex-row">
                {poster && (
                    <img
                        src={poster}
                        alt=""
                        className="sm:w-40 h-32 sm:h-auto object-cover bg-secondary"
                    />
                )}
                <div className="flex-1 p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <h2 className="text-lg font-semibold leading-tight">
                                {eventPath ? (
                                    <Link to={eventPath} className="hover:underline">
                                        {event?.title || "Evento"}
                                    </Link>
                                ) : (
                                    event?.title || "Evento"
                                )}
                            </h2>
                            {fn?.name && (
                                <p className="text-sm text-muted-foreground mt-0.5">{fn.name}</p>
                            )}
                            {organizer?.company_name && (
                                <p className="text-xs text-muted-foreground">{organizer.company_name}</p>
                            )}
                        </div>
                        <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {starts && (
                            <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {formatEventDate(starts, event?.timezone)}
                            </span>
                        )}
                        {event?.venue_name && (
                            <span className="inline-flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5" />
                                {event.venue_name}
                                {event.venue_city ? ` · ${event.venue_city}` : ""}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                            <TicketIcon className="h-3.5 w-3.5" />
                            {order.quantity_total} · {formatCents(order.total_cents, order.currency)}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Orden {order.order_number}</p>

                    {order.status === "paid" && tickets?.length > 0 && (
                        <div className="grid sm:grid-cols-2 gap-3 pt-2">
                            {tickets.map((t, idx) => (
                                <TicketMini key={t.id} ticket={t} order={order} idx={idx + 1} />
                            ))}
                        </div>
                    )}
                    {invoice && (
                        <InvoiceBlock invoice={invoice} order={order} organizer={organizer} />
                    )}
                    {order.status === "paid" && !invoice && organizer?.slug && (
                        <Button asChild variant="outline" size="sm">
                            <Link to={orderSuccessPath(organizer.slug, order.order_number)}>
                                Ver detalle de la compra
                            </Link>
                        </Button>
                    )}
                    {(order.status === "pending_manual_payment" || order.status === "pending") && organizer?.slug && (
                        <Button asChild variant="outline" size="sm">
                            <Link
                                to={previewMicrositeSubpath(
                                    organizer.slug,
                                    order.status === "pending_manual_payment"
                                        ? `/orden/${order.order_number}/instrucciones`
                                        : `/orden/${order.order_number}`,
                                )}
                            >
                                Ver estado de la compra
                            </Link>
                        </Button>
                    )}
                </div>
            </div>
        </article>
    );
}

function TicketMini({ ticket, order, idx }) {
    return (
        <div className="rounded-xl border p-3 flex gap-3 items-center bg-background">
            {ticket.qr_token && ticket.status === "issued" ? (
                <div className="rounded-md bg-white p-1 border shrink-0">
                    <QRCodeSVG value={ticket.qr_token} size={72} level="M" />
                </div>
            ) : (
                <div className="h-[72px] w-[72px] rounded-md bg-secondary shrink-0" />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                    Entrada #{idx}
                    {ticket.seat_label ? ` · ${ticket.seat_label}` : ""}
                </p>
                {ticket.locality_name && (
                    <p className="text-xs text-muted-foreground truncate">{ticket.locality_name}</p>
                )}
                {ticket.status === "issued" && (
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 mt-1">
                        <a href={ticketPdfUrl(order.order_number, ticket.id)} target="_blank" rel="noreferrer">
                            <Download className="h-3.5 w-3.5 mr-1" />
                            Entrada PDF
                        </a>
                    </Button>
                )}
            </div>
        </div>
    );
}

function InvoiceBlock({ invoice, order, organizer }) {
    const meta = invoiceStatusMeta(invoice.estado);
    const orderPath = organizer?.slug
        ? orderSuccessPath(organizer.slug, order.order_number)
        : null;
    const errorText =
        invoice.estado === "ERROR" ? formatEinvoiceError(invoice.error_message) : "";

    return (
        <div
            className="rounded-xl border bg-background p-3 space-y-2"
            data-testid={`cuenta-invoice-${order.order_number}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium inline-flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Factura electrónica
                    {invoice.numero ? ` · ${invoice.numero}` : ""}
                </p>
                <Badge className={meta.className}>{meta.label}</Badge>
            </div>
            {errorText ? (
                <p className="text-xs text-red-700">{errorText}</p>
            ) : null}
            {invoice.mock && (
                <p className="text-xs text-amber-800">
                    Comprobante de prueba: no es un RIDE autorizado por el SRI.
                </p>
            )}
            {!invoice.ride_url && invoice.estado !== "ERROR" && (
                <p className="text-xs text-muted-foreground">
                    El PDF de la factura aparece cuando el SRI autoriza el comprobante.
                    Si no está, abrí el detalle y recargá en un momento.
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                {invoice.ride_url && (
                    <Button asChild variant="outline" size="sm" className="h-8">
                        <a href={invoice.ride_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1" />
                            Factura PDF
                        </a>
                    </Button>
                )}
                {invoice.xml_url && (
                    <Button asChild variant="outline" size="sm" className="h-8">
                        <a href={invoice.xml_url} target="_blank" rel="noreferrer">
                            XML
                        </a>
                    </Button>
                )}
                {orderPath && (
                    <Button asChild variant="ghost" size="sm" className="h-8">
                        <Link to={orderPath}>Ver detalle</Link>
                    </Button>
                )}
            </div>
        </div>
    );
}

function PassList({ passes }) {
    return (
        <div className="space-y-3">
            {passes.map((p) => (
                <div key={p.id} className="rounded-2xl border bg-card p-5 flex flex-wrap justify-between gap-3">
                    <div>
                        <h2 className="font-semibold">{p.event?.title || "Abono"}</h2>
                        <p className="text-sm text-muted-foreground">
                            {p.credits_used}/{p.credits_total} créditos usados
                            {p.organizer?.company_name ? ` · ${p.organizer.company_name}` : ""}
                        </p>
                    </div>
                    {p.status === "paid" && p.organizer?.slug && (
                        <Button asChild size="sm">
                            <Link to={previewMicrositeSubpath(p.organizer.slug, `/abono/${p.purchase_token}`)}>
                                Redimir
                            </Link>
                        </Button>
                    )}
                </div>
            ))}
        </div>
    );
}
