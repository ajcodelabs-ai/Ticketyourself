/**
 * EventSalesTabs — Ventas / Estadísticas / Tickets tabs for the organizer's
 * event detail page. Pulls from:
 *   /api/events/me/:id/stats
 *   /api/events/me/:id/orders
 *   /api/events/me/:id/tickets
 *   /api/events/me/:id/tickets.csv  (download)
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
    Loader2,
    DollarSign,
    Users,
    TicketCheck,
    CheckCircle,
    Download,
    RefreshCw,
    Mail,
    ScanQrCode,
    Clock,
    DoorOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import api, { formatApiError } from "@/lib/api";
import { formatCents, ORDER_STATUS_META } from "@/lib/orders";

const TICKET_STATUS_META = {
    issued: { label: "Emitido", className: "bg-emerald-100 text-emerald-800" },
    used: { label: "Usado", className: "bg-slate-200 text-slate-700" },
    revoked: { label: "Revocado", className: "bg-red-100 text-red-800" },
};

export default function EventSalesTabs({ event }) {
    const [tab, setTab] = useState("stats");
    return (
        <Tabs value={tab} onValueChange={setTab} className="w-full" data-testid="event-sales-tabs">
            <TabsList className="grid grid-cols-3 max-w-md">
                <TabsTrigger value="stats" data-testid="tab-stats">
                    Estadísticas
                </TabsTrigger>
                <TabsTrigger value="orders" data-testid="tab-orders">
                    Ventas
                </TabsTrigger>
                <TabsTrigger value="tickets" data-testid="tab-tickets">
                    Tickets
                </TabsTrigger>
            </TabsList>

            <TabsContent value="stats" className="mt-4">
                <StatsTab event={event} />
            </TabsContent>
            <TabsContent value="orders" className="mt-4">
                <OrdersTab event={event} />
            </TabsContent>
            <TabsContent value="tickets" className="mt-4">
                <TicketsTab event={event} />
            </TabsContent>
        </Tabs>
    );
}

// ── Stats ────────────────────────────────────────────────────────────────────
function StatsTab({ event }) {
    const [stats, setStats] = useState(null);
    const [scanStats, setScanStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const [salesRes, scanRes] = await Promise.allSettled([
                api.get(`/events/me/${event.id}/stats`),
                api.get(`/events/me/${event.id}/scan-stats`),
            ]);
            if (salesRes.status === "fulfilled") setStats(salesRes.value.data);
            else toast.error(formatApiError(salesRes.reason?.response?.data?.detail) || salesRes.reason?.message);
            if (scanRes.status === "fulfilled") setScanStats(scanRes.value.data);
            // scan-stats failures are silent — block is optional
        } finally {
            setLoading(false);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [event.id]);

    if (loading) {
        return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
    }
    if (!stats) return null;

    const occupancy =
        stats.capacity && stats.capacity > 0
            ? Math.round((stats.sold / stats.capacity) * 100)
            : null;
    const conversion = Math.round((stats.conversion_rate || 0) * 100);

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={load} data-testid="stats-refresh">
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Refrescar
                </Button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Metric
                    icon={<DollarSign className="h-5 w-5" />}
                    label="Ingresos brutos"
                    value={formatCents(stats.revenue_cents, event.currency)}
                    sub={`Comisiones: ${formatCents(stats.fees_cents, event.currency)}`}
                />
                <Metric
                    icon={<Users className="h-5 w-5" />}
                    label="Órdenes pagadas"
                    value={stats.paid_orders}
                    sub={`${stats.pending_orders} pendientes · ${conversion}% conversión`}
                />
                <Metric
                    icon={<TicketCheck className="h-5 w-5" />}
                    label="Tickets vendidos"
                    value={stats.sold}
                    sub={stats.capacity ? `${stats.capacity - stats.sold} disponibles` : "Sin límite"}
                />
                <Metric
                    icon={<CheckCircle className="h-5 w-5" />}
                    label="Tickets escaneados"
                    value={`${stats.tickets_used} / ${stats.tickets_issued}`}
                    sub="En puerta"
                />
            </div>

            {occupancy != null && (
                <Card>
                    <CardContent className="py-4">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Ocupación</span>
                            <span className="font-semibold">{occupancy}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${Math.min(100, occupancy)}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            <DoorAccessSection event={event} scanStats={scanStats} />
        </div>
    );
}

// ── Door access (Phase 9 closing item) ──────────────────────────────────────
function DoorAccessSection({ event, scanStats }) {
    // Show only when we actually have a published numbered/free event with tickets
    // issued so far OR the org explicitly wants to monitor scans. If the event has
    // no tickets issued and no scans, render a minimal CTA instead of empty cards.
    const isPublished = event.status === "published";
    if (!scanStats && !isPublished) return null;

    const hasData = scanStats && (scanStats.tickets_issued > 0 || scanStats.scanned_count > 0);
    const lastScan = scanStats?.last_scan_at
        ? new Date(scanStats.last_scan_at).toLocaleString("es-EC", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              day: "2-digit",
              month: "2-digit",
          })
        : null;

    return (
        <Card data-testid="door-access-section">
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-2">
                    <DoorOpen className="h-5 w-5 text-emerald-600" />
                    <CardTitle className="text-lg">Acceso al evento</CardTitle>
                </div>
                {isPublished && (
                    <Button
                        asChild
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        data-testid="door-open-scanner"
                    >
                        <Link to={`/app/eventos/${event.id}/validacion`}>
                            <ScanQrCode className="h-4 w-4 mr-1.5" />
                            Abrir scanner
                        </Link>
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {!hasData ? (
                    <p className="text-sm text-muted-foreground" data-testid="door-empty-state">
                        Todavía no hay escaneos. Cuando empiece el control en la puerta,
                        verás aquí cuántos asistentes ingresaron, en qué localidades y a qué hora.
                    </p>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <DoorMetric
                                label="Tickets escaneados"
                                value={`${scanStats.scanned_count} / ${scanStats.tickets_issued}`}
                                sub={`${scanStats.scanned_pct}% de tickets emitidos`}
                                testid="door-scanned"
                            />
                            <DoorMetric
                                label="% Asistencia"
                                value={`${scanStats.attendance_pct}%`}
                                sub={`${scanStats.valid_count} escaneos válidos${
                                    scanStats.rejected_count
                                        ? ` · ${scanStats.rejected_count} rechazados`
                                        : ""
                                }`}
                                testid="door-attendance"
                                accent={scanStats.attendance_pct >= 50 ? "emerald" : "amber"}
                            />
                            <DoorMetric
                                label="Último escaneo"
                                value={lastScan || "—"}
                                sub={
                                    scanStats.scan_rate_per_minute > 0
                                        ? `Ritmo: ${scanStats.scan_rate_per_minute}/min (últ. 10 min)`
                                        : "Sin escaneos recientes"
                                }
                                testid="door-last-scan"
                                icon={<Clock className="h-4 w-4" />}
                            />
                        </div>

                        {scanStats.localities?.length > 0 && (
                            <div
                                className="rounded-lg border overflow-hidden"
                                data-testid="door-locality-table"
                            >
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Localidad</TableHead>
                                            <TableHead className="text-right">
                                                Escaneados
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {scanStats.localities.map((loc) => (
                                            <TableRow
                                                key={loc.locality_id}
                                                data-testid={`door-loc-${loc.locality_id}`}
                                            >
                                                <TableCell className="flex items-center gap-2">
                                                    <span
                                                        className="inline-block h-3 w-3 rounded-sm border"
                                                        style={{
                                                            backgroundColor:
                                                                loc.color || "#94a3b8",
                                                        }}
                                                    />
                                                    {loc.name || "Sin nombre"}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {loc.scanned}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function DoorMetric({ label, value, sub, accent, icon, testid }) {
    const accentClass =
        accent === "emerald"
            ? "text-emerald-600"
            : accent === "amber"
            ? "text-amber-600"
            : "text-foreground";
    return (
        <div
            className="rounded-lg border bg-secondary/30 p-3"
            data-testid={testid}
        >
            <div className="flex items-center justify-between mb-1 text-xs text-muted-foreground">
                <span>{label}</span>
                {icon}
            </div>
            <div className={`text-xl font-semibold leading-tight ${accentClass}`}>
                {value}
            </div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}

function Metric({ icon, label, value, sub }) {
    return (
        <Card>
            <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2 text-muted-foreground">
                    <span className="text-xs uppercase tracking-wide">{label}</span>
                    {icon}
                </div>
                <div className="text-2xl font-semibold leading-tight">{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            </CardContent>
        </Card>
    );
}

// ── Orders ───────────────────────────────────────────────────────────────────
const METHOD_LABEL = { stripe: "Tarjeta", transfer: "Transferencia", cash: "Efectivo" };
const METHOD_ICON = { stripe: "💳", transfer: "🏦", cash: "💵" };

function OrdersTab({ event }) {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refundingId, setRefundingId] = useState(null);
    const [filterMethod, setFilterMethod] = useState("all");
    const [filterStatus, setFilterStatus] = useState("all");
    const [manualOrder, setManualOrder] = useState(null); // open dialog

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/events/me/${event.id}/orders?limit=100`);
            setOrders(data.items || []);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLoading(false);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [event.id]);

    const refund = async (orderId) => {
        if (!window.confirm("¿Reembolsar esta orden? Los tickets quedarán revocados.")) {
            return;
        }
        setRefundingId(orderId);
        try {
            await api.post(`/events/me/${event.id}/orders/${orderId}/refund`, {
                reason: "Solicitado por el organizador",
            });
            toast.success("Orden reembolsada");
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setRefundingId(null);
        }
    };

    const resend = async (orderId) => {
        try {
            await api.post(`/events/me/${event.id}/orders/${orderId}/resend-email`);
            toast.success("Email reenviado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const filtered = orders.filter((o) => {
        if (filterMethod !== "all" && (o.payment_method || "stripe") !== filterMethod) {
            return false;
        }
        if (filterStatus !== "all" && o.status !== filterStatus) return false;
        return true;
    });

    const pendingManualCount = orders.filter(
        (o) => o.status === "pending_manual_payment",
    ).length;

    if (loading) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
    if (orders.length === 0) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                    Todavía no hay ventas registradas para este evento.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            {pendingManualCount > 0 && (
                <div
                    className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 flex items-center justify-between"
                    data-testid="manual-pending-banner"
                >
                    <span>
                        Tenés <b>{pendingManualCount}</b> orden(es) esperando confirmación
                        manual.
                    </span>
                    <button
                        type="button"
                        className="underline font-medium"
                        onClick={() => setFilterStatus("pending_manual_payment")}
                    >
                        Filtrar →
                    </button>
                </div>
            )}

            <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground">Filtros:</span>
                <select
                    value={filterMethod}
                    onChange={(e) => setFilterMethod(e.target.value)}
                    className="text-xs border rounded px-2 py-1 bg-background"
                    data-testid="filter-method"
                >
                    <option value="all">Todos los métodos</option>
                    <option value="stripe">💳 Tarjeta</option>
                    <option value="transfer">🏦 Transferencia</option>
                    <option value="cash">💵 Efectivo</option>
                </select>
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="text-xs border rounded px-2 py-1 bg-background"
                    data-testid="filter-status"
                >
                    <option value="all">Todos los estados</option>
                    <option value="paid">Pagados</option>
                    <option value="pending_manual_payment">Esperando pago manual</option>
                    <option value="pending">Pending</option>
                    <option value="cancelled">Cancelados</option>
                    <option value="refunded">Reembolsados</option>
                </select>
                <span className="text-xs text-muted-foreground ml-auto">
                    {filtered.length} de {orders.length}
                </span>
            </div>

            <div className="rounded-lg border overflow-x-auto" data-testid="orders-table">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Orden</TableHead>
                            <TableHead>Comprador</TableHead>
                            <TableHead>Método</TableHead>
                            <TableHead className="text-right">Cant.</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((o) => {
                            const meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
                            const method = o.payment_method || "stripe";
                            const isManualPending = o.status === "pending_manual_payment";
                            return (
                                <TableRow key={o.id} data-testid={`order-row-${o.order_number}`}>
                                    <TableCell className="font-mono text-xs">
                                        {o.order_number}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium">{o.buyer?.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {o.buyer?.email}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        <span className="mr-1">{METHOD_ICON[method]}</span>
                                        {METHOD_LABEL[method] || method}
                                    </TableCell>
                                    <TableCell className="text-right">{o.quantity_total}</TableCell>
                                    <TableCell className="text-right font-medium">
                                        {formatCents(o.total_cents, o.currency)}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={meta.className}>{meta.label}</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {new Date(o.created_at).toLocaleDateString("es-EC")}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {isManualPending && (
                                            <Button
                                                size="sm"
                                                onClick={() => setManualOrder(o)}
                                                className="bg-orange-600 hover:bg-orange-700"
                                                data-testid={`manual-action-${o.order_number}`}
                                            >
                                                Revisar
                                            </Button>
                                        )}
                                        {o.status === "paid" && (
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => resend(o.id)}
                                                    data-testid={`resend-${o.order_number}`}
                                                >
                                                    <Mail className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => refund(o.id)}
                                                    disabled={refundingId === o.id}
                                                    className="text-red-600 hover:text-red-700"
                                                    data-testid={`refund-${o.order_number}`}
                                                >
                                                    {refundingId === o.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        "Reembolsar"
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            <ManualPaymentDialog
                order={manualOrder}
                event={event}
                onClose={() => setManualOrder(null)}
                onChanged={async () => {
                    setManualOrder(null);
                    await load();
                }}
            />
        </div>
    );
}

// ── Manual payment confirmation dialog (Phase 5b) ───────────────────────────
function ManualPaymentDialog({ order, event, onClose, onChanged }) {
    const [mode, setMode] = useState("idle"); // idle | confirming | rejecting
    const [notes, setNotes] = useState("");
    const [reference, setReference] = useState("");
    const [reason, setReason] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (order) {
            setMode("idle");
            setNotes("");
            setReference("");
            setReason("");
        }
    }, [order]);

    if (!order) return null;

    const method = order.payment_method || "transfer";
    const pm = event.payment_methods?.[method] || {};

    const confirm = async () => {
        setSubmitting(true);
        try {
            const { data } = await api.post(
                `/events/me/${event.id}/orders/${order.id}/confirm-payment`,
                { notes: notes || undefined, reference: reference || undefined },
            );
            toast.success(
                `Pago confirmado · ${data.tickets?.length || 0} ticket(s) emitido(s) y email enviado.`,
            );
            await onChanged();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const reject = async () => {
        if (reason.trim().length < 2) {
            toast.error("Indicá una razón para el comprador.");
            return;
        }
        setSubmitting(true);
        try {
            await api.post(
                `/events/me/${event.id}/orders/${order.id}/reject-payment`,
                { reason: reason.trim() },
            );
            toast.success("Orden rechazada · email enviado al comprador.");
            await onChanged();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const deadline = order.created_at
        ? new Date(new Date(order.created_at).getTime() + 48 * 3600 * 1000)
        : null;

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="sm:max-w-lg max-h-[92vh] overflow-y-auto"
                data-testid="manual-payment-dialog"
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className="text-2xl">{METHOD_ICON[method]}</span>
                        Confirmar pago manual
                    </DialogTitle>
                    <DialogDescription>
                        Orden <b className="font-mono">{order.order_number}</b> · {METHOD_LABEL[method]}
                    </DialogDescription>
                </DialogHeader>

                {/* Order summary */}
                <div className="rounded-lg bg-secondary/40 border p-3 space-y-1 text-sm">
                    <Row label="Comprador" value={`${order.buyer?.name} · ${order.buyer?.email}`} />
                    <Row label="Cantidad" value={`${order.quantity_total} ticket(s)`} />
                    <Row label="Total" value={formatCents(order.total_cents, order.currency)} bold />
                    {deadline && (
                        <Row
                            label="Vence"
                            value={deadline.toLocaleString("es-EC")}
                            extra={
                                deadline.getTime() < Date.now() ? (
                                    <span className="text-red-600 text-xs ml-2">expirado</span>
                                ) : null
                            }
                        />
                    )}
                </div>

                {/* Method details the buyer saw */}
                {method === "transfer" && (
                    <div className="rounded-lg border p-3 text-xs space-y-0.5">
                        <p className="font-semibold text-foreground">El comprador vio:</p>
                        <p>Banco: {pm.bank_name || "—"}</p>
                        <p>Cuenta: {pm.account_number || "—"}</p>
                        <p>Titular: {pm.account_holder || "—"}</p>
                    </div>
                )}
                {method === "cash" && (
                    <div className="rounded-lg border p-3 text-xs space-y-0.5">
                        <p className="font-semibold text-foreground">El comprador vio:</p>
                        <p>Lugar: {pm.location || "—"}</p>
                        <p>Horarios: {pm.schedule || "—"}</p>
                        <p>Contacto: {pm.contact || "—"}</p>
                    </div>
                )}

                {mode === "idle" && (
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            onClick={() => setMode("confirming")}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                            data-testid="open-confirm"
                        >
                            <CheckCircle className="h-4 w-4 mr-1.5" />
                            Marcar como pagado
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setMode("rejecting")}
                            className="flex-1 text-red-600 hover:text-red-700 border-red-200"
                            data-testid="open-reject"
                        >
                            Rechazar
                        </Button>
                    </div>
                )}

                {mode === "confirming" && (
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium uppercase">
                                Referencia (opcional)
                            </label>
                            <input
                                type="text"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                placeholder="Ej: TRX-12345"
                                className="w-full border rounded px-2 py-1.5 text-sm"
                                maxLength={120}
                                data-testid="confirm-reference"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium uppercase">
                                Notas (opcional)
                            </label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Ej: Recibido en cuenta Pichincha"
                                rows={3}
                                maxLength={500}
                                className="w-full border rounded px-2 py-1.5 text-sm"
                                data-testid="confirm-notes"
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button
                                variant="outline"
                                onClick={() => setMode("idle")}
                                disabled={submitting}
                            >
                                Volver
                            </Button>
                            <Button
                                onClick={confirm}
                                disabled={submitting}
                                className="bg-emerald-600 hover:bg-emerald-700"
                                data-testid="submit-confirm"
                            >
                                {submitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                ) : (
                                    <CheckCircle className="h-4 w-4 mr-1.5" />
                                )}
                                Confirmar pago y emitir tickets
                            </Button>
                        </div>
                    </div>
                )}

                {mode === "rejecting" && (
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium uppercase">
                                Razón (requerida — se enviará al comprador)
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Ej: No recibimos la transferencia en el plazo"
                                rows={3}
                                maxLength={500}
                                className="w-full border rounded px-2 py-1.5 text-sm"
                                data-testid="reject-reason"
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button
                                variant="outline"
                                onClick={() => setMode("idle")}
                                disabled={submitting}
                            >
                                Volver
                            </Button>
                            <Button
                                onClick={reject}
                                disabled={submitting || reason.trim().length < 2}
                                className="bg-red-600 hover:bg-red-700"
                                data-testid="submit-reject"
                            >
                                {submitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                ) : null}
                                Rechazar y liberar reserva
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Row({ label, value, bold, extra }) {
    return (
        <div className="flex justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className={bold ? "font-semibold" : ""}>
                {value}
                {extra}
            </span>
        </div>
    );
}

// ── Tickets ─────────────────────────────────────────────────────────────────
function TicketsTab({ event }) {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/events/me/${event.id}/tickets`);
            setTickets(data.items || []);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLoading(false);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [event.id]);

    const downloadCsv = async () => {
        try {
            const res = await api.get(`/events/me/${event.id}/tickets.csv`, {
                responseType: "blob",
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `tickets-${event.slug}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    if (loading) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
    if (tickets.length === 0) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                    Todavía no hay tickets emitidos. Aparecen cuando se confirma el pago.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={downloadCsv} data-testid="tickets-csv">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Descargar CSV
                </Button>
            </div>
            <div className="rounded-lg border overflow-x-auto" data-testid="tickets-table">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Ticket</TableHead>
                            <TableHead>Asistente</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Emitido</TableHead>
                            <TableHead>Usado</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tickets.map((t) => {
                            const h = t.holder || {};
                            const meta = TICKET_STATUS_META[t.status] || TICKET_STATUS_META.issued;
                            return (
                                <TableRow key={t.id}>
                                    <TableCell className="font-mono text-xs">
                                        {t.id.slice(0, 8)}
                                    </TableCell>
                                    <TableCell>{h.name || "—"}</TableCell>
                                    <TableCell className="text-xs">{h.email || "—"}</TableCell>
                                    <TableCell>
                                        <Badge className={meta.className}>{meta.label}</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {new Date(t.issued_at).toLocaleDateString("es-EC")}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {t.used_at
                                            ? new Date(t.used_at).toLocaleString("es-EC")
                                            : "—"}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
