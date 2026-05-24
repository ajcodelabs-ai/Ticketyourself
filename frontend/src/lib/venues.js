/**
 * Venues — API helpers + element factory pure functions.
 * Phase 6b: added curved row, individual seat, round/rect tables.
 */
import api from "@/lib/api";

export const GRID = 20;
export const VENUE_TYPES = [
    { value: "theater", label: "Teatro" },
    { value: "auditorium", label: "Auditorio" },
    { value: "stadium", label: "Estadio" },
    { value: "fair", label: "Feria" },
    { value: "classroom", label: "Aula" },
    { value: "mixed", label: "Mixto" },
    { value: "other", label: "Otro" },
];
export const STATUS_LABEL = {
    draft: "Borrador",
    published: "Publicado",
    archived: "Archivado",
};

export const LOCALITY_PALETTE = [
    "#6366F1", "#3B82F6", "#10B981", "#F59E0B",
    "#EF4444", "#EC4899", "#8B5CF6", "#14B8A6",
];

export function snap(v) {
    return Math.round(v / GRID) * GRID;
}

export function newId() {
    return crypto.randomUUID();
}

// ── Element factories ─────────────────────────────────────────────────────
export function makeStage(x, y) {
    return {
        id: newId(), kind: "stage",
        x: snap(x), y: snap(y),
        rotation: 0, label: "Escenario",
        locality_id: null, z_index: 0,
        width: 240, height: 80, color: "#9CA3AF",
    };
}

export function makeZone({ x, y, width, height, label, capacity, locality_id }) {
    return {
        id: newId(), kind: "unnumbered_zone",
        x: snap(x), y: snap(y),
        rotation: 0, label: label || "Zona",
        locality_id: locality_id || null, z_index: 1,
        width: Math.max(60, snap(width)),
        height: Math.max(60, snap(height)),
        capacity: capacity || 1,
        color: null,
    };
}

export function makeRow({
    x, y, row_label = "A", seats_count = 10, seat_spacing = 24,
    seat_radius = 10, numbering_start = 1, numbering_direction = "ltr",
    numbering_style = "numeric", locality_id,
}) {
    return {
        id: newId(), kind: "seat_row_straight",
        x: snap(x), y: snap(y), rotation: 0,
        label: `Fila ${row_label}`,
        locality_id: locality_id || null, z_index: 1,
        seats_count, seat_spacing, seat_radius,
        row_label, numbering_start, numbering_direction, numbering_style,
    };
}

export function makeCurvedRow({
    x, y, row_label = "A", seats_count = 12, seat_spacing = 24,
    seat_radius = 10, curve_radius = 240, curve_arc_degrees = 60,
    numbering_start = 1, numbering_direction = "ltr",
    numbering_style = "numeric", locality_id,
}) {
    return {
        id: newId(), kind: "seat_row_curved",
        x: snap(x), y: snap(y), rotation: 0,
        label: `Fila ${row_label} (curva)`,
        locality_id: locality_id || null, z_index: 1,
        seats_count, seat_spacing, seat_radius,
        curve_radius, curve_arc_degrees,
        row_label, numbering_start, numbering_direction, numbering_style,
    };
}

export function makeSeat({ x, y, label = "VIP-1", locality_id }) {
    return {
        id: newId(), kind: "seat_individual",
        x: snap(x), y: snap(y),
        rotation: 0, label,
        locality_id: locality_id || null, z_index: 2,
        seat_radius: 12,
    };
}

export function makeTableRound({
    x, y, table_radius = 40, chairs_count = 6, chair_radius = 10,
    chair_distance = 22, label = "Mesa", locality_id,
}) {
    return {
        id: newId(), kind: "table_round",
        x: snap(x), y: snap(y), rotation: 0,
        label, locality_id: locality_id || null, z_index: 1,
        table_radius, chairs_count, chair_radius, chair_distance,
    };
}

export function makeTableRect({
    x, y, width = 200, height = 100, chairs_per_side,
    chair_radius = 10, chair_distance = 20,
    label = "Mesa rect.", locality_id,
}) {
    return {
        id: newId(), kind: "table_rect",
        x: snap(x), y: snap(y), rotation: 0,
        label, locality_id: locality_id || null, z_index: 1,
        width: Math.max(80, snap(width)),
        height: Math.max(60, snap(height)),
        chairs_per_side: chairs_per_side || { top: 4, right: 0, bottom: 4, left: 0 },
        chair_radius, chair_distance,
    };
}

export function newLocality(name = "Localidad", colorIdx = 0) {
    return {
        id: newId(),
        name,
        color: LOCALITY_PALETTE[colorIdx % LOCALITY_PALETTE.length],
        description: null,
        default_price_cents: null,
    };
}

// ── Capacity ──────────────────────────────────────────────────────────────
export function elementSeats(e) {
    if (e.kind === "unnumbered_zone") return e.capacity || 0;
    if (e.kind === "seat_row_straight" || e.kind === "seat_row_curved") return e.seats_count || 0;
    if (e.kind === "seat_individual") return 1;
    if (e.kind === "table_round") return e.chairs_count || 0;
    if (e.kind === "table_rect") {
        const cps = e.chairs_per_side || {};
        return (cps.top || 0) + (cps.right || 0) + (cps.bottom || 0) + (cps.left || 0);
    }
    return 0;
}

export function computeCapacity(elements) {
    return elements.reduce((s, e) => s + elementSeats(e), 0);
}

export function capacityByLocality(elements, locality_id) {
    return elements.reduce((s, e) => (e.locality_id === locality_id ? s + elementSeats(e) : s), 0);
}

export function elementAcceptsLocality(kind) {
    return kind !== "stage";
}

// ── Bounding box (used for selection + marquee + alignment) ───────────────
// Returns {minX, minY, maxX, maxY, cx, cy} in WORLD coordinates,
// ignoring rotation (good enough for marquee/alignment heuristics).
export function elementBBox(e) {
    if (e.kind === "stage" || e.kind === "unnumbered_zone" || e.kind === "table_rect") {
        const w = e.width || 100;
        const h = e.height || 80;
        return { minX: e.x, minY: e.y, maxX: e.x + w, maxY: e.y + h,
                 cx: e.x + w / 2, cy: e.y + h / 2 };
    }
    if (e.kind === "seat_row_straight") {
        const w = ((e.seats_count || 1) - 1) * (e.seat_spacing || 24) + (e.seat_radius || 10) * 2;
        const h = (e.seat_radius || 10) * 2;
        return { minX: e.x, minY: e.y, maxX: e.x + w, maxY: e.y + h,
                 cx: e.x + w / 2, cy: e.y + h / 2 };
    }
    if (e.kind === "seat_row_curved") {
        const r = e.curve_radius || 240;
        const arc = (e.curve_arc_degrees || 60) * Math.PI / 180;
        const span = 2 * r * Math.sin(arc / 2);
        const depth = r - r * Math.cos(arc / 2);
        const pad = (e.seat_radius || 10) * 2;
        return { minX: e.x - span / 2 - pad, minY: e.y - pad,
                 maxX: e.x + span / 2 + pad, maxY: e.y + depth + pad,
                 cx: e.x, cy: e.y + depth / 2 };
    }
    if (e.kind === "seat_individual") {
        const r = e.seat_radius || 12;
        return { minX: e.x - r, minY: e.y - r, maxX: e.x + r, maxY: e.y + r, cx: e.x, cy: e.y };
    }
    if (e.kind === "table_round") {
        const r = (e.table_radius || 40) + (e.chair_distance || 20) + (e.chair_radius || 10);
        return { minX: e.x - r, minY: e.y - r, maxX: e.x + r, maxY: e.y + r, cx: e.x, cy: e.y };
    }
    return { minX: e.x, minY: e.y, maxX: e.x, maxY: e.y, cx: e.x, cy: e.y };
}

export function bboxIntersects(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

// Auto-increment a label like "VIP-3" -> "VIP-4". Returns next label.
export function bumpLabel(label) {
    const m = (label || "").match(/^(.*?)(\d+)$/);
    if (!m) return `${label || "Asiento"}-2`;
    return `${m[1]}${parseInt(m[2], 10) + 1}`;
}

// ── API ────────────────────────────────────────────────────────────────────
export const venuesApi = {
    list: (params) => api.get("/venues/me", { params }).then((r) => r.data),
    create: (body) => api.post("/venues/me", body).then((r) => r.data),
    get: (id) => api.get(`/venues/me/${id}`).then((r) => r.data),
    update: (id, body) => api.put(`/venues/me/${id}`, body).then((r) => r.data),
    remove: (id) => api.delete(`/venues/me/${id}`),
    duplicate: (id) => api.post(`/venues/me/${id}/duplicate`).then((r) => r.data),
    publish: (id) => api.post(`/venues/me/${id}/publish`).then((r) => r.data),
    archive: (id) => api.post(`/venues/me/${id}/archive`).then((r) => r.data),
    lockStatus: (id) => api.get(`/venues/me/${id}/lock-status`).then((r) => r.data),
    publicGet: (tenant, slug) => api.get(`/public/venues/${tenant}/${slug}`).then((r) => r.data),
};
