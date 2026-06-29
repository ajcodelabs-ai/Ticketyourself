/**
 * PurchaseModal — public ticket purchase flow.
 *
 * Phase 8 additions:
 *  - Function selector when event.is_multi_function === true
 *  - Ticket type quantity selectors (replaces the single qty picker when types exist)
 *  - function_id + ticket_type_selections forwarded to /public/orders
 *
 * Existing behavior preserved:
 *  - free / donation / seat-numbered events
 *  - promo codes, payment method selector, buyer info
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
    Loader2,
    Ticket as TicketIcon,
    ShieldCheck,
    Tag,
    CalendarRange,
    Plus,
    Minus,
    Clock,
    AlertTriangle,
    KeyRound,
    Users,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import PhoneInput from "@/components/ui/phone-input";
import api, { formatApiError } from "@/lib/api";
import { formatPriceLabel } from "@/lib/events";
import { formatCents, orderSuccessPath, PAYMENT_METHOD_META } from "@/lib/orders";

const FEE_PERCENT = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function activeMethodsFor(event) {
    const pm = event?.payment_methods || {};
    return ["stripe", "transfer", "cash"].filter((k) => pm[k]?.enabled);
}

interface TicketTypeItem {
    id: string;
    name: string;
    description?: string;
    price_cents: number;
    currency: string;
    capacity?: number;
    color?: string;
    is_on_sale?: boolean;
    is_sold_out?: boolean;
    is_early_bird?: boolean;
    max_per_buyer?: number;
    min_quantity?: number;
    exact_quantity?: number;
}

interface EventFunction {
    id: string;
    name: string;
    starts_at?: string;
    venue_name?: string;
    venue_city?: string;
    status: string;
}

function fmtDate(iso?: string): string {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleString("es", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

function HoldCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
    const [secondsLeft, setSecondsLeft] = useState(() =>
        Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    );
    const onExpireRef = useRef(onExpire);
    onExpireRef.current = onExpire;

    useEffect(() => {
        if (secondsLeft <= 0) { onExpireRef.current(); return; }
        const t = setInterval(() => {
            setSecondsLeft((s) => {
                if (s <= 1) { clearInterval(t); onExpireRef.current(); return 0; }
                return s - 1;
            });
        }, 1000);
        return () => clearInterval(t);
    }, [expiresAt]);

    const min = Math.floor(secondsLeft / 60);
    const sec = secondsLeft % 60;
    const warning = secondsLeft < 120;
    return (
        <span className={`inline-flex items-center gap-1 font-mono text-sm font-semibold ${warning ? "text-amber-600 animate-pulse" : "text-emerald-600"}`}>
            {warning ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
            {min}:{sec.toString().padStart(2, "0")}
        </span>
    );
}

export default function PurchaseModal({
    open, onOpenChange, event, tenantSlug, seatHoldsInfo,
    preSelectedFunctionId = null, preSelectedFunctionName = "",
}) {
    const navigate = useNavigate();
    const pricingType = event?.pricing_type || "free";
    const isSeatNumbered = !!seatHoldsInfo;
    // §4.2.6 — límite "por compra/transacción" configurado en el evento.
    const maxPerPurchase = event?.access_params?.max_per_purchase || 10;
    // "Subevento" wording (independent add-on: sala VIP, cena, meet & greet)
    // vs "función" (same show repeated) — same underlying mechanics either way.
    const isSubevent = event?.multi_function_mode === "subevent";
    const functionNoun = isSubevent ? "subevento" : "función";

    const activeMethods = useMemo(() => {
        if (pricingType === "free") return [];
        const m = activeMethodsFor(event);
        return m.length ? m : ["stripe"];
    }, [event, pricingType]);

    // ── Phase 8: ticket types + functions ────────────────────────────────────
    const [ticketTypes, setTicketTypes] = useState<TicketTypeItem[]>([]);
    const [functions, setFunctions] = useState<EventFunction[]>([]);
    const [loadingMeta, setLoadingMeta] = useState(false);
    const [selectedFunctionId, setSelectedFunctionId] = useState<string | null>(preSelectedFunctionId);
    // qty per ticket type id
    const [typeQty, setTypeQty] = useState<Record<string, number>>({});

    // ── Classic fields ────────────────────────────────────────────────────────
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
    const [errors, setErrors] = useState<Record<string, string>>({});
    // §4.2.8 — preguntas adicionales al comprador, por id de pregunta
    const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
    const customQuestions = event?.custom_questions || [];
    const [promoCodeInput, setPromoCodeInput] = useState("");
    const [appliedPromo, setAppliedPromo] = useState<{
        code: string;
        name: string;
        amount_cents: number;
    } | null>(null);
    const [applyingPromo, setApplyingPromo] = useState(false);

    // ── Fase 9: access gate (lista verificada / código de acceso) ──────────────
    const accessType = event?.access_params?.access_type || "open";
    const needsAccessGate = accessType === "verified_list" || accessType === "access_code";
    const [accessVerified, setAccessVerified] = useState(false);
    const [accessCode, setAccessCode] = useState("");
    const [checkEmail, setCheckEmail] = useState("");
    const [checkCedula, setCheckCedula] = useState("");
    const [checkingAccess, setCheckingAccess] = useState(false);
    const [accessError, setAccessError] = useState("");

    const checkAccess = async () => {
        setAccessError("");
        if (accessType === "access_code" && !accessCode.trim()) {
            setAccessError("Ingresá el código de acceso.");
            return;
        }
        if (accessType === "verified_list" && !checkEmail.trim() && !checkCedula.trim()) {
            setAccessError("Ingresá tu correo o cédula.");
            return;
        }
        setCheckingAccess(true);
        try {
            const { data } = await api.post(
                `/public/events/${tenantSlug}/${event.slug}/check-access`,
                {
                    access_code: accessCode.trim() || undefined,
                    email: checkEmail.trim() || undefined,
                    cedula: checkCedula.trim() || undefined,
                },
            );
            if (!data.ok) {
                setAccessError(data.reason || "No tenés acceso a este evento.");
                return;
            }
            setAccessVerified(true);
            if (checkEmail.trim()) {
                setBuyer((b) => ({ ...b, email: checkEmail.trim() }));
            }
            if (checkCedula.trim()) {
                setBuyer((b) => ({ ...b, document_id: checkCedula.trim() }));
            }
        } catch (e: any) {
            setAccessError(formatApiError(e?.response?.data?.detail) || "No se pudo verificar el acceso.");
        } finally {
            setCheckingAccess(false);
        }
    };

    // Load functions on open. Non-multi-función events also load their
    // (event-level) ticket types right away; multi-función events wait for
    // the buyer to pick a función first (see effect below) since price/aforo
    // can differ per función via overrides.
    useEffect(() => {
        if (!open || !event?.id) return;
        let alive = true;
        setLoadingMeta(true);
        setTicketTypes([]);
        setFunctions([]);
        setTypeQty({});
        setSelectedFunctionId(preSelectedFunctionId);

        // Seat-numbered events resolve their función earlier, on the seat map
        // (each función has its own seat pool) — seatHoldsInfo.function_id
        // already carries it. Same for callers that already picked a specific
        // subevento before opening this modal (preSelectedFunctionId). Either
        // way the selector below must not offer a second, possibly
        // conflicting choice.
        const loadFns = event.is_multi_function && !isSeatNumbered && !preSelectedFunctionId
            ? api
                  .get(`/public/events/${event.id}/functions`)
                  .then((r) => alive && setFunctions(
                      (r.data || []).filter((f: EventFunction) => f.status !== "cancelled"),
                  ))
                  .catch(() => alive && setFunctions([]))
            : Promise.resolve();

        const loadTypes = event.is_multi_function
            ? Promise.resolve()
            : api
                  .get(`/public/events/${event.id}/ticket-types`)
                  .then((r) => {
                      if (!alive) return;
                      const available = (r.data || []).filter(
                          (t: TicketTypeItem) => !t.is_sold_out && t.is_on_sale !== false,
                      );
                      setTicketTypes(available);
                      const init: Record<string, number> = {};
                      available.forEach((t: TicketTypeItem) => { init[t.id] = 0; });
                      setTypeQty(init);
                  })
                  .catch(() => alive && setTicketTypes([]));

        Promise.all([loadTypes, loadFns]).finally(() => alive && setLoadingMeta(false));

        return () => { alive = false; };
    }, [open, event?.id, event?.is_multi_function, isSeatNumbered, preSelectedFunctionId]);

    // Multi-función: (re)load ticket types scoped to the chosen función so
    // price/capacity/availability reflect that función's overrides.
    useEffect(() => {
        if (!open || !event?.id || !event.is_multi_function || !selectedFunctionId || isSeatNumbered) return;
        let alive = true;
        setLoadingMeta(true);
        setTypeQty({});
        api
            .get(`/public/events/${event.id}/ticket-types`, { params: { function_id: selectedFunctionId } })
            .then((r) => {
                if (!alive) return;
                const available = (r.data || []).filter(
                    (t: TicketTypeItem) => !t.is_sold_out && t.is_on_sale !== false,
                );
                setTicketTypes(available);
                const init: Record<string, number> = {};
                available.forEach((t: TicketTypeItem) => { init[t.id] = 0; });
                setTypeQty(init);
            })
            .catch(() => alive && setTicketTypes([]))
            .finally(() => alive && setLoadingMeta(false));
        return () => { alive = false; };
    }, [selectedFunctionId, open, event?.id, event?.is_multi_function]);

    useEffect(() => {
        if (open) {
            setQuantity(1);
            setDonation("");
            setBuyer({ name: "", email: "", phone: "", document_id: "" });
            setErrors({});
            setPaymentMethod(activeMethods[0] || "stripe");
            setPromoCodeInput("");
            setAppliedPromo(null);
            setAccessVerified(false);
            setAccessCode("");
            setCheckEmail("");
            setCheckCedula("");
            setAccessError("");
        }
    }, [open]);

    // True while a multi-función event is waiting for the buyer to pick a
    // función — ticket types load scoped to that función, so nothing else
    // (classic quantity, donation amount) should render in the meantime.
    const functionPending = !!(event?.is_multi_function && functions.length > 0 && !selectedFunctionId);

    // ── Ticket type selections ────────────────────────────────────────────────
    const hasTypes = ticketTypes.length > 0;
    const typeSelections = useMemo(
        () =>
            ticketTypes
                .filter((t) => (typeQty[t.id] || 0) > 0)
                .map((t) => ({ ticket_type_id: t.id, quantity: typeQty[t.id] })),
        [ticketTypes, typeQty],
    );
    const totalQtyFromTypes = useMemo(
        () => typeSelections.reduce((sum, s) => sum + s.quantity, 0),
        [typeSelections],
    );

    // §4.2.6 — "mínimo N" steps from 0 straight to N, then +1; "cantidad
    // exacta N" steps in multiples of N so the selection is always valid.
    const setTypeCount = (tt: TicketTypeItem, direction: 1 | -1) => {
        const max = tt.exact_quantity || tt.max_per_buyer || 10;
        const floor = tt.exact_quantity || tt.min_quantity || 0;
        const step = tt.exact_quantity || 1;
        setTypeQty((prev) => {
            const cur = prev[tt.id] || 0;
            let next: number;
            if (direction > 0) {
                next = cur === 0 && floor > 0 ? floor : cur + step;
            } else {
                next = cur - step;
                if (floor > 0 && next < floor) next = 0;
            }
            next = Math.max(0, Math.min(max, next));
            return { ...prev, [tt.id]: next };
        });
    };

    // ── Totals ────────────────────────────────────────────────────────────────
    const totals = useMemo(() => {
        if (!event) return { subtotal: 0, fees: 0, total: 0, discount: 0 };

        let base: { subtotal: number; fees: number; total: number };

        if (isSeatNumbered) {
            base = {
                subtotal: seatHoldsInfo.subtotal_cents,
                fees: seatHoldsInfo.fees_cents,
                total: seatHoldsInfo.total_cents,
            };
        } else if (hasTypes && typeSelections.length > 0) {
            const subtotal = typeSelections.reduce((sum, sel) => {
                const tt = ticketTypes.find((t) => t.id === sel.ticket_type_id);
                return sum + (tt?.price_cents ?? 0) * sel.quantity;
            }, 0);
            const fees = subtotal > 0 ? Math.round((subtotal * FEE_PERCENT) / 100) : 0;
            base = { subtotal, fees, total: subtotal + fees };
        } else if (pricingType === "free") {
            base = { subtotal: 0, fees: 0, total: 0 };
        } else if (pricingType === "donation") {
            const cents = Math.round(parseFloat(donation || "0") * 100);
            base = { subtotal: cents, fees: 0, total: cents };
        } else {
            const unit = event.base_price_cents || 0;
            const subtotal = unit * quantity;
            const fees = Math.round((subtotal * FEE_PERCENT) / 100);
            base = { subtotal, fees, total: subtotal + fees };
        }

        if (appliedPromo) {
            const discount = appliedPromo.amount_cents || 0;
            const subtotalAfterDiscount = Math.max(0, base.subtotal - discount);
            const fees = base.fees > 0
                ? Math.round((subtotalAfterDiscount * FEE_PERCENT) / 100)
                : 0;
            return { ...base, discount, fees, total: subtotalAfterDiscount + fees };
        }
        return { ...base, discount: 0 };
    }, [
        event, pricingType, quantity, donation, isSeatNumbered, seatHoldsInfo,
        appliedPromo, hasTypes, typeSelections, ticketTypes,
    ]);

    const effectiveQty = isSeatNumbered
        ? seatHoldsInfo.seats.length
        : hasTypes
          ? totalQtyFromTypes
          : quantity;

    const applyPromo = async () => {
        const code = (promoCodeInput || "").trim().toUpperCase();
        if (!code) return;
        setApplyingPromo(true);
        try {
            const body = {
                tenant_slug: tenantSlug,
                event_slug: event.slug,
                quantity: effectiveQty || 1,
                promo_code: code,
                payment_method: pricingType === "free" ? "stripe" : paymentMethod,
            };
            if (isSeatNumbered) (body as any).seat_ids = seatHoldsInfo.seat_ids;
            const { data } = await api.post("/public/orders/preview", body);
            const applied = (data.discounts_applied || []).find(
                (a: any) => a.type === "promo_code",
            );
            if (!applied) {
                toast.error(data.warnings?.[0] || "Código no válido.");
                return;
            }
            setAppliedPromo({ code, name: applied.name, amount_cents: applied.amount_cents });
            toast.success(`Descuento "${applied.name}" aplicado`);
        } catch (e: any) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo validar el código.");
        } finally {
            setApplyingPromo(false);
        }
    };

    const removePromo = () => {
        setAppliedPromo(null);
        setPromoCodeInput("");
    };

    const validate = () => {
        const e: Record<string, string> = {};
        if (!buyer.name.trim() || buyer.name.trim().length < 2) e.name = "Requerido";
        if (!EMAIL_RE.test(buyer.email)) e.email = "Email inválido";
        if (pricingType === "donation") {
            const d = parseFloat(donation || "0");
            if (!d || d < 1) e.donation = "Mínimo $1";
        }
        if (!isSeatNumbered && !hasTypes && (quantity < 1 || quantity > maxPerPurchase))
            e.quantity = `Entre 1 y ${maxPerPurchase}`;
        if (hasTypes && !isSeatNumbered && totalQtyFromTypes < 1)
            e.ticketTypes = "Seleccioná al menos 1 ticket";
        if (hasTypes && !isSeatNumbered && totalQtyFromTypes > maxPerPurchase)
            e.ticketTypes = `Máximo ${maxPerPurchase} entradas por compra`;
        for (const tt of ticketTypes) {
            const sel = typeSelections.find((s) => s.ticket_type_id === tt.id);
            const qty = sel?.quantity || 0;
            if (qty === 0) continue;
            if (tt.exact_quantity && qty !== tt.exact_quantity) {
                e.ticketTypes = `'${tt.name}' se vende en paquetes de exactamente ${tt.exact_quantity}`;
            } else if (tt.min_quantity && qty < tt.min_quantity) {
                e.ticketTypes = `'${tt.name}' requiere comprar al menos ${tt.min_quantity}`;
            }
        }
        if (event?.is_multi_function && functions.length > 0 && !selectedFunctionId)
            e.function = `Seleccioná un${isSubevent ? "" : "a"} ${functionNoun}`;
        for (const q of customQuestions) {
            if (q.required && !(customAnswers[q.id] || "").trim()) {
                e[`cq_${q.id}`] = "Requerido";
            }
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const submit = async () => {
        if (!validate()) return;
        setSubmitting(true);
        try {
            const baseQty = isSeatNumbered
                ? seatHoldsInfo.seat_ids.length
                : hasTypes
                  ? totalQtyFromTypes
                  : quantity;

            const payload: any = {
                tenant_slug: tenantSlug,
                event_slug: event.slug,
                quantity: baseQty,
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
            if (isSeatNumbered) {
                payload.seat_ids = seatHoldsInfo.seat_ids;
                payload.seat_holds_session_token = seatHoldsInfo.session_token;
            }
            if (appliedPromo?.code) {
                payload.promo_code = appliedPromo.code;
            }
            if (accessType === "access_code" && accessCode.trim()) {
                payload.access_code = accessCode.trim();
            }
            // Phase 8 — seat-numbered events already resolved their función on
            // the seat map (seatHoldsInfo.function_id); general events resolve
            // it via the selector above.
            const effectiveFunctionId = isSeatNumbered ? seatHoldsInfo.function_id : selectedFunctionId;
            if (effectiveFunctionId) payload.function_id = effectiveFunctionId;
            if (hasTypes && typeSelections.length > 0) {
                payload.ticket_type_selections = typeSelections;
            }
            if (customQuestions.length > 0) {
                payload.custom_answers = customAnswers;
            }

            const { data } = await api.post("/public/orders", payload);
            if (data.status === "paid") {
                toast.success("¡Compra exitosa! Te enviamos tu ticket por email.");
                navigate(orderSuccessPath(tenantSlug, data.order_number));
                onOpenChange(false);
                return;
            }
            if (data.status === "pending_manual_payment" && data.redirect_to) {
                toast.success("Reserva creada. Te enviamos las instrucciones de pago por email.");
                navigate(data.redirect_to);
                onOpenChange(false);
                return;
            }
            if (data.checkout_url) {
                window.location.href = data.checkout_url;
                return;
            }
            toast.error("No se pudo generar la orden.");
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!event) return null;

    const isEffectivelyFree = hasTypes
        ? typeSelections.every((s) => {
              const tt = ticketTypes.find((t) => t.id === s.ticket_type_id);
              return (tt?.price_cents ?? 0) === 0;
          }) && typeSelections.length > 0
        : pricingType === "free";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-lg max-h-[92vh] overflow-y-auto"
                data-testid="purchase-modal"
            >
                <DialogHeader>
                    <div className="flex items-start justify-between gap-2">
                        <DialogTitle className="text-2xl">Comprar entradas</DialogTitle>
                        {seatHoldsInfo?.expires_at && (
                            <div className="flex flex-col items-end text-right shrink-0">
                                <span className="text-[10px] text-muted-foreground leading-none mb-0.5">
                                    Reserva expira en
                                </span>
                                <HoldCountdown
                                    expiresAt={seatHoldsInfo.expires_at}
                                    onExpire={() => {
                                        onOpenChange(false);
                                        toast.warning("Tu reserva de asientos venció. Elegí nuevamente.");
                                    }}
                                />
                            </div>
                        )}
                    </div>
                    <DialogDescription className="text-base">{event.title}</DialogDescription>
                </DialogHeader>

                {needsAccessGate && !accessVerified ? (
                    <div className="space-y-4 py-2" data-testid="access-gate">
                        {accessType === "access_code" ? (
                            <>
                                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
                                    <span>Este evento requiere un código de acceso para comprar.</span>
                                </div>
                                <Input
                                    placeholder="Código de acceso"
                                    value={accessCode}
                                    onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === "Enter" && checkAccess()}
                                    data-testid="access-gate-code-input"
                                />
                            </>
                        ) : (
                            <>
                                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <Users className="h-4 w-4 mt-0.5 shrink-0" />
                                    <span>
                                        Este evento es solo para invitados. Ingresá tu correo o
                                        cédula para verificar que estás en la lista.
                                    </span>
                                </div>
                                <Input
                                    placeholder="Email"
                                    value={checkEmail}
                                    onChange={(e) => setCheckEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && checkAccess()}
                                    data-testid="access-gate-email-input"
                                />
                                <Input
                                    placeholder="Cédula (opcional si ya pusiste tu email)"
                                    value={checkCedula}
                                    onChange={(e) => setCheckCedula(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && checkAccess()}
                                    data-testid="access-gate-cedula-input"
                                />
                            </>
                        )}
                        {accessError && (
                            <p className="text-sm text-red-600" data-testid="access-gate-error">
                                {accessError}
                            </p>
                        )}
                        <Button
                            className="w-full"
                            onClick={checkAccess}
                            disabled={checkingAccess}
                            data-testid="access-gate-submit"
                        >
                            {checkingAccess && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Verificar acceso
                        </Button>
                    </div>
                ) : loadingMeta ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                        <span className="text-sm text-muted-foreground">Cargando…</span>
                    </div>
                ) : (
                    <>
                        {/* ── Pre-selected función/subevento (chosen before opening this modal) ── */}
                        {preSelectedFunctionId && preSelectedFunctionName && (
                            <div
                                className="rounded-lg border bg-secondary/40 px-3 py-2 text-sm flex items-center gap-2"
                                data-testid="preselected-function"
                            >
                                <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                                Comprando para <strong>{preSelectedFunctionName}</strong>
                            </div>
                        )}

                        {/* ── Function selector ─────────────────────────────── */}
                        {functions.length > 0 && (
                            <div className="space-y-2" data-testid="function-selector">
                                <Label className="font-medium">
                                    Seleccioná un{isSubevent ? "" : "a"} {functionNoun} *
                                </Label>
                                {errors.function && (
                                    <p className="text-xs text-red-600">{errors.function}</p>
                                )}
                                <div className="space-y-2">
                                    {functions.map((fn) => (
                                        <label
                                            key={fn.id}
                                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                                                selectedFunctionId === fn.id
                                                    ? "border-primary bg-primary/5"
                                                    : "hover:bg-secondary/40"
                                            }`}
                                            data-testid={`fn-option-${fn.id}`}
                                        >
                                            <input
                                                type="radio"
                                                name="function_id"
                                                value={fn.id}
                                                checked={selectedFunctionId === fn.id}
                                                onChange={() => setSelectedFunctionId(fn.id)}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                    <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                                                    {fn.name}
                                                </div>
                                                {fn.starts_at && (
                                                    <div className="text-xs text-muted-foreground mt-0.5">
                                                        {fmtDate(fn.starts_at)}
                                                        {fn.venue_name &&
                                                            ` · ${fn.venue_name}${fn.venue_city ? `, ${fn.venue_city}` : ""}`}
                                                    </div>
                                                )}
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Ticket type selectors ─────────────────────────── */}
                        {hasTypes && !isSeatNumbered && (
                            <div className="space-y-2" data-testid="ticket-type-selector">
                                <Label className="font-medium">Seleccioná tus tickets</Label>
                                {errors.ticketTypes && (
                                    <p className="text-xs text-red-600">{errors.ticketTypes}</p>
                                )}
                                <div className="space-y-2">
                                    {ticketTypes.map((tt) => {
                                        const qty = typeQty[tt.id] || 0;
                                        // exact_quantity caps the stepper too — it's an on/off
                                        // toggle (0 or exactly N), not a multiples-of-N counter.
                                        const maxQty = tt.exact_quantity || tt.max_per_buyer || 10;
                                        const priceLabel =
                                            tt.price_cents === 0
                                                ? "Gratis"
                                                : formatCents(tt.price_cents, tt.currency);
                                        return (
                                            <div
                                                key={tt.id}
                                                className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                                                    qty > 0 ? "border-primary bg-primary/5" : ""
                                                }`}
                                                data-testid={`tt-row-${tt.id}`}
                                            >
                                                {tt.color && (
                                                    <div
                                                        className="h-8 w-1.5 rounded-full shrink-0"
                                                        style={{ backgroundColor: tt.color }}
                                                    />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-sm">
                                                            {tt.name}
                                                        </span>
                                                        {tt.is_early_bird && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                Early Bird
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-xs font-medium text-primary mt-0.5">
                                                        {priceLabel}
                                                    </div>
                                                    {tt.description && (
                                                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                                            {tt.description}
                                                        </div>
                                                    )}
                                                    {tt.exact_quantity ? (
                                                        <div className="text-xs text-amber-600 mt-0.5">
                                                            Se vende en paquetes de {tt.exact_quantity}
                                                        </div>
                                                    ) : tt.min_quantity ? (
                                                        <div className="text-xs text-amber-600 mt-0.5">
                                                            Mínimo {tt.min_quantity} por compra
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => setTypeCount(tt, -1)}
                                                        disabled={qty <= 0}
                                                        data-testid={`tt-minus-${tt.id}`}
                                                    >
                                                        <Minus className="h-3 w-3" />
                                                    </Button>
                                                    <span
                                                        className="w-6 text-center text-sm font-medium"
                                                        data-testid={`tt-qty-${tt.id}`}
                                                    >
                                                        {qty}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => setTypeCount(tt, 1)}
                                                        disabled={qty >= maxQty}
                                                        data-testid={`tt-plus-${tt.id}`}
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── Seat summary (numbered events) ────────────────── */}
                        {isSeatNumbered && (
                            <div
                                className="rounded-lg border bg-secondary/40 p-3 space-y-1.5"
                                data-testid="purchase-seats-summary"
                            >
                                <p className="text-xs font-medium">
                                    Estás reservando {seatHoldsInfo.seats.length} asiento(s)
                                    {seatHoldsInfo.function_name ? ` para "${seatHoldsInfo.function_name}"` : ""}:
                                </p>
                                <div className="flex flex-wrap gap-1">
                                    {seatHoldsInfo.seats.map((s: any) => (
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
                                    Tu reserva vence en 10 minutos. Si no completás el pago, los
                                    asientos vuelven a estar disponibles.
                                </p>
                            </div>
                        )}

                        {/* ── Classic quantity (when no ticket types) ────────── */}
                        {!hasTypes && pricingType !== "donation" && !isSeatNumbered && !functionPending && (
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
                                        max={maxPerPurchase}
                                        value={quantity}
                                        onChange={(e) =>
                                            setQuantity(
                                                Math.min(
                                                    maxPerPurchase,
                                                    Math.max(
                                                        1,
                                                        parseInt(e.target.value || "1", 10),
                                                    ),
                                                ),
                                            )
                                        }
                                        className="text-center w-20"
                                        data-testid="qty-input"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setQuantity((q) => Math.min(maxPerPurchase, q + 1))}
                                        disabled={quantity >= maxPerPurchase}
                                        data-testid="qty-plus"
                                    >
                                        +
                                    </Button>
                                    <span className="text-xs text-muted-foreground ml-2">
                                        Máx. {maxPerPurchase} por compra
                                    </span>
                                </div>
                                {errors.quantity && (
                                    <p className="text-xs text-red-600">{errors.quantity}</p>
                                )}
                            </div>
                        )}

                        {/* ── Donation ──────────────────────────────────────── */}
                        {pricingType === "donation" && !functionPending && (
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

                        {/* ── Payment method ────────────────────────────────── */}
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

                        {/* ── Buyer info ────────────────────────────────────── */}
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

                        {/* ── Preguntas adicionales (§4.2.8) ─────────────────── */}
                        {customQuestions.length > 0 && (
                            <div className="space-y-3 border-t pt-3" data-testid="custom-questions-block">
                                {customQuestions.map((q: any) => (
                                    <div key={q.id} className="space-y-1.5">
                                        <Label htmlFor={`cq-${q.id}`}>
                                            {q.label} {q.required && "*"}
                                        </Label>
                                        {q.type === "text" && (
                                            <Input
                                                id={`cq-${q.id}`}
                                                value={customAnswers[q.id] || ""}
                                                onChange={(e) =>
                                                    setCustomAnswers((prev) => ({
                                                        ...prev,
                                                        [q.id]: e.target.value,
                                                    }))
                                                }
                                                data-testid={`cq-input-${q.id}`}
                                            />
                                        )}
                                        {q.type === "select" && (
                                            <select
                                                id={`cq-${q.id}`}
                                                value={customAnswers[q.id] || ""}
                                                onChange={(e) =>
                                                    setCustomAnswers((prev) => ({
                                                        ...prev,
                                                        [q.id]: e.target.value,
                                                    }))
                                                }
                                                className="w-full text-sm border rounded-md px-3 py-2 bg-background"
                                                data-testid={`cq-select-${q.id}`}
                                            >
                                                <option value="">Seleccioná una opción</option>
                                                {(q.options || []).map((opt: string) => (
                                                    <option key={opt} value={opt}>
                                                        {opt}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                        {q.type === "checkbox" && (
                                            <Switch
                                                checked={customAnswers[q.id] === "true"}
                                                onCheckedChange={(v) =>
                                                    setCustomAnswers((prev) => ({
                                                        ...prev,
                                                        [q.id]: v ? "true" : "false",
                                                    }))
                                                }
                                                data-testid={`cq-switch-${q.id}`}
                                            />
                                        )}
                                        {errors[`cq_${q.id}`] && (
                                            <p className="text-xs text-red-600">{errors[`cq_${q.id}`]}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ── Promo code ────────────────────────────────────── */}
                        {(pricingType !== "free" || (hasTypes && totals.subtotal > 0)) && (
                            <div className="border-t pt-3 space-y-2" data-testid="promo-code-block">
                                {appliedPromo ? (
                                    <div
                                        className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm"
                                        data-testid="promo-applied"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-emerald-700" />
                                            <span className="text-emerald-900">
                                                <strong>{appliedPromo.name}</strong>{" "}
                                                <code className="text-xs bg-white/60 rounded px-1">
                                                    {appliedPromo.code}
                                                </code>
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={removePromo}
                                            className="text-xs text-emerald-800 hover:underline"
                                            data-testid="promo-remove"
                                        >
                                            Quitar
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="¿Tenés un código promocional?"
                                            value={promoCodeInput}
                                            onChange={(e) =>
                                                setPromoCodeInput(e.target.value.toUpperCase())
                                            }
                                            maxLength={40}
                                            className="h-9"
                                            data-testid="promo-input"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={applyPromo}
                                            disabled={applyingPromo || !promoCodeInput.trim()}
                                            data-testid="promo-apply"
                                        >
                                            {applyingPromo ? "..." : "Aplicar"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Totals ────────────────────────────────────────── */}
                        {totals.subtotal > 0 && (
                            <div className="border-t pt-3 space-y-1 text-sm" data-testid="totals">
                                {hasTypes && typeSelections.length > 0 ? (
                                    typeSelections.map((sel) => {
                                        const tt = ticketTypes.find(
                                            (t) => t.id === sel.ticket_type_id,
                                        );
                                        const lineTotal = (tt?.price_cents ?? 0) * sel.quantity;
                                        return (
                                            <Row
                                                key={sel.ticket_type_id}
                                                label={`${tt?.name} × ${sel.quantity}`}
                                                value={formatCents(lineTotal, tt?.currency)}
                                            />
                                        );
                                    })
                                ) : (
                                    <Row
                                        label={
                                            pricingType === "donation"
                                                ? "Aporte"
                                                : `Subtotal (${quantity}× ${formatCents(event.base_price_cents)})`
                                        }
                                        value={formatCents(totals.subtotal, event.currency)}
                                    />
                                )}
                                {totals.discount > 0 && (
                                    <Row
                                        label={`Descuento ${appliedPromo?.name || ""}`}
                                        value={`–${formatCents(totals.discount, event.currency)}`}
                                        accent="emerald"
                                        testid="row-discount"
                                    />
                                )}
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
                            {isEffectivelyFree || pricingType === "free"
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
                                ) : isEffectivelyFree || pricingType === "free" ? (
                                    <>
                                        <TicketIcon className="h-4 w-4 mr-1.5" />
                                        Confirmar reserva
                                    </>
                                ) : paymentMethod === "stripe" ? (
                                    <>
                                        <TicketIcon className="h-4 w-4 mr-1.5" />
                                        Pagar{" "}
                                        {totals.total > 0
                                            ? formatCents(totals.total, event.currency)
                                            : ""}
                                    </>
                                ) : (
                                    <>
                                        <TicketIcon className="h-4 w-4 mr-1.5" />
                                        Reservar y ver instrucciones
                                    </>
                                )}
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Field({ label, id, value, onChange, error, type = "text", testId }: {
    label: string; id: string; value: string; onChange: (v: string) => void;
    error?: string; type?: string; testId?: string;
}) {
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

function Row({ label, value, bold = false, accent, testid }: {
    label: string; value: string; bold?: boolean; accent?: string; testid?: string;
}) {
    const accentClass =
        accent === "emerald" ? "text-emerald-700" : accent === "amber" ? "text-amber-700" : "";
    return (
        <div
            className={`flex justify-between ${
                bold ? "font-semibold text-foreground pt-1" : "text-muted-foreground"
            }`}
            data-testid={testid}
        >
            <span>{label}</span>
            <span className={accentClass}>{value}</span>
        </div>
    );
}
