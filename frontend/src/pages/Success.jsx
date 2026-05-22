import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    CheckCircle2,
    Clock,
    AlertCircle,
    Loader2,
    Receipt,
} from "lucide-react";

import { useTenant } from "@/contexts/TenantContext";
import api from "@/lib/api";

const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 2000;

export default function Success() {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get("session_id");
    const { tenantSlug, tenant } = useTenant();

    const [attempts, setAttempts] = useState(0);
    const [stripeStatus, setStripeStatus] = useState(null); // payment_status from Stripe
    const [dbStatus, setDbStatus] = useState(null); // status in our DB
    const [amount, setAmount] = useState(null);
    const [currency, setCurrency] = useState(null);
    const [error, setError] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const stopRef = useRef(false);

    const poll = useCallback(async () => {
        if (!sessionId) return;
        try {
            const { data } = await api.get(`/poc/stripe/status/${sessionId}`);
            setStripeStatus(data.payment_status);
            setDbStatus(data.db_status);
            setAmount(data.amount_total);
            setCurrency(data.currency);
            return data.payment_status === "paid" || data.status === "expired";
        } catch (e) {
            setError(
                e?.response?.data?.detail || e?.message || "Error al consultar",
            );
            return true; // stop on error
        }
    }, [sessionId]);

    useEffect(() => {
        stopRef.current = false;
        if (!sessionId) return;
        let attempt = 0;
        const run = async () => {
            if (stopRef.current) return;
            const done = await poll();
            attempt += 1;
            setAttempts(attempt);
            if (done) return;
            if (attempt >= MAX_ATTEMPTS) {
                setTimedOut(true);
                return;
            }
            setTimeout(run, POLL_INTERVAL_MS);
        };
        run();
        return () => {
            stopRef.current = true;
        };
    }, [sessionId, poll]);

    const isPaid = stripeStatus === "paid" || dbStatus === "paid";
    const isPending = !isPaid && !error && !timedOut;

    return (
        <div data-testid="success-page" className="space-y-6 max-w-2xl">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Resultado del pago
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    {isPaid
                        ? "Pago confirmado"
                        : error
                          ? "Hubo un error"
                          : timedOut
                            ? "Aún no confirmado"
                            : "Procesando pago…"}
                </h1>
                {tenant && (
                    <p className="text-sm text-muted-foreground">
                        Tenant: <b>{tenant.name}</b> ({tenantSlug})
                    </p>
                )}
            </header>

            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        {isPaid ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : error ? (
                            <AlertCircle className="h-5 w-5 text-destructive" />
                        ) : timedOut ? (
                            <Clock className="h-5 w-5 text-amber-600" />
                        ) : (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        )}
                        Sesión de Stripe
                    </CardTitle>
                    <CardDescription>
                        ID:{" "}
                        <code
                            data-testid="success-session-id"
                            className="text-xs"
                        >
                            {sessionId || "—"}
                        </code>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <Row
                        label="Estado en Stripe"
                        value={stripeStatus || "—"}
                        testid="row-stripe-status"
                    />
                    <Row
                        label="Estado en DB"
                        value={dbStatus || "—"}
                        testid="row-db-status"
                    />
                    <Row
                        label="Monto"
                        value={
                            amount != null
                                ? `${(amount / 100).toFixed(2)} ${(
                                      currency || "usd"
                                  ).toUpperCase()}`
                                : "—"
                        }
                        testid="row-amount"
                    />
                    <Row
                        label="Intentos de polling"
                        value={`${attempts} / ${MAX_ATTEMPTS}`}
                        testid="row-attempts"
                    />

                    {isPending && (
                        <p className="text-xs text-muted-foreground pt-1">
                            Reintentamos cada {POLL_INTERVAL_MS / 1000}s. Si el
                            webhook llega antes, esto se actualiza solo.
                        </p>
                    )}
                    {timedOut && !isPaid && (
                        <p
                            className="text-xs text-amber-700 pt-1"
                            data-testid="success-timeout-msg"
                        >
                            El pago aún no aparece como confirmado. Refrescá la
                            página o revisá la lista de pagos.
                        </p>
                    )}
                    {error && (
                        <p
                            className="text-xs text-destructive pt-1"
                            data-testid="success-error-msg"
                        >
                            {error}
                        </p>
                    )}
                </CardContent>
            </Card>

            <div className="flex flex-wrap gap-3">
                <Button
                    asChild
                    data-testid="success-go-payments"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                    <Link to="/poc/payments">
                        <Receipt className="h-4 w-4 mr-2" />
                        Ver pagos del tenant
                    </Link>
                </Button>
                <Button asChild variant="outline" data-testid="success-go-home">
                    <Link to="/">Volver al inicio</Link>
                </Button>
            </div>
        </div>
    );
}

function Row({ label, value, testid }) {
    return (
        <div className="flex justify-between gap-4 border-b border-border/60 last:border-0 py-2">
            <span className="text-muted-foreground">{label}</span>
            <span data-testid={testid} className="font-medium text-right break-all">
                {value}
            </span>
        </div>
    );
}
