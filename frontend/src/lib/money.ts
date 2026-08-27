// Single home for USD cents <-> string conversions used across admin and
// event forms. Avoids the scattered per-file copies of these helpers.

export function centsToDollars(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2);
}

export function dollarsToCents(value) {
    if (value === "" || value == null) return 0;
    const n = Number.parseFloat(String(value).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

export function centsToInput(cents) {
    return cents == null ? "" : (cents / 100).toFixed(2);
}
