import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import {
    isPaidDeunaResult,
    startDeunaCheckout,
    type DeunaCheckoutConfig,
} from "@/lib/deuna";

type Props = {
    config: DeunaCheckoutConfig;
    onPaid: () => void;
    onCancel?: () => void;
};

export default function DeunaCheckoutPanel({ config, onPaid, onCancel }: Props) {
    const [booting, setBooting] = useState(true);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await startDeunaCheckout(config, {
                    onSuccess: async (data) => {
                        if (cancelled) return;
                        if (!isPaidDeunaResult(data)) {
                            // Widget may still report success with nested paid status — confirm server-side.
                        }
                        setConfirming(true);
                        try {
                            await api.post("/deuna/confirm", {
                                order_token: config.order_token,
                                order_id: config.order_id,
                            });
                            toast.success("Pago confirmado");
                            onPaid();
                        } catch (err: any) {
                            toast.error(
                                formatApiError(err?.response?.data?.detail) ||
                                    "El pago se recibió pero aún no pudimos confirmarlo. Revisá en unos segundos.",
                            );
                            onPaid();
                        } finally {
                            setConfirming(false);
                        }
                    },
                    onError: (err: any) => {
                        const msg =
                            err?.metadata?.message ||
                            err?.message ||
                            "Error en checkout DEUNA";
                        toast.error(String(msg));
                    },
                    onClosed: (action) => {
                        if (action === "userAction") {
                            onCancel?.();
                        }
                    },
                });
            } catch (err: any) {
                toast.error(err?.message || "No se pudo iniciar DEUNA");
                onCancel?.();
            } finally {
                if (!cancelled) setBooting(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.order_token]);

    return (
        <div className="space-y-3" data-testid="deuna-checkout-panel">
            <div className="rounded-xl border bg-card p-3">
                <p className="text-sm font-medium mb-2">Pago seguro con DEUNA</p>
                <p className="text-xs text-muted-foreground mb-3">
                    Se abre el widget de pago. Completá el cobro en la ventana de DEUNA.
                </p>
                {(booting || confirming) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {confirming ? "Confirmando pago…" : "Abriendo checkout…"}
                    </div>
                )}
            </div>
            {onCancel && (
                <button
                    type="button"
                    className="text-sm text-muted-foreground underline"
                    onClick={onCancel}
                    data-testid="deuna-checkout-cancel"
                >
                    Cancelar
                </button>
            )}
        </div>
    );
}
