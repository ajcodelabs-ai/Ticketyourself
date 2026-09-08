/**
 * Friendly admin editors for registration-country settings.
 * The API still stores a regex + JSON schema; this module translates
 * those into plain-language options a non-developer can edit.
 */

export const DEFAULT_COMPLIANCE_SCHEMA = {
    pep: {
        label: "Persona políticamente expuesta (PEP)",
        description:
            "Indica si tú o un familiar cercano ocupa o ha ocupado un cargo público relevante.",
        require_details_if_true: true,
    },
    uafe: {
        label: "Declaración UAFE",
        description:
            "Declaración de origen de fondos y conocimiento de obligaciones frente a la UAFE (Ecuador).",
        fields: [
            {
                key: "funds_origin_declared",
                type: "boolean",
                label: "Declaro que los fondos provienen de actividades lícitas",
                required: true,
            },
            {
                key: "funds_origin_detail",
                type: "text",
                label: "Descripción del origen de los fondos",
                required: true,
            },
            {
                key: "accepts_uafe_obligations",
                type: "boolean",
                label: "Acepto las obligaciones de prevención de lavado de activos",
                required: true,
            },
        ],
    },
    references: {
        label: "Referencias",
        description: "Al menos una referencia comercial o personal.",
        min_count: 1,
        max_count: 5,
        fields: [
            { key: "name", type: "text", label: "Nombre", required: true },
            { key: "phone", type: "text", label: "Teléfono", required: true },
            { key: "relation", type: "text", label: "Relación / cargo", required: false },
        ],
    },
};

/** @typedef {"none" | "digits_exact" | "digits_range" | "digits_either" | "custom"} LegalIdKind */

function readCountedDigits(source) {
    if (!source.startsWith("\\d{")) return null;
    const close = source.indexOf("}", 3);
    if (close < 0) return null;
    return { spec: source.slice(3, close), rest: source.slice(close + 1) };
}

/**
 * @param {string | null | undefined} pattern
 * @returns {{
 *   kind: LegalIdKind,
 *   digits?: number,
 *   minDigits?: number,
 *   maxDigits?: number,
 *   eitherA?: number,
 *   eitherB?: number,
 *   customPattern?: string,
 * }}
 */
export function parseLegalIdPattern(pattern) {
    const raw = String(pattern || "").trim();
    if (!raw) return { kind: "none" };

    const unanchored = raw.startsWith("^") ? raw.slice(1) : raw;
    const body = unanchored.endsWith("$") ? unanchored.slice(0, -1) : unanchored;

    if (body.startsWith("(") && body.endsWith(")")) {
        const inner = body.slice(1, -1);
        const first = readCountedDigits(inner);
        if (first && first.rest.startsWith("|") && !first.spec.includes(",")) {
            const second = readCountedDigits(first.rest.slice(1));
            if (second && second.rest === "" && !second.spec.includes(",")) {
                const eitherA = Number(first.spec);
                const eitherB = Number(second.spec);
                if (Number.isInteger(eitherA) && Number.isInteger(eitherB)) {
                    return { kind: "digits_either", eitherA, eitherB };
                }
            }
        }
    }

    const one = readCountedDigits(body);
    if (one && one.rest === "") {
        if (one.spec.includes(",")) {
            const [minRaw, maxRaw] = one.spec.split(",");
            const minDigits = Number(minRaw);
            const maxDigits = Number(maxRaw);
            if (Number.isInteger(minDigits) && Number.isInteger(maxDigits)) {
                if (minDigits === maxDigits) return { kind: "digits_exact", digits: minDigits };
                return { kind: "digits_range", minDigits, maxDigits };
            }
        } else {
            const digits = Number(one.spec);
            if (Number.isInteger(digits)) return { kind: "digits_exact", digits };
        }
    }

    return { kind: "custom", customPattern: raw };
}

export function buildLegalIdPattern(format) {
    if (!format || format.kind === "none") return null;
    if (format.kind === "custom") return format.customPattern || null;

    const n = (value, fallback) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 1) return fallback;
        return Math.min(40, Math.round(num));
    };

    if (format.kind === "digits_exact") {
        return `^\\d{${n(format.digits, 10)}}$`;
    }
    if (format.kind === "digits_range") {
        const min = n(format.minDigits, 8);
        const max = Math.max(min, n(format.maxDigits, 13));
        if (min === max) return `^\\d{${min}}$`;
        return `^\\d{${min},${max}}$`;
    }
    if (format.kind === "digits_either") {
        const a = n(format.eitherA, 10);
        const b = n(format.eitherB, 13);
        if (a === b) return `^\\d{${a}}$`;
        return `^(\\d{${a}}|\\d{${b}})$`;
    }
    return null;
}

export function describeLegalIdPattern(pattern) {
    const parsed = parseLegalIdPattern(pattern);
    switch (parsed.kind) {
        case "none":
            return "Acepta cualquier texto (no se revisa el formato).";
        case "digits_exact":
            return `Debe tener exactamente ${parsed.digits} números.`;
        case "digits_range":
            return `Debe tener entre ${parsed.minDigits} y ${parsed.maxDigits} números.`;
        case "digits_either":
            return `Debe tener ${parsed.eitherA} o ${parsed.eitherB} números (por ejemplo cédula o RUC).`;
        default:
            return "Este país ya tiene un formato especial. Podés dejarlo o elegir una opción más simple.";
    }
}

/**
 * @param {Record<string, unknown> | null | undefined} schema
 */
export function parseComplianceForm(schema) {
    const s = schema && typeof schema === "object" ? schema : {};
    const pep = s.pep && typeof s.pep === "object" ? s.pep : null;
    const uafe = s.uafe && typeof s.uafe === "object" ? s.uafe : null;
    const refs = s.references && typeof s.references === "object" ? s.references : null;

    return {
        pepEnabled: Boolean(pep),
        pepRequireDetails: pep ? pep.require_details_if_true !== false : true,
        pepLabel: pep?.label || DEFAULT_COMPLIANCE_SCHEMA.pep.label,
        uafeEnabled: Boolean(uafe),
        refsEnabled: Number(refs?.min_count || 0) > 0,
        refsMin: Math.max(0, Number(refs?.min_count ?? 1) || 0),
        refsMax: Math.max(1, Number(refs?.max_count ?? 5) || 5),
    };
}

export function buildComplianceSchema(form) {
    if (!form) return null;
    const out: Record<string, any> = {};

    if (form.pepEnabled) {
        out.pep = {
            ...DEFAULT_COMPLIANCE_SCHEMA.pep,
            label: (form.pepLabel || DEFAULT_COMPLIANCE_SCHEMA.pep.label).trim(),
            require_details_if_true: Boolean(form.pepRequireDetails),
        };
    }

    if (form.uafeEnabled) {
        out.uafe = { ...DEFAULT_COMPLIANCE_SCHEMA.uafe };
    }

    if (form.refsEnabled) {
        const min = Math.max(1, Math.min(5, Number(form.refsMin) || 1));
        const max = Math.max(min, Math.min(5, Number(form.refsMax) || 5));
        out.references = {
            ...DEFAULT_COMPLIANCE_SCHEMA.references,
            min_count: min,
            max_count: max,
        };
    }

    return Object.keys(out).length ? out : null;
}

export function legalIdFormatForKind(prev, kind) {
    const p = prev || { kind: "none" };
    if (kind === "none") return { kind: "none" };
    if (kind === "custom") return p.kind === "custom" ? p : { kind: "none" };
    if (kind === "digits_exact") {
        return {
            kind: "digits_exact",
            digits: p.digits || p.eitherA || p.minDigits || 10,
        };
    }
    if (kind === "digits_range") {
        return {
            kind: "digits_range",
            minDigits: p.minDigits || p.digits || p.eitherA || 8,
            maxDigits: p.maxDigits || p.eitherB || 13,
        };
    }
    if (kind === "digits_either") {
        return {
            kind: "digits_either",
            eitherA: p.eitherA || p.digits || p.minDigits || 10,
            eitherB: p.eitherB || p.maxDigits || 13,
        };
    }
    return p;
}

export function exampleLegalId(format) {
    const ones = (n) => "1".repeat(Math.max(1, Math.min(40, Number(n) || 1)));
    if (!format || format.kind === "none") return "ABC-123";
    if (format.kind === "digits_exact") return ones(format.digits);
    if (format.kind === "digits_range") return ones(format.minDigits);
    if (format.kind === "digits_either") {
        return `${ones(format.eitherA)} o ${ones(format.eitherB)}`;
    }
    return null;
}

export function countryToDraft(row) {
    if (!row) return null;
    return {
        code: row.code,
        name: row.name || "",
        is_active: Boolean(row.is_active),
        requires_compliance: Boolean(row.requires_compliance),
        legal_id_label: row.legal_id_label || "",
        sort_order: row.sort_order ?? 0,
        legalIdFormat: parseLegalIdPattern(row.legal_id_pattern),
        complianceForm: parseComplianceForm(row.compliance_schema),
    };
}

export function draftToCountryPayload(draft) {
    return {
        name: draft.name,
        is_active: draft.is_active,
        requires_compliance: draft.requires_compliance,
        legal_id_label: draft.legal_id_label,
        legal_id_pattern: buildLegalIdPattern(draft.legalIdFormat) || "",
        compliance_schema: buildComplianceSchema(draft.complianceForm) || {},
        sort_order: draft.sort_order,
    };
}
