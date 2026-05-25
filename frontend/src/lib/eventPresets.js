/**
 * Time presets for the event wizard — duration of the event and "sales window"
 * offsets. Each preset has a canonical key (persisted on the event) and an
 * `offsetMinutes` used to derive the absolute ISO dates from `starts_at`.
 *
 * `custom` carries no offset and signals the UI to render numeric inputs.
 */

export const DURATION_PRESETS = [
    { key: "30m", label: "30 minutos", minutes: 30 },
    { key: "1h", label: "1 hora", minutes: 60 },
    { key: "2h", label: "2 horas", minutes: 120 },
    { key: "3h", label: "3 horas", minutes: 180 },
    { key: "4h", label: "4 horas", minutes: 240 },
    { key: "6h", label: "6 horas", minutes: 360 },
    { key: "8h", label: "8 horas", minutes: 480 },
    { key: "12h", label: "Todo el día (12 h)", minutes: 720 },
    { key: "2d", label: "2 días", minutes: 60 * 24 * 2 },
    { key: "3d", label: "3 días", minutes: 60 * 24 * 3 },
    { key: "1w", label: "1 semana", minutes: 60 * 24 * 7 },
    { key: "custom", label: "Personalizado", minutes: null },
];

export const SALES_START_PRESETS = [
    { key: "immediate", label: "Inmediatamente", offsetMinutes: 0 },
    { key: "1d_before", label: "1 día antes del evento", offsetMinutes: 60 * 24 },
    { key: "1w_before", label: "1 semana antes", offsetMinutes: 60 * 24 * 7 },
    { key: "2w_before", label: "2 semanas antes", offsetMinutes: 60 * 24 * 14 },
    { key: "1m_before", label: "1 mes antes", offsetMinutes: 60 * 24 * 30 },
    { key: "2m_before", label: "2 meses antes", offsetMinutes: 60 * 24 * 60 },
    { key: "custom", label: "Fecha y hora personalizada", offsetMinutes: null },
];

export const SALES_END_PRESETS = [
    { key: "at_start", label: "Al iniciar el evento", offsetMinutes: 0 },
    { key: "1h_before", label: "1 hora antes del evento", offsetMinutes: 60 },
    { key: "4h_before", label: "4 horas antes del evento", offsetMinutes: 60 * 4 },
    { key: "24h_before", label: "24 horas antes del evento", offsetMinutes: 60 * 24 },
    { key: "1w_before", label: "1 semana antes del evento", offsetMinutes: 60 * 24 * 7 },
    { key: "custom", label: "Fecha y hora personalizada", offsetMinutes: null },
];

const TOLERANCE_MIN = 1; // allow 1-minute drift when matching legacy events

function findByMinutes(list, mins) {
    return list.find(
        (p) =>
            p.minutes != null && Math.abs((p.minutes ?? Number.NaN) - mins) <= TOLERANCE_MIN,
    );
}

function findByOffset(list, mins) {
    return list.find(
        (p) =>
            p.offsetMinutes != null &&
            Math.abs((p.offsetMinutes ?? Number.NaN) - mins) <= TOLERANCE_MIN,
    );
}

/**
 * Reverse-engineer the duration preset from existing ISO dates. Returns
 * `{ preset, minutes }` where `preset` is a known key or "custom".
 */
export function inferDurationPreset(startsIso, endsIso) {
    if (!startsIso || !endsIso) return { preset: "1h", minutes: 60 };
    const startsMs = new Date(startsIso).getTime();
    const endsMs = new Date(endsIso).getTime();
    if (!isFinite(startsMs) || !isFinite(endsMs) || endsMs <= startsMs) {
        return { preset: "1h", minutes: 60 };
    }
    const mins = Math.round((endsMs - startsMs) / 60000);
    const match = findByMinutes(DURATION_PRESETS, mins);
    return match
        ? { preset: match.key, minutes: match.minutes }
        : { preset: "custom", minutes: mins };
}

/**
 * Reverse-engineer the sales-window preset given the event's starts_at and
 * the persisted sales_start/sales_end. Returns the preset key (or "custom").
 */
export function inferSalesStartPreset(startsIso, salesStartIso) {
    if (!salesStartIso) return "immediate";
    if (!startsIso) return "custom";
    const startsMs = new Date(startsIso).getTime();
    const ssMs = new Date(salesStartIso).getTime();
    if (!isFinite(startsMs) || !isFinite(ssMs)) return "custom";
    const mins = Math.round((startsMs - ssMs) / 60000);
    if (mins <= TOLERANCE_MIN) return "immediate";
    const match = findByOffset(SALES_START_PRESETS, mins);
    return match ? match.key : "custom";
}

export function inferSalesEndPreset(startsIso, salesEndIso) {
    if (!salesEndIso) return "at_start";
    if (!startsIso) return "custom";
    const startsMs = new Date(startsIso).getTime();
    const seMs = new Date(salesEndIso).getTime();
    if (!isFinite(startsMs) || !isFinite(seMs)) return "custom";
    const mins = Math.round((startsMs - seMs) / 60000);
    if (mins <= TOLERANCE_MIN) return "at_start";
    const match = findByOffset(SALES_END_PRESETS, mins);
    return match ? match.key : "custom";
}

/**
 * Compute `ends_at` from `starts_at` + duration preset.
 */
export function computeEndsAt(startsIso, preset, customMinutes) {
    if (!startsIso) return "";
    const startMs = new Date(startsIso).getTime();
    if (!isFinite(startMs)) return "";
    const def = DURATION_PRESETS.find((p) => p.key === preset);
    const mins = preset === "custom" ? customMinutes : def?.minutes ?? 60;
    if (!mins || mins <= 0) return "";
    return new Date(startMs + mins * 60000).toISOString();
}

export function computeSalesStart(startsIso, preset, customIso) {
    if (preset === "custom") return customIso || null;
    if (!startsIso) return null;
    const def = SALES_START_PRESETS.find((p) => p.key === preset);
    if (!def || def.offsetMinutes == null) return null;
    if (def.offsetMinutes === 0) return null; // immediate
    const startMs = new Date(startsIso).getTime();
    if (!isFinite(startMs)) return null;
    return new Date(startMs - def.offsetMinutes * 60000).toISOString();
}

export function computeSalesEnd(startsIso, preset, customIso) {
    if (preset === "custom") return customIso || null;
    if (!startsIso) return null;
    const def = SALES_END_PRESETS.find((p) => p.key === preset);
    if (!def || def.offsetMinutes == null) return null;
    if (def.offsetMinutes === 0) return null; // at_start (defaults to event start)
    const startMs = new Date(startsIso).getTime();
    if (!isFinite(startMs)) return null;
    return new Date(startMs - def.offsetMinutes * 60000).toISOString();
}
