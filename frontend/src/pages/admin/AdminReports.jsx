/**
 * /admin/reportes — single page with all CSV export buttons.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
    Download,
    Users,
    Ticket as TicketIcon,
    Receipt,
    FileText,
    Calendar,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import api, { formatApiError } from "@/lib/api";

const MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

async function downloadCsv(path, filename) {
    const res = await api.get(path, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

export default function AdminReports() {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [busy, setBusy] = useState(null);

    const handle = async (key, path, filename) => {
        setBusy(key);
        try {
            await downloadCsv(path, filename);
            toast.success("Reporte descargado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setBusy(null);
        }
    };

    const yearOptions = [today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2];

    return (
        <div className="space-y-5" data-testid="admin-reports-page">
            <header>
                <div className="text-sm text-muted-foreground">Reportes</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                    Exportar reportes
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Descargas CSV con BOM UTF-8 (compatibles con Excel).
                </p>
            </header>

            <div className="grid sm:grid-cols-2 gap-3" data-testid="reports-grid">
                <ReportCard
                    icon={<Users className="h-5 w-5" />}
                    title="Organizadores"
                    description="Listado completo con plan, estado, ingresos, tickets, eventos."
                    busy={busy === "orgs"}
                    onClick={() =>
                        handle("orgs", "/admin/export/organizers.csv", `organizadores_${today.toISOString().slice(0, 10)}.csv`)
                    }
                    testid="report-organizers"
                />
                <ReportCard
                    icon={<TicketIcon className="h-5 w-5" />}
                    title="Eventos"
                    description="Todos los eventos con organizer, GMV, fees, capacidad."
                    busy={busy === "events"}
                    onClick={() =>
                        handle("events", "/admin/export/events.csv", `eventos_${today.toISOString().slice(0, 10)}.csv`)
                    }
                    testid="report-events"
                />
                <ReportCard
                    icon={<Receipt className="h-5 w-5" />}
                    title="Órdenes"
                    description="Todas las órdenes con buyer, monto, método, estado, fechas."
                    busy={busy === "orders"}
                    onClick={() =>
                        handle("orders", "/admin/export/orders.csv", `ordenes_${today.toISOString().slice(0, 10)}.csv`)
                    }
                    testid="report-orders"
                />
                <ReportCard
                    icon={<FileText className="h-5 w-5" />}
                    title="Auditoría"
                    description="Registro completo de acciones administrativas."
                    busy={busy === "audit"}
                    onClick={() =>
                        handle("audit", "/admin/export/audit-log.csv", `auditoria_${today.toISOString().slice(0, 10)}.csv`)
                    }
                    testid="report-audit"
                />
            </div>

            <Card data-testid="monthly-report-card">
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-orange-600" />
                        Reporte ejecutivo mensual
                    </CardTitle>
                    <CardDescription>
                        Agregado por organizer con totales del mes seleccionado.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                        <label className="text-xs uppercase font-medium">Año</label>
                        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                            <SelectTrigger className="w-28" data-testid="report-year">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {yearOptions.map((y) => (
                                    <SelectItem key={y} value={String(y)}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs uppercase font-medium">Mes</label>
                        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                            <SelectTrigger className="w-36" data-testid="report-month">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MONTH_NAMES.map((n, i) => (
                                    <SelectItem key={n} value={String(i + 1)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        onClick={() =>
                            handle(
                                "monthly",
                                `/admin/export/monthly-report.csv?year=${year}&month=${month}`,
                                `reporte_mensual_${year}_${String(month).padStart(2, "0")}.csv`,
                            )
                        }
                        disabled={busy === "monthly"}
                        className="bg-orange-600 hover:bg-orange-700"
                        data-testid="report-monthly-download"
                    >
                        {busy === "monthly" ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4 mr-1.5" />
                        )}
                        Descargar
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

function ReportCard({ icon, title, description, onClick, busy, testid }) {
    return (
        <Card data-testid={testid}>
            <CardHeader className="flex flex-row items-start gap-3">
                <div className="rounded-lg bg-orange-100 text-orange-600 p-2 shrink-0">
                    {icon}
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{title}</CardTitle>
                    <CardDescription className="text-xs mt-1">{description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent>
                <Button onClick={onClick} disabled={busy} variant="outline" className="w-full">
                    {busy ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                        <Download className="h-4 w-4 mr-1.5" />
                    )}
                    Descargar CSV
                </Button>
            </CardContent>
        </Card>
    );
}
