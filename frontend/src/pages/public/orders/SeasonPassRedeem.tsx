/**
 * /o/:slug/abono/:purchase_token — season pass "Mi abono" guest page (Fase 4).
 *
 * Shows credits remaining and lets the buyer redeem one credit at a time
 * against a specific función of the event, whenever they want during the
 * season — "no se bloquea un asiento, solo se precompra."
 */
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    Loader2, Frown, ArrowLeft, Ticket as TicketIcon, CalendarRange, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { formatEventDate } from "@/lib/events";
import { ticketPdfUrl } from "@/lib/orders";

export default function SeasonPassRedeem() {
    const { token } = useParams<{ token: string }>();
    const [searchParams] = useSearchParams();
    const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
    const [data, setData] = useState<any>(null);
    const [redeemingId, setRedeemingId] = useState<string | null>(null);
    const [redeemedTickets, setRedeemedTickets] = useState<any[]>([]);

    const load = () => {
        if (!token) return;
        setState("loading");
        const sessionId = searchParams.get("session_id");
        api
            .get(`/public/season-pass-purchases/${token}`, {
                params: sessionId ? { session_id: sessionId } : {},
            })
            .then((r) => {
                setData(r.data);
                setState("ready");
            })
            .catch((e) => setState(e?.response?.status === 404 ? "notfound" : "error"));
    };

    useEffect(load, [token]);

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
                <h1 className="text-2xl font-semibold mb-2">Abono no encontrado</h1>
                <p className="text-muted-foreground max-w-md">
                    {state === "notfound"
                        ? "El link puede ser incorrecto."
                        : "No se pudo cargar el abono. Intentá más tarde."}
                </p>
                <Link to="/" className="mt-6 inline-flex items-center gap-1 underline text-primary">
                    <ArrowLeft className="h-4 w-4" />
                    Ir al inicio
                </Link>
            </div>
        );
    }

    const { purchase, season_pass: seasonPass, event, organizer, functions } = data;
    const isPaid = purchase.status === "paid";
    const creditsLeft = purchase.credits_total - purchase.credits_used;

    const redeem = async (functionId: string) => {
        setRedeemingId(functionId);
        try {
            const { data: res } = await api.post(
                `/public/season-pass-purchases/${token}/redeem`,
                { function_id: functionId },
            );
            setRedeemedTickets((prev) => [...prev, ...res.tickets]);
            setData((prev: any) => ({ ...prev, purchase: res.purchase }));
            toast.success("¡Crédito redimido! Te enviamos el ticket por email.");
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setRedeemingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-background" data-testid="season-pass-redeem-page">
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
                    <h1 className="text-xl font-bold mt-1">{seasonPass.name}</h1>
                </div>
                <Badge variant={isPaid ? "default" : "secondary"} className="text-sm">
                    {isPaid ? "Pagado" : purchase.status}
                </Badge>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                {!isPaid ? (
                    <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="p-5 text-amber-800">
                            Todavía estamos confirmando tu pago. Refrescá esta página en un
                            momento, o revisá tu email para más detalles.
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <Card data-testid="pass-summary-card">
                            <CardContent className="p-5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">N° de abono</p>
                                    <p className="font-mono font-semibold">{purchase.order_number}</p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Créditos disponibles</p>
                                    <p className="text-2xl font-bold" data-testid="credits-left">
                                        {creditsLeft} / {purchase.credits_total}
                                    </p>
                                </div>
                                <p className="text-sm text-muted-foreground">{event?.title}</p>
                            </CardContent>
                        </Card>

                        <div className="space-y-2">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <CalendarRange className="h-5 w-5" />
                                Elegí a qué funciones ir
                            </h2>
                            {functions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    Todavía no hay funciones publicadas para este evento.
                                </p>
                            ) : (
                                functions.map((fn: any) => (
                                    <div
                                        key={fn.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border p-4"
                                        data-testid={`redeem-fn-row-${fn.id}`}
                                    >
                                        <div>
                                            <div className="font-medium">{fn.name}</div>
                                            {fn.starts_at && (
                                                <div className="text-sm text-muted-foreground">
                                                    {formatEventDate(fn.starts_at, event?.timezone)}
                                                    {fn.venue_name ? ` · ${fn.venue_name}` : ""}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={() => redeem(fn.id)}
                                            disabled={creditsLeft <= 0 || redeemingId === fn.id}
                                            size="sm"
                                            data-testid={`redeem-btn-${fn.id}`}
                                        >
                                            {redeemingId === fn.id ? (
                                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                            ) : (
                                                <TicketIcon className="h-4 w-4 mr-1.5" />
                                            )}
                                            Redimir
                                        </Button>
                                    </div>
                                ))
                            )}
                            {creditsLeft <= 0 && (
                                <p className="text-xs text-muted-foreground italic">
                                    Ya usaste todos tus créditos.
                                </p>
                            )}
                        </div>

                        {redeemedTickets.length > 0 && (
                            <div className="space-y-4" data-testid="redeemed-tickets-section">
                                <h2 className="text-lg font-semibold flex items-center gap-2">
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                    Tickets redimidos en esta sesión
                                </h2>
                                {redeemedTickets.map((ticket: any, i: number) => (
                                    <Card key={ticket.id} data-testid={`redeemed-ticket-${ticket.id}`}>
                                        <CardContent className="p-5 flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                                            <div className="shrink-0 text-center">
                                                <div className="bg-white p-3 rounded-xl inline-block border">
                                                    <QRCodeSVG value={ticket.qr_token || ticket.id} size={130} level="M" />
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-2">Ticket #{i + 1}</p>
                                            </div>
                                            <div className="flex-1 space-y-2 text-center sm:text-left">
                                                <p className="font-semibold">{event?.title}</p>
                                                {ticket.order_number && organizer?.slug && (
                                                    <Button variant="outline" size="sm" asChild>
                                                        <a
                                                            href={ticketPdfUrl(ticket.order_number, ticket.id)}
                                                            target="_blank" rel="noreferrer"
                                                        >
                                                            Descargar PDF
                                                        </a>
                                                    </Button>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </>
                )}

                <p className="text-xs text-center text-muted-foreground pb-4">
                    Guardá este link — es tu acceso al abono sin necesidad de cuenta.
                    <br />
                    También te enviamos cada ticket por email a <strong>{purchase.buyer?.email}</strong>.
                </p>
            </div>
        </div>
    );
}
