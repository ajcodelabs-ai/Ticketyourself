/**
 * PRD §4.2.4 — Formato de asistencia / venue helpers.
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

const SEAT_KINDS = new Set([
    "seat_row_straight",
    "seat_row_curved",
    "seat_individual",
    "table_round",
    "table_rect",
]);

export function layoutHasNumberedSeats(elements: any[] | null | undefined): boolean {
    return (elements || []).some((e) => SEAT_KINDS.has(e?.kind));
}

export function layoutHasUnnumberedZones(elements: any[] | null | undefined): boolean {
    return (elements || []).some((e) => e?.kind === "unnumbered_zone");
}

/** Infer PRD attendance format from event + optional layout elements. */
export function inferAttendanceFormat(event: any): AttendanceFormat {
    if (!event?.venue_id) {
        const saved = event?.access_params?.attendance_format;
        if (saved === "numbered" || saved === "general" || saved === "mixed") {
            return saved;
        }
        return "general";
    }
    const saved = event?.access_params?.attendance_format;
    if (saved === "mixed") return "mixed";
    const elements =
        event.venue_layout?.elements ||
        event.venue?.elements ||
        [];
    const seats = layoutHasNumberedSeats(elements);
    const zones = layoutHasUnnumberedZones(elements);
    if (seats && zones) return "mixed";
    if (saved === "general") return "general";
    return "numbered";
}
