/**
 * /admin — super-admin dashboard global (Phase 5.5).
 * KPIs + recharts + top tables + attention items.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    Loader2,
    DollarSign,
    TrendingUp,
    Coins,
    Users,
    AlertTriangle,
    Calendar,
    Download,
} from "lucide-react";
import {
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    CartesianGrid,
} from "recharts";
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
import api, { formatApiError } from "@/lib/api";
import { formatCents } from "@/lib/orders";

const STATUS_COLORS = {
    pending: "#f59e0b",
    approved: "#10b981",
    rejected: "#ef4444",
    suspended: "#64748b",
};
const PLAN_COLORS = {
    evento_unico: "#f97316",
    basico: "#3b82f6",
    profesional: "#8b5cf6",
    enterprise: "#10b981",
    sin_plan: "#94a3b8",
};

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [attention, setAttention] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get("/admin/dashboard/stats"),
            api.get("/admin/attention-items"),
        ])
            .then(([s, a]) => {
                setStats(s.data);
                setAttention(a.data);
            })
            .catch((e) => {
                console.error("Failed loading admin dashboard", formatApiError(e?.response?.data?.detail));
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!stats) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                    No se pudo cargar el dashboard.
                </CardContent>
            </Card>
        );
    }

    const { kpis, distribution, activity, top_organizers_by_gmv, top_events_by_sales } = stats;

    const statusData = Object.entries(distribution.organizers_by_status)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    const planData = Object.entries(distribution.organizers_by_plan)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));

    return (
        <div className="space-y-6" data-testid="admin-dashboard">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-sm text-muted-foreground">Panel super-admin</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Dashboard global
                    </h1>
                </div>
                <Button asChild variant="outline" data-testid="goto-reports">
                    <Link to="/admin/reportes">
                        <Download className="h-4 w-4 mr-1.5" />
                        Exportar reportes
                    </Link>
                </Button>
            </header>

            {/* ── Attention banner — siempre 3 chips ──────────────── */}
            {attention && (
                <Card
                    className="border-orange-200 bg-orange-50"
                    data-testid="attention-card"
                >
                    <CardHeader className="flex flex-row items-start gap-3 pb-3">
                        <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                        <div>
                            <CardTitle className="text-base text-orange-900">
                                Atención requerida
                            </CardTitle>
                            <CardDescription className="text-orange-800">
                                Items operativos para revisar
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="grid sm:grid-cols-3 gap-3 text-sm">
                        <AttentionChip
                            value={attention.pending_organizers}
                            label="Organizadores pendientes"
                            to="/admin/organizadores?status=pending"
                            testid="attention-pending-orgs"
                        />
                        <AttentionChip
                            value={attention.stale_manual_orders}
                            label="Órdenes manuales >24h sin confirmar"
                            to="/admin/eventos"
                            testid="attention-stale-orders"
                        />
                        <AttentionChip
                            value={attention.past_due_subscriptions}
                            label="Suscripciones past_due"
                            to="/admin/organizadores?subscription_status=past_due"
                            testid="attention-past-due"
                        />
                    </CardContent>
                </Card>
            )}

            {/* ── KPIs (4 cards) ────────────────────────────────────── */}
            <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpis">
                <Kpi
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="MRR"
                    value={formatCents(kpis.mrr_cents)}
                    sub="Recurrente mensual"
                    testid="kpi-mrr"
                />
                <Kpi
                    icon={<DollarSign className="h-5 w-5" />}
                    label="GMV este mes"
                    value={formatCents(kpis.gmv_month_cents)}
                    delta={kpis.gmv_delta_pct}
                    sub={
                        kpis.gmv_delta_pct == null
                            ? "Sin histórico"
                            : `${kpis.gmv_delta_pct > 0 ? "+" : ""}${kpis.gmv_delta_pct}% vs mes ant.`
                    }
                    testid="kpi-gmv"
                />
                <Kpi
                    icon={<Coins className="h-5 w-5" />}
                    label="Comisiones del mes"
                    value={formatCents(kpis.fees_month_cents)}
                    sub="Tarifa de servicio 5%"
                    testid="kpi-fees"
                />
                <Kpi
                    icon={<Users className="h-5 w-5" />}
                    label="Organizers activos"
                    value={kpis.active_organizers}
                    sub="Approved + active sub"
                    testid="kpi-active-orgs"
                />
            </section>

            {/* ── Charts row ────────────────────────────────────────── */}
            <div className="grid lg:grid-cols-2 gap-3">
                <Card data-testid="chart-status">
                    <CardHeader>
                        <CardTitle className="text-base">Organizers por estado</CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                        {statusData.length === 0 ? (
                            <EmptyChart />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={statusData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={90}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value}`}
                                    >
                                        {statusData.map((entry) => (
                                            <Cell
                                                key={entry.name}
                                                fill={STATUS_COLORS[entry.name] || "#cbd5e1"}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                <Card data-testid="chart-plan">
                    <CardHeader>
                        <CardTitle className="text-base">Organizers por plan</CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                        {planData.length === 0 ? (
                            <EmptyChart />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={planData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" fontSize={11} />
                                    <YAxis fontSize={11} allowDecimals={false} />
                                    <Tooltip />
                                    <Bar dataKey="value">
                                        {planData.map((e) => (
                                            <Cell key={e.name} fill={PLAN_COLORS[e.name] || "#94a3b8"} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ── Activity cards ────────────────────────────────────── */}
            <section className="grid sm:grid-cols-3 gap-3" data-testid="activity">
                <ActivityCard
                    label="Tickets vendidos"
                    primary={activity.tickets_total}
                    secondary={`${activity.tickets_month} este mes`}
                />
                <ActivityCard
                    label="Órdenes del mes"
                    primary={activity.orders_month.paid}
                    secondary={`${activity.orders_month.pending_manual} pending · ${activity.orders_month.cancelled} cancelled · ${activity.orders_month.refunded} refunded`}
                />
                <ActivityCard
                    label="Eventos publicados"
                    primary={activity.events_published_total}
                    secondary={`+${activity.events_published_month} nuevos del mes`}
                />
            </section>

            {/* ── Top tables ────────────────────────────────────────── */}
            <div className="grid lg:grid-cols-2 gap-3">
                <Card data-testid="top-organizers">
                    <CardHeader>
                        <CardTitle className="text-base">
                            Top 5 organizadores por GMV (mes)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {top_organizers_by_gmv.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                Aún sin ventas este mes.
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Empresa</TableHead>
                                        <TableHead>Plan</TableHead>
                                        <TableHead className="text-right">GMV</TableHead>
                                        <TableHead className="text-right">Tickets</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {top_organizers_by_gmv.map((o) => (
                                        <TableRow key={o.organizer_id}>
                                            <TableCell>
                                                <Link
                                                    to={`/admin/organizadores/${o.organizer_id}`}
                                                    className="font-medium hover:text-primary"
                                                    data-testid={`top-org-${o.slug}`}
                                                >
                                                    {o.company_name}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">
                                                    {o.plan_name || "—"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {formatCents(o.gmv_cents)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {o.tickets}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                <Card data-testid="top-events">
                    <CardHeader>
                        <CardTitle className="text-base">Top 5 eventos por ventas (mes)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {top_events_by_sales.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                Aún sin ventas este mes.
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Evento</TableHead>
                                        <TableHead>Organizer</TableHead>
                                        <TableHead className="text-right">GMV</TableHead>
                                        <TableHead className="text-right">Vendidos</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {top_events_by_sales.map((e) => (
                                        <TableRow key={e.event_id}>
                                            <TableCell>
                                                <Link
                                                    to={`/admin/eventos`}
                                                    className="font-medium hover:text-primary"
                                                >
                                                    {e.title}
                                                </Link>
                                                <div className="text-xs text-muted-foreground">
                                                    {e.starts_at && new Date(e.starts_at).toLocaleDateString("es-EC")}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {e.company_name}
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {formatCents(e.gmv_cents)}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">
                                                {e.tickets_sold || e.tickets}
                                                {e.capacity ? ` / ${e.capacity}` : ""}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Kpi({ icon, label, value, sub, delta, testid }) {
    return (
        <Card data-testid={testid}>
            <CardContent className="pt-5 pb-4 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                    <span className="text-xs uppercase tracking-wide">{label}</span>
                    {icon}
                </div>
                <div className="text-2xl font-semibold leading-tight flex items-baseline gap-2">
                    {value}
                    {delta != null && delta !== 0 && (
                        <span
                            className={`text-xs font-medium ${
                                delta > 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                        >
                            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}%
                        </span>
                    )}
                </div>
                {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
            </CardContent>
        </Card>
    );
}

function ActivityCard({ label, primary, secondary }) {
    return (
        <Card>
            <CardContent className="pt-5 pb-4 space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {label}
                </div>
                <div className="text-2xl font-semibold">{primary}</div>
                <div className="text-xs text-muted-foreground">{secondary}</div>
            </CardContent>
        </Card>
    );
}

function EmptyChart() {
    return (
        <div className="h-full grid place-items-center text-sm text-muted-foreground">
            Sin datos
        </div>
    );
}

function AttentionChip({ value, label, to, testid }) {
    const isWarn = value > 0;
    return (
        <Link
            to={to}
            className={`rounded-lg border p-3 transition ${
                isWarn
                    ? "bg-white border-red-300 hover:border-red-400"
                    : "bg-slate-50 border-slate-200 hover:border-slate-300"
            }`}
            data-testid={testid}
        >
            <div
                className={`text-2xl font-semibold ${
                    isWarn ? "text-red-600" : "text-slate-400"
                }`}
            >
                {value}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
        </Link>
    );
}
