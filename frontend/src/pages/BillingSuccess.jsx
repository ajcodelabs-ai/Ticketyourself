import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SECONDS = 5;

export default function BillingSuccess() {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get("session_id");
    const { refreshOrganizer, organizer } = useAuth();
    const navigate = useNavigate();
    const [countdown, setCountdown] = useState(SECONDS);
    const [activating, setActivating] = useState(true);
    const [activated, setActivated] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                // Try to fire the simulator (dev only). If it 404s, we silently ignore.
                if (sessionId) {
                    try {
                        await api.post("/stripe/_simulate_webhook", {
                            event_type: "checkout.session.completed",
                            session_id: sessionId,
                        });
                    } catch (err) {
                        // 404 is expected when this is a real webhook environment.
                        // Logged at warn level for diagnostics, never bubbled up.
                        console.warn("Webhook simulator skipped:", err?.message);
                    }
                }
                await refreshOrganizer();
                if (!mounted) return;
                setActivated(true);
            } catch (err) {
                if (mounted) setError(formatApiError(err?.response?.data?.detail));
            } finally {
                if (mounted) setActivating(false);
            }
        })();
        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    useEffect(() => {
        if (activating) return;
        if (countdown <= 0) {
            navigate("/dashboard", { replace: true });
            return;
        }
        const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown, activating, navigate]);

    return (
        <div data-testid="billing-success-page" className="max-w-xl space-y-6">
            <Badge variant="secondary" className="text-primary">
                Pago recibido
            </Badge>
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-2xl flex items-center gap-2">
                        {activating ? (
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : error ? (
                            <AlertCircle className="h-6 w-6 text-destructive" />
                        ) : (
                            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        )}
                        {activating
                            ? "Confirmando suscripción…"
                            : error
                              ? "Hubo un error confirmando"
                              : "¡Listo!"}
                    </CardTitle>
                    <CardDescription>
                        {error
                            ? error
                            : "Tu suscripción quedó activa. Te redirigimos al dashboard."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {organizer && (
                        <div className="text-sm text-muted-foreground">
                            Plan actual: <b>{organizer.plan_code || "—"}</b> · Suscripción:{" "}
                            <b data-testid="billing-success-sub-status">
                                {organizer.subscription_status}
                            </b>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <Button
                            asChild
                            data-testid="billing-success-go-now"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            <Link to="/dashboard">Ir al dashboard ahora</Link>
                        </Button>
                        {!activating && !error && (
                            <span
                                data-testid="billing-success-countdown"
                                className="text-sm text-muted-foreground self-center"
                            >
                                Redirigiendo en {countdown}s…
                            </span>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
