import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    extractNuveiTransactionId,
    isApprovedNuveiResult,
    isBillingNuveiCheckout,
    nuveiPaymentUrl,
    openNuveiReferenceCheckout,
    type NuveiCheckoutConfig,
} from "@/lib/nuvei";

const NUVEI_PAID_RESULTS = new Set([
    "order_paid",
    "billing_completed",
    "already_paid",
    "pre_event_fee_paid",
    "season_pass_paid",
]);

export function SimulateBillingWebhookButton({
    config,
    onPaid,
}: {
    config: NuveiCheckoutConfig;
    onPaid?: () => void;
}) {
    const [devEnabled, setDevEnabled] = useState(false);
    const [simulating, setSimulating] = useState(false);

    useEffect(() => {
        api
            .get("/_dev/enabled")
            .then((r) => setDevEnabled(!!r.data?.enabled))
            .catch(() => setDevEnabled(false));
    }, []);

    if (!devEnabled || !isBillingNuveiCheckout(config)) return null;

    const simulate = async () => {
        setSimulating(true);
        try {
            const { data } = await api.post("/_dev/simulate-billing-paid", {
                intent_id: config.intent_id || undefined,
                session_id: config.client_unique_id || undefined,
            });
            if (data?.result === "billing_completed" || data?.already_paid) {
                toast.success("Webhook simulado. Plan activado.");
                onPaid?.();
                return;
            }
            toast.error("No se pudo simular el webhook de Nuvei");
        } catch (err: any) {
            toast.error(
                formatApiError(err?.response?.data?.detail) ||
                    err?.message ||
                    "No se pudo simular el webhook",
            );
        } finally {
            setSimulating(false);
        }
    };

    return (
        <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2"
            data-testid="simulate-billing-webhook"
        >
            <p className="text-xs text-amber-950">
                En local el webhook de Nuvei suele no llegar. Esto ejecuta la misma
                confirmación que Paymentez enviaría a TYS.
            </p>
            <Button
                type="button"
                variant="outline"
                className="w-full border-amber-300 bg-amber-100/80 text-amber-950 hover:bg-amber-200/70"
                disabled={simulating}
                onClick={simulate}
                data-testid="simulate-billing-webhook-btn"
            >
                {simulating ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Simulando webhook…
                    </>
                ) : (
                    "Simular respuesta del webhook"
                )}
            </Button>
        </div>
    );
}

type Props = {
    config: NuveiCheckoutConfig;
    onPaid?: () => void;
    onCancel?: () => void;
    hideSimulate?: boolean;
};

export default function NuveiCheckoutPanel({
    config,
    onPaid,
    onCancel,
    hideSimulate = false,
}: Props) {
    const paymentUrl = nuveiPaymentUrl(config);
    if (config.checkout_mode === "linktopay" && paymentUrl) {
        return (
            <LinkToPayCheckout
                config={config}
                paymentUrl={paymentUrl}
                onPaid={onPaid}
                onCancel={onCancel}
                hideSimulate={hideSimulate}
            />
        );
    }
    return (
        <JsCheckout
            config={config}
            onPaid={onPaid}
            onCancel={onCancel}
            hideSimulate={hideSimulate}
        />
    );
}

function LinkToPayCheckout({
    config,
    paymentUrl,
    onPaid,
    onCancel,
    hideSimulate = false,
}: {
    config: NuveiCheckoutConfig;
    paymentUrl: string;
    onPaid?: () => void;
    onCancel?: () => void;
    hideSimulate?: boolean;
}) {
    const [paying, setPaying] = useState(false);
    const [holdRedirect, setHoldRedirect] = useState(
        isBillingNuveiCheckout(config),
    );

    useEffect(() => {
        if (!isBillingNuveiCheckout(config)) {
            setHoldRedirect(false);
            return;
        }
        api
            .get("/_dev/enabled")
            .then((r) => setHoldRedirect(!!r.data?.enabled))
            .catch(() => setHoldRedirect(false));
    }, [config.intent_id, config.client_unique_id]);

    useEffect(() => {
        if (!paymentUrl || holdRedirect) return;
        setPaying(true);
        window.location.assign(paymentUrl);
    }, [paymentUrl, holdRedirect]);
    return (
        <div className="space-y-3" data-testid="nuvei-checkout-panel">
            <div className="rounded-xl border bg-card p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                    Vas a pagar en el enlace seguro de Nuvei (Paymentez). Al
                    terminar, Nuvei te devuelve a TYS y confirmamos el cobro.
                </p>
                {!paymentUrl ? (
                    <p className="text-sm text-destructive">
                        Falta el enlace de pago de Nuvei (Link to Pay).
                    </p>
                ) : (
                    <>
                        <Button
                            type="button"
                            className="w-full"
                            disabled={paying}
                            onClick={() => {
                                setPaying(true);
                                window.location.assign(paymentUrl);
                            }}
                            data-testid="nuvei-pay-button"
                        >
                            {paying ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Abriendo Nuvei…
                                </>
                            ) : (
                                <>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    {`Pagar USD $${Number(config.amount || 0).toFixed(2)}`}
                                </>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            Tarjeta de prueba stg: 4111111111111111 · 11/27 · CVV 634
                        </p>
                    </>
                )}
            </div>
            {!hideSimulate && <SimulateBillingWebhookButton config={config} onPaid={onPaid} />}
            {onCancel && (
                <button
                    type="button"
                    className="text-sm text-muted-foreground underline"
                    onClick={onCancel}
                    data-testid="nuvei-checkout-cancel"
                >
                    Cancelar
                </button>
            )}
        </div>
    );
}

function JsCheckout({
    config,
    onPaid,
    onCancel,
    hideSimulate = false,
}: {
    config: NuveiCheckoutConfig;
    onPaid?: () => void;
    onCancel?: () => void;
    hideSimulate?: boolean;
}) {
    const referenceOpenRef = useRef<(() => void) | null>(null);
    const referenceCloseRef = useRef<(() => void) | null>(null);
    const [booting, setBooting] = useState(true);
    const [gatewayVisible, setGatewayVisible] = useState(false);
    const missing = !(config.reference || config.session_token);

    const openGateway = () => {
        const open = referenceOpenRef.current;
        if (!open) {
            toast.error("El checkout de Nuvei todavía no está listo");
            return;
        }
        try {
            open();
        } catch (err: any) {
            toast.error(err?.message || "Error al abrir Nuvei");
        }
    };

    useEffect(() => {
        let cancelled = false;
        setBooting(true);
        (async () => {
            try {
                if (missing) {
                    setBooting(false);
                    return;
                }
                const handle = await openNuveiReferenceCheckout(config, {
                    onResponse: async (response) => {
                        if (cancelled) return;
                        if (!isApprovedNuveiResult(response)) {
                            toast.error("El pago no fue aprobado");
                            return;
                        }
                        const transactionId = extractNuveiTransactionId(response);
                        if (!transactionId) {
                            toast.error("Nuvei no devolvió transaction id");
                            return;
                        }
                        try {
                            const { data } = await api.post("/nuvei/confirm", {
                                transaction_id: transactionId,
                                client_unique_id: config.client_unique_id,
                                reference: config.reference || config.session_token,
                            });
                            if (!NUVEI_PAID_RESULTS.has(data?.result)) {
                                toast.error(
                                    "El pago se recibió pero aún no pudimos confirmarlo. " +
                                        "Contactá al organizador si el problema persiste.",
                                );
                                return;
                            }
                            toast.success("Pago confirmado");
                            onPaid?.();
                        } catch (err: any) {
                            toast.error(
                                formatApiError(err?.response?.data?.detail) ||
                                    err?.message ||
                                    "No pudimos confirmar el pago con Nuvei",
                            );
                        }
                    },
                    onError: (message) => {
                        toast.error(message || "Error de Nuvei");
                    },
                });
                if (cancelled) {
                    handle.close();
                    return;
                }
                referenceOpenRef.current = handle.open;
                referenceCloseRef.current = handle.close;
                setBooting(false);
                handle.open();
            } catch (err: any) {
                if (!cancelled) {
                    console.error("Nuvei checkout mount failed", err);
                    toast.error(err?.message || "No se pudo cargar el checkout Nuvei");
                    setBooting(false);
                }
            }
        })();
        const syncGatewayVisible = () => {
            setGatewayVisible(
                document.body.classList.contains("payment-checkout-enabled"),
            );
        };
        syncGatewayVisible();
        const observer = new MutationObserver(syncGatewayVisible);
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });
        return () => {
            cancelled = true;
            observer.disconnect();
            try {
                referenceCloseRef.current?.();
            } catch {
                /* ignore */
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        config.client_unique_id,
        config.reference,
        config.client_app_code,
        config.checkout_mode,
    ]);

    if (gatewayVisible) {
        const hidden = (
            <div data-testid="nuvei-checkout-panel" className="hidden" />
        );
        const simulate = hideSimulate ? null : (
            <div className="fixed bottom-4 right-4 z-[2147483001] max-w-sm">
                <SimulateBillingWebhookButton config={config} onPaid={onPaid} />
            </div>
        );
        if (typeof document === "undefined") return hidden;
        return (
            <>
                {createPortal(hidden, document.body)}
                {simulate ? createPortal(simulate, document.body) : null}
            </>
        );
    }

    const fallback = (
        <div
            className="fixed inset-x-0 bottom-0 z-[100] p-4 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/40"
            data-testid="nuvei-checkout-panel"
        >
            <div className="mx-auto w-full max-w-md rounded-xl border bg-background p-4 shadow-lg space-y-3">
                <p className="text-sm text-muted-foreground">
                    {booting
                        ? "Abriendo el formulario de Nuvei (Paymentez)…"
                        : "Si no ves el formulario de Nuvei, pulsá pagar de nuevo. No guardamos la tarjeta en TYS."}
                </p>
                {missing ? (
                    <p className="text-sm text-destructive">
                        Falta la reference de Nuvei (Checkout v3).
                    </p>
                ) : (
                    <>
                        <Button
                            type="button"
                            className="w-full"
                            disabled={booting}
                            onClick={openGateway}
                            data-testid="nuvei-pay-button"
                        >
                            {booting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Abriendo Nuvei…
                                </>
                            ) : (
                                `Pagar USD $${Number(config.amount || 0).toFixed(2)}`
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            Tarjeta de prueba stg: 4111111111111111 · 11/27 · CVV 634
                        </p>
                    </>
                )}
                {!hideSimulate && <SimulateBillingWebhookButton config={config} onPaid={onPaid} />}
                {onCancel && (
                    <button
                        type="button"
                        className="text-sm text-muted-foreground underline"
                        onClick={onCancel}
                        data-testid="nuvei-checkout-cancel"
                    >
                        Cancelar
                    </button>
                )}
            </div>
        </div>
    );

    if (typeof document === "undefined") return fallback;
    return createPortal(fallback, document.body);
}
