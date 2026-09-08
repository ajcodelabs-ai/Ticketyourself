/**
 * Spanish copy for the super-admin organizer list + detail.
 * API values stay in English (pending, none, past_due…); this module
 * is the only place those tokens become labels a reviewer can read.
 */

export const ORG_STATUS_LABEL = {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    suspended: "Suspendido",
};

export const ORG_STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
    suspended: "bg-slate-200 text-slate-700",
};

export const SUBSCRIPTION_STATUS_LABEL = {
    none: "Sin suscripción",
    trialing: "Periodo de prueba",
    active: "Activa",
    past_due: "Pago atrasado",
    canceled: "Cancelada",
};

export const SUBSCRIPTION_STATUS_STYLE = {
    active: "bg-emerald-100 text-emerald-800",
    trialing: "bg-sky-100 text-sky-800",
    past_due: "bg-amber-100 text-amber-900",
    canceled: "bg-slate-100 text-slate-700",
    none: "bg-slate-100 text-slate-600",
};

export const ORG_TYPE_LABEL = {
    individual: "Persona natural",
    company: "Empresa",
};

export const VERIFICATION_FEE_LABEL = {
    none: "No aplica",
    pending: "Pendiente de pago",
    paid: "Pagada",
    waived: "Exonerada",
};

export const CONTRACT_STATUS_LABEL = {
    none: "Sin contrato",
    pending: "Pendiente",
    sent: "Enviado",
    signed: "Firmado",
};

export const SOCIAL_LABELS = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    x: "X (Twitter)",
    twitter: "X (Twitter)",
    website: "Sitio web",
    linkedin: "LinkedIn",
    youtube: "YouTube",
};

export const SORT_COLUMN_LABEL = {
    company_name: "nombre",
    email: "email",
    events_published: "eventos publicados",
    tickets_emitted: "tickets",
    revenue: "ingresos",
    last_login: "última visita",
    created_at: "fecha de registro",
};

export const ACCOUNT_ACTION_LABEL = {
    approve: "aprobado",
    reject: "rechazado",
    suspend: "suspendido",
    comment: "comentario guardado",
};

const UAFE_FIELD_META = {
    funds_origin_declared: {
        label: "Declaró origen lícito de fondos",
        kind: "bool",
    },
    funds_origin_detail: {
        label: "Origen de los fondos",
        kind: "text",
    },
    accepts_uafe_obligations: {
        label: "Aceptó obligaciones UAFE",
        kind: "bool",
    },
};

const UAFE_KNOWN_KEYS = Object.keys(UAFE_FIELD_META);

export function orgStatusLabel(status) {
    return ORG_STATUS_LABEL[status] || status || "—";
}

export function subscriptionStatusLabel(status) {
    return SUBSCRIPTION_STATUS_LABEL[status] || status || "—";
}

export function orgTypeLabel(orgType) {
    return ORG_TYPE_LABEL[orgType] || orgType || "—";
}

export function verificationFeeLabel(status) {
    return VERIFICATION_FEE_LABEL[status] || status || "—";
}

export function contractStatusLabel(status) {
    return CONTRACT_STATUS_LABEL[status] || status || "—";
}

export function sortColumnLabel(col) {
    return SORT_COLUMN_LABEL[col] || col;
}

export function accountActionLabel(action) {
    return ACCOUNT_ACTION_LABEL[action] || action;
}

export function yesNo(value) {
    if (value === true) return "Sí";
    if (value === false) return "No";
    return "—";
}

function titleFromKey(key) {
    return String(key || "")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function looksLikeUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
}

function socialHref(key, value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (looksLikeUrl(raw)) return raw;
    const handle = raw.replace(/^@/, "");
    if (key === "website") {
        return `https://${handle}`;
    }
    const hosts = {
        instagram: `https://instagram.com/${handle}`,
        facebook: `https://facebook.com/${handle}`,
        tiktok: `https://tiktok.com/@${handle}`,
        x: `https://x.com/${handle}`,
        twitter: `https://x.com/${handle}`,
        linkedin: `https://linkedin.com/in/${handle}`,
        youtube: `https://youtube.com/@${handle}`,
    };
    return hosts[key] || null;
}

/**
 * Flatten UAFE JSON into labeled rows. Known Ecuador fields get Spanish
 * copy; anything extra still renders as a row instead of a code block.
 */
export function uafeRows(declaration) {
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
        return [];
    }
    const rows = [];
    for (const key of UAFE_KNOWN_KEYS) {
        if (!(key in declaration)) continue;
        const raw = declaration[key];
        const meta = UAFE_FIELD_META[key];
        rows.push({
            key,
            label: meta.label,
            value: meta.kind === "bool" ? yesNo(Boolean(raw)) : String(raw || "").trim() || "—",
            kind: meta.kind,
            ok: meta.kind === "bool" ? Boolean(raw) : undefined,
        });
    }
    for (const [key, raw] of Object.entries(declaration)) {
        if (UAFE_KNOWN_KEYS.includes(key)) continue;
        const isBool = typeof raw === "boolean";
        rows.push({
            key,
            label: titleFromKey(key),
            value: isBool
                ? yesNo(raw)
                : raw == null || raw === ""
                  ? "—"
                  : typeof raw === "object"
                    ? JSON.stringify(raw)
                    : String(raw),
            kind: isBool ? "bool" : "text",
            ok: isBool ? raw : undefined,
        });
    }
    return rows;
}

export function referenceRows(refs) {
    if (!Array.isArray(refs)) return [];
    return refs
        .filter((r) => r && (String(r.name || "").trim() || String(r.phone || "").trim()))
        .map((r, index) => ({
            key: String(r.id || index),
            name: String(r.name || "").trim() || "Sin nombre",
            phone: String(r.phone || "").trim() || "—",
            relation: String(r.relation || "").trim(),
        }));
}

export function socialLinkRows(links) {
    if (!links || typeof links !== "object" || Array.isArray(links)) return [];
    return Object.entries(links)
        .filter(([, value]) => String(value || "").trim())
        .map(([key, value]) => {
            const display = String(value).trim();
            return {
                key,
                label: SOCIAL_LABELS[key] || titleFromKey(key),
                value: display,
                href: socialHref(key, display),
            };
        });
}

export function mimeShortLabel(mime) {
    if (!mime) return "";
    if (mime === "application/pdf") return "PDF";
    if (mime.startsWith("image/")) return "Imagen";
    return mime;
}

export function fileSizeLabel(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    return `${(n / 1024).toFixed(1)} KB`;
}

/** Catalog name for a plan code, falling back to the stored token. */
export function planDisplayName(code, plans) {
    const token = String(code || "").trim();
    if (!token) return "";
    const match = (plans || []).find((p) => p && p.code === token);
    return (match && match.name) || token;
}

/** Verificante sometimes returns an HTML snippet; the admin UI shows plain text. */
export function plainTextFromHtml(value) {
    if (value == null) return "";
    if (typeof value !== "string") {
        try {
            return JSON.stringify(value);
        } catch {
            return "";
        }
    }
    // Decode &amp; last so a double-encoded sequence like &amp;lt; becomes
    // "&lt;" (one level), not "<". CodeQL js/double-escaping.
    return value
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
}
