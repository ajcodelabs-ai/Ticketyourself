import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import {
    isApprovedNuveiResult,
    startNuveiCheckout,
    type NuveiCheckoutConfig,
} from "@/lib/nuvei";

type Props = {
    config: NuveiCheckoutConfig;
    onPaid: () => void;
    onCancel?: () => void;
};

export default function NuveiCheckoutPanel({ config, onPaid, onCancel }: Props) {
    const reactId = useId().replace(/:/g, "");
    const containerId = `nuvei-checkout-${reactId}`;
    const [booting, setBooting] = useState(true);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await startNuveiCheckout(config, {
                    renderTo: `#${containerId}`,
                    onResult: async (result) => {
                        if (cancelled) return;
                        if (!isApprovedNuveiResult(result)) {
                            const status = String(
                                result?.result || result?.transactionStatus || result?.status || "",
                            );
                            if (status && status.toUpperCase() !== "PENDING") {
                                toast.error(`Pago Nuvei: ${status || "rechazado"}`);
                            }
                            return;
                        }
                        setConfirming(true);
                        try {
                            await api.post("/nuvei/confirm", {
                                session_token: config.session_token,
                                client_unique_id: config.client_unique_id,
                            });
                            toast.success("Pago confirmado");
                            onPaid();
                        } catch (err: any) {
                            toast.error(
                                formatApiError(err?.response?.data?.detail) ||
                                    "El pago se recibió pero aún no pudimos confirmarlo. Revisá en unos segundos.",
                            );
                            // Still navigate — DMN may finalize shortly.
                            onPaid();
                        } finally {
                            setConfirming(false);
                        }
                    },
                    onError: (err) => {
                        toast.error(String(err) || "Error en checkout Nuvei");
                    },
                });
            } catch (err: any) {
                toast.error(err?.message || "No se pudo iniciar Nuvei");
                onCancel?.();
            } finally {
                if (!cancelled) setBooting(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // Mount once per session_token
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.session_token]);

    return (
        <div className="space-y-3" data-testid="nuvei-checkout-panel">
            <div className="rounded-xl border bg-card p-3">
                <p className="text-sm font-medium mb-2">Pago seguro con Nuvei</p>
                {(booting || confirming) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {confirming ? "Confirmando pago…" : "Cargando checkout…"}
                    </div>
                )}
                <div id={containerId} className={booting || confirming ? "hidden" : ""} />
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
