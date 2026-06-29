/**
 * /admin/auditoria — audit log viewer.
 */
import { useEffect, useState } from "react";
import { Loader2, Download, Search, Eye } from "lucide-react";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import api, { formatApiError } from "@/lib/api";

const ACTION_BADGES = {
    approve_organizer: "bg-emerald-100 text-emerald-800",
    reject_organizer: "bg-red-100 text-red-800",
    suspend: "bg-amber-100 text-amber-800",
    confirm_manual_payment: "bg-emerald-100 text-emerald-800",
    reject_manual_payment: "bg-red-100 text-red-800",
    force_cancel_event: "bg-red-100 text-red-800",
    plan_create: "bg-sky-100 text-sky-800",
    plan_update: "bg-sky-100 text-sky-800",
    plan_delete: "bg-slate-200 text-slate-700",
};

const TARGET_TYPES = [
    { value: "all", label: "Todos" },
    { value: "organizer", label: "Organizador" },
    { value: "ticket_order", label: "Orden" },
    { value: "event", label: "Evento" },
    { value: "plan", label: "Plan" },
    { value: "user", label: "Usuario" },
];

export default function AdminAuditLog() {
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState("");
    const [targetType, setTargetType] = useState("all");
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: "50" });
            if (action) params.set("action", action);
            if (targetType !== "all") params.set("target_type", targetType);
            const { data: d } = await api.get(`/admin/audit-log?${params}`);
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
    }, [targetType, page]);

    const downloadCsv = async () => {
        try {
            const params = new URLSearchParams();
            if (action) params.set("action", action);
            if (targetType !== "all") params.set("target_type", targetType);
            const res = await api.get(`/admin/export/audit-log.csv?${params}`, {
                responseType: "blob",
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    return (
        <div className="space-y-5" data-testid="admin-audit-page">
            <header className="flex flex-wrap justify-between items-end gap-3">
                <div>
                    <div className="text-sm text-muted-foreground">Auditoría</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Registro de acciones
                    </h1>
                </div>
                <Button variant="outline" onClick={downloadCsv} data-testid="audit-csv">
                    <Download className="h-4 w-4 mr-1.5" />
                    Exportar CSV
                </Button>
            </header>

            <Card>
                <CardContent className="py-4 flex flex-wrap gap-2">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            setPage(1);
                            load();
                        }}
                        className="flex gap-2 flex-1 min-w-[200px]"
                    >
                        <Input
                            placeholder="Buscar acción (ej: approve_organizer)…"
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            data-testid="audit-action-filter"
                        />
                        <Button type="submit" variant="outline">
                            <Search className="h-4 w-4" />
                        </Button>
                    </form>
                    <Select value={targetType} onValueChange={setTargetType}>
                        <SelectTrigger className="w-44" data-testid="audit-target-filter">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TARGET_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                        {data.total} entrada(s)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table data-testid="audit-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Actor</TableHead>
                                        <TableHead>Acción</TableHead>
                                        <TableHead>Target</TableHead>
                                        <TableHead>Metadata</TableHead>
                                        <TableHead></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.items.map((it) => {
                                        const metaJson = JSON.stringify(it.metadata || {});
                                        return (
                                            <TableRow key={it.id || `${it.created_at}-${it.action}`}>
                                                <TableCell className="text-xs whitespace-nowrap">
                                                    {new Date(it.created_at).toLocaleString("es-EC")}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {it.actor?.email || (
                                                        <span className="text-muted-foreground">sistema</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={ACTION_BADGES[it.action] || "bg-slate-100 text-slate-700"}
                                                    >
                                                        {it.action}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <div>{it.target_type}</div>
                                                    <code className="text-muted-foreground font-mono text-[10px]">
                                                        {(it.target_id || "").slice(0, 16)}
                                                    </code>
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                                                    {metaJson.slice(0, 200)}
                                                </TableCell>
                                                <TableCell>
                                                    {Object.keys(it.metadata || {}).length > 0 && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setDetail(it)}
                                                            data-testid="audit-view-detail"
                                                        >
                                                            <Eye className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {data.items.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                                Sin entradas con esos filtros.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {data.total > 50 && (
                        <div className="flex justify-between items-center pt-3 text-sm">
                            <span className="text-muted-foreground">Página {page}</span>
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
                                    disabled={page * 50 >= data.total}
                                >
                                    Siguiente →
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
                <DialogContent className="max-w-2xl" data-testid="audit-detail-dialog">
                    {detail && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{detail.action}</DialogTitle>
                                <DialogDescription>
                                    {new Date(detail.created_at).toLocaleString("es-EC")} ·
                                    {detail.target_type} · {detail.target_id}
                                </DialogDescription>
                            </DialogHeader>
                            <pre className="bg-secondary/40 border rounded-lg p-3 text-xs overflow-x-auto max-h-[60vh]">
                                {JSON.stringify(detail.metadata || {}, null, 2)}
                            </pre>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
