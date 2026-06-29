/**
 * /admin/eventos — global events view across all organizers.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import api, { formatApiError } from "@/lib/api";
import { EVENT_CATEGORIES, EVENT_STATUS_META, formatEventDate } from "@/lib/events";
import { formatCents } from "@/lib/orders";

const STATUS_OPTIONS = [
    { value: "all", label: "Todos" },
    { value: "draft", label: "Borrador" },
    { value: "published", label: "Publicado" },
    { value: "archived", label: "Archivado" },
    { value: "cancelled", label: "Cancelado" },
];

const CATEGORY_OPTIONS = [
    { value: "all", label: "Todas" },
    ...EVENT_CATEGORIES.map((c) => ({ value: c.code, label: c.label })),
];

export default function AdminEvents() {
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("all");
    const [category, setCategory] = useState("all");
    const [sort, setSort] = useState("created_at");
    const [direction, setDirection] = useState("desc");
    const [page, setPage] = useState(1);

    const load = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                sort,
                direction,
                page: String(page),
                limit: "30",
            });
            if (search) params.set("search", search);
            if (status !== "all") params.set("status", status);
            if (category !== "all") params.set("category", category);
            const { data: d } = await api.get(`/admin/events?${params}`);
            setData(d);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, category, sort, direction, page]);

    const onSearch = (e) => {
        e.preventDefault();
        setPage(1);
        load();
    };

    const downloadCsv = async () => {
        try {
            const params = new URLSearchParams();
            if (status !== "all") params.set("status", status);
            if (category !== "all") params.set("category", category);
            const res = await api.get(`/admin/export/events.csv?${params}`, {
                responseType: "blob",
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `events_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            toast.success("CSV descargado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const toggleSort = (col) => {
        if (sort === col) setDirection(direction === "asc" ? "desc" : "asc");
        else {
            setSort(col);
            setDirection("desc");
        }
    };

    const sortIndicator = (col) => {
        if (sort !== col) return "";
        return direction === "asc" ? " ▲" : " ▼";
    };

    return (
        <div className="space-y-5" data-testid="admin-events-page">
            <header className="flex flex-wrap justify-between gap-3 items-end">
                <div>
                    <div className="text-sm text-muted-foreground">Eventos globales</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Todos los eventos
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Vista cross-tenant de todos los organizadores.
                    </p>
                </div>
                <Button variant="outline" onClick={downloadCsv} data-testid="admin-events-csv">
                    <Download className="h-4 w-4 mr-1.5" />
                    Exportar CSV
                </Button>
            </header>

            <Card>
                <CardContent className="py-4 flex flex-wrap gap-2">
                    <form onSubmit={onSearch} className="flex gap-2 flex-1 min-w-[200px]">
                        <Input
                            placeholder="Buscar por título…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            data-testid="admin-events-search"
                        />
                        <Button type="submit" variant="outline">
                            <Search className="h-4 w-4" />
                        </Button>
                    </form>
                    <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger className="w-40" data-testid="admin-events-status">
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
                    <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger className="w-44" data-testid="admin-events-category">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CATEGORY_OPTIONS.map((s) => (
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
                    <CardTitle className="text-base">
                        {data.total} evento(s)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table data-testid="admin-events-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead
                                            className="cursor-pointer"
                                            onClick={() => toggleSort("title")}
                                        >
                                            Evento{sortIndicator("title")}
                                        </TableHead>
                                        <TableHead>Organizer</TableHead>
                                        <TableHead>Categoría</TableHead>
                                        <TableHead
                                            className="cursor-pointer"
                                            onClick={() => toggleSort("starts_at")}
                                        >
                                            Fecha{sortIndicator("starts_at")}
                                        </TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead
                                            className="text-right cursor-pointer"
                                            onClick={() => toggleSort("tickets_sold")}
                                        >
                                            Vendidos{sortIndicator("tickets_sold")}
                                        </TableHead>
                                        <TableHead className="text-right">GMV</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.items.map((e) => {
                                        const meta = EVENT_STATUS_META[e.status] || {};
                                        return (
                                            <TableRow key={e.id} data-testid={`admin-event-${e.slug}`}>
                                                <TableCell>
                                                    <div className="font-medium">{e.title}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        /e/{e.slug}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Link
                                                        to={`/admin/organizadores/${e.organizer_id}`}
                                                        className="text-sm hover:text-primary"
                                                    >
                                                        {e.organizer_company_name || "—"}
                                                    </Link>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {e.category}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">
                                                    {formatEventDate(e.starts_at)}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={meta.className || ""}>
                                                        {meta.label || e.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right text-sm">
                                                    {e.tickets_sold || 0}
                                                    {e.capacity ? ` / ${e.capacity}` : ""}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {formatCents(e.gmv_cents)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {e.organizer_slug && (
                                                        <Button asChild variant="ghost" size="sm">
                                                            <a
                                                                href={`/o/${e.organizer_slug}/e/${e.slug}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                            >
                                                                <ExternalLink className="h-3.5 w-3.5" />
                                                            </a>
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {data.items.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                                                Sin resultados con los filtros actuales.
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
