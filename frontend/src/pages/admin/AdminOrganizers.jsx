/**
 * /admin/organizadores — Phase 5.5 enriched listing.
 *
 * Uses GET /api/admin/organizers-rich (returns revenue, tickets_emitted,
 * events_published, last_login + plan + subscription_status). Adds sort
 * indicators on clickable headers + multi-status filters.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpDown, ArrowDown, ArrowUp, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import api from "@/lib/api";
import { formatCents } from "@/lib/orders";

const STATUSES = [
    { value: "__all", label: "Todos los estados" },
    { value: "pending", label: "Pendientes" },
    { value: "approved", label: "Aprobados" },
    { value: "rejected", label: "Rechazados" },
    { value: "suspended", label: "Suspendidos" },
];

const SUB_STATUSES = [
    { value: "__all", label: "Todas las suscripciones" },
    { value: "active", label: "Activa" },
    { value: "trialing", label: "Trial" },
    { value: "past_due", label: "Past due" },
    { value: "canceled", label: "Canceled" },
    { value: "none", label: "Sin suscripción" },
];

const ACTIVITIES = [
    { value: "__all", label: "Cualquier actividad" },
    { value: "none", label: "Sin eventos" },
    { value: "1-5", label: "1-5 eventos" },
    { value: "5+", label: "5+ eventos" },
    { value: "10+", label: "10+ eventos" },
];

const STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
    suspended: "bg-slate-200 text-slate-700",
};
const SUB_STATUS_STYLE = {
    active: "bg-emerald-100 text-emerald-800",
    trialing: "bg-sky-100 text-sky-800",
    past_due: "bg-amber-100 text-amber-900",
    canceled: "bg-slate-100 text-slate-700",
    none: "bg-slate-100 text-slate-600",
};

const SORTABLE_COLS = [
    { id: "company_name", label: "Empresa" },
    { id: "email", label: "Email" },
    { id: "events_published", label: "Eventos" },
    { id: "tickets_emitted", label: "Tickets" },
    { id: "revenue", label: "Ingresos" },
    { id: "last_login", label: "Último login" },
    { id: "created_at", label: "Registro" },
];

function formatDate(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString("es-EC");
    } catch {
        return "—";
    }
}

function formatLastLogin(iso) {
    if (!iso) return <span className="text-muted-foreground italic">Nunca</span>;
    try {
        const d = new Date(iso);
        const diffH = Math.floor((Date.now() - d.getTime()) / 3_600_000);
        if (diffH < 1) return "Hace minutos";
        if (diffH < 24) return `Hace ${diffH}h`;
        return d.toLocaleDateString("es-EC");
    } catch {
        return "—";
    }
}

export default function AdminOrganizers() {
    const [params, setParams] = useSearchParams();
    const [status, setStatus] = useState(params.get("status") || "__all");
    const [subStatus, setSubStatus] = useState(
        params.get("subscription_status") || "__all",
    );
    const [activity, setActivity] = useState(params.get("activity") || "__all");
    const [search, setSearch] = useState(params.get("search") || "");
    const [sort, setSort] = useState("revenue");
    const [direction, setDirection] = useState("desc");
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({
                sort,
                direction,
                page: "1",
                limit: "100",
            });
            if (status !== "__all") q.set("status", status);
            if (subStatus !== "__all") q.set("subscription_status", subStatus);
            if (activity !== "__all") q.set("activity", activity);
            if (search.trim()) q.set("search", search.trim());
            const { data } = await api.get(`/admin/organizers-rich?${q}`);
            setItems(data.items || []);
            setTotal(data.total || 0);
        } finally {
            setLoading(false);
        }
    }, [status, subStatus, activity, search, sort, direction]);

    useEffect(() => {
        load();
    }, [load]);

    // Reflect filters in URL (deep-link-friendly)
    useEffect(() => {
        const next = new URLSearchParams();
        if (status !== "__all") next.set("status", status);
        if (subStatus !== "__all") next.set("subscription_status", subStatus);
        if (activity !== "__all") next.set("activity", activity);
        if (search.trim()) next.set("search", search.trim());
        setParams(next, { replace: true });
    }, [status, subStatus, activity, search, setParams]);

    const toggleSort = (col) => {
        if (sort === col) {
            setDirection((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSort(col);
            setDirection("desc");
        }
    };

    const sortIcon = (col) => {
        if (sort !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
        return direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
        ) : (
            <ArrowDown className="h-3 w-3" />
        );
    };

    return (
        <div data-testid="admin-organizers-page" className="space-y-5">
            <header className="space-y-1">
                <div className="text-sm text-muted-foreground">Admin</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Organizadores
                </h1>
                <p className="text-sm text-muted-foreground">
                    {total} organizador(es) · ordenado por {sort} ({direction})
                </p>
            </header>

            <Card>
                <CardContent className="py-4 flex flex-wrap gap-2 items-end">
                    <div className="flex-1 min-w-[220px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar por nombre, email o slug…"
                                className="pl-9"
                                data-testid="admin-orgs-search"
                            />
                        </div>
                    </div>
                    <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger className="w-44" data-testid="admin-orgs-status-filter">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={subStatus} onValueChange={setSubStatus}>
                        <SelectTrigger
                            className="w-48"
                            data-testid="admin-orgs-substatus-filter"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SUB_STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={activity} onValueChange={setActivity}>
                        <SelectTrigger
                            className="w-44"
                            data-testid="admin-orgs-activity-filter"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ACTIVITIES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-4">
                    <div className="overflow-x-auto">
                        <Table data-testid="admin-organizers-table">
                            <TableHeader>
                                <TableRow>
                                    <SortHeader
                                        col="company_name"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                    >
                                        Empresa
                                    </SortHeader>
                                    <SortHeader
                                        col="email"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                    >
                                        Email
                                    </SortHeader>
                                    <TableHead>Plan</TableHead>
                                    <TableHead>Suscripción</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <SortHeader
                                        col="events_published"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                        align="right"
                                    >
                                        Eventos
                                    </SortHeader>
                                    <SortHeader
                                        col="tickets_emitted"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                        align="right"
                                    >
                                        Tickets
                                    </SortHeader>
                                    <SortHeader
                                        col="revenue"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                        align="right"
                                    >
                                        Ingresos
                                    </SortHeader>
                                    <SortHeader
                                        col="last_login"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                    >
                                        Último login
                                    </SortHeader>
                                    <SortHeader
                                        col="created_at"
                                        sort={sort}
                                        direction={direction}
                                        onClick={toggleSort}
                                        icon={sortIcon}
                                    >
                                        Registro
                                    </SortHeader>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                                            Cargando…
                                        </TableCell>
                                    </TableRow>
                                ) : items.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                                            Sin resultados.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    items.map((o) => (
                                        <TableRow key={o.id} data-testid={`admin-org-${o.slug}`}>
                                            <TableCell>
                                                <Link
                                                    to={`/admin/organizadores/${o.id}`}
                                                    className="font-medium hover:text-primary"
                                                >
                                                    {o.company_name}
                                                </Link>
                                                <div className="text-xs text-muted-foreground">
                                                    /{o.slug}
                                                </div>
                                            </TableCell>
                                            <TableCell
                                                className="text-sm text-muted-foreground"
                                                data-testid={`org-email-${o.slug}`}
                                            >
                                                {o.email}
                                            </TableCell>
                                            <TableCell>
                                                {o.plan_name ? (
                                                    <Badge variant="outline" className="text-xs">
                                                        {o.plan_name}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    className={
                                                        SUB_STATUS_STYLE[o.subscription_status || "none"]
                                                    }
                                                    data-testid={`org-substatus-${o.slug}`}
                                                >
                                                    {o.subscription_status || "none"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={STATUS_STYLE[o.status]}>
                                                    {o.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {o.events_published}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {o.tickets_emitted}
                                            </TableCell>
                                            <TableCell
                                                className="text-right font-medium"
                                                data-testid={`org-revenue-${o.slug}`}
                                            >
                                                {formatCents(o.revenue)}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {formatLastLogin(o.last_login)}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {formatDate(o.created_at)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    asChild
                                                    data-testid={`org-view-${o.slug}`}
                                                >
                                                    <Link to={`/admin/organizadores/${o.id}`}>
                                                        Ver
                                                    </Link>
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function SortHeader({ col, sort, direction, onClick, icon, align = "left", children }) {
    const isActive = sort === col;
    return (
        <TableHead
            onClick={() => onClick(col)}
            className={`cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
            data-testid={`sort-${col}`}
        >
            <span
                className={`inline-flex items-center gap-1 hover:text-foreground ${
                    isActive ? "text-foreground font-semibold" : ""
                }`}
            >
                {children}
                {icon(col)}
            </span>
        </TableHead>
    );
}
