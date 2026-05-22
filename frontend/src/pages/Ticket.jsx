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
import { Input } from "@/components/ui/input";

import { useTenant } from "@/contexts/TenantContext";
import api from "@/lib/api";
import { TicketIcon, Loader2 } from "lucide-react";

export default function Ticket() {
    const { tenantSlug, tenant } = useTenant();
    const [eventName, setEventName] = useState("Concierto POC");
    const [amountUsd, setAmountUsd] = useState("15.00");
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const submit = async () => {
        if (!tenantSlug) {
            toast.error("No hay tenant activo. Definí ?tenant=demo-org.");
            return;
        }
        const amountFloat = parseFloat(amountUsd);
        if (!eventName.trim()) {
            toast.error("Ingresá un nombre de evento.");
            return;
        }
        if (!amountFloat || amountFloat <= 0) {
            toast.error("Ingresá un monto mayor a 0.");
            return;
        }
        setSubmitting(true);
        try {
            const { data } = await api.post(
                "/poc/stripe/create-ticket-session",
                {
                    tenant_slug: tenantSlug,
                    event_name: eventName.trim(),
                    amount_cents: Math.round(amountFloat * 100),
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
        <div data-testid="ticket-page" className="space-y-8 max-w-2xl">
            <header className="space-y-3">
                <Badge variant="secondary" className="text-primary">
                    Compra de ticket
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Comprar ticket en{" "}
                    <span className="text-primary">
                        {tenant?.name || tenantSlug || "tu organización"}
                    </span>
                </h1>
                <p className="text-sm text-muted-foreground max-w-xl">
                    POC: cargo único en Stripe test, monto definido aquí.
                </p>
            </header>

            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-lg">
                        Detalles del ticket
                    </CardTitle>
                    <CardDescription>
                        Tarjeta de prueba:{" "}
                        <code className="text-xs px-1 py-0.5 rounded bg-secondary text-secondary-foreground">
                            4242 4242 4242 4242
                        </code>{" "}
                        cualquier fecha futura, CVC{" "}
                        <code className="text-xs px-1 py-0.5 rounded bg-secondary text-secondary-foreground">
                            123
                        </code>
                        .
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="event-name-input">Nombre del evento</Label>
                        <Input
                            id="event-name-input"
                            data-testid="event-name-input"
                            value={eventName}
                            onChange={(e) => setEventName(e.target.value)}
                            placeholder="Ej. Concierto POC"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="amount-input">Monto (USD)</Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                $
                            </span>
                            <Input
                                id="amount-input"
                                data-testid="amount-input"
                                value={amountUsd}
                                onChange={(e) => setAmountUsd(e.target.value)}
                                placeholder="15.00"
                                inputMode="decimal"
                                className="pl-7"
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Se convertirá a centavos al enviar al backend.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                        <Button
                            onClick={submit}
                            disabled={submitting || !tenantSlug}
                            data-testid="ticket-pay-btn"
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
                                    <TicketIcon className="h-4 w-4 mr-2" />
                                    Pagar con Stripe
                                </>
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => navigate("/")}
                            data-testid="ticket-cancel-btn"
                        >
                            Volver
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
