/**
 * Organizer pays the per-event platform fee before publish.
 * The backend returns 402 `pre_event_fee_required` until this is paid or waived.
 */
import { useEffect, useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { PAYMENT_METHOD_META, PLAN_PAYMENT_METHODS, formatCents } from "@/lib/orders";
import NuveiCheckoutPanel from "@/components/orders/NuveiCheckoutPanel";
import type { NuveiCheckoutConfig } from "@/lib/nuvei";
import DeunaCheckoutPanel from "@/components/orders/DeunaCheckoutPanel";
import type { DeunaCheckoutConfig } from "@/lib/deuna";

type FeeBreakdown = {
    enabled?: boolean;
    fee_cents?: number;
    ticket_units?: number;
    estimated_gmv_cents?: number;
    per_ticket_cents?: number;
    percent_bps?: number;
    ticket_component_cents?: number;
    gmv_component_cents?: number;
    current_status?: string;
    simulate_allowed?: boolean;
    message?: string;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string | null;
    seed?: FeeBreakdown | null;
    onPaid: () => void;
};

export default function PreEventFeeDialog({
    open,
    onOpenChange,
    eventId,
    seed,
    onPaid,
}: Props) {
    const [loading, setLoading] = useState(false);
    const [paying, setPaying] = useState(false);
    const [fee, setFee] = useState<FeeBreakdown | null>(seed || null);
    const [method, setMethod] = useState("stripe");
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [nuveiCheckout, setNuveiCheckout] = useState<NuveiCheckoutConfig | null>(null);
    const [deunaCheckout, setDeunaCheckout] = useState<DeunaCheckoutConfig | null>(null);

    useEffect(() => {
        if (!open) {
            setNuveiCheckout(null);
            setDeunaCheckout(null);
            setPendingMessage(null);
            setPaying(false);
            return;
        }
        if (seed?.fee_cents != null) {
            const flattened = seed.breakdown
                ? { ...seed.breakdown, ...seed }
                : seed;
            setFee(flattened);
            setMethod(flattened.simulate_allowed ? "simulate" : "stripe");
        }
        if (!eventId) return;
        let alive = true;
        setLoading(true);
        api.get(`/events/me/${eventId}/pre-event-fee`)
            .then(({ data }) => {
                if (!alive) return;
                setFee(data);
                setMethod(data?.simulate_allowed ? "simulate" : "stripe");
            })
            .catch((err) => {
                if (!alive) return;
                toast.error(
                    formatApiError(err?.response?.data?.detail) ||
                        "No se pudo calcular el cargo de plataforma.",
                );
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [open, eventId, seed]);

    const alreadyPaid =
        fee?.current_status === "paid" || fee?.current_status === "waived";
    const required = Boolean(fee?.enabled) && (fee?.fee_cents || 0) > 0 && !alreadyPaid;

    const pay = async () => {
        if (!eventId) return;
        setPaying(true);
        try {
            const { data } = await api.post(`/events/me/${eventId}/pay-pre-event-fee`, {
                payment_method: method,
            });
            if (data?.status === "paid" || data?.status === "waived") {
                toast.success(
                    data.status === "waived"
                        ? "Este evento no tiene cargo de plataforma"
                        : "Cargo de plataforma pagado",
                );
                onOpenChange(false);
                onPaid();
                return;
            }
            if (
                data?.status === "nuvei_checkout" &&
                (data.reference || data.session_token)
            ) {
                setNuveiCheckout({
                    reference: data.reference || data.session_token,
                    session_token: data.session_token || data.reference,
                    checkout_mode: data.checkout_mode,
                    nuvei_env: data.nuvei_env,
                    checkout_js_url: data.checkout_js_url,
                    checkout_url: data.checkout_url,
                    client_app_code: data.client_app_code,
                    client_app_key: data.client_app_key,
                    client_unique_id: data.client_unique_id,
                    amount: data.amount,
                    currency: data.currency,
                    user_id: data.user_id,
                    user_email: data.user_email,
                    user_phone: data.user_phone,
                    order_description: data.order_description,
                    order_vat: data.order_vat,
                    order_installments_type: data.order_installments_type,
                });
                return;
            }
            if (data?.status === "deuna_checkout" && data.order_token) {
                setDeunaCheckout({
                    order_token: data.order_token,
                    public_api_key: data.public_api_key,
                    deuna_env: data.deuna_env,
                    checkout_js_url: data.checkout_js_url,
                    order_id: data.client_unique_id,
                });
                return;
            }
            if (data?.status === "pending_gateway" || data?.status === "pending") {
                setPendingMessage(
                    data.message ||
                        "Registramos tu solicitud. El equipo TYS confirmará el cobro y vas a poder publicar.",
                );
                return;
            }
            toast.error("No se pudo iniciar el pago del cargo.");
        } catch (err: any) {
            toast.error(
                formatApiError(err?.response?.data?.detail) ||
                    err?.message ||
                    "No se pudo pagar el cargo.",
            );
        } finally {
            setPaying(false);
        }
    };

    const percentLabel = ((fee?.percent_bps || 0) / 100).toFixed(2);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-lg"
                data-testid="pre-event-fee-dialog"
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Receipt className="h-5 w-5" />
                        Cargo de plataforma
                    </DialogTitle>
                    <DialogDescription>
                        Tu plan cobra un cargo de TYS al publicar el evento. Pagalo acá
                        y después podés publicarlo.
                    </DialogDescription>
                </DialogHeader>

                {loading && !fee ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : alreadyPaid ? (
                    <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        Este cargo ya está {fee?.current_status === "waived" ? "exonerado" : "pagado"}.
                        Podés publicar el evento.
                    </p>
                ) : !required ? (
                    <p className="text-sm text-muted-foreground">
                        Este evento no tiene cargo de plataforma. Podés publicarlo.
                    </p>
                ) : nuveiCheckout ? (
                    <div data-testid="pre-event-fee-nuvei">
                        <NuveiCheckoutPanel
                            config={nuveiCheckout}
                            onPaid={() => {
                                setNuveiCheckout(null);
                                onOpenChange(false);
                                onPaid();
                            }}
                            onCancel={() => setNuveiCheckout(null)}
                        />
                    </div>
                ) : deunaCheckout ? (
                    <div data-testid="pre-event-fee-deuna">
                        <DeunaCheckoutPanel
                            config={deunaCheckout}
                            onPaid={() => {
                                setDeunaCheckout(null);
                                onOpenChange(false);
                                onPaid();
                            }}
                            onCancel={() => setDeunaCheckout(null)}
                        />
                    </div>
                ) : pendingMessage ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 space-y-2">
                        <p className="text-sm text-sky-900">{pendingMessage}</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingMessage(null)}
                        >
                            Elegir otro método
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-lg border bg-secondary/30 px-4 py-3 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">
                                    Aforo × {formatCents(fee?.per_ticket_cents || 0)}
                                    {fee?.ticket_units != null ? ` (${fee.ticket_units} entradas)` : ""}
                                </span>
                                <span className="tabular-nums">
                                    {formatCents(fee?.ticket_component_cents || 0)}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">
                                    {percentLabel}% del GMV estimado
                                    {fee?.estimated_gmv_cents
                                        ? ` (${formatCents(fee.estimated_gmv_cents)})`
                                        : ""}
                                </span>
                                <span className="tabular-nums">
                                    {formatCents(fee?.gmv_component_cents || 0)}
                                </span>
                            </div>
                            <div className="flex justify-between text-base font-semibold pt-1 border-t">
                                <span>Total a pagar</span>
                                <span className="tabular-nums" data-testid="pre-event-fee-total">
                                    {formatCents(fee?.fee_cents || 0)}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Forma de pago</Label>
                            <div className="grid sm:grid-cols-3 gap-2">
                                {fee?.simulate_allowed && (
                                    <button
                                        type="button"
                                        data-testid="pre-event-fee-simulate"
                                        onClick={() => setMethod("simulate")}
                                        className={`text-left rounded-lg border p-3 transition ${
                                            method === "simulate"
                                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                : "border-border/70 hover:border-primary/40"
                                        }`}
                                    >
                                        <div className="text-sm font-medium">Entorno local</div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Registrar el pago sin pasarela (solo desarrollo).
                                        </div>
                                    </button>
                                )}
                                {PLAN_PAYMENT_METHODS.map((code) => {
                                    const meta = PAYMENT_METHOD_META[code];
                                    const selected = method === code;
                                    return (
                                        <button
                                            key={code}
                                            type="button"
                                            data-testid={`pre-event-fee-pay-${code}`}
                                            onClick={() => setMethod(code)}
                                            className={`text-left rounded-lg border p-3 transition ${
                                                selected
                                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                    : "border-border/70 hover:border-primary/40"
                                            }`}
                                        >
                                            <div className="text-sm font-medium">
                                                {meta.icon} {meta.label}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {meta.description}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {!nuveiCheckout && !deunaCheckout && !pendingMessage && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Ahora no
                        </Button>
                        {alreadyPaid || !required ? (
                            <Button
                                onClick={() => {
                                    onOpenChange(false);
                                    onPaid();
                                }}
                                data-testid="pre-event-fee-continue"
                            >
                                Publicar
                            </Button>
                        ) : (
                            <Button
                                onClick={pay}
                                disabled={paying || loading || !eventId}
                                data-testid="pre-event-fee-pay-btn"
                            >
                                {paying && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                                Pagar {formatCents(fee?.fee_cents || 0)}
                            </Button>
                        )}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
