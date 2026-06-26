/**
 * /app/dashboard — Phase 5 organizer home.
 * Pulls from /api/dashboard/me (single aggregated payload).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    Loader2,
    Calendar,
    CreditCard,
    Globe,
    Ticket as TicketIcon,
    TrendingUp,
    DollarSign,
    AlertCircle,
    ExternalLink,
    Share2,
    Edit3,
    Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import ShareModal from "@/components/microsite/ShareModal";
import { useDashboard } from "@/hooks/queries/useDashboard";
import { previewMicrositePath, publicMicrositeHost } from "@/lib/config";
import { formatEventDate, EVENT_STATUS_META } from "@/lib/events";
import { formatCents } from "@/lib/orders";

const SUB_STATUS_META = {
    active: { label: "Activa", className: "bg-emerald-100 text-emerald-800" },
    trialing: { label: "Trial", className: "bg-sky-100 text-sky-800" },
    past_due: { label: "Pago atrasado", className: "bg-amber-100 text-amber-800" },
    canceled: { label: "Cancelada", className: "bg-slate-100 text-slate-700" },
    none: { label: "Sin plan", className: "bg-slate-100 text-slate-700" },
};

export default function DashboardHome() {
    const { data, isLoading, isError } = useDashboard();
    const [shareOpen, setShareOpen] = useState(false);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (isError || !data?.organizer) {
        return (
            <Card data-testid="dash-no-org">
                <CardContent className="py-10 text-center text-muted-foreground">
                    No encontramos tu perfil de organizador.
                </CardContent>
            </Card>
        );
    }

    const { organizer, plan, stats, next_event, upcoming_events, microsite, funnel } = data;
    const subMeta = SUB_STATUS_META[organizer.subscription_status] || SUB_STATUS_META.none;
    const publicUrl = `${window.location.origin}${previewMicrositePath(organizer.slug)}`;

    return (
        <div className="space-y-6" data-testid="dashboard-home">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-sm text-muted-foreground">Dashboard</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Hola, <span className="text-primary">{organizer.company_name}</span>
                    </h1>
                </div>
                <Button asChild data-testid="dash-create-event">
                    <Link to="/app/eventos/nuevo">
                        <Plus className="h-4 w-4 mr-1.5" />
                        Crear evento
                    </Link>
                </Button>
            </header>

            {/* ── Plan card ──────────────────────────────────────────────── */}
            <Card data-testid="plan-card" className="overflow-hidden">
                <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-5">
                    <div className="flex flex-wrap justify-between items-start gap-4">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                Tu plan
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <h2
                                    className="text-2xl font-semibold"
                                    data-testid="plan-name"
                                >
                                    {plan?.name || "Sin plan"}
                                </h2>
                                <Badge className={subMeta.className}>{subMeta.label}</Badge>
                            </div>
                            {plan && (
                                <p className="text-sm text-muted-foreground mt-1">
                                    {formatCents(plan.price_cents)}
                                    {plan.billing_period === "monthly" && " / mes"}
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" asChild data-testid="plan-portal">
                                <Link to="/app/configuracion">
                                    <CreditCard className="h-4 w-4 mr-1.5" />
                                    Gestionar plan
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>

            {/* ── Account status ────────────────────────────────────────── */}
            {organizer.admin_comments?.length > 0 && (
                <Card
                    data-testid="account-comments-card"
                    className="border-amber-200 bg-amber-50/40"
                >
                    <CardHeader className="flex flex-row items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="space-y-2 text-sm">
                            <CardTitle className="text-base">Mensajes del equipo</CardTitle>
                            {organizer.admin_comments.slice(-3).map((c) => (
                                <p key={c.id} className="text-amber-900">
                                    {c.comment}
                                </p>
                            ))}
                        </div>
                    </CardHeader>
                </Card>
            )}

            {/* ── Stats cards ───────────────────────────────────────────── */}
            <section
                className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"
                data-testid="stats-grid"
            >
                <Metric
                    icon={<TicketIcon className="h-5 w-5" />}
                    label="Eventos publicados"
                    value={stats.published_events}
                    sub={`${stats.draft_events} en borrador`}
                    testid="stat-published"
                />
                <Metric
                    icon={<Calendar className="h-5 w-5" />}
                    label="Próximo evento"
                    value={next_event ? truncate(next_event.title, 22) : "—"}
                    sub={
                        next_event
                            ? stats.days_to_next_event === 0
                                ? "Hoy"
                                : `En ${stats.days_to_next_event} día(s)`
                            : "Sin eventos próximos"
                    }
                    testid="stat-next"
                />
                <Metric
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="Tickets vendidos este mes"
                    value={stats.tickets_sold_month}
                    sub={`${stats.orders_month} órdenes pagadas`}
                    testid="stat-tickets"
                />
                <Metric
                    icon={<DollarSign className="h-5 w-5" />}
                    label="Ingresos del mes"
                    value={formatCents(stats.revenue_cents - stats.fees_cents)}
                    sub={`Comisiones: ${formatCents(stats.fees_cents)}`}
                    testid="stat-revenue"
                />
            </section>

            {/* ── Upcoming events table ─────────────────────────────────── */}
            <Card data-testid="upcoming-events-card">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-lg">Tus próximos eventos</CardTitle>
                        <CardDescription>Los 5 más cercanos.</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                        <Link to="/app/eventos">Ver todos</Link>
                    </Button>
                </CardHeader>
                <CardContent>
                    {upcoming_events.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground text-sm">
                            Todavía no publicaste eventos futuros.{" "}
                            <Link to="/app/eventos/nuevo" className="text-primary underline">
                                Crear el primero
                            </Link>
                            .
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Evento</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Venue</TableHead>
                                        <TableHead className="text-right">Vendidos</TableHead>
                                        <TableHead></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {upcoming_events.map((e) => {
                                        const meta = EVENT_STATUS_META[e.status] || {};
                                        return (
                                            <TableRow key={e.id} data-testid={`upcoming-${e.slug}`}>
                                                <TableCell>
                                                    <div className="font-medium">{e.title}</div>
                                                    <Badge
                                                        variant="outline"
                                                        className={`mt-1 text-xs ${meta.className || ""}`}
                                                    >
                                                        {meta.label || e.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {formatEventDate(e.starts_at)}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {e.venue_name || "—"}
                                                </TableCell>
                                                <TableCell className="text-right text-sm">
                                                    {e.tickets_sold || 0}
                                                    {e.capacity ? ` / ${e.capacity}` : ""}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        asChild
                                                        data-testid={`upcoming-view-${e.slug}`}
                                                    >
                                                        <Link to={`/app/eventos/${e.id}`}>Ver</Link>
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Microsite + Funnel row ────────────────────────────────── */}
            <div className="grid lg:grid-cols-2 gap-3">
                <Card data-testid="microsite-card">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Globe className="h-5 w-5 text-primary" />
                            Tu microsite
                        </CardTitle>
                        <CardDescription>
                            <code
                                className="bg-secondary px-1.5 py-0.5 rounded font-mono text-foreground"
                            >
                                {publicMicrositeHost(organizer.slug)}
                            </code>
                            <Badge variant="outline" className="ml-2 text-xs">
                                {microsite?.published ? "Publicado" : "Borrador"}
                            </Badge>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button asChild data-testid="ms-edit-btn">
                            <Link to="/app/microsite">
                                <Edit3 className="h-4 w-4 mr-1.5" />
                                Editar
                            </Link>
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShareOpen(true)}
                            data-testid="ms-share-btn"
                        >
                            <Share2 className="h-4 w-4 mr-1.5" />
                            Compartir
                        </Button>
                        <Button variant="outline" asChild data-testid="ms-view-btn">
                            <Link to={previewMicrositePath(organizer.slug)} target="_blank">
                                <ExternalLink className="h-4 w-4 mr-1.5" />
                                Ver público
                            </Link>
                        </Button>
                    </CardContent>
                </Card>

                <Card data-testid="funnel-card">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            Funnel de ventas
                        </CardTitle>
                        <CardDescription>Conversión total acumulada.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-3">
                        <FunnelStep
                            label="Visitas"
                            value={funnel.visits ?? "—"}
                            sub="placeholder"
                        />
                        <FunnelStep
                            label="Órdenes"
                            value={funnel.total_orders}
                            sub={`${funnel.paid_orders} pagadas`}
                        />
                        <FunnelStep
                            label="Conversión"
                            value={`${Math.round((funnel.conversion_rate || 0) * 100)}%`}
                            sub="orders → paid"
                        />
                    </CardContent>
                </Card>
            </div>

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={publicUrl}
                companyName={organizer.company_name}
                heroSubtitle=""
            />
        </div>
    );
}

function Metric({ icon, label, value, sub, testid }) {
    return (
        <Card data-testid={testid}>
            <CardContent className="pt-5 pb-4 space-y-1.5">
                <div className="flex items-center justify-between text-muted-foreground">
                    <span className="text-xs uppercase tracking-wide">{label}</span>
                    {icon}
                </div>
                <div className="text-2xl font-semibold leading-tight">{value}</div>
                {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
            </CardContent>
        </Card>
    );
}

function FunnelStep({ label, value, sub }) {
    return (
        <div className="text-center space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            <div className="text-xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
    );
}

function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
