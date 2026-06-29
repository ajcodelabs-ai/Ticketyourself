/**
 * /o/:slug/orden/:order_number — post-checkout landing page (public, no auth).
 * Polls /api/public/orders/:order_number while status==pending.
 *
 * Behaviour:
 *  - paid → shows ticket cards with QR + PDF download.
 *  - pending → poll every 2s up to 60s. Shows "esperando pago" + (DEV) simulate button.
 *  - missing → 404 banner.
 */
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSlug } from "@/contexts/TenantContext";
import { QRCodeSVG } from "qrcode.react";
import {
    Loader2,
    CheckCircle2,
    Download,
    Mail,
    Calendar,
    MapPin,
    Ticket as TicketIcon,
    AlertTriangle,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import api, { formatApiError } from "@/lib/api";
import { formatEventDate } from "@/lib/events";
import { previewMicrositePath } from "@/lib/config";
import { formatCents, ticketPdfUrl, ORDER_STATUS_META } from "@/lib/orders";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // ~60s total

export default function OrderSuccess() {
    const { order_number } = useParams();
    const slug = useSlug();
    const [params] = useSearchParams();
    const sessionId = params.get("session_id");

    const [state, setState] = useState("loading");
    const [data, setData] = useState(null);
    const [polls, setPolls] = useState(0);
    const [devEnabled, setDevEnabled] = useState(false);
    const [simulating, setSimulating] = useState(false);

    // Initial dev-enabled check
    useEffect(() => {
        api.get("/_dev/enabled").then((r) => setDevEnabled(!!r.data?.enabled)).catch(() => {});
    }, []);

    // Fetch + poll
    useEffect(() => {
        let alive = true;
        let timer = null;

        const fetchOrder = async () => {
            try {
                const url = sessionId
                    ? `/public/orders/${order_number}?session_id=${encodeURIComponent(sessionId)}`
                    : `/public/orders/${order_number}`;
                const { data: d } = await api.get(url);
                if (!alive) return;
                setData(d);
                setState("ready");
                document.title = `Orden ${d.order.order_number} · TYS`;

                if (d.order.status === "pending" && polls < MAX_POLLS) {
                    timer = setTimeout(() => setPolls((p) => p + 1), POLL_INTERVAL_MS);
                }
            } catch (e) {
                if (!alive) return;
                setState(e?.response?.status === 404 ? "notfound" : "error");
            }
        };

        fetchOrder();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [order_number, sessionId, polls]);

    const simulatePaid = async () => {
        setSimulating(true);
        try {
            await api.post("/_dev/simulate-purchase-paid", {
                order_number,
            });
            toast.success("Pago simulado. Refrescando…");
            setPolls(0); // reset to re-fetch immediately
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSimulating(false);
        }
    };

    if (state === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (state === "notfound") {
        return (
            <div
                className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
                data-testid="order-notfound"
            >
                <AlertTriangle className="h-12 w-12 text-amber-500 mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Orden no encontrada</h1>
                <p className="text-muted-foreground max-w-md mb-6">
                    El número <code className="font-mono">{order_number}</code> no
                    aparece en nuestros registros.
                </p>
                <Link to={previewMicrositePath(slug)} className="underline text-primary">
                    Ir al organizador
                </Link>
            </div>
        );
    }

    const { order, tickets = [], event, organizer, branding = {} } = data;
    const status = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending;
    const primary = branding?.primary_color || "#4f46e5";
    const isPending = order.status === "pending";
    const isPaid = order.status === "paid";

    return (
        <div className="min-h-screen bg-secondary/30 py-10 px-4" data-testid="order-success-page">
            <div className="max-w-3xl mx-auto space-y-6">
                <Link
                    to={previewMicrositePath(slug)}
                    className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                    ← Volver al organizador
                </Link>

                {/* Hero */}
                <div
                    className="rounded-2xl p-8 text-white shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${primary}, ${primary}aa)` }}
                >
                    <div className="flex flex-col gap-2">
                        <Badge className="bg-white/20 text-white border-0 w-fit">
                            Orden {order.order_number}
                        </Badge>
                        <h1 className="text-3xl md:text-4xl font-bold" data-testid="order-title">
                            {isPaid ? "¡Listo, tu entrada está confirmada!" : "Procesando tu compra…"}
                        </h1>
                        <p className="text-white/85">
                            {event?.title}
                            {event?.venue_name ? ` · ${event.venue_name}` : ""}
                        </p>
                    </div>
                </div>

                {/* Status card */}
                <Card data-testid="order-status-card">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">
                                Estado de la orden
                            </p>
                            <div className="flex items-center gap-2">
                                <Badge className={status.className} data-testid="order-status-badge">
                                    {status.label}
                                </Badge>
                                {isPending && (
                                    <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Esperando confirmación del banco…
                                    </span>
                                )}
                                {isPaid && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                            </div>
                        </div>
                        <div className="text-right text-sm">
                            <div className="text-muted-foreground">Total</div>
                            <div className="font-semibold text-base">
                                {formatCents(order.total_cents, order.currency)}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <Row
                            label={
                                <span className="inline-flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" />
                                    Fecha
                                </span>
                            }
                            value={formatEventDate(event?.starts_at, event?.timezone)}
                        />
                        {event?.venue_name && (
                            <Row
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <MapPin className="h-3.5 w-3.5" />
                                        Lugar
                                    </span>
                                }
                                value={`${event.venue_name}${event.venue_city ? ` · ${event.venue_city}` : ""}`}
                            />
                        )}
                        <Row
                            label={
                                <span className="inline-flex items-center gap-1.5">
                                    <TicketIcon className="h-3.5 w-3.5" />
                                    Entradas
                                </span>
                            }
                            value={`${order.quantity_total} · ${order.buyer.name}`}
                        />
                        <Row
                            label={
                                <span className="inline-flex items-center gap-1.5">
                                    <Mail className="h-3.5 w-3.5" />
                                    Email
                                </span>
                            }
                            value={order.buyer.email}
                        />
                    </CardContent>
                </Card>

                {/* DEV simulator */}
                {isPending && devEnabled && (
                    <Card className="border-amber-200 bg-amber-50" data-testid="simulate-card">
                        <CardContent className="py-4 flex items-center justify-between gap-3">
                            <div className="text-sm">
                                <p className="font-semibold flex items-center gap-1.5">
                                    <Sparkles className="h-4 w-4 text-amber-600" />
                                    Modo preview
                                </p>
                                <p className="text-muted-foreground">
                                    En preview los webhooks de Stripe no llegan. Podés simular el pago
                                    para emitir los tickets.
                                </p>
                            </div>
                            <Button
                                onClick={simulatePaid}
                                disabled={simulating}
                                className="bg-amber-600 hover:bg-amber-700"
                                data-testid="simulate-paid-btn"
                            >
                                {simulating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    "Simular pago exitoso"
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Tickets */}
                {isPaid && tickets.length > 0 && (
                    <div className="space-y-3" data-testid="tickets-list">
                        <h2 className="text-xl font-semibold">
                            Tus tickets ({tickets.length})
                        </h2>
                        <div className="grid sm:grid-cols-2 gap-3">
                            {tickets.map((t, idx) => (
                                <TicketCard
                                    key={t.id}
                                    ticket={t}
                                    order={order}
                                    idx={idx + 1}
                                    primaryColor={primary}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer */}
                {isPaid && (
                    <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                        Te enviamos los tickets a <strong>{order.buyer.email}</strong>. Si
                        no llegan en unos minutos, revisá tu carpeta de spam o solicitá un
                        reenvío al organizador {organizer?.company_name || ""}.
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value }) {
    return (
        <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-right">{value}</span>
        </div>
    );
}

function TicketCard({ ticket, order, idx, primaryColor }) {
    const holder = ticket.holder || {};
    return (
        <div
            className="rounded-2xl border bg-card overflow-hidden shadow-sm"
            data-testid={`ticket-${ticket.id}`}
        >
            <div
                className="p-3 text-white text-xs font-semibold flex items-center justify-between"
                style={{ background: primaryColor }}
            >
                <span>Entrada #{idx}</span>
                <span className="opacity-80">{ticket.id.slice(0, 8)}</span>
            </div>
            <div className="p-4 flex items-center gap-4">
                <div className="rounded-lg bg-white p-2 border shrink-0">
                    <QRCodeSVG value={ticket.qr_token} size={88} level="M" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{holder.name || "Sin nombre"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                        {holder.email}
                    </p>
                    {ticket.seat_label && (
                        <p
                            className="text-xs font-medium text-primary mt-1 truncate"
                            data-testid={`ticket-seat-${ticket.id}`}
                        >
                            🎫 {ticket.seat_label}
                        </p>
                    )}
                    {ticket.raffle_number && (
                        <p
                            className="text-xs font-medium text-primary mt-1 truncate"
                            data-testid={`ticket-raffle-${ticket.id}`}
                        >
                            🎟️ N° de rifa #{ticket.raffle_number}
                        </p>
                    )}
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        data-testid="ticket-pdf-btn"
                    >
                        <a
                            href={ticketPdfUrl(order.order_number, ticket.id)}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            PDF
                        </a>
                    </Button>
                </div>
            </div>
        </div>
    );
}
