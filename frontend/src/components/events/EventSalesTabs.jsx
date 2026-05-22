/**
 * EventSalesTabs — Ventas / Estadísticas / Tickets tabs for the organizer's
 * event detail page. Pulls from:
 *   /api/events/me/:id/stats
 *   /api/events/me/:id/orders
 *   /api/events/me/:id/tickets
 *   /api/events/me/:id/tickets.csv  (download)
 */
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/events/me/${event.id}/stats`);
            setStats(data);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
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
function OrdersTab({ event }) {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refundingId, setRefundingId] = useState(null);

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
        <div className="rounded-lg border overflow-x-auto" data-testid="orders-table">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Orden</TableHead>
                        <TableHead>Comprador</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {orders.map((o) => {
                        const meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
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
