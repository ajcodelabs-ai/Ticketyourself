/**
 * Organizer plan checkout — same "processing page" pattern as ticket OrderSuccess.
 * Checkout payload is stashed so /billing/success can reopen Nuvei without
 * creating a second intent.
 */

const STORAGE_PREFIX = "tys_billing_checkout_";

export const BILLING_INTENT_STATUS_META = {
    pending: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    pending_gateway: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    completed: { label: "Pagado", className: "bg-emerald-100 text-emerald-800" },
};

export function isBillingIntentPending(status) {
    return status === "pending" || status === "pending_gateway";
}

export function billingPeriodLabel(period) {
    if (period === "monthly") return "Mensual";
    if (period === "one_time") return "Pago único";
    return period || "—";
}

export function billingSuccessPath({ sessionId, intentId } = {}) {
    const qs = new URLSearchParams();
    if (sessionId) qs.set("session_id", sessionId);
    if (intentId) qs.set("intent_id", intentId);
    const query = qs.toString();
    return query ? `/billing/success?${query}` : "/billing/success";
}

export function billingCheckoutStorageKey(sessionId) {
    return `${STORAGE_PREFIX}${sessionId}`;
}

export function saveBillingCheckout(sessionId, data) {
    if (!sessionId || data == null) return;
    try {
        sessionStorage.setItem(billingCheckoutStorageKey(sessionId), JSON.stringify(data));
    } catch {
        /* private mode / quota */
    }
}

export function loadBillingCheckout(sessionId) {
    if (!sessionId) return null;
    try {
        const raw = sessionStorage.getItem(billingCheckoutStorageKey(sessionId));
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function clearBillingCheckout(sessionId) {
    if (!sessionId) return;
    try {
        sessionStorage.removeItem(billingCheckoutStorageKey(sessionId));
    } catch {
        /* ignore */
    }
}
