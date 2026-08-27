/**
 * /admin/pagos — inbox of verification, plan, pre-event and ticket payments.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import api, { formatApiError } from "@/lib/api";
import { formatCents, ORDER_STATUS_META, PAYMENT_METHOD_META } from "@/lib/orders";

const KIND_META = {
    verification: { label: "Verificación", className: "bg-violet-100 text-violet-800" },
    plan: { label: "Plan", className: "bg-sky-100 text-sky-900" },
    pre_event: { label: "Cargo pre-evento", className: "bg-amber-100 text-amber-900" },
    ticket: { label: "Venta de boletos", className: "bg-emerald-100 text-emerald-800" },
};

const KIND_OPTIONS = [
    { value: "all", label: "Todos los tipos" },
    { value: "verification", label: "Verificación" },
    { value: "plan", label: "Plan / suscripción" },
    { value: "pre_event", label: "Cargo pre-evento" },
    { value: "ticket", label: "Venta de boletos" },
];

const STATUS_OPTIONS = [
    { value: "pending", label: "Pendientes" },
    { value: "paid", label: "Pagados" },
    { value: "all", label: "Todos" },
];

function formatWhen(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("es-EC", {
            dateStyle: "short",
            timeStyle: "short",
        });
    } catch {
        return iso;
    }
}

function paymentMethodLabel(code) {
    return PAYMENT_METHOD_META[code]?.label || code || "—";
}

export default function AdminPayments() {
    const [params, setParams] = useSearchParams();
    const status = params.get("status") || "pending";
    const kind = params.get("kind") || "all";
    const qParam = params.get("q") || "";
    const [search, setSearch] = useState(qParam);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actingId, setActingId] = useState(null);
    const [data, setData] = useState({
        items: [],
        total: 0,
        summary: {
            pending_count: 0,
            pending_cents: 0,
            pending_by_kind: {},
        },
    });

    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        if (key === "kind" && (!value || value === "all")) next.delete("kind");
        else if (!value) next.delete(key);
        else next.set(key, value);
        setParams(next, { replace: true });
        setPage(1);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({
                status,
                page: String(page),
                limit: "30",
            });
            if (kind !== "all") query.set("kind", kind);
            if (qParam.trim()) query.set("q", qParam.trim());
            const { data: d } = await api.get(`/admin/payments?${query}`);
            setData(d);
        } catch (e) {
            toast.error(
                formatApiError(e?.response?.data?.detail) || "No se pudieron cargar los pagos.",
            );
        } finally {
            setLoading(false);
        }
    }, [status, kind, page, qParam]);

    useEffect(() => {
        load();
    }, [load]);

    const onSearch = (e) => {
        e.preventDefault();
        const next = new URLSearchParams(params);
        const q = search.trim();
        if (q) next.set("q", q);
        else next.delete("q");
        setParams(next, { replace: true });
        setPage(1);
    };

    const act = async (item) => {
        const action = item.extra?.action;
        if (!action) return;
        setActingId(item.id);
        try {
            if (action === "mark_verification") {
                await api.post(`/admin/organizers/${item.organizer_id}/mark-verification-paid`);
                toast.success("Verificación marcada como pagada");
            } else if (action === "confirm_plan") {
                await api.post(`/admin/organizers/${item.organizer_id}/confirm-plan-payment`, {
                    intent_id: item.extra.intent_id,
                    comment: "Pago de plan confirmado desde Pagos",
                });
                toast.success("Pago de plan confirmado — suscripción activada");
            } else if (action === "mark_pre_event") {
                await api.post(`/admin/events/${item.event_id}/mark-pre-event-fee-paid`);
                toast.success("Cargo pre-evento marcado como pagado");
            }
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setActingId(null);
        }
    };

    const byKind = data.summary?.pending_by_kind || {};
    const kindCards = [
        { key: "verification", label: "Verificación" },
        { key: "plan", label: "Planes" },
        { key: "pre_event", label: "Pre-evento" },
        { key: "ticket", label: "Boletos" },
    ];

    return (
        <div className="space-y-5" data-testid="admin-payments-page">
            <header className="flex flex-wrap justify-between gap-3 items-end">
                <div>
                    <div className="text-sm text-muted-foreground">Tesorería</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Pagos
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                        Verificación de organizadores, planes, cargo previo al evento y ventas
                        de boletos — pendientes y cobrados — en un solo inbox.
                    </p>
                </div>
            </header>

            <section className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <Card
                    className="border-orange-200 bg-orange-50"
                    data-testid="payments-pending-total"
                >
                    <CardHeader className="pb-2">
                        <CardDescription className="text-orange-800">Pendiente total</CardDescription>
                        <CardTitle className="text-2xl text-orange-950">
                            {formatCents(data.summary?.pending_cents || 0)}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-orange-800">
                        {data.summary?.pending_count || 0} pago(s) por revisar
                    </CardContent>
                </Card>
                {kindCards.map((c) => {
                    const row = byKind[c.key] || { count: 0, cents: 0 };
                    const active = kind === c.key;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            onClick={() => setFilter("kind", active ? "all" : c.key)}
                            className="text-left"
                            data-testid={`payments-chip-${c.key}`}
                        >
                            <Card className={active ? "ring-2 ring-orange-400" : ""}>
                                <CardHeader className="pb-2">
                                    <CardDescription>{c.label}</CardDescription>
                                    <CardTitle className="text-xl">{formatCents(row.cents)}</CardTitle>
                                </CardHeader>
                                <CardContent className="text-sm text-muted-foreground">
                                    {row.count} pendiente(s)
                                </CardContent>
                            </Card>
                        </button>
                    );
                })}
            </section>

            <Card>
                <CardContent className="py-4 flex flex-wrap gap-2">
                    <form onSubmit={onSearch} className="flex gap-2 flex-1 min-w-[200px]">
                        <Input
                            placeholder="Organizador, evento, orden…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            data-testid="admin-payments-search"
                        />
                        <Button type="submit" variant="outline">
                            <Search className="h-4 w-4" />
                        </Button>
                    </form>
                    <Select value={status} onValueChange={(v) => setFilter("status", v)}>
                        <SelectTrigger className="w-40" data-testid="admin-payments-status">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={kind} onValueChange={(v) => setFilter("kind", v)}>
                        <SelectTrigger className="w-48" data-testid="admin-payments-kind">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {KIND_OPTIONS.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{data.total} pago(s)</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table data-testid="admin-payments-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Detalle</TableHead>
                                        <TableHead>Organizador</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.items.map((item) => {
                                        const km = KIND_META[item.kind] || KIND_META.ticket;
                                        const extra = item.extra || {};
                                        const orderMeta =
                                            ORDER_STATUS_META[extra.order_status] ||
                                            (item.status === "paid"
                                                ? ORDER_STATUS_META.paid
                                                : ORDER_STATUS_META.pending);
                                        return (
                                            <TableRow key={item.id} data-testid={`payment-row-${item.kind}`}>
                                                <TableCell>
                                                    <Badge className={km.className}>{km.label}</Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{item.title}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.reference || extra.buyer_email || "—"}
                                                        {extra.payment_method
                                                            ? ` · ${paymentMethodLabel(extra.payment_method)}`
                                                            : ""}
                                                    </div>
                                                    {item.kind === "ticket" && extra.fees_cents > 0 && (
                                                        <div className="text-xs text-muted-foreground">
                                                            Comisión TYS {formatCents(extra.fees_cents)}
                                                            {extra.platform_fee_bearer === "organizer"
                                                                ? " · la absorbe el organizador"
                                                                : " · la paga el comprador"}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {item.organizer_id ? (
                                                        <Link
                                                            to={`/admin/organizadores/${item.organizer_id}`}
                                                            className="text-sm hover:text-primary"
                                                        >
                                                            {item.organizer_name || "—"}
                                                        </Link>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                                    {formatWhen(item.paid_at || item.created_at)}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {formatCents(item.amount_cents)}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={orderMeta.className || ""}>
                                                        {item.kind === "ticket"
                                                            ? orderMeta.label
                                                            : item.status === "paid"
                                                              ? "Pagado"
                                                              : "Pendiente"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {extra.action ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={actingId === item.id}
                                                            onClick={() => act(item)}
                                                        >
                                                            {actingId === item.id ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : extra.action === "confirm_plan" ? (
                                                                "Confirmar pago"
                                                            ) : (
                                                                "Marcar pagado"
                                                            )}
                                                        </Button>
                                                    ) : item.kind === "ticket" && item.status === "pending" ? (
                                                        <span className="text-xs text-muted-foreground">
                                                            Lo confirma el organizador
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {data.items.length === 0 && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={7}
                                                className="text-center text-muted-foreground py-10"
                                            >
                                                <Wallet className="h-8 w-8 mx-auto mb-2 opacity-40" />
                                                No hay pagos con los filtros actuales.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {data.total > 30 && (
                        <div className="flex justify-between items-center pt-3 text-sm">
                            <span className="text-muted-foreground">
                                Página {page} · {data.total} totales
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                >
                                    ← Anterior
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={page * 30 >= data.total}
                                >
                                    Siguiente →
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
