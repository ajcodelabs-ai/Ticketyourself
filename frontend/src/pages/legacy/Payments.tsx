import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { useTenant } from "@/contexts/TenantContext";
import api from "@/lib/api";
import { RefreshCw, Receipt } from "lucide-react";

const STATUS_STYLE = {
    paid: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    pending: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    failed: "bg-red-100 text-red-700 hover:bg-red-100",
};

export default function Payments() {
    const { tenantSlug, tenant } = useTenant();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!tenantSlug) {
            setItems([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { data } = await api.get("/poc/payments", {
                params: { tenant_slug: tenantSlug },
            });
            setItems(Array.isArray(data) ? data : []);
        } catch (e) {
            const msg =
                e?.response?.data?.detail || e?.message || "Error cargando";
            setError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [tenantSlug]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div data-testid="payments-page" className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                    <Badge variant="secondary" className="text-primary">
                        Pagos POC
                    </Badge>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                        Pagos de{" "}
                        <span className="text-primary">
                            {tenant?.name || tenantSlug || "tenant"}
                        </span>
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Los pagos nacen <b>pending</b> y pasan a <b>paid</b>{" "}
                        cuando llega el webhook o el polling de la página de
                        éxito.
                    </p>
                </div>
                <Button
                    onClick={load}
                    variant="outline"
                    data-testid="payments-refresh-btn"
                    disabled={loading}
                >
                    <RefreshCw
                        className={`h-4 w-4 mr-2 ${
                            loading ? "animate-spin" : ""
                        }`}
                    />
                    Refrescar
                </Button>
            </header>

            <Card className="border-border/70 tys-soft-shadow overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-primary" />
                        Sesiones de checkout
                    </CardTitle>
                    <CardDescription>
                        {items.length} {items.length === 1 ? "pago" : "pagos"}{" "}
                        encontrados.
                    </CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                    <Table data-testid="payments-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Detalle</TableHead>
                                <TableHead>Monto</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Creado</TableHead>
                                <TableHead>Pagado</TableHead>
                                <TableHead>Stripe Session</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <PaymentsTableBody
                                loading={loading}
                                items={items}
                                error={error}
                            />
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function PaymentsTableBody({ loading, items, error }) {
    if (loading && items.length === 0) {
        return (
            <TableRow>
                <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                    data-testid="payments-loading"
                >
                    Cargando…
                </TableCell>
            </TableRow>
        );
    }
    if (items.length === 0) {
        return (
            <TableRow>
                <TableCell
                    colSpan={7}
                    className="text-center py-10 text-muted-foreground"
                    data-testid="payments-empty"
                >
                    {error || "Todavía no hay pagos para este tenant."}
                </TableCell>
            </TableRow>
        );
    }
    return items.map((p) => <PaymentRow key={p.id} p={p} />);
}

function PaymentRow({ p }) {
    return (
        <TableRow data-testid={`payment-row-${p.stripe_session_id}`}>
            <TableCell className="capitalize">{p.type}</TableCell>
            <TableCell className="max-w-[260px] truncate">
                {p.event_name || p.plan_name || p.description}
            </TableCell>
            <TableCell>
                ${(p.amount_cents / 100).toFixed(2)}{" "}
                <span className="text-muted-foreground uppercase text-xs">
                    {p.currency}
                </span>
            </TableCell>
            <TableCell>
                <Badge
                    data-testid={`payment-status-${p.stripe_session_id}`}
                    className={STATUS_STYLE[p.status] || ""}
                >
                    {p.status}
                </Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
                {fmtDate(p.created_at)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
                {p.paid_at ? fmtDate(p.paid_at) : "—"}
            </TableCell>
            <TableCell className="text-xs font-mono max-w-[180px] truncate">
                {p.stripe_session_id}
            </TableCell>
        </TableRow>
    );
}

function fmtDate(iso) {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        return d.toLocaleString("es-EC", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}
