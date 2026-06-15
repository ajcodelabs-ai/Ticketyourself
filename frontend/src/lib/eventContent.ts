export function defaultEventContent() {
    return {
        policies_html: "",
        agenda: [],
        faq: [],
    };
}

export function normalizeEventContent(raw) {
    if (!raw || typeof raw !== "object") return defaultEventContent();
    return {
        policies_html: raw.policies_html || "",
        agenda: Array.isArray(raw.agenda) ? raw.agenda : [],
        faq: Array.isArray(raw.faq) ? raw.faq : [],
    };
}

export function newAgendaItem() {
    return {
        id: crypto.randomUUID(),
        time: "",
        title: "",
        description: "",
    };
}

export function newFaqItem() {
    return {
        id: crypto.randomUUID(),
        question: "",
        answer_html: "",
    };
}
