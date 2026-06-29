/**
 * /o/:slug/orden/:order_number/cancelado — buyer hit cancel in Stripe.
 *
 * The order is still in DB with status=pending (Stripe didn't capture).
 * Reservation expires automatically after 15min. We expose:
 *  - retry: re-attempt via Stripe checkout (we re-create a checkout session
 *    by reposting to /public/orders. Order_number changes.)
 *  - dev simulate paid (preview only).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSlug } from "@/contexts/TenantContext";
import { XCircle, Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api, { formatApiError } from "@/lib/api";
import { previewMicrositePath } from "@/lib/config";
import { eventPublicPath } from "@/lib/events";
import { formatCents, orderSuccessPath } from "@/lib/orders";

export default function OrderCancel() {
    const { order_number } = useParams();
    const slug = useSlug();
    const navigate = useNavigate();
    const [order, setOrder] = useState(null);
    const [event, setEvent] = useState(null);
    const [devEnabled, setDevEnabled] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.get("/_dev/enabled").then((r) => setDevEnabled(!!r.data?.enabled)).catch(() => {});
    }, []);

    useEffect(() => {
        let alive = true;
        api.get(`/public/orders/${order_number}`)
            .then((r) => {
                if (!alive) return;
                setOrder(r.data.order);
                setEvent(r.data.event);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [order_number]);

    const simulatePaid = async () => {
        setBusy(true);
        try {
            await api.post("/_dev/simulate-purchase-paid", { order_number });
            toast.success("Pago simulado.");
            navigate(orderSuccessPath(slug, order_number));
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-secondary/30 py-16 px-4" data-testid="order-cancel-page">
            <div className="max-w-xl mx-auto">
                <Link
                    to={previewMicrositePath(slug)}
                    className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver al organizador
                </Link>
                <Card>
                    <CardHeader className="text-center pb-3">
                        <div className="mx-auto rounded-full bg-amber-100 p-3 w-14 h-14 flex items-center justify-center mb-2">
                            <XCircle className="h-7 w-7 text-amber-600" />
                        </div>
                        <CardTitle className="text-2xl">Compra cancelada</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground text-center">
                            No se cobró nada. Tu reserva de entradas se libera
                            automáticamente en 15 minutos.
                        </p>

                        {order && (
                            <div
                                className="rounded-lg bg-secondary/40 border p-3 text-sm space-y-1"
                                data-testid="cancel-order-summary"
                            >
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Orden</span>
                                    <span className="font-mono">{order.order_number}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Cantidad</span>
                                    <span>{order.quantity_total} entrada(s)</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total</span>
                                    <span className="font-semibold">
                                        {formatCents(order.total_cents, order.currency)}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col gap-2 pt-2">
                            {event && (
                                <Button asChild data-testid="retry-purchase">
                                    <Link to={eventPublicPath(slug, event.slug)}>
                                        Reintentar compra
                                    </Link>
                                </Button>
                            )}
                            <Button variant="outline" asChild>
                                <Link to={previewMicrositePath(slug)}>
                                    Ver otros eventos
                                </Link>
                            </Button>
                        </div>

                        {devEnabled && order?.status === "pending" && (
                            <div
                                className="rounded-lg border border-amber-200 bg-amber-50 p-3 mt-3"
                                data-testid="cancel-simulate-card"
                            >
                                <p className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                                    <Sparkles className="h-4 w-4 text-amber-600" />
                                    Modo preview
                                </p>
                                <p className="text-xs text-muted-foreground mb-2">
                                    Para demos sin Stripe real, podés marcar esta orden como
                                    pagada y emitir los tickets.
                                </p>
                                <Button
                                    size="sm"
                                    onClick={simulatePaid}
                                    disabled={busy}
                                    className="bg-amber-600 hover:bg-amber-700 w-full"
                                    data-testid="cancel-simulate-paid"
                                >
                                    {busy ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        "Simular pago exitoso"
                                    )}
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
