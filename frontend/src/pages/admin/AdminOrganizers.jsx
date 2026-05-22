import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { Search } from "lucide-react";

const STATUSES = [
    { value: "__all", label: "Todos" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "suspended", label: "Suspended" },
];

const STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    suspended: "bg-zinc-200 text-zinc-700",
};

export default function AdminOrganizers() {
    const [status, setStatus] = useState("__all");
    const [search, setSearch] = useState("");
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page: 1, limit: 50 };
            if (status !== "__all") params.status = status;
            if (search.trim()) params.search = search.trim();
            const { data } = await api.get("/admin/organizers", { params });
            setItems(data.items || []);
            setTotal(data.total || 0);
        } finally {
            setLoading(false);
        }
    }, [status, search]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div data-testid="admin-organizers-page" className="space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Admin · Organizadores
                </Badge>
                <h1 className="text-3xl font-semibold tracking-tight">
                    Organizadores ({total})
                </h1>
            </header>

            <Card className="border-border/70">
                <CardContent className="pt-6 space-y-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="flex-1 min-w-[240px]">
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
                            <SelectTrigger
                                data-testid="admin-orgs-status-filter"
                                className="w-[180px]"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {STATUSES.map((s) => (
                                    <SelectItem
                                        key={s.value}
                                        value={s.value}
                                        data-testid={`status-option-${s.value}`}
                                    >
                                        {s.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            onClick={load}
                            data-testid="admin-orgs-refresh"
                        >
                            Refrescar
                        </Button>
                    </div>

                    <Table data-testid="admin-orgs-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Organizador</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Plan</TableHead>
                                <TableHead className="text-right">Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && items.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={6}
                                        className="text-center py-8 text-muted-foreground"
                                    >
                                        Cargando…
                                    </TableCell>
                                </TableRow>
                            ) : items.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={6}
                                        className="text-center py-10 text-muted-foreground"
                                        data-testid="admin-orgs-empty"
                                    >
                                        No hay organizadores que coincidan.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                items.map((o) => (
                                    <TableRow
                                        key={o.id}
                                        data-testid={`admin-org-row-${o.id}`}
                                    >
                                        <TableCell className="font-medium">
                                            {o.company_name}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {o.email}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {o.slug}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                className={STATUS_STYLE[o.status] || ""}
                                                data-testid={`admin-org-status-${o.id}`}
                                            >
                                                {o.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {o.plan_code || "—"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                asChild
                                                size="sm"
                                                variant="outline"
                                                data-testid={`admin-org-view-${o.id}`}
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
                </CardContent>
            </Card>
        </div>
    );
}
