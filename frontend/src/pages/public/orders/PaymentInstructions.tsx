/**
 * /o/:slug/orden/:order_number/instrucciones
 *
 * Public landing page that buyers reach right after creating a manual-payment
 * (transfer / cash) order. Shows:
 *  - deadline (created_at + 48h)
 *  - exact amount + reference (order_number)
 *  - method-specific block (bank details or cash location)
 *  - back-to-event button
 *
 * Polls /public/orders/:order_number every 10s so that, if the organizer
 * confirms while the buyer is on this page, we auto-redirect to the success
 * page with their tickets.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSlug } from "@/contexts/TenantContext";
import {
    Loader2,
    Clock,
    Building2,
    MapPin,
    Mail,
    Phone,
    Calendar,
    ArrowLeft,
    Copy,
    AlertTriangle,
    CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";
import { eventPublicPath, formatEventDate } from "@/lib/events";
import { previewMicrositePath } from "@/lib/config";
import {
    formatCents,
    orderSuccessPath,
    PAYMENT_METHOD_META,
} from "@/lib/orders";

const POLL_INTERVAL_MS = 10_000;

function plus48h(iso) {
    if (!iso) return null;
    try {
        const t = new Date(iso);
        t.setHours(t.getHours() + 48);
        return t;
    } catch {
        return null;
    }
}

function timeLeftLabel(deadline) {
    if (!deadline) return "—";
    const ms = deadline - Date.now();
    if (ms <= 0) return "Reserva expirada";
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h restantes`;
    return `${hours}h ${minutes}m restantes`;
}

export default function PaymentInstructions() {
    const { order_number } = useParams();
    const slug = useSlug();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [poll, setPoll] = useState(0);

    useEffect(() => {
        let alive = true;
        let t;
        const fetchOrder = async () => {
            try {
                const { data: d } = await api.get(
                    `/public/orders/${order_number}/instructions`,
                );
                if (!alive) return;
                setData(d);
                setLoading(false);
                if (d.order.status === "paid") {
                    toast.success("¡Tu pago fue confirmado! Cargando tickets…");
                    navigate(orderSuccessPath(slug, order_number));
                    return;
                }
                if (d.order.status === "cancelled") {
                    return; // no more polling
                }
                t = setTimeout(() => setPoll((p) => p + 1), POLL_INTERVAL_MS);
            } catch {
                if (!alive) return;
                setLoading(false);
            }
        };
        fetchOrder();
        return () => {
            alive = false;
            if (t) clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order_number, poll]);

    const deadline = useMemo(() => plus48h(data?.order?.created_at), [data]);
    const expired = deadline && deadline.getTime() < Date.now();

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!data || !data.order) {
        return (
            <div
                className="min-h-screen grid place-items-center px-6 text-center"
                data-testid="instructions-notfound"
            >
                <div>
                    <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                    <h1 className="text-2xl font-semibold mb-2">Orden no encontrada</h1>
                    <Link to={previewMicrositePath(slug)} className="text-primary underline">
                        Ir al organizador
                    </Link>
                </div>
            </div>
        );
    }

    const { order, event, organizer, payment_method, payment_instructions, branding } = data;
    const meta = PAYMENT_METHOD_META[payment_method] || PAYMENT_METHOD_META.transfer;
    const primary = branding?.primary_color || "#4f46e5";

    const isCancelled = order.status === "cancelled";
    const isPaid = order.status === "paid";

    const copyToClipboard = (text, label) => {
        navigator.clipboard?.writeText(text).then(
            () => toast.success(`${label} copiado al portapapeles`),
            () => toast.error("No pudimos copiar"),
        );
    };

    return (
        <div
            className="min-h-screen bg-secondary/30 py-10 px-4"
            data-testid="payment-instructions-page"
        >
            <div className="max-w-3xl mx-auto space-y-6">
                <Link
                    to={previewMicrositePath(slug)}
                    className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver al organizador
                </Link>

                {/* ── Hero ─────────────────────────────────────────────── */}
                <div
                    className="rounded-2xl p-8 text-white shadow-lg"
                    style={{
                        background: `linear-gradient(135deg, ${primary}, ${primary}aa)`,
                    }}
                >
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                        <Badge className="bg-white/20 text-white border-0">
                            Orden {order.order_number}
                        </Badge>
                        {isCancelled ? (
                            <Badge className="bg-red-500/30 text-white border-0">
                                Cancelada
                            </Badge>
                        ) : isPaid ? (
                            <Badge className="bg-emerald-500/40 text-white border-0">
                                Confirmada
                            </Badge>
                        ) : (
                            <Badge className="bg-amber-500/30 text-white border-0 inline-flex items-center gap-1.5">
                                <Clock className="h-3 w-3" />
                                Pendiente de pago
                            </Badge>
                        )}
                    </div>
                    <h1
                        className="text-3xl md:text-4xl font-bold"
                        data-testid="instructions-title"
                    >
                        {meta.icon} Pagá tu reserva por {meta.label.toLowerCase()}
                    </h1>
                    <p className="text-white/85 mt-1">
                        {event?.title} · {formatEventDate(event?.starts_at, event?.timezone)}
                    </p>
                </div>

                {/* ── Cancelled state ──────────────────────────────────── */}
                {isCancelled && (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="py-5 flex gap-3">
                            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-red-900">
                                Esta reserva fue cancelada{" "}
                                {order.refund_reason
                                    ? `(${order.refund_reason})`
                                    : ""}
                                . Si fue un error, reintentá la compra.
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* ── Amount + deadline summary ────────────────────────── */}
                <Card data-testid="instructions-summary">
                    <CardContent className="py-5 grid sm:grid-cols-3 gap-4">
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">
                                Monto a pagar
                            </div>
                            <div className="text-2xl font-semibold mt-1">
                                {formatCents(order.total_cents, order.currency)}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">
                                Cantidad de entradas
                            </div>
                            <div className="text-2xl font-semibold mt-1">
                                {order.quantity_total}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Tiempo restante
                            </div>
                            <div
                                className={`text-2xl font-semibold mt-1 ${
                                    expired ? "text-red-600" : "text-amber-700"
                                }`}
                                data-testid="instructions-deadline"
                            >
                                {timeLeftLabel(deadline)}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Reference call-out ───────────────────────────────── */}
                {!isCancelled && (
                    <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm">
                                <span className="text-amber-900 font-medium">
                                    Usá este número como referencia de la transferencia:
                                </span>
                                <div className="font-mono text-xl mt-1">
                                    {order.order_number}
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    copyToClipboard(order.order_number, "Número de orden")
                                }
                                data-testid="copy-reference"
                            >
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                Copiar
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* ── Method-specific instructions ─────────────────────── */}
                {payment_method === "transfer" && (
                    <Card data-testid="instructions-transfer">
                        <CardContent className="py-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <Building2 className="h-5 w-5 text-primary" />
                                <h2 className="text-lg font-semibold">Datos bancarios</h2>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <InstructionRow
                                    label="Banco"
                                    value={payment_instructions?.bank_name}
                                />
                                <InstructionRow
                                    label="Número de cuenta"
                                    value={payment_instructions?.account_number}
                                    copyable
                                    onCopy={copyToClipboard}
                                />
                                <InstructionRow
                                    label="Titular"
                                    value={payment_instructions?.account_holder}
                                />
                                <InstructionRow
                                    label="Tipo"
                                    value="Cuenta corriente / ahorros"
                                />
                            </div>
                            {payment_instructions?.instructions && (
                                <div className="rounded-lg bg-secondary/40 border p-3 text-sm whitespace-pre-line">
                                    {payment_instructions.instructions}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {payment_method === "cash" && (
                    <Card data-testid="instructions-cash">
                        <CardContent className="py-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-primary" />
                                <h2 className="text-lg font-semibold">Pago en efectivo</h2>
                            </div>
                            <div className="grid gap-3">
                                <InstructionRow
                                    label="Ubicación"
                                    value={payment_instructions?.location}
                                />
                                <InstructionRow
                                    label="Horarios"
                                    value={payment_instructions?.schedule}
                                    icon={<Clock className="h-3.5 w-3.5" />}
                                />
                                <InstructionRow
                                    label="Contacto"
                                    value={payment_instructions?.contact}
                                    icon={<Phone className="h-3.5 w-3.5" />}
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* ── How it works after paying ────────────────────────── */}
                {!isCancelled && (
                    <Card>
                        <CardContent className="py-5 space-y-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2 text-foreground font-medium">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                ¿Qué pasa después de pagar?
                            </div>
                            <p>
                                Cuando completes el pago,{" "}
                                <strong>{organizer?.company_name || "el organizador"}</strong>{" "}
                                lo verificará manualmente. En cuanto lo confirme te enviaremos
                                los tickets a <strong>{order.buyer.email}</strong>. Esta
                                página se actualiza automáticamente cuando se confirme.
                            </p>
                            {organizer?.email && (
                                <p className="flex items-center gap-1.5 pt-1">
                                    <Mail className="h-3.5 w-3.5" />
                                    Contacto del organizador:{" "}
                                    <a
                                        href={`mailto:${organizer.email}`}
                                        className="underline text-primary"
                                    >
                                        {organizer.email}
                                    </a>
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                <div className="flex gap-2">
                    {event?.slug && (
                        <Button variant="outline" asChild data-testid="back-to-event">
                            <Link to={eventPublicPath(slug, event.slug)}>
                                <Calendar className="h-4 w-4 mr-1.5" />
                                Volver al evento
                            </Link>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function InstructionRow({ label, value, icon = null, copyable = false, onCopy = undefined }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div>
                <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                    {icon}
                    {label}
                </div>
                <div className="font-medium mt-1 break-all">{value || "—"}</div>
            </div>
            {copyable && value && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopy?.(value, label)}
                    data-testid={`copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                    <Copy className="h-3.5 w-3.5" />
                </Button>
            )}
        </div>
    );
}
