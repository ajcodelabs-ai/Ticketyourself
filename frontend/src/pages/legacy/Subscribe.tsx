import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { useTenant } from "@/contexts/TenantContext";
import api from "@/lib/api";
import { CreditCard, Loader2, Sparkles } from "lucide-react";

const PLANS = [
    {
        id: "basic",
        name: "Básico",
        price: 20,
        bullets: [
            "Microsite del organizador",
            "Hasta 3 eventos activos",
            "Reportes básicos",
        ],
    },
    {
        id: "pro",
        name: "Pro",
        price: 50,
        bullets: [
            "Eventos ilimitados",
            "Reportes avanzados",
            "Dominio personalizado (Fase 1+)",
        ],
        highlight: true,
    },
];

export default function Subscribe() {
    const { tenantSlug, tenant } = useTenant();
    const [plan, setPlan] = useState("basic");
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const submit = async () => {
        if (!tenantSlug) {
            toast.error("No hay tenant activo. Definí ?tenant=demo-org.");
            return;
        }
        setSubmitting(true);
        try {
            const { data } = await api.post(
                "/poc/stripe/create-subscription-session",
                {
                    tenant_slug: tenantSlug,
                    plan_name: plan,
                    origin_url: window.location.origin,
                },
            );
            if (!data?.checkout_url) {
                throw new Error("Stripe no devolvió checkout_url");
            }
            window.location.href = data.checkout_url;
        } catch (err) {
            const msg =
                err?.response?.data?.detail ||
                err?.message ||
                "Error creando la sesión";
            toast.error(`No se pudo crear la sesión: ${msg}`);
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="subscribe-page" className="space-y-8 max-w-3xl">
            <header className="space-y-3">
                <Badge variant="secondary" className="text-primary">
                    Suscripción de organizador
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Elegí un plan para{" "}
                    <span className="text-primary">
                        {tenant?.name || tenantSlug || "tu organización"}
                    </span>
                </h1>
                <p className="text-sm text-muted-foreground max-w-xl">
                    POC: se cobra el equivalente al primer mes como pago único
                    en Stripe test. La suscripción recurrente real se conecta
                    en Fase 1+.
                </p>
            </header>

            <div className="grid sm:grid-cols-2 gap-4">
                {PLANS.map((p) => {
                    const selected = plan === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            data-testid={`plan-${p.id}`}
                            onClick={() => setPlan(p.id)}
                            className={`text-left rounded-2xl border bg-card p-5 transition-all ${
                                selected
                                    ? "border-primary ring-2 ring-primary/30 tys-soft-shadow"
                                    : "border-border/70 hover:border-primary/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-lg">
                                    {p.name}
                                </span>
                                {p.highlight && (
                                    <Badge className="bg-primary text-primary-foreground">
                                        <Sparkles className="h-3 w-3 mr-1" />
                                        Recomendado
                                    </Badge>
                                )}
                            </div>
                            <div className="mt-3 flex items-baseline gap-1">
                                <span className="text-3xl font-semibold">
                                    ${p.price}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    /mes USD
                                </span>
                            </div>
                            <ul className="mt-4 space-y-1.5 text-sm text-foreground/80">
                                {p.bullets.map((b) => (
                                    <li key={b} className="flex gap-2">
                                        <span className="text-primary">•</span>
                                        {b}
                                    </li>
                                ))}
                            </ul>
                        </button>
                    );
                })}
            </div>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg">
                        Confirmar y pagar
                    </CardTitle>
                    <CardDescription>
                        Te redirigimos a Stripe Checkout (modo test).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                                Tenant
                            </Label>
                            <div
                                className="mt-1 text-sm font-medium"
                                data-testid="subscribe-tenant-label"
                            >
                                {tenant?.name || "—"}{" "}
                                <span className="text-muted-foreground font-normal">
                                    ({tenantSlug || "sin slug"})
                                </span>
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                                Plan
                            </Label>
                            <Select value={plan} onValueChange={setPlan}>
                                <SelectTrigger
                                    data-testid="plan-select"
                                    className="mt-1"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PLANS.map((p) => (
                                        <SelectItem
                                            key={p.id}
                                            value={p.id}
                                            data-testid={`plan-option-${p.id}`}
                                        >
                                            {p.name} — ${p.price}/mes
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                        <Button
                            onClick={submit}
                            disabled={submitting || !tenantSlug}
                            data-testid="subscribe-pay-btn"
                            size="lg"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Creando sesión…
                                </>
                            ) : (
                                <>
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    Ir a Stripe Checkout
                                </>
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => navigate("/")}
                            data-testid="subscribe-cancel-btn"
                        >
                            Volver
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
