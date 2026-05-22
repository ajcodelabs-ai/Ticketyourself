/**
 * Order/ticket helpers — shared between PurchaseModal, OrderSuccess and EventDetail.
 */
import { previewMicrositePath } from "@/lib/config";

export const ORDER_STATUS_META = {
    pending: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    paid: { label: "Pagado", className: "bg-emerald-100 text-emerald-800" },
    refunded: { label: "Reembolsado", className: "bg-slate-100 text-slate-700" },
    cancelled: { label: "Cancelado", className: "bg-red-100 text-red-800" },
};

export function formatCents(cents, currency = "USD") {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)} ${currency}`;
}

export function orderSuccessPath(slug, orderNumber) {
    return `${previewMicrositePath(slug)}/orden/${orderNumber}`;
}

export function orderCancelPath(slug, orderNumber) {
    return `${previewMicrositePath(slug)}/orden/${orderNumber}/cancelado`;
}

export function ticketPdfUrl(orderNumber, ticketId) {
    const base = process.env.REACT_APP_BACKEND_URL || "";
    return `${base}/api/public/orders/${orderNumber}/tickets/${ticketId}/pdf`;
}
