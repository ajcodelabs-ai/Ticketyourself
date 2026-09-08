/**
 * /billing/success — post-checkout landing for the organizer plan, mirrored
 * from the buyer's OrderSuccess: poll while pending, show a summary, and in
 * preview offer "Simular pago exitoso" so Nuvei webhooks are not required.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
    Building2,
    Calendar,
    CheckCircle2,
    CreditCard,
    Loader2,
    Mail,
    Sparkles,
    AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import {
    BILLING_INTENT_STATUS_META,
    billingPeriodLabel,
    clearBillingCheckout,
    isBillingIntentPending,
    loadBillingCheckout,
} from "@/lib/billingCheckout";
import { formatEventDate } from "@/lib/events";
import { formatCents } from "@/lib/orders";
import NuveiCheckoutPanel from "@/components/orders/NuveiCheckoutPanel";
import { nuveiCheckoutFromApi, nuveiPaymentUrl } from "@/lib/nuvei";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30;
const REDIRECT_SECONDS = 5;
const HERO_COLOR = "#4f46e5";

export default function BillingSuccess() {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get("session_id");
    const intentId = searchParams.get("intent_id");
    const { refreshOrganizer, organizer } = useAuth();
    const navigate = useNavigate();

    const [state, setState] = useState("loading");
    const [intent, setIntent] = useState(null);
    const [polls, setPolls] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [devEnabled, setDevEnabled] = useState(false);
    const [simulating, setSimulating] = useState(false);
    const [showNuvei, setShowNuvei] = useState(false);
    const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

    const storedCheckout = useMemo(
        () => loadBillingCheckout(sessionId),
        [sessionId, polls],
    );
    const nuvei = nuveiCheckoutFromApi(storedCheckout);

    useEffect(() => {
        api.get("/_dev/enabled").then((r) => setDevEnabled(!!r.data?.enabled)).catch(() => {});
    }, []);

    useEffect(() => {
        let alive = true;
        let timer = null;

        const fetchIntent = async () => {
            try {
                const params = new URLSearchParams();
                if (intentId) params.set("intent_id", intentId);
                else if (sessionId) params.set("session_id", sessionId);
                const qs = params.toString();
                const { data } = await api.get(qs ? `/billing/me/intent?${qs}` : "/billing/me/intent");
                if (!alive) return;
                setIntent(data);
                setState("ready");
                if (isBillingIntentPending(data.status) && polls < MAX_POLLS) {
                    timer = setTimeout(() => setPolls((p) => p + 1), POLL_INTERVAL_MS);
                }
                if (data.status === "completed") {
                    clearBillingCheckout(sessionId);
                    await refreshOrganizer();
                }
            } catch (e) {
                if (!alive) return;
                setState(e?.response?.status === 404 ? "notfound" : "error");
            }
        };

        fetchIntent();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, intentId, polls, reloadToken]);

    const isPending = isBillingIntentPending(intent?.status);
    const isPaid = intent?.status === "completed";

    useEffect(() => {
        if (!isPaid) return;
        if (countdown <= 0) {
            navigate("/app/dashboard", { replace: true });
            return;
        }
        const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown, isPaid, navigate]);

    const simulatePaid = async () => {
        setSimulating(true);
        try {
            await api.post("/_dev/simulate-billing-paid", {
                intent_id: intent?.id || intentId || undefined,
                session_id: intent?.session_id || sessionId || undefined,
            });
            toast.success("Pago simulado. Refrescando…");
            setPolls(0);
            setReloadToken((n) => n + 1);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSimulating(false);
        }
    };

    const backHref = organizer?.subscription_status === "none" ? "/onboarding" : "/app/configuracion";
    const backLabel =
        organizer?.subscription_status === "none" ? "← Volver al plan" : "← Volver a configuración";

    if (state === "loading") {
        return (
            <div className="min-h-[50vh] flex items-center justify-center" data-testid="billing-success-page">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (state === "notfound" || state === "error") {
        return (
            <div
                className="flex flex-col items-center justify-center px-6 py-16 text-center"
                data-testid="billing-success-page"
            >
                <AlertTriangle className="h-12 w-12 text-amber-500 mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Pago no encontrado</h1>
                <p className="text-muted-foreground max-w-md mb-6">
                    No encontramos este cobro de plan. Si ya pagaste, esperá un momento o
                    volvé a elegir el plan.
                </p>
                <Link to="/onboarding" className="underline text-primary">
                    Volver al plan
                </Link>
            </div>
        );
    }

    const status = BILLING_INTENT_STATUS_META[intent.status] || BILLING_INTENT_STATUS_META.pending;
    const payUrl = nuveiPaymentUrl(nuvei);

    return (
        <div className="py-2" data-testid="billing-success-page">
            <div className="max-w-3xl mx-auto space-y-6">
                <Link
                    to={backHref}
                    className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                    {backLabel}
                </Link>

                <div
                    className="rounded-2xl p-8 text-white shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${HERO_COLOR}, ${HERO_COLOR}aa)` }}
                >
                    <div className="flex flex-col gap-2">
                        <Badge className="bg-white/20 text-white border-0 w-fit">
                            Pago de plan
                            {intent.session_id ? ` · ${intent.session_id}` : ""}
                        </Badge>
                        <h1 className="text-3xl md:text-4xl font-bold" data-testid="billing-title">
                            {isPaid
                                ? "¡Listo, tu plan está activo!"
                                : "Procesando tu compra…"}
                        </h1>
                        <p className="text-white/85">
                            {intent.plan_name || intent.plan_code}
                            {intent.company_name ? ` · ${intent.company_name}` : ""}
                        </p>
                    </div>
                </div>

                <Card data-testid="billing-status-card">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">
                                Estado de la orden
                            </p>
                            <div className="flex items-center gap-2">
                                <Badge className={status.className} data-testid="billing-success-status-badge">
                                    {status.label}
                                </Badge>
                                {isPending && (
                                    <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Esperando confirmación del banco…
                                    </span>
                                )}
                                {isPaid && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Suscripción:{" "}
                                <b data-testid="billing-success-sub-status">
                                    {intent.subscription_status || organizer?.subscription_status || "none"}
                                </b>
                            </p>
                        </div>
                        <div className="text-right text-sm">
                            <div className="text-muted-foreground">Total</div>
                            <div className="font-semibold text-base">
                                {formatCents(intent.price_cents, intent.currency || "USD")}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <Row
                            label={
                                <span className="inline-flex items-center gap-1.5">
                                    <CreditCard className="h-3.5 w-3.5" />
                                    Plan
                                </span>
                            }
                            value={intent.plan_name || intent.plan_code}
                        />
                        <Row
                            label="Periodo"
                            value={billingPeriodLabel(intent.billing_period)}
                        />
                        <Row
                            label={
                                <span className="inline-flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" />
                                    Fecha
                                </span>
                            }
                            value={formatEventDate(intent.created_at)}
                        />
                        {intent.company_name && (
                            <Row
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <Building2 className="h-3.5 w-3.5" />
                                        Organización
                                    </span>
                                }
                                value={intent.company_name}
                            />
                        )}
                        {intent.email && (
                            <Row
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="h-3.5 w-3.5" />
                                        Email
                                    </span>
                                }
                                value={intent.email}
                            />
                        )}
                    </CardContent>
                </Card>

                {isPending && nuvei && (
                    <Card data-testid="billing-nuvei-pay">
                        <CardContent className="py-4 space-y-3">
                            {showNuvei ? (
                                <NuveiCheckoutPanel
                                    hideSimulate
                                    config={nuvei}
                                    onPaid={() => {
                                        setPolls(0);
                                        setReloadToken((n) => n + 1);
                                    }}
                                    onCancel={() => setShowNuvei(false)}
                                />
                            ) : (
                                <>
                                    <p className="text-sm text-muted-foreground">
                                        Completá el pago en Nuvei o, en preview, simulá la
                                        confirmación del banco.
                                    </p>
                                    <Button
                                        type="button"
                                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                                        data-testid="billing-nuvei-pay-btn"
                                        onClick={() => {
                                            if (payUrl) {
                                                window.location.assign(payUrl);
                                                return;
                                            }
                                            setShowNuvei(true);
                                        }}
                                    >
                                        Pagar con Nuvei
                                    </Button>
                                </>
                            )}
                        </CardContent>
                    </Card>
                )}

                {isPending && devEnabled && (
                    <Card className="border-amber-200 bg-amber-50" data-testid="simulate-card">
                        <CardContent className="py-4 flex items-center justify-between gap-3">
                            <div className="text-sm">
                                <p className="font-semibold flex items-center gap-1.5">
                                    <Sparkles className="h-4 w-4 text-amber-600" />
                                    Modo preview
                                </p>
                                <p className="text-muted-foreground">
                                    En preview los webhooks de Nuvei pueden no llegar. Podés
                                    simular el pago para activar el plan.
                                </p>
                            </div>
                            <Button
                                onClick={simulatePaid}
                                disabled={simulating}
                                className="bg-amber-600 hover:bg-amber-700"
                                data-testid="simulate-paid-btn"
                            >
                                {simulating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    "Simular pago exitoso"
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {isPaid && (
                    <div className="flex flex-wrap gap-3">
                        <Button
                            asChild
                            data-testid="billing-success-go-now"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            <Link to="/app/dashboard">Ir al dashboard ahora</Link>
                        </Button>
                        <span
                            data-testid="billing-success-countdown"
                            className="text-sm text-muted-foreground self-center"
                        >
                            Redirigiendo en {countdown}s…
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value }) {
    return (
        <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-right">{value}</span>
        </div>
    );
}
