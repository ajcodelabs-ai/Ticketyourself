import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    extractNuveiTransactionId,
    isApprovedNuveiResult,
    mountNuveiTokenizeForm,
    openNuveiReferenceCheckout,
    type NuveiCheckoutConfig,
} from "@/lib/nuvei";

// A 200 from /nuvei/confirm or /nuvei/charge isn't itself proof of payment —
// the backend also returns 200 for e.g. "ignored_amount_mismatch" so it can
// tell Nuvei/Paymentez not to retry. Only these results mean the order/plan
// was actually finalized as paid.
const NUVEI_PAID_RESULTS = new Set([
    "order_paid",
    "billing_completed",
    "already_paid",
    "pre_event_fee_paid",
]);

type Props = {
    config: NuveiCheckoutConfig;
    onPaid: () => void;
    onCancel?: () => void;
};

function friendlyNuveiError(raw: string): string {
    const t = (raw || "").toLowerCase();
    if (t.includes("invalid credentials") || t.includes("authorizationerror")) {
        return (
            "Nuvei rechazó las credenciales para tokenize. " +
            "generate_tokenize solo acepta el par CLIENT (SERVER → 401). " +
            "Usá checkout por reference (SERVER) o pedí CLIENT habilitado."
        );
    }
    if (
        t.includes("wrappedattributeerror") ||
        t.includes("nonetype") ||
        t.includes("attribute 'enable'")
    ) {
        return (
            "Nuvei rechazó generate_tokenize (CLIENT mal configurado en stg). " +
            "Pedí a soporte que activen tokenization, o usá modo reference."
        );
    }
    return raw || "Error de Nuvei";
}

export default function NuveiCheckoutPanel({ config, onPaid, onCancel }: Props) {
    const mode = (config.checkout_mode || "reference").toLowerCase();
    const isReference = mode === "reference" || mode === "client";
    const reactId = useId().replace(/:/g, "");
    const containerId = `nuvei-tokenize-${reactId}`;
    const tokenizeRef = useRef<(() => void) | null>(null);
    const referenceOpenRef = useRef<(() => void) | null>(null);
    const referenceCloseRef = useRef<(() => void) | null>(null);
    const [booting, setBooting] = useState(true);
    const [paying, setPaying] = useState(false);
    const missingTokenizeCreds =
        !isReference && (!config.client_app_code || !config.client_app_key);
    const missingReference = isReference && !(config.reference || config.session_token);

    useEffect(() => {
        let cancelled = false;
        setBooting(true);

        (async () => {
            try {
                if (isReference) {
                    if (missingReference) {
                        setBooting(false);
                        return;
                    }
                    const handle = await openNuveiReferenceCheckout(config, {
                        onResponse: async (response) => {
                            if (cancelled) return;
                            if (!isApprovedNuveiResult(response)) {
                                toast.error("El pago no fue aprobado");
                                setPaying(false);
                                return;
                            }
                            const transactionId = extractNuveiTransactionId(response);
                            if (!transactionId) {
                                toast.error("Nuvei no devolvió transaction id");
                                setPaying(false);
                                return;
                            }
                            setPaying(true);
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
                                onPaid();
                            } catch (err: any) {
                                toast.error(
                                    formatApiError(err?.response?.data?.detail) ||
                                        err?.message ||
                                        "No pudimos confirmar el pago con Nuvei",
                                );
                            } finally {
                                setPaying(false);
                            }
                        },
                        onError: (message) => {
                            toast.error(friendlyNuveiError(message));
                            setPaying(false);
                        },
                    });
                    if (!cancelled) {
                        referenceOpenRef.current = handle.open;
                        referenceCloseRef.current = handle.close;
                        setBooting(false);
                        // Open immediately so the user sees the Paymentez modal.
                        handle.open();
                    }
                    return;
                }

                if (missingTokenizeCreds) {
                    setBooting(false);
                    return;
                }
                await new Promise<void>((r) => requestAnimationFrame(() => r()));
                if (cancelled) return;
                const handle = await mountNuveiTokenizeForm(config, {
                    containerSelector: `#${containerId}`,
                    onToken: async (token) => {
                        if (cancelled) return;
                        setPaying(true);
                        try {
                            const { data } = await api.post("/nuvei/charge", {
                                card_token: token,
                                client_unique_id: config.client_unique_id,
                                amount_cents: Math.round(Number(config.amount) * 100),
                                currency: config.currency || "USD",
                                email: config.user_email,
                                user_id: config.user_id,
                                description: config.order_description,
                            });
                            if (!NUVEI_PAID_RESULTS.has(data?.result)) {
                                toast.error(
                                    "El pago se recibió pero aún no pudimos confirmarlo. " +
                                        "Contactá al organizador si el problema persiste.",
                                );
                                return;
                            }
                            toast.success("Pago confirmado");
                            onPaid();
                        } catch (err: any) {
                            toast.error(
                                formatApiError(err?.response?.data?.detail) ||
                                    err?.message ||
                                    "No pudimos completar el cobro con Nuvei",
                            );
                        } finally {
                            setPaying(false);
                        }
                    },
                    onError: (message) => {
                        toast.error(friendlyNuveiError(message));
                        setPaying(false);
                    },
                });
                if (!cancelled) {
                    tokenizeRef.current = handle.tokenize;
                    setBooting(false);
                }
            } catch (err: any) {
                if (!cancelled) {
                    console.error("Nuvei checkout mount failed", err);
                    toast.error(
                        friendlyNuveiError(
                            err?.message || "No se pudo cargar el checkout Nuvei",
                        ),
                    );
                    setBooting(false);
                    onCancel?.();
                }
            }
        })();

        return () => {
            cancelled = true;
            try {
                referenceCloseRef.current?.();
            } catch {
                /* ignore */
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.client_unique_id, config.reference, config.checkout_mode]);

    return (
        <div className="space-y-3" data-testid="nuvei-checkout-panel">
            <div className="rounded-xl border bg-card p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                    {isReference
                        ? "Vas a pagar en el checkout seguro de Nuvei (Paymentez). No guardamos la tarjeta en TYS."
                        : "Ingresá los datos de tu tarjeta. El cobro lo procesa Nuvei; no guardamos la tarjeta en TYS."}
                </p>
                {missingReference ? (
                    <p className="text-sm text-destructive">
                        Falta la reference de Nuvei (init_reference).
                    </p>
                ) : missingTokenizeCreds ? (
                    <p className="text-sm text-destructive">
                        Falta el par CLIENT de Nuvei para tokenize.
                    </p>
                ) : isReference ? (
                    <>
                        {booting && (
                            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Abriendo checkout Nuvei…
                            </div>
                        )}
                        <Button
                            type="button"
                            className="w-full"
                            disabled={booting || paying}
                            onClick={() => {
                                setPaying(true);
                                try {
                                    referenceOpenRef.current?.();
                                } catch (err: any) {
                                    toast.error(err?.message || "Error al abrir Nuvei");
                                    setPaying(false);
                                }
                            }}
                            data-testid="nuvei-pay-button"
                        >
                            {paying ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Procesando…
                                </>
                            ) : (
                                `Pagar USD $${Number(config.amount || 0).toFixed(2)}`
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            Tarjeta de prueba stg: 4111111111111111 · CVC cualquiera ·
                            fecha futura
                        </p>
                    </>
                ) : (
                    <>
                        {booting && (
                            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Cargando formulario…
                            </div>
                        )}
                        <div
                            id={containerId}
                            className="min-h-[220px] w-full"
                            data-testid="nuvei-tokenize-form"
                        />
                        <Button
                            type="button"
                            className="w-full"
                            disabled={booting || paying}
                            onClick={() => {
                                setPaying(true);
                                try {
                                    tokenizeRef.current?.();
                                } catch (err: any) {
                                    toast.error(err?.message || "Error al tokenizar");
                                    setPaying(false);
                                }
                            }}
                            data-testid="nuvei-pay-button"
                        >
                            {paying ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Procesando…
                                </>
                            ) : (
                                `Pagar USD $${Number(config.amount || 0).toFixed(2)}`
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            Tarjeta de prueba stg: 4111111111111111 · CVC cualquiera ·
                            fecha futura
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
