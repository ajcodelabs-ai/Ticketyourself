/**
 * /admin/organizadores — Phase 5.5 enriched listing.
 *
 * Uses GET /api/admin/organizers-rich (returns revenue, tickets_emitted,
 * events_published, last_login + plan + subscription_status). Adds sort
 * indicators on clickable headers + multi-status filters + inline/bulk
 * approve & reject without opening the detail page.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table";
import {
    ArrowUpDown,
    ArrowDown,
    ArrowUp,
    Search,
    CheckCircle2,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { formatCents } from "@/lib/orders";
import { useAdminOrganizers } from "@/hooks/queries/useAdminOrganizers";
import {
    approveConfirmMessage,
    needsApproveConfirm,
    verificanteRiskMeta,
} from "@/lib/verificante";

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
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const [status, setStatus] = useState(params.get("status") || "__all");
    const [subStatus, setSubStatus] = useState(
        params.get("subscription_status") || "__all",
    );
    const [activity, setActivity] = useState(params.get("activity") || "__all");
    const [search, setSearch] = useState(params.get("search") || "");
    const [sort, setSort] = useState("revenue");
    const [direction, setDirection] = useState("desc");
    const [selected, setSelected] = useState(() => new Set());
    const [acting, setActing] = useState(false);
    const [rejectTarget, setRejectTarget] = useState(null); // { ids: string[], label: string }
    const [rejectComment, setRejectComment] = useState("");

    const filters = {
        status,
        subscription_status: subStatus,
        activity,
        search: search.trim(),
        sort,
        direction,
    };
    const { data, isLoading } = useAdminOrganizers(filters);
    const items = data?.items ?? [];
    const total = data?.total ?? 0;

    // Reflect filters in URL (deep-link-friendly)
    useEffect(() => {
        const next = new URLSearchParams();
        if (status !== "__all") next.set("status", status);
        if (subStatus !== "__all") next.set("subscription_status", subStatus);
        if (activity !== "__all") next.set("activity", activity);
        if (search.trim()) next.set("search", search.trim());
        setParams(next, { replace: true });
    }, [status, subStatus, activity, search, setParams]);

    // Drop selections that disappeared after filter/refetch.
    useEffect(() => {
        const visible = new Set(items.map((o) => o.id));
        setSelected((prev) => {
            const next = new Set([...prev].filter((id) => visible.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [items]);

    const toggleSort = (col) => {
        if (sort === col) {
            setDirection((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSort(col);
            setDirection("desc");
        }
    };

    const refreshList = async () => {
        await queryClient.invalidateQueries({ queryKey: ["admin", "organizers"] });
    };

    const approveIds = async (ids) => {
        if (!ids.length) return;
        const risky = ids
            .map((id) => items.find((o) => o.id === id))
            .filter(
                (o) =>
                    o &&
                    needsApproveConfirm({
                        status: o.verificante_status,
                        risk_level: o.verificante_risk_level,
                        admitted: o.verificante_admitted,
                    }),
            );
        if (risky.length) {
            const first = risky[0];
            const ok = window.confirm(
                risky.length === 1
                    ? approveConfirmMessage({
                          status: first.verificante_status,
                          risk_level: first.verificante_risk_level,
                      })
                    : `${risky.length} organizadores no tienen riesgo bajo en Verificante. ¿Aprobar igual?`,
            );
            if (!ok) return;
        }
        setActing(true);
        let ok = 0;
        try {
            for (const id of ids) {
                await api.post(`/admin/organizers/${id}/approve`, {});
                ok += 1;
            }
            toast.success(
                ok === 1 ? "Organizador aprobado" : `${ok} organizadores aprobados`,
            );
            setSelected(new Set());
            await refreshList();
        } catch (err) {
            toast.error(
                formatApiError(err?.response?.data?.detail) ||
                    `Error al aprobar (${ok} OK antes del fallo)`,
            );
            await refreshList();
        } finally {
            setActing(false);
        }
    };

    const openReject = (ids, label) => {
        setRejectTarget({ ids, label });
        setRejectComment("");
    };

    const confirmReject = async () => {
        if (!rejectTarget?.ids?.length) return;
        if (rejectComment.trim().length < 2) {
            toast.error("El comentario es obligatorio para rechazar");
            return;
        }
        setActing(true);
        let ok = 0;
        try {
            for (const id of rejectTarget.ids) {
                await api.post(`/admin/organizers/${id}/reject`, {
                    comment: rejectComment.trim(),
                });
                ok += 1;
            }
            toast.success(
                ok === 1 ? "Organizador rechazado" : `${ok} organizadores rechazados`,
            );
            setRejectTarget(null);
            setRejectComment("");
            setSelected(new Set());
            await refreshList();
        } catch (err) {
            toast.error(
                formatApiError(err?.response?.data?.detail) ||
                    `Error al rechazar (${ok} OK antes del fallo)`,
            );
            await refreshList();
        } finally {
            setActing(false);
        }
    };

    const toggleOne = (id, checked) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const allVisibleIds = items.map((o) => o.id);
    const allSelected =
        allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
    const someSelected = allVisibleIds.some((id) => selected.has(id));

    const toggleAll = (checked) => {
        setSelected(checked ? new Set(allVisibleIds) : new Set());
    };

    const selectedPending = items.filter(
        (o) => selected.has(o.id) && o.status === "pending",
    );

    const columns = useMemo(
        () => [
            {
                id: "select",
                header: () => (
                    <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(v) => toggleAll(!!v)}
                        aria-label="Seleccionar todos"
                        data-testid="admin-orgs-select-all"
                    />
                ),
                cell: ({ row }) => (
                    <Checkbox
                        checked={selected.has(row.original.id)}
                        onCheckedChange={(v) => toggleOne(row.original.id, !!v)}
                        aria-label={`Seleccionar ${row.original.company_name}`}
                        data-testid={`admin-org-select-${row.original.slug}`}
                    />
                ),
            },
            {
                id: "company_name",
                header: "Empresa",
                cell: ({ row }) => {
                    const o = row.original;
                    return (
                        <>
                            <Link
                                to={`/admin/organizadores/${o.id}`}
                                className="font-medium hover:text-primary"
                            >
                                {o.company_name}
                            </Link>
                            <div className="text-xs text-muted-foreground">/{o.slug}</div>
                        </>
                    );
                },
            },
            {
                id: "email",
                header: "Email",
                cell: ({ row }) => (
                    <span
                        className="text-sm text-muted-foreground"
                        data-testid={`org-email-${row.original.slug}`}
                    >
                        {row.original.email}
                    </span>
                ),
            },
            {
                id: "plan",
                header: "Plan",
                cell: ({ row }) =>
                    row.original.plan_name ? (
                        <Badge variant="outline" className="text-xs">
                            {row.original.plan_name}
                        </Badge>
                    ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                    ),
            },
            {
                id: "subscription",
                header: "Suscripción",
                cell: ({ row }) => {
                    const o = row.original;
                    const sub = o.subscription_status || "none";
                    return (
                        <Badge
                            className={`text-xs ${SUB_STATUS_STYLE[sub] || ""}`}
                            data-testid={`org-substatus-${o.slug}`}
                        >
                            {sub}
                        </Badge>
                    );
                },
            },
            {
                id: "status",
                header: "Estado",
                cell: ({ row }) => (
                    <div className="flex flex-wrap items-center gap-1">
                        <Badge className={STATUS_STYLE[row.original.status] || ""}>
                            {row.original.status}
                        </Badge>
                        {row.original.verificante_status &&
                            row.original.verificante_status !== "skipped" && (
                                <Badge
                                    className={`text-[10px] ${
                                        verificanteRiskMeta(
                                            row.original.verificante_risk_level,
                                        ).className
                                    }`}
                                    data-testid={`org-verificante-${row.original.slug}`}
                                    title="Verificante"
                                >
                                    {verificanteRiskMeta(
                                        row.original.verificante_risk_level,
                                    ).label}
                                </Badge>
                            )}
                    </div>
                ),
            },
            {
                id: "events_published",
                header: "Eventos",
                cell: ({ row }) => (
                    <span className="tabular-nums">{row.original.events_published ?? 0}</span>
                ),
            },
            {
                id: "tickets_emitted",
                header: "Tickets",
                cell: ({ row }) => (
                    <span className="tabular-nums">{row.original.tickets_emitted ?? 0}</span>
                ),
            },
            {
                id: "revenue",
                header: "Ingresos",
                cell: ({ row }) => (
                    <span
                        className="tabular-nums font-medium"
                        data-testid={`org-revenue-${row.original.slug}`}
                    >
                        {formatCents(row.original.revenue || 0)}
                    </span>
                ),
            },
            {
                id: "last_login",
                header: "Último login",
                cell: ({ row }) => formatLastLogin(row.original.last_login),
            },
            {
                id: "created_at",
                header: "Registro",
                cell: ({ row }) => formatDate(row.original.created_at),
            },
            {
                id: "actions",
                header: "Acciones",
                cell: ({ row }) => {
                    const o = row.original;
                    const isPending = o.status === "pending";
                    return (
                        <div className="flex items-center justify-end gap-1">
                            {isPending && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={acting}
                                        onClick={() => approveIds([o.id])}
                                        data-testid={`org-approve-${o.slug}`}
                                        className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                        title="Aprobar"
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span className="sr-only">Aprobar</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={acting}
                                        onClick={() =>
                                            openReject([o.id], o.company_name || o.slug)
                                        }
                                        data-testid={`org-reject-${o.slug}`}
                                        className="text-red-700 hover:text-red-800 hover:bg-red-50"
                                        title="Rechazar"
                                    >
                                        <XCircle className="h-4 w-4" />
                                        <span className="sr-only">Rechazar</span>
                                    </Button>
                                </>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                data-testid={`org-view-${o.slug}`}
                            >
                                <Link to={`/admin/organizadores/${o.id}`}>Ver</Link>
                            </Button>
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps -- table cells close over latest handlers
        [selected, acting, allSelected, someSelected, items],
    );

    const table = useReactTable({
        data: items,
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualSorting: true,
    });

    const sortIcon = (col) => {
        if (sort !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
        return direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
        ) : (
            <ArrowDown className="h-3 w-3" />
        );
    };

    const colSpan = 12;

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

            {selected.size > 0 && (
                <div
                    data-testid="admin-orgs-bulk-bar"
                    className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 shadow-sm"
                >
                    <span className="text-sm font-medium">
                        {selected.size} seleccionado(s)
                        {selectedPending.length > 0 && selectedPending.length !== selected.size
                            ? ` · ${selectedPending.length} pendiente(s)`
                            : null}
                    </span>
                    <div className="flex flex-wrap gap-2 ml-auto">
                        <Button
                            size="sm"
                            disabled={acting || selectedPending.length === 0}
                            onClick={() => approveIds(selectedPending.map((o) => o.id))}
                            data-testid="admin-orgs-bulk-approve"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Aprobar pendientes
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={acting || selectedPending.length === 0}
                            onClick={() =>
                                openReject(
                                    selectedPending.map((o) => o.id),
                                    `${selectedPending.length} organizador(es)`,
                                )
                            }
                            data-testid="admin-orgs-bulk-reject"
                        >
                            <XCircle className="h-4 w-4 mr-1" />
                            Rechazar pendientes
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={acting}
                            onClick={() => setSelected(new Set())}
                        >
                            Limpiar
                        </Button>
                    </div>
                </div>
            )}

            <Card>
                <CardContent className="pt-4">
                    <div className="overflow-x-auto">
                        <Table data-testid="admin-organizers-table">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10" />
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
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                                            Cargando…
                                        </TableCell>
                                    </TableRow>
                                ) : table.getRowModel().rows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                                            Sin resultados.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            data-testid={`admin-org-${(row.original as { slug: string }).slug}`}
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell
                                                    key={cell.id}
                                                    className={
                                                        ["events_published", "tickets_emitted", "revenue", "actions"].includes(
                                                            cell.column.id,
                                                        )
                                                            ? "text-right"
                                                            : ""
                                                    }
                                                >
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext(),
                                                    )}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog
                open={!!rejectTarget}
                onOpenChange={(open) => {
                    if (!open && !acting) {
                        setRejectTarget(null);
                        setRejectComment("");
                    }
                }}
            >
                <DialogContent data-testid="admin-orgs-reject-dialog">
                    <DialogHeader>
                        <DialogTitle>Rechazar organizador</DialogTitle>
                        <DialogDescription>
                            {rejectTarget
                                ? `Se rechazará: ${rejectTarget.label}. El comentario se envía por correo.`
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        placeholder="Motivo del rechazo (obligatorio)"
                        rows={4}
                        data-testid="admin-orgs-reject-comment"
                    />
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            disabled={acting}
                            onClick={() => {
                                setRejectTarget(null);
                                setRejectComment("");
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={acting || rejectComment.trim().length < 2}
                            onClick={confirmReject}
                            data-testid="admin-orgs-reject-confirm"
                        >
                            Rechazar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
