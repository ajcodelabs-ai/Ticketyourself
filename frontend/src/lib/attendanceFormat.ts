/**
 * PRD §4.2.4 — Formato de asistencia / venue helpers.
 *
 * Seating type lives on the locality (numbered | unnumbered). The event
 * format (numbered | general | mixed) is inferred from those localities —
 * never chosen as a third locality type.
 */

export const ATTENDANCE_FORMATS = {
    numbered: {
        value: "numbered",
        title: "Numerado",
        description:
            "Asientos individuales con mapa interactivo. El comprador elige su butaca.",
    },
    general: {
        value: "general",
        title: "No numerado",
        description:
            "El comprador elige la cantidad de entradas. Sin asignación de asiento.",
    },
    mixed: {
        value: "mixed",
        title: "Mixto",
        description:
            "Zonas numeradas y no numeradas en el mismo evento (mapa + aforo general).",
    },
} as const;

export type AttendanceFormat = keyof typeof ATTENDANCE_FORMATS;

/** Seating mode lives on the locality (wizard 4.2). Event mixed is inferred. */
export const LOCALITY_SEATING_TYPES = {
    numbered: {
        value: "numbered",
        title: "Numerada",
        description: "Asientos o mesas con butaca asignada en el mapa.",
    },
    unnumbered: {
        value: "unnumbered",
        title: "No numerada",
        description: "Zona de aforo general: el comprador elige cantidad, no butaca.",
    },
} as const;

export type LocalitySeatingType = keyof typeof LOCALITY_SEATING_TYPES;

const SEAT_KINDS = new Set([
    "seat_row_straight",
    "seat_row_curved",
    "seat_individual",
    "table_round",
    "table_rect",
]);

const UNNUMBERED_KINDS = new Set(["unnumbered_zone"]);

/** Locality is numbered or unnumbered. Legacy `mixed` collapses to numbered. */
export function normalizeLocalitySeatingType(
    type?: string | null,
): LocalitySeatingType {
    return type === "unnumbered" ? "unnumbered" : "numbered";
}

/**
 * Resolve a stored seating_type to numbered | unnumbered.
 * Legacy `mixed` uses assigned map kinds: zones-only → unnumbered, else numbered.
 */
export function coerceLocalitySeatingType(
    type: string | null | undefined,
    assignedKinds: Array<string | null | undefined> = [],
): LocalitySeatingType {
    if (type === "unnumbered") return "unnumbered";
    if (type === "numbered") return "numbered";
    const kinds = (assignedKinds || []).filter((k) => k && k !== "stage");
    const hasZones = kinds.some((k) => UNNUMBERED_KINDS.has(k as string));
    const hasSeats = kinds.some((k) => SEAT_KINDS.has(k as string));
    if (hasZones && !hasSeats) return "unnumbered";
    return "numbered";
}

export function elementMatchesSeatingType(
    kind: string | null | undefined,
    seatingType: LocalitySeatingType | string,
): boolean {
    if (!kind || kind === "stage") return false;
    const normalized = normalizeLocalitySeatingType(seatingType);
    if (normalized === "unnumbered") return UNNUMBERED_KINDS.has(kind);
    return SEAT_KINDS.has(kind);
}

export function inferAttendanceFormatFromLocalities(
    localities: Array<{ seating_type?: string }> | null | undefined,
): AttendanceFormat {
    let hasNumbered = false;
    let hasUnnumbered = false;
    for (const loc of localities || []) {
        const raw = loc?.seating_type || "numbered";
        // Legacy mixed locality still means the event had both channels.
        if (raw === "mixed") {
            hasNumbered = true;
            hasUnnumbered = true;
            continue;
        }
        if (raw === "unnumbered") hasUnnumbered = true;
        else hasNumbered = true;
    }
    if (hasNumbered && hasUnnumbered) return "mixed";
    if (hasUnnumbered) return "general";
    return "numbered";
}

export function layoutHasNumberedSeats(elements: any[] | null | undefined): boolean {
    return (elements || []).some((e) => SEAT_KINDS.has(e?.kind));
}

export function layoutHasUnnumberedZones(elements: any[] | null | undefined): boolean {
    return (elements || []).some((e) => e?.kind === "unnumbered_zone");
}

/**
 * When the plan has no numbered seating, a map with butacas cannot sell those
 * seats. Mixed maps can still sell GA zones. Seat-only maps cannot sell at all.
 */
export function planLayoutSeatingConflict(
    elements: any[] | null | undefined,
    allowNumbered: boolean,
): "none" | "numbered_unused" | "numbered_only_blocked" {
    if (allowNumbered) return "none";
    const seats = layoutHasNumberedSeats(elements);
    if (!seats) return "none";
    return layoutHasUnnumberedZones(elements) ? "numbered_unused" : "numbered_only_blocked";
}

export const PLAN_SEATING_COPY = {
    numbered_unused:
        "Este mapa tiene filas o asientos numerados. Tu plan no incluye butacas: solo podés asignar zonas de aforo. Las butacas no se venden hasta que mejores el plan.",
    numbered_only_blocked:
        "Este escenario solo tiene asientos numerados y tu plan no incluye esa función. Podés dejarlo vinculado, pero para vender entradas necesitás un mapa con zonas de aforo o mejorar el plan.",
} as const;

/** Infer event attendance format from localities first, then layout shape. */
export function inferAttendanceFormat(event: any): AttendanceFormat {
    const layoutLocs = event?.venue_layout?.localities;
    if (Array.isArray(layoutLocs) && layoutLocs.some((l) => l?.seating_type)) {
        return inferAttendanceFormatFromLocalities(layoutLocs);
    }
    if (!event?.venue_id) {
        const saved = event?.access_params?.attendance_format;
        if (saved === "numbered" || saved === "general" || saved === "mixed") {
            return saved;
        }
        return "general";
    }
    const elements =
        event.venue_layout?.elements ||
        event.venue?.elements ||
        [];
    const seats = layoutHasNumberedSeats(elements);
    const zones = layoutHasUnnumberedZones(elements);
    if (seats && zones) return "mixed";
    if (zones && !seats) return "general";
    return "numbered";
}
