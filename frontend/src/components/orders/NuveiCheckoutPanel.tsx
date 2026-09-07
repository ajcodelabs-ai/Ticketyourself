import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    extractNuveiTransactionId,
    isApprovedNuveiResult,
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

type Props = {
    config: NuveiCheckoutConfig;
    onPaid?: () => void;
    onCancel?: () => void;
};

export default function NuveiCheckoutPanel({ config, onPaid, onCancel }: Props) {
    const paymentUrl = nuveiPaymentUrl(config);
    if (config.checkout_mode === "linktopay" && paymentUrl) {
        return (
            <LinkToPayCheckout
                config={config}
                paymentUrl={paymentUrl}
                onCancel={onCancel}
            />
        );
    }
    return <JsCheckout config={config} onPaid={onPaid} onCancel={onCancel} />;
}

function LinkToPayCheckout({
    config,
    paymentUrl,
    onCancel,
}: {
    config: NuveiCheckoutConfig;
    paymentUrl: string;
    onCancel?: () => void;
}) {
    const [paying, setPaying] = useState(false);

    useEffect(() => {
        if (!paymentUrl) return;
        setPaying(true);
        window.location.assign(paymentUrl);
    }, [paymentUrl]);
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
}: {
    config: NuveiCheckoutConfig;
    onPaid?: () => void;
    onCancel?: () => void;
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
        return typeof document === "undefined"
            ? hidden
            : createPortal(hidden, document.body);
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
