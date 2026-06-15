import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import api, { formatApiError } from "@/lib/api";

export default function AdminPlans() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get("/admin/plans");
            setPlans(data || []);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggleActive = async (plan) => {
        try {
            await api.patch(`/admin/plans/${plan.code}`, { active: !plan.active });
            toast.success(`Plan ${plan.code} ${!plan.active ? "activado" : "desactivado"}`);
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
    };

    return (
        <div data-testid="admin-plans-page" className="space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Admin · Planes
                </Badge>
                <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
                <p className="text-sm text-muted-foreground">
                    Activá o desactivá planes. Borrar sólo se permite si no hay organizadores suscritos.
                </p>
            </header>

            <Card className="border-border/70">
                <CardContent className="pt-6">
                    <Table data-testid="admin-plans-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Precio</TableHead>
                                <TableHead>Periodicidad</TableHead>
                                <TableHead>Activo</TableHead>
                                <TableHead>Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && plans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        Cargando…
                                    </TableCell>
                                </TableRow>
                            ) : (
                                plans.map((p) => (
                                    <TableRow key={p.id} data-testid={`admin-plan-row-${p.code}`}>
                                        <TableCell className="font-mono text-xs">
                                            {p.code}
                                        </TableCell>
                                        <TableCell className="font-medium">{p.name}</TableCell>
                                        <TableCell>
                                            ${(p.price_cents / 100).toFixed(2)}
                                        </TableCell>
                                        <TableCell className="capitalize">
                                            {p.billing_period === "monthly" ? "mensual" : "único"}
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={p.active}
                                                onCheckedChange={() => toggleActive(p)}
                                                data-testid={`admin-plan-switch-${p.code}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                data-testid={`admin-plan-delete-${p.code}`}
                                                onClick={async () => {
                                                    try {
                                                        await api.delete(`/admin/plans/${p.code}`);
                                                        toast.success("Plan eliminado");
                                                        load();
                                                    } catch (err) {
                                                        toast.error(
                                                            formatApiError(err?.response?.data?.detail) ||
                                                                err.message,
                                                        );
                                                    }
                                                }}
                                            >
                                                Borrar
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
