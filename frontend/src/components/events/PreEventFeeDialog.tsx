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
import { PAYMENT_METHOD_META, formatCents } from "@/lib/orders";
import NuveiCheckoutPanel from "@/components/orders/NuveiCheckoutPanel";
import { nuveiCheckoutFromApi, type NuveiCheckoutConfig } from "@/lib/nuvei";

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
    breakdown?: Partial<FeeBreakdown>;
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
    const [method, setMethod] = useState("nuvei");
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [nuveiCheckout, setNuveiCheckout] = useState<NuveiCheckoutConfig | null>(null);

    useEffect(() => {
        if (!open) {
            setNuveiCheckout(null);
            setPendingMessage(null);
            setPaying(false);
            return;
        }
        if (seed?.fee_cents != null) {
            const flattened = seed.breakdown
                ? { ...seed.breakdown, ...seed }
                : seed;
            setFee(flattened);
            setMethod(flattened.simulate_allowed ? "simulate" : "nuvei");
        }
        if (!eventId) return;
        let alive = true;
        setLoading(true);
        api.get(`/events/me/${eventId}/pre-event-fee`)
            .then(({ data }) => {
                if (!alive) return;
                setFee(data);
                setMethod(data?.simulate_allowed ? "simulate" : "nuvei");
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
            const nuvei = nuveiCheckoutFromApi(data);
            if (nuvei) {
                setNuveiCheckout(nuvei);
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
                                <button
                                    type="button"
                                    data-testid="pre-event-fee-pay-nuvei"
                                    onClick={() => setMethod("nuvei")}
                                    className={`text-left rounded-lg border p-3 transition ${
                                        method === "nuvei"
                                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                                            : "border-border/70 hover:border-primary/40"
                                    }`}
                                >
                                    <div className="text-sm font-medium">
                                        {PAYMENT_METHOD_META.nuvei.icon} {PAYMENT_METHOD_META.nuvei.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {PAYMENT_METHOD_META.nuvei.description}
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {!nuveiCheckout && !pendingMessage && (
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
