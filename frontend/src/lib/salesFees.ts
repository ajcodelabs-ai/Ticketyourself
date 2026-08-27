/**
 * TYS per-ticket sales commission helpers (admin matrix).
 */

export const PRICING_TYPE_LABELS = {
    paid: "Pagado",
    free: "Gratuito",
    donation: "Donación",
};

export function centsToDollars(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2);
}

export function dollarsToCents(raw) {
    if (raw === "" || raw == null) return 0;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.round(n * 100));
}

/** "4.50" percent → 450 bps. */
export function percentToBps(raw) {
    if (raw === "" || raw == null) return 0;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.round(n * 100));
}

export function bpsToPercent(bps) {
    return ((Number(bps) || 0) / 100).toFixed(2);
}

export function formatFeeFormula(rule) {
    const mode =
        rule?.fee_mode ||
        (Number(rule?.fee_percent_bps || 0) > 0 ? "percent" : "fixed");
    if (mode === "percent") {
        const bps = Number(rule?.fee_percent_bps || 0);
        return `${bpsToPercent(bps)}%`;
    }
    return `$${centsToDollars(rule?.fee_fixed_cents)}`;
}

export function formatPriceRange(rule) {
    const lo = centsToDollars(rule?.min_price_cents);
    if (rule?.max_price_cents == null) return `desde $${lo}`;
    return `$${lo} – $${centsToDollars(rule.max_price_cents)}`;
}

export function formatQuoteLabel(quote) {
    if (!quote) return "";
    const fee = `$${centsToDollars(quote.fee_cents)}`;
    if (quote.matched) {
        return `${fee} (${formatFeeFormula(quote)} por entrada)`;
    }
    if (quote.fallback) {
        return `${fee} (tarifa general de la plataforma)`;
    }
    return fee;
}
