/**
 * Order/ticket helpers — shared between PurchaseModal, OrderSuccess and EventDetail.
 */
import { previewMicrositeSubpath } from "@/lib/config";

export const ORDER_STATUS_META = {
    pending: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    pending_gateway: {
        label: "Pago digital pendiente",
        className: "bg-sky-100 text-sky-900",
    },
    pending_manual_payment: {
        label: "Esperando pago manual",
        className: "bg-orange-100 text-orange-900",
    },
    paid: { label: "Pagado", className: "bg-emerald-100 text-emerald-800" },
    refunded: { label: "Reembolsado", className: "bg-slate-100 text-slate-700" },
    cancelled: { label: "Cancelado", className: "bg-red-100 text-red-800" },
};

export const PAYMENT_METHOD_META = {
    stripe: {
        label: "Stripe",
        icon: "💳",
        description: "Pago digital con tarjeta (Checkout)",
    },
    nuvei: {
        label: "Nuvei",
        icon: "💳",
        description: "Pago digital con tarjeta (Nuvei Ecuador)",
    },
    deuna: {
        label: "DeUna",
        icon: "📱",
        description: "Pago digital con DEUNA (Payment Widget)",
    },
    paypal: {
        label: "PayPal",
        icon: "🅿️",
        description: "Pago digital PayPal — integración en preparación",
    },
    transfer: {
        label: "Transferencia bancaria",
        icon: "🏦",
        description: "Verificación manual hasta 48h",
    },
    cash: {
        label: "Pago en efectivo",
        icon: "💵",
        description: "Coordinar con organizador",
    },
    demo: {
        label: "Simular pago",
        icon: "🧪",
        description: "Confirma la compra al instante, sin cobro real (solo pruebas)",
    },
};

export const PLAN_PAYMENT_METHODS = ["stripe", "nuvei", "deuna"] as const;

export function formatCents(cents, currency = "USD") {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)} ${currency}`;
}

export function orderSuccessPath(slug, orderNumber) {
    return previewMicrositeSubpath(slug, `/orden/${orderNumber}`);
}

export function orderCancelPath(slug, orderNumber) {
    return previewMicrositeSubpath(slug, `/orden/${orderNumber}/cancelado`);
}

export function ticketPdfUrl(orderNumber, ticketId) {
    const base = import.meta.env.VITE_BACKEND_URL || "";
    return `${base}/api/public/orders/${orderNumber}/tickets/${ticketId}/pdf`;
}
