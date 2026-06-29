/**
 * /orden/:token — guest order page.
 *
 * Accessible via the UUID token embedded in the confirmation email.
 * No auth required. Shows order summary + QR codes for each ticket.
 * Token expires 30 days after the event ends (enforced server-side).
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    Loader2,
    Frown,
    Calendar,
    MapPin,
    Ticket as TicketIcon,
    Download,
    CheckCircle2,
    Clock,
    ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";
import { formatEventDate } from "@/lib/events";
import { formatCents, ticketPdfUrl, ORDER_STATUS_META } from "@/lib/orders";

function fmtDate(iso?: string): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("es", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export default function OrderByToken() {
    const { token } = useParams<{ token: string }>();
    const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!token) return;
        setState("loading");
        api
            .get(`/public/orders/by-token/${token}`)
            .then((r) => {
                setData(r.data);
                setState("ready");
            })
            .catch((e) => {
                setState(e?.response?.status === 404 ? "notfound" : "error");
            });
    }, [token]);

    if (state === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (state === "notfound" || state === "error") {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
                <Frown className="h-12 w-12 text-muted-foreground mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Orden no encontrada</h1>
                <p className="text-muted-foreground max-w-md">
                    {state === "notfound"
                        ? "El link puede haber expirado o ser incorrecto."
                        : "No se pudo cargar la orden. Intentá más tarde."}
                </p>
                <Link to="/" className="mt-6 inline-flex items-center gap-1 underline text-primary">
                    <ArrowLeft className="h-4 w-4" />
                    Ir al inicio
                </Link>
            </div>
        );
    }

    const { order, tickets, event, organizer } = data;
    const statusMeta = ORDER_STATUS_META?.[order.status] || {
        label: order.status,
        color: "secondary",
    };
    const isPaid = order.status === "paid";
    const orderNumber = order.order_number;
    const buyer = order.buyer || {};

    return (
        <div className="min-h-screen bg-background" data-testid="order-by-token-page">
            {/* Header */}
            <div className="bg-card border-b px-6 py-4 flex items-center justify-between max-w-3xl mx-auto">
                <div>
                    {organizer?.slug && (
                        <Link
                            to={`/o/${organizer.slug}`}
                            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            {organizer.company_name || organizer.slug}
                        </Link>
                    )}
                    <h1 className="text-xl font-bold mt-1">Tu orden</h1>
                </div>
                <Badge variant={statusMeta.color as any} className="text-sm">
                    {isPaid ? (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    ) : (
                        <Clock className="h-3.5 w-3.5 mr-1" />
                    )}
                    {statusMeta.label}
                </Badge>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                {/* Order summary card */}
                <Card>
                    <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <p className="text-xs text-muted-foreground">N° de orden</p>
                                <p
                                    className="font-mono font-semibold text-lg"
                                    data-testid="order-number"
                                >
                                    {orderNumber}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground">Total</p>
                                <p className="font-semibold text-lg">
                                    {formatCents(order.total_cents, order.currency)}
                                </p>
                            </div>
                        </div>

                        {/* Buyer */}
                        <div className="rounded-lg bg-secondary/40 p-3 space-y-1">
                            <p className="text-xs text-muted-foreground">Comprador</p>
                            <p className="font-medium">{buyer.name}</p>
                            <p className="text-sm text-muted-foreground">{buyer.email}</p>
                        </div>

                        {/* Event */}
                        {event && (
                            <div className="space-y-2">
                                <p className="font-semibold text-base">{event.title}</p>
                                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1.5">
                                        <Calendar className="h-4 w-4 shrink-0" />
                                        {formatEventDate(event.starts_at, event.timezone)}
                                    </span>
                                    {event.venue_name && (
                                        <span className="flex items-center gap-1.5">
                                            <MapPin className="h-4 w-4 shrink-0" />
                                            {event.venue_name}
                                            {event.venue_city ? `, ${event.venue_city}` : ""}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Items breakdown */}
                        {order.items?.length > 0 && (
                            <div className="border-t pt-3 space-y-1 text-sm">
                                {order.items.map((item: any, i: number) => (
                                    <div key={i} className="flex justify-between text-muted-foreground">
                                        <span>
                                            {item.ticket_type} × {item.quantity}
                                        </span>
                                        <span>
                                            {formatCents(item.subtotal_cents, order.currency)}
                                        </span>
                                    </div>
                                ))}
                                {order.discount_total_cents > 0 && (
                                    <div className="flex justify-between text-emerald-700">
                                        <span>Descuento</span>
                                        <span>
                                            −{formatCents(order.discount_total_cents, order.currency)}
                                        </span>
                                    </div>
                                )}
                                {order.fees_cents > 0 && (
                                    <div className="flex justify-between text-muted-foreground">
                                        <span>Tarifa de servicio</span>
                                        <span>
                                            {formatCents(order.fees_cents, order.currency)}
                                        </span>
                                    </div>
                                )}
                                <div className="flex justify-between font-semibold pt-1 border-t">
                                    <span>Total</span>
                                    <span>
                                        {formatCents(order.total_cents, order.currency)}
                                    </span>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Tickets with QR */}
                {isPaid && tickets?.length > 0 ? (
                    <div className="space-y-4" data-testid="tickets-section">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <TicketIcon className="h-5 w-5" />
                            Tus tickets ({tickets.length})
                        </h2>
                        {tickets.map((ticket: any, i: number) => (
                            <Card key={ticket.id} data-testid={`ticket-card-${ticket.id}`}>
                                <CardContent className="p-5">
                                    <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                                        {/* QR */}
                                        <div className="shrink-0 text-center">
                                            <div className="bg-white p-3 rounded-xl inline-block border">
                                                <QRCodeSVG
                                                    value={ticket.qr_token || ticket.id}
                                                    size={150}
                                                    level="M"
                                                    data-testid={`qr-${ticket.id}`}
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2">
                                                Ticket #{i + 1}
                                            </p>
                                        </div>

                                        {/* Ticket info */}
                                        <div className="flex-1 space-y-3 text-center sm:text-left">
                                            <div>
                                                <p className="font-semibold text-base">
                                                    {event?.title}
                                                </p>
                                                {event && (
                                                    <p className="text-sm text-muted-foreground">
                                                        {formatEventDate(
                                                            event.starts_at,
                                                            event.timezone,
                                                        )}
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">
                                                    Titular
                                                </p>
                                                <p className="font-medium">
                                                    {ticket.holder?.name || buyer.name}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">
                                                    N° de orden
                                                </p>
                                                <p className="font-mono text-sm">{orderNumber}</p>
                                            </div>
                                            {ticket.raffle_number && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground">
                                                        N° de rifa
                                                    </p>
                                                    <p
                                                        className="font-mono text-sm font-semibold text-primary"
                                                        data-testid={`ticket-raffle-${ticket.id}`}
                                                    >
                                                        #{ticket.raffle_number}
                                                    </p>
                                                </div>
                                            )}
                                            {event && organizer?.slug && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    asChild
                                                    className="mt-2"
                                                >
                                                    <a
                                                        href={ticketPdfUrl(
                                                            orderNumber,
                                                            ticket.id,
                                                        )}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        data-testid={`pdf-btn-${ticket.id}`}
                                                    >
                                                        <Download className="h-4 w-4 mr-1.5" />
                                                        Descargar PDF
                                                    </a>
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : isPaid && tickets?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        Los tickets aún están siendo generados. Recibirás un email en breve.
                    </div>
                ) : null}

                {/* Pending state */}
                {!isPaid && order.status === "pending_manual_payment" && (
                    <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="p-5 space-y-2">
                            <div className="flex items-center gap-2 font-medium text-amber-800">
                                <Clock className="h-5 w-5" />
                                Pago pendiente
                            </div>
                            <p className="text-sm text-amber-700">
                                Tu reserva está confirmada. Completá el pago siguiendo las
                                instrucciones que te enviamos por email.
                            </p>
                            {organizer?.slug && (
                                <Link
                                    to={`/o/${organizer.slug}/orden/${orderNumber}/instrucciones`}
                                    className="text-sm underline text-amber-800"
                                >
                                    Ver instrucciones de pago
                                </Link>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Reminder note */}
                <p className="text-xs text-center text-muted-foreground pb-4">
                    Guarda este link — es tu acceso a la orden sin necesidad de cuenta.
                    <br />
                    También te enviamos los tickets por email a{" "}
                    <strong>{buyer.email}</strong>.
                </p>
            </div>
        </div>
    );
}
