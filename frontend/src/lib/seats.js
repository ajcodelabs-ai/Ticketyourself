/**
 * Phase 7 — Seat helpers (frontend).
 *
 * Mirrors `backend/services/seats.py` for seat-id generation + position
 * resolution. Only used in read/select flows; the editor still relies on the
 * legacy ElementShape.
 */

export const SEAT_HOLD_TOKEN_KEY = "tys.seat_holds.session_token";

export function getOrCreateSessionToken() {
    let token = localStorage.getItem(SEAT_HOLD_TOKEN_KEY);
    if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem(SEAT_HOLD_TOKEN_KEY, token);
    }
    return token;
}

export function resetSessionToken() {
    localStorage.removeItem(SEAT_HOLD_TOKEN_KEY);
}

// Status colors (consistent with backend seats_status field)
export const SEAT_STATUS_COLORS = {
    available: null, // use locality color
    selected: "#0EA5E9", // sky-500
    held_by_me: "#0EA5E9",
    held: "#D1D5DB",  // slate-300
    sold: "#4B5563",  // slate-600
};

// Resolve world (x, y) of a seat given its element and sub_index.
export function seatWorldPos(element, sub_index) {
    if (!element) return { x: 0, y: 0 };
    if (element.kind === "seat_row_straight") {
        const spacing = element.seat_spacing || 24;
        const radius = element.seat_radius || 10;
        return {
            x: element.x + sub_index * spacing + radius,
            y: element.y + radius,
        };
    }
    if (element.kind === "seat_row_curved") {
        const seats = element.seats_count || 1;
        const arcRad = ((element.curve_arc_degrees || 60) * Math.PI) / 180;
        const cr = element.curve_radius || 240;
        const startAngle = Math.PI / 2 + arcRad / 2;
        const stepAngle = seats > 1 ? -arcRad / (seats - 1) : 0;
        const a = startAngle + sub_index * stepAngle;
        return {
            x: element.x + cr * Math.cos(a),
            y: element.y - cr + cr * Math.sin(a),
        };
    }
    if (element.kind === "seat_individual") {
        return { x: element.x, y: element.y };
    }
    if (element.kind === "table_round") {
        const tr = element.table_radius || 40;
        const cd = element.chair_distance || 22;
        const n = element.chairs_count || 6;
        const a = -Math.PI / 2 + (sub_index * 2 * Math.PI) / n;
        const ring = tr + cd;
        return {
            x: element.x + ring * Math.cos(a),
            y: element.y + ring * Math.sin(a),
        };
    }
    if (element.kind === "table_rect") {
        const cps = element.chairs_per_side || {};
        const cd = element.chair_distance || 18;
        const cr = element.chair_radius || 10;
        const w = element.width || 200;
        const h = element.height || 100;
        let idx = sub_index;
        const sides = ["top", "right", "bottom", "left"];
        for (const side of sides) {
            const count = cps[side] || 0;
            if (idx < count) {
                const t = count === 1 ? 0.5 : idx / (count - 1);
                if (side === "top") return { x: element.x + t * w, y: element.y - cd - cr };
                if (side === "bottom") return { x: element.x + t * w, y: element.y + h + cd + cr };
                if (side === "left") return { x: element.x - cd - cr, y: element.y + t * h };
                if (side === "right") return { x: element.x + w + cd + cr, y: element.y + t * h };
            }
            idx -= count;
        }
    }
    return { x: 0, y: 0 };
}

export function seatRadius(element) {
    if (!element) return 10;
    if (element.kind === "seat_individual") return element.seat_radius || 12;
    if (element.kind === "seat_row_straight" || element.kind === "seat_row_curved") return element.seat_radius || 10;
    if (element.kind === "table_round") return element.chair_radius || 10;
    if (element.kind === "table_rect") return element.chair_radius || 10;
    return 10;
}

// Total of selected seats given event.locality_pricing + seats_status entries
export function selectedSubtotalCents(selectedSeats, localityPricing) {
    const priceByLoc = Object.fromEntries(
        (localityPricing || []).map((lp) => [lp.locality_id, lp.price_cents]),
    );
    return selectedSeats.reduce(
        (s, seat) => s + (priceByLoc[seat.locality_id] || 0), 0,
    );
}

export const FEE_PERCENT = 5; // mirrors backend DEFAULT_FEE_PERCENT
export function feesForSubtotal(subtotal) {
    return Math.round((subtotal * FEE_PERCENT) / 100);
}
