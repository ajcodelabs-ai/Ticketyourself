/**
 * Venues — API helpers + element factory pure functions.
 *
 * Element model (matches backend `routers/venues.py:VenueElement`).
 * Keep this file pure: no React, no fetch lifecycle.
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

// Default palette for new localities — rotated through.
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
        id: newId(),
        kind: "stage",
        x: snap(x), y: snap(y),
        rotation: 0, label: "Escenario",
        locality_id: null, z_index: 0,
        width: 240, height: 80, color: "#9CA3AF",
    };
}

export function makeZone({ x, y, width, height, label, capacity, locality_id }) {
    return {
        id: newId(),
        kind: "unnumbered_zone",
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
        id: newId(),
        kind: "seat_row_straight",
        x: snap(x), y: snap(y), rotation: 0,
        label: `Fila ${row_label}`,
        locality_id: locality_id || null, z_index: 1,
        seats_count, seat_spacing, seat_radius,
        row_label, numbering_start, numbering_direction, numbering_style,
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

// Total capacity = sum of zone capacities + sum of row seats.
export function computeCapacity(elements) {
    return elements.reduce((s, e) => {
        if (e.kind === "unnumbered_zone") return s + (e.capacity || 0);
        if (e.kind === "seat_row_straight") return s + (e.seats_count || 0);
        return s;
    }, 0);
}

// Capacity assigned per locality.
export function capacityByLocality(elements, locality_id) {
    return elements.reduce((s, e) => {
        if (e.locality_id !== locality_id) return s;
        if (e.kind === "unnumbered_zone") return s + (e.capacity || 0);
        if (e.kind === "seat_row_straight") return s + (e.seats_count || 0);
        return s;
    }, 0);
}

export function elementAcceptsLocality(kind) {
    return kind === "unnumbered_zone" || kind === "seat_row_straight";
}

// Bounding box of a seat row (used for selection / size text).
export function rowSize(el) {
    const w = ((el.seats_count || 1) - 1) * (el.seat_spacing || 24) + (el.seat_radius || 10) * 2;
    const h = (el.seat_radius || 10) * 2;
    return { w, h };
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
