/**
 * Admin Activation Funnel page.
 * GET /api/admin/activation-funnel → render horizontal bar chart with conversion %.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import api, { formatApiError } from "@/lib/api";
import { Loader2, TrendingDown, Mail, MousePointerClick, FileText, ListChecks, CreditCard, BadgeCheck } from "lucide-react";

const STEP_META = {
    email_sent: { label: "Email enviado", icon: Mail },
    link_clicked: { label: "Link clickeado", icon: MousePointerClick },
    first_doc_uploaded: { label: "Primer documento", icon: FileText },
    plan_selected: { label: "Plan elegido", icon: ListChecks },
    checkout_started: { label: "Checkout iniciado", icon: CreditCard },
    subscription_active: { label: "Suscripción activa", icon: BadgeCheck },
};

function fmtPct(v) {
    if (!Number.isFinite(v)) return "—";
    return `${Math.round(v * 100)}%`;
}

export default function AdminFunnel() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        api.get("/admin/activation-funnel")
            .then((r) => alive && setData(r.data))
            .catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, []);

    const maxCount = Math.max(1, ...((data?.steps || []).map((s) => s.count)));

    return (
        <div className="space-y-6" data-testid="admin-funnel-page">
            <div>
                <h1 className="text-2xl font-semibold">Funnel de activación</h1>
                <p className="text-sm text-muted-foreground">
                    Cada organizador registrado avanza a través de estos pasos. La conversión
                    se calcula contra el paso inmediato anterior.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : !data ? (
                <p className="text-muted-foreground">No hay datos disponibles.</p>
            ) : (
                <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Pasos</CardTitle>
                            <CardDescription>
                                Total acumulado de organizadores que alcanzaron cada paso.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {data.steps.map((s) => {
                                const meta = STEP_META[s.event] || { label: s.event, icon: FileText };
                                const Icon = meta.icon;
                                const widthPct = (s.count / maxCount) * 100;
                                return (
                                    <div
                                        key={s.event}
                                        className="space-y-1.5"
                                        data-testid={`funnel-row-${s.event}`}
                                    >
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2 font-medium">
                                                <Icon className="h-4 w-4 text-primary" />
                                                {meta.label}
                                            </span>
                                            <span className="tabular-nums text-muted-foreground">
                                                <strong className="text-foreground">{s.count}</strong>
                                                {" · "}
                                                {fmtPct(s.conversion_from_prev)}
                                            </span>
                                        </div>
                                        <div className="h-3 w-full rounded-full bg-secondary/60 overflow-hidden">
                                            <div
                                                className="h-full bg-primary transition-all"
                                                style={{ width: `${Math.max(2, widthPct)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <TrendingDown className="h-4 w-4 text-amber-500" />
                                Lectura rápida
                            </CardTitle>
                            <CardDescription>
                                Dónde estamos perdiendo más activaciones.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ol className="space-y-2 text-sm">
                                {data.steps.slice(1).map((s, i) => {
                                    const prev = data.steps[i];
                                    const drop = prev.count - s.count;
                                    return (
                                        <li key={s.event} className="flex justify-between">
                                            <span>
                                                {STEP_META[prev.event]?.label} → {STEP_META[s.event]?.label}
                                            </span>
                                            <span
                                                className={
                                                    drop > 0
                                                        ? "tabular-nums text-amber-700 font-medium"
                                                        : "tabular-nums text-emerald-700 font-medium"
                                                }
                                            >
                                                {drop > 0 ? `-${drop}` : "0"}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
