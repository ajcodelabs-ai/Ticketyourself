/**
 * Client-side field errors for organizer registration.
 *
 * Collects every invalid field at once (instead of returning on the first
 * toast) so a duplicate email is not hidden behind a RUC/cédula format error.
 */
import { isValidPhoneNumber } from "react-phone-number-input";
import { isValidEcCedula } from "@/lib/ecId";

export const EMAIL_TAKEN_MSG = "Este correo ya está registrado";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_ORDER = [
    "email",
    "phone",
    "password",
    "confirmPassword",
    "company_name",
    "legal_id",
    "legal_address",
    "slug",
    "pep_details",
    "funds_origin_declared",
    "funds_origin_detail",
    "accepts_uafe_obligations",
    "org_references",
    "country_code",
    "_form",
];

export function looksLikeEmail(value: string): boolean {
    return EMAIL_RE.test(String(value || "").trim());
}

export function legalIdFieldLabel(orgType: string, country?: { code?: string; legal_id_label?: string } | null): string {
    if (country?.code === "EC" || !country?.legal_id_label) {
        return orgType === "company" ? "RUC" : "Cédula";
    }
    return country.legal_id_label;
}

export function legalIdError({
    legalId,
    orgType,
    countryCode,
    country,
}: {
    legalId: string;
    orgType: string;
    countryCode: string;
    country?: { name?: string; legal_id_label?: string; legal_id_pattern?: string; code?: string } | null;
}): string | null {
    const trimmed = String(legalId || "").trim();
    const label = legalIdFieldLabel(orgType, country);
    if (!trimmed) return `Ingresa tu ${label}`;

    const digits = trimmed.replace(/\D/g, "");

    if (countryCode === "EC") {
        if (orgType === "individual") {
            if (digits.length !== 10) return "La cédula debe tener 10 dígitos.";
            if (!isValidEcCedula(trimmed)) return "La cédula ecuatoriana no es válida.";
        } else if (digits.length !== 10 && digits.length !== 13) {
            return "El RUC debe tener 13 dígitos.";
        }
    }

    const pattern = country?.legal_id_pattern;
    if (pattern) {
        try {
            if (!new RegExp(pattern).test(trimmed)) {
                if (countryCode === "EC") {
                    return orgType === "company"
                        ? "El RUC debe tener 13 dígitos."
                        : "La cédula debe tener 10 dígitos.";
                }
                return `${label} no tiene un formato válido para ${country.name}`;
            }
        } catch {
            /* ignore bad pattern from admin */
        }
    }
    return null;
}

export function collectRegisterFieldErrors({
    form,
    country,
    slugCheck,
    emailCheck,
    requiresCompliance,
}: {
    form: {
        email?: string;
        phone?: string;
        password?: string;
        confirmPassword?: string;
        company_name?: string;
        legal_id?: string;
        org_type?: string;
        country_code?: string;
        slug?: string;
        legal_address?: string;
        is_pep?: boolean;
        pep_details?: string;
        uafe_declaration?: {
            funds_origin_declared?: boolean;
            funds_origin_detail?: string;
            accepts_uafe_obligations?: boolean;
        };
        org_references?: Array<{ name?: string; phone?: string }>;
    };
    country?: {
        code?: string;
        name?: string;
        legal_id_label?: string;
        legal_id_pattern?: string;
    } | null;
    slugCheck?: { available?: boolean | null; checking?: boolean };
    emailCheck?: { available?: boolean | null; reason?: string | null };
    requiresCompliance?: boolean;
}): Record<string, string> {
    const errors: Record<string, string> = {};
    const countryCode = form.country_code || country?.code || "";
    const orgType = form.org_type || "company";

    const email = (form.email || "").trim();
    if (!email) {
        errors.email = "Ingresa tu email";
    } else if (!looksLikeEmail(email)) {
        errors.email = "Ingresa un email válido";
    } else if (emailCheck?.available === false && emailCheck.reason === "taken") {
        errors.email = EMAIL_TAKEN_MSG;
    }

    const phone = (form.phone || "").trim();
    if (!phone) {
        errors.phone = "Ingresa tu número de teléfono";
    } else if (!isValidPhoneNumber(phone)) {
        errors.phone = "El número de teléfono no es válido. Revisa el código de país y los dígitos.";
    }

    if (!(form.password || "").length) {
        errors.password = "Ingresa una contraseña";
    } else if ((form.password || "").length < 8) {
        errors.password = "La contraseña debe tener al menos 8 caracteres";
    }

    if ((form.password || "") !== (form.confirmPassword || "")) {
        errors.confirmPassword = "Las contraseñas no coinciden";
    }

    if (!(form.company_name || "").trim()) {
        errors.company_name =
            orgType === "company" ? "Ingresa el nombre comercial" : "Ingresa tu nombre completo";
    }

    const legalMsg = legalIdError({
        legalId: form.legal_id || "",
        orgType,
        countryCode,
        country,
    });
    if (legalMsg) errors.legal_id = legalMsg;

    if (countryCode === "EC") {
        const addr = (form.legal_address || "").trim();
        if (!addr || addr.length < 8) {
            errors.legal_address = "Ingresa la dirección fiscal del establecimiento (SRI)";
        }
    }

    if (!form.slug || slugCheck?.available === false) {
        errors.slug = "El slug elegido no está disponible";
    }

    if (requiresCompliance) {
        if (form.is_pep && !(form.pep_details || "").trim()) {
            errors.pep_details = "Describe tu condición PEP";
        }
        const uafe = form.uafe_declaration || {};
        if (!uafe.funds_origin_declared) {
            errors.funds_origin_declared = "Debes declarar el origen lícito de los fondos";
        }
        if (!(uafe.funds_origin_detail || "").trim()) {
            errors.funds_origin_detail = "Describe el origen de los fondos";
        }
        if (!uafe.accepts_uafe_obligations) {
            errors.accepts_uafe_obligations = "Debes aceptar las obligaciones UAFE";
        }
        const validRefs = (form.org_references || []).filter(
            (r) => (r.name || "").trim() && (r.phone || "").trim(),
        );
        if (validRefs.length < 1) {
            errors.org_references = "Agrega al menos una referencia con nombre y teléfono";
        }
    }

    return errors;
}

function mapKnownStringError(text: string): Record<string, string> {
    const t = String(text || "").toLowerCase();
    if (!t.trim()) return {};
    if (t.includes("email already") || t.includes("correo ya")) {
        return { email: EMAIL_TAKEN_MSG };
    }
    if (t.includes("slug") && (t.includes("taken") || t.includes("en uso") || t.includes("ya está") || t.includes("ya esta"))) {
        return { slug: "Esta URL ya está en uso" };
    }
    if (t.includes("invalid slug") || t.includes("url de tu página no es válida") || t.includes("caracteres no válidos")) {
        return { slug: "La URL de tu página no es válida" };
    }
    if (
        t.includes("ruc") ||
        t.includes("cédula") ||
        t.includes("cedula") ||
        t.includes("legal_id") ||
        t.includes("invalid") && t.includes("ecuador")
    ) {
        if (t.includes("ruc") || t.includes("cédula") || t.includes("cedula") || t.includes("legal_id")) {
            return { legal_id: text };
        }
    }
    if (t.includes("dirección fiscal") || t.includes("direccion fiscal") || t.includes("legal_address")) {
        return { legal_address: text };
    }
    return { _form: text };
}

/** Map FastAPI `detail` (string, Pydantic list, or {fields}) onto input names. */
export function fieldErrorsFromApi(detail: unknown): Record<string, string> {
    if (detail == null) return {};

    if (typeof detail === "string") {
        return mapKnownStringError(detail);
    }

    if (Array.isArray(detail)) {
        const errors: Record<string, string> = {};
        for (const entry of detail) {
            if (typeof entry === "string") {
                Object.assign(errors, mapKnownStringError(entry));
                continue;
            }
            if (!entry || typeof entry !== "object") continue;
            const loc = Array.isArray((entry as { loc?: unknown }).loc)
                ? ((entry as { loc: unknown[] }).loc).filter((x) => x !== "body")
                : [];
            const field = loc.length ? String(loc[loc.length - 1]) : null;
            const msg =
                typeof (entry as { msg?: unknown }).msg === "string"
                    ? (entry as { msg: string }).msg
                    : typeof (entry as { message?: unknown }).message === "string"
                      ? (entry as { message: string }).message
                      : null;
            if (field && msg) {
                errors[String(field)] = msg;
            } else if (msg) {
                Object.assign(errors, mapKnownStringError(msg));
            }
        }
        return errors;
    }

    if (typeof detail === "object") {
        const obj = detail as { fields?: Record<string, string>; detail?: unknown; message?: string; msg?: string };
        if (obj.fields && typeof obj.fields === "object") {
            return { ...obj.fields };
        }
        if (typeof obj.detail === "string" || Array.isArray(obj.detail)) {
            return fieldErrorsFromApi(obj.detail);
        }
        if (typeof obj.message === "string") return mapKnownStringError(obj.message);
        if (typeof obj.msg === "string") return mapKnownStringError(obj.msg);
    }

    return {};
}

export function firstErrorField(errors: Record<string, string> | null | undefined): string | null {
    if (!errors) return null;
    const found = FIELD_ORDER.find((key) => errors[key]);
    if (found) return found;
    const keys = Object.keys(errors).filter((k) => errors[k]);
    return keys[0] || null;
}

export function fieldInputId(field: string): string {
    const ids: Record<string, string> = {
        email: "email-input",
        phone: "phone-input",
        password: "password-input",
        confirmPassword: "confirm-input",
        company_name: "company-input",
        legal_id: "legal-input",
        legal_address: "legal-address-input",
        slug: "slug-input",
        pep_details: "is-pep",
        funds_origin_detail: "funds-origin",
        accepts_uafe_obligations: "uafe-accept",
        org_references: "register-ref-name-0",
    };
    return ids[field] || `${field}-input`;
}
