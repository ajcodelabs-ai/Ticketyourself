import { uuid } from "@/lib/utils";

export function defaultEventContent() {
    return {
        policies_html: "",
        agenda: [],
        faq: [],
        tyc_url: null,
        tyc_label: "",
        allow_full_group_purchase: false,
    };
}

// Backend's `content` JSONB column is replaced wholesale on every PUT (see
// EventContent in routers/events.py) — any field this allowlist drops here
// gets silently reset to its default on the very next save, even one meant
// to change something unrelated (a typo in the description, a new photo).
// This used to only keep policies_html/agenda/faq, wiping out an organizer's
// TyC link and "compra de fila/mesa completa" setting the first time they
// reopened an existing event and saved anything at all.
export function normalizeEventContent(raw) {
    if (!raw || typeof raw !== "object") return defaultEventContent();
    return {
        policies_html: raw.policies_html || "",
        agenda: Array.isArray(raw.agenda) ? raw.agenda : [],
        faq: Array.isArray(raw.faq) ? raw.faq : [],
        tyc_url: raw.tyc_url || null,
        tyc_label: raw.tyc_label || "",
        allow_full_group_purchase: !!raw.allow_full_group_purchase,
    };
}

export function newAgendaItem() {
    return {
        id: uuid(),
        time: "",
        title: "",
        description: "",
    };
}

export function newFaqItem() {
    return {
        id: uuid(),
        question: "",
        answer_html: "",
    };
}
