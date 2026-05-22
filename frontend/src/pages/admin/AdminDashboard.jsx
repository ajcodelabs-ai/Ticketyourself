import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";
import { Users, CheckCircle2, Clock, XCircle, CreditCard, BarChart3 } from "lucide-react";

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/admin/dashboard/stats");
                setStats(data);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <div data-testid="admin-dashboard" className="space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Panel admin
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Resumen del sistema
                </h1>
            </header>

            <section className="grid md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard
                    icon={<Users className="h-5 w-5" />}
                    label="Organizadores"
                    value={stats?.organizers_total ?? "—"}
                    loading={loading}
                    testid="stat-total"
                />
                <StatCard
                    icon={<Clock className="h-5 w-5 text-amber-600" />}
                    label="Pendientes"
                    value={stats?.organizers_pending ?? "—"}
                    loading={loading}
                    testid="stat-pending"
                />
                <StatCard
                    icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                    label="Aprobados"
                    value={stats?.organizers_approved ?? "—"}
                    loading={loading}
                    testid="stat-approved"
                />
                <StatCard
                    icon={<XCircle className="h-5 w-5 text-red-600" />}
                    label="Rechazados"
                    value={stats?.organizers_rejected ?? "—"}
                    loading={loading}
                    testid="stat-rejected"
                />
                <StatCard
                    icon={<CreditCard className="h-5 w-5 text-primary" />}
                    label="Suscripciones activas"
                    value={stats?.active_subscriptions ?? "—"}
                    loading={loading}
                    testid="stat-active"
                />
                <StatCard
                    icon={<BarChart3 className="h-5 w-5 text-primary" />}
                    label="MRR estimado"
                    value={stats ? `$${(stats.monthly_revenue_estimate_cents / 100).toFixed(0)}` : "—"}
                    loading={loading}
                    testid="stat-mrr"
                />
            </section>

            <div className="flex gap-3">
                <Link
                    to="/admin/organizadores"
                    className="text-sm text-primary hover:underline"
                    data-testid="admin-dash-goto-orgs"
                >
                    Ver lista de organizadores →
                </Link>
                <Link
                    to="/admin/planes"
                    className="text-sm text-primary hover:underline"
                    data-testid="admin-dash-goto-plans"
                >
                    Gestionar planes →
                </Link>
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, loading, testid }) {
    return (
        <Card className="border-border/70" data-testid={testid}>
            <CardContent className="pt-6 space-y-2">
                <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center">
                    {icon}
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {label}
                </div>
                <div className="text-2xl font-semibold">
                    {loading ? "—" : value}
                </div>
            </CardContent>
        </Card>
    );
}
