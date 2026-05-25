/**
 * PurchaseModal — public ticket purchase flow.
 *
 * - free events: confirms instantly and redirects to /o/:slug/orden/:order_number.
 * - paid events: collects qty + buyer info, calls /public/orders → redirects to
 *   Stripe checkout_url.
 * - donation: lets buyer pick amount (min $1), single ticket.
 *
 * No auth — buyer just provides name + email.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Ticket as TicketIcon, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import PhoneInput from "@/components/ui/phone-input";
import api, { formatApiError } from "@/lib/api";
import { formatPriceLabel } from "@/lib/events";
import { formatCents, orderSuccessPath, PAYMENT_METHOD_META } from "@/lib/orders";

const FEE_PERCENT = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns list of payment_method codes that are enabled on the event. */
function activeMethodsFor(event) {
    const pm = event?.payment_methods || {};
    return ["stripe", "transfer", "cash"].filter((k) => pm[k]?.enabled);
}

export default function PurchaseModal({ open, onOpenChange, event, tenantSlug, seatHoldsInfo }) {
    const navigate = useNavigate();
    const pricingType = event?.pricing_type || "free";
    const isSeatNumbered = !!seatHoldsInfo;

    const activeMethods = useMemo(() => {
        if (pricingType === "free") return [];
        const m = activeMethodsFor(event);
        return m.length ? m : ["stripe"]; // safety fallback
    }, [event, pricingType]);

    const [quantity, setQuantity] = useState(1);
    const [donation, setDonation] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("stripe");
    const [buyer, setBuyer] = useState({
        name: "",
        email: "",
        phone: "",
        document_id: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (open) {
            setQuantity(1);
            setDonation("");
            setBuyer({ name: "", email: "", phone: "", document_id: "" });
            setErrors({});
            setPaymentMethod(activeMethods[0] || "stripe");
        }
    }, [open, activeMethods]);

    const totals = useMemo(() => {
        if (!event) return { subtotal: 0, fees: 0, total: 0 };
        // Phase 7 — numbered events: totals come from seatHoldsInfo
        if (isSeatNumbered) {
            return {
                subtotal: seatHoldsInfo.subtotal_cents,
                fees: seatHoldsInfo.fees_cents,
                total: seatHoldsInfo.total_cents,
            };
        }
        if (pricingType === "free") return { subtotal: 0, fees: 0, total: 0 };
        if (pricingType === "donation") {
            const cents = Math.round(parseFloat(donation || "0") * 100);
            return { subtotal: cents, fees: 0, total: cents };
        }
        const unit = event.base_price_cents || 0;
        const subtotal = unit * quantity;
        const fees = Math.round((subtotal * FEE_PERCENT) / 100);
        return { subtotal, fees, total: subtotal + fees };
    }, [event, pricingType, quantity, donation, isSeatNumbered, seatHoldsInfo]);

    const validate = () => {
        const e = {};
        if (!buyer.name.trim() || buyer.name.trim().length < 2) e.name = "Requerido";
        if (!EMAIL_RE.test(buyer.email)) e.email = "Email inválido";
        if (pricingType === "donation") {
            const d = parseFloat(donation || "0");
            if (!d || d < 1) e.donation = "Mínimo $1";
        }
        if (quantity < 1 || quantity > 10) e.quantity = "Entre 1 y 10";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const submit = async () => {
        if (!validate()) return;
        setSubmitting(true);
        try {
            const payload = {
                tenant_slug: tenantSlug,
                event_slug: event.slug,
                quantity: isSeatNumbered ? seatHoldsInfo.seat_ids.length : quantity,
                buyer: {
                    name: buyer.name.trim(),
                    email: buyer.email.trim().toLowerCase(),
                    phone: buyer.phone || undefined,
                    document_id: buyer.document_id || undefined,
                },
                origin_url: window.location.origin,
                payment_method: pricingType === "free" ? "stripe" : paymentMethod,
            };
            if (pricingType === "donation") {
                payload.donation_amount_cents = Math.round(parseFloat(donation) * 100);
                payload.quantity = 1;
            }
            // Phase 7 — numbered event: attach seat info
            if (isSeatNumbered) {
                payload.seat_ids = seatHoldsInfo.seat_ids;
                payload.seat_holds_session_token = seatHoldsInfo.session_token;
            }
            const { data } = await api.post("/public/orders", payload);
            if (data.status === "paid") {
                toast.success("¡Compra exitosa! Te enviamos tu ticket por email.");
                navigate(orderSuccessPath(tenantSlug, data.order_number));
                onOpenChange(false);
                return;
            }
            if (data.status === "pending_manual_payment" && data.redirect_to) {
                toast.success(
                    "Reserva creada. Te enviamos las instrucciones de pago por email.",
                );
                navigate(data.redirect_to);
                onOpenChange(false);
                return;
            }
            if (data.checkout_url) {
                // Stripe checkout
                window.location.href = data.checkout_url;
                return;
            }
            toast.error("No se pudo generar la orden.");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!event) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-lg max-h-[92vh] overflow-y-auto"
                data-testid="purchase-modal"
            >
                <DialogHeader>
                    <DialogTitle className="text-2xl">Comprar entradas</DialogTitle>
                    <DialogDescription className="text-base">
                        {event.title}
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg bg-secondary/40 border p-3 flex items-center justify-between">
                    <div>
                        <div className="text-xs text-muted-foreground">Precio</div>
                        <div className="font-semibold">{formatPriceLabel(event)}</div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                        {pricingType === "free" && "Sin costo"}
                        {pricingType === "donation" && "Aporte voluntario"}
                        {pricingType === "paid" && paymentMethod === "stripe" && "Pago con tarjeta"}
                        {pricingType === "paid" && paymentMethod === "transfer" && "Pago por transferencia"}
                        {pricingType === "paid" && paymentMethod === "cash" && "Pago en efectivo"}
                    </Badge>
                </div>

                {/* Phase 7 — seats summary (numbered events) */}
                {isSeatNumbered && (
                    <div
                        className="rounded-lg border bg-secondary/40 p-3 space-y-1.5"
                        data-testid="purchase-seats-summary"
                    >
                        <p className="text-xs font-medium">
                            Estás reservando {seatHoldsInfo.seats.length} asiento(s):
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {seatHoldsInfo.seats.map((s) => (
                                <Badge
                                    key={s.seat_id}
                                    variant="outline"
                                    className="text-xs"
                                    data-testid={`purchase-seat-${s.seat_id}`}
                                >
                                    {s.label}
                                </Badge>
                            ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            Tu reserva vence en 10 minutos. Si no completás el pago, los asientos vuelven a estar disponibles.
                        </p>
                    </div>
                )}

                {/* Quantity (hidden for numbered events + donation) */}
                {pricingType !== "donation" && !isSeatNumbered && (
                    <div className="space-y-1.5">
                        <Label htmlFor="qty">Cantidad de entradas</Label>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                                disabled={quantity <= 1}
                                data-testid="qty-minus"
                            >
                                −
                            </Button>
                            <Input
                                id="qty"
                                type="number"
                                min="1"
                                max="10"
                                value={quantity}
                                onChange={(e) =>
                                    setQuantity(
                                        Math.min(10, Math.max(1, parseInt(e.target.value || "1", 10))),
                                    )
                                }
                                className="text-center w-20"
                                data-testid="qty-input"
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                                disabled={quantity >= 10}
                                data-testid="qty-plus"
                            >
                                +
                            </Button>
                            <span className="text-xs text-muted-foreground ml-2">
                                Máx. 10 por compra
                            </span>
                        </div>
                        {errors.quantity && (
                            <p className="text-xs text-red-600">{errors.quantity}</p>
                        )}
                    </div>
                )}

                {/* Donation amount */}
                {pricingType === "donation" && (
                    <div className="space-y-1.5">
                        <Label htmlFor="donation">Tu aporte (USD)</Label>
                        <div className="flex gap-2">
                            {[5, 10, 20, 50].map((v) => (
                                <Button
                                    key={v}
                                    type="button"
                                    variant={
                                        parseFloat(donation) === v ? "default" : "outline"
                                    }
                                    onClick={() => setDonation(String(v))}
                                    data-testid={`donation-preset-${v}`}
                                >
                                    ${v}
                                </Button>
                            ))}
                        </div>
                        <Input
                            id="donation"
                            type="number"
                            min="1"
                            step="0.50"
                            placeholder="O escribí un monto"
                            value={donation}
                            onChange={(e) => setDonation(e.target.value)}
                            data-testid="donation-input"
                        />
                        {errors.donation && (
                            <p className="text-xs text-red-600">{errors.donation}</p>
                        )}
                    </div>
                )}

                {/* Payment method selector — only when ≥2 active */}
                {activeMethods.length > 1 && (
                    <div className="space-y-2" data-testid="payment-method-selector">
                        <Label>¿Cómo quieres pagar?</Label>
                        <div className="space-y-2">
                            {activeMethods.map((m) => {
                                const meta = PAYMENT_METHOD_META[m];
                                const checked = paymentMethod === m;
                                return (
                                    <label
                                        key={m}
                                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                                            checked
                                                ? "border-primary bg-primary/5"
                                                : "hover:bg-secondary/40"
                                        }`}
                                        data-testid={`payment-method-${m}`}
                                    >
                                        <input
                                            type="radio"
                                            name="payment_method"
                                            value={m}
                                            checked={checked}
                                            onChange={() => setPaymentMethod(m)}
                                            className="mt-1"
                                        />
                                        <div className="flex-1">
                                            <div className="font-medium text-sm flex items-center gap-2">
                                                <span className="text-lg">{meta.icon}</span>
                                                {meta.label}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {meta.description}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Buyer info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Field
                        label="Nombre completo *"
                        id="buyer-name"
                        value={buyer.name}
                        onChange={(v) => setBuyer((b) => ({ ...b, name: v }))}
                        error={errors.name}
                        testId="buyer-name"
                    />
                    <Field
                        label="Email *"
                        id="buyer-email"
                        type="email"
                        value={buyer.email}
                        onChange={(v) => setBuyer((b) => ({ ...b, email: v }))}
                        error={errors.email}
                        testId="buyer-email"
                    />
                    <div className="space-y-1.5">
                        <Label htmlFor="buyer-phone">Teléfono</Label>
                        <PhoneInput
                            id="buyer-phone"
                            value={buyer.phone}
                            onChange={(v) =>
                                setBuyer((b) => ({ ...b, phone: v || "" }))
                            }
                            data-testid="buyer-phone"
                        />
                    </div>
                    <Field
                        label="Documento / cédula"
                        id="buyer-doc"
                        value={buyer.document_id}
                        onChange={(v) => setBuyer((b) => ({ ...b, document_id: v }))}
                        testId="buyer-doc"
                    />
                </div>

                {/* Totals */}
                {pricingType !== "free" && (
                    <div className="border-t pt-3 space-y-1 text-sm" data-testid="totals">
                        <Row
                            label={
                                pricingType === "donation"
                                    ? "Aporte"
                                    : `Subtotal (${quantity}× ${formatCents(event.base_price_cents)})`
                            }
                            value={formatCents(totals.subtotal, event.currency)}
                        />
                        {totals.fees > 0 && (
                            <Row
                                label={`Tarifa de servicio (${FEE_PERCENT}%)`}
                                value={formatCents(totals.fees, event.currency)}
                            />
                        )}
                        <Row
                            label="Total"
                            bold
                            value={formatCents(totals.total, event.currency)}
                        />
                    </div>
                )}

                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {pricingType === "free"
                        ? "Te enviaremos tu ticket por email al confirmar."
                        : "Te redirigimos a Stripe (procesamiento seguro). Los datos del tarjetahabiente no quedan en TYS."}
                </p>

                <div className="flex justify-end gap-2 pt-2">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                        data-testid="purchase-cancel"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={submitting}
                        className="min-w-[170px]"
                        data-testid="purchase-submit"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                Procesando…
                            </>
                        ) : pricingType === "free" ? (
                            <>
                                <TicketIcon className="h-4 w-4 mr-1.5" />
                                Confirmar reserva
                            </>
                        ) : paymentMethod === "stripe" ? (
                            <>
                                <TicketIcon className="h-4 w-4 mr-1.5" />
                                Pagar {formatCents(totals.total, event.currency)}
                            </>
                        ) : (
                            <>
                                <TicketIcon className="h-4 w-4 mr-1.5" />
                                Reservar y ver instrucciones
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Field({ label, id, value, onChange, error, type = "text", testId }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                data-testid={testId}
                aria-invalid={!!error}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
}
function Row({ label, value, bold }) {
    return (
        <div
            className={`flex justify-between ${bold ? "font-semibold text-foreground pt-1" : "text-muted-foreground"}`}
        >
            <span>{label}</span>
            <span>{value}</span>
        </div>
    );
}
