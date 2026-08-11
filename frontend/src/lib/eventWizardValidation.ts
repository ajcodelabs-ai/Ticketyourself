/**
 * Client-side checklist for EventWizard save / publish.
 * Returns concrete Spanish messages + step ids so the UI can jump the user there.
 */

import { resolveEnabledPaymentCodes } from "@/lib/paymentMethods";

/**
 * @param {'draft' | 'publish'} mode
 * @returns {{ step: string, message: string, code: string }[]}
 */
export function collectEventWizardIssues({
    form,
    poster,
    currentEvent,
    pendingVenueId = null,
    mode = "draft",
    organizerStatus = null,
}) {
    const issues = [];
    const push = (step, code, message) => {
        issues.push({ step, code, message });
    };

    const title = (form?.title || "").trim();
    if (title.length < 2) {
        push(
            "general",
            "title",
            "Falta el título del evento (mínimo 2 caracteres) en General.",
        );
    }

    if (!form?.starts_at) {
        push(
            "fechas",
            "starts_at",
            "Definí la fecha y hora de inicio en Fechas y ventas.",
        );
    }

    const durationOk =
        form?.duration_preset && form.duration_preset !== "custom"
            ? true
            : Number(form?.duration_minutes_custom || 0) > 0;
    if (!durationOk) {
        push(
            "fechas",
            "duration",
            form?.duration_preset === "custom"
                ? "Indicá la duración personalizada en minutos (mayor a 0)."
                : "Elegí cuánto dura el evento en Fechas y ventas.",
        );
    }

    if (form?.sales_window_preset_start === "custom" && !form?.sales_start_custom) {
        push(
            "fechas",
            "sales_start_custom",
            "Elegiste inicio de venta personalizado: completá esa fecha.",
        );
    }
    if (form?.sales_window_preset_end === "custom" && !form?.sales_end_custom) {
        push(
            "fechas",
            "sales_end_custom",
            "Elegiste fin de venta personalizado: completá esa fecha.",
        );
    }

    // Draft only needs title + schedule (backend EventBase).
    if (mode === "draft") {
        return issues;
    }

    // ── Publish-only ──────────────────────────────────────────────────────
    if (organizerStatus && organizerStatus !== "approved") {
        push(
            "general",
            "organizer_pending",
            "Tu cuenta todavía está en revisión por TYS. Podés guardar el borrador, pero no publicar hasta la aprobación.",
        );
    }

    const hasPoster = !!(poster || currentEvent?.poster_url);
    if (!hasPoster) {
        push(
            "media",
            "poster",
            "Subí la imagen principal en Media (obligatoria para publicar).",
        );
    }

    const seated = !form?.no_seating_mode;
    const hasVenue = !!(
        form?.venue_id ||
        currentEvent?.venue_id ||
        pendingVenueId
    );
    const localityPricing = currentEvent?.locality_pricing || [];

    if (seated) {
        if (!hasVenue) {
            push(
                "localidades",
                "venue",
                "Vinculá un mapa (venue) publicado en Localidades.",
            );
        } else if (pendingVenueId && !currentEvent?.venue_id) {
            push(
                "localidades",
                "locality_pricing_pending",
                "Guardá el borrador para vincular el mapa y después configurá los precios por localidad.",
            );
        } else if (!localityPricing.length) {
            push(
                "localidades",
                "locality_pricing",
                "Configurá el precio de cada localidad en Localidades.",
            );
        } else {
            const invalid = localityPricing.filter(
                (lp) => lp.price_cents == null || Number(lp.price_cents) < 0,
            );
            if (invalid.length) {
                push(
                    "localidades",
                    "locality_price_invalid",
                    "Hay localidades sin precio válido. Revisá la tabla de precios.",
                );
            }
            const hasPaidLocality = localityPricing.some(
                (lp) => Number(lp.price_cents) > 0,
            );
            if (hasPaidLocality && form?.pricing_type === "free") {
                push(
                    "general",
                    "pricing_type_mismatch",
                    "Tenés localidades con precio pero el tipo de recaudación es Gratuito. Cambialo a Pagado en General.",
                );
            }
        }
    } else {
        if (!(form?.venue_name || "").trim()) {
            push(
                "localidades",
                "venue_name",
                "Indicá el nombre del lugar en Localidades.",
            );
        }
        if (
            form?.pricing_type === "paid" &&
            !(Number(form?.base_price_dollars) > 0)
        ) {
            push(
                "localidades",
                "base_price",
                "Definí el precio base del evento (mayor a $0) en Localidades.",
            );
        }
    }

    if (form?.pricing_type !== "free") {
        const enabledCodes = resolveEnabledPaymentCodes(form?.payment_methods, {
            includeLegacyStripe: false,
        });
        if (!enabledCodes.length) {
            push(
                "payments",
                "payment_methods",
                "Activá al menos una forma de pago en Formas de pago.",
            );
        }
    }

    return issues;
}

export function stepLabelForIssue(stepId, steps) {
    return steps?.find((s) => s.id === stepId)?.label || stepId;
}
