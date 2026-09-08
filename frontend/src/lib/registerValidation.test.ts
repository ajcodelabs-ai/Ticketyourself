import { describe, expect, it } from "vitest";
import {
    collectRegisterFieldErrors,
    EMAIL_TAKEN_MSG,
    fieldErrorsFromApi,
    firstErrorField,
    legalIdError,
    looksLikeEmail,
} from "./registerValidation";

const EC_COUNTRY = {
    code: "EC",
    name: "Ecuador",
    legal_id_label: "RUC / Cédula",
    legal_id_pattern: "^(\\d{10}|\\d{13})$",
};

function baseForm(overrides = {}) {
    return {
        email: "nuevo@ticketyourself.com",
        phone: "++1-555-0047",
        password: "Organizer123!",
        confirmPassword: "Organizer123!",
        company_name: "Edwar",
        legal_id: "1790012345001",
        org_type: "company",
        country_code: "EC",
        slug: "edwar",
        legal_address: "Av. Amazonas N34-123, Quito",
        is_pep: false,
        pep_details: "",
        uafe_declaration: {
            funds_origin_declared: true,
            funds_origin_detail: "Eventos",
            accepts_uafe_obligations: true,
        },
        org_references: [{ name: "Ana", phone: "+593988888888", relation: "Cliente" }],
        ...overrides,
    };
}

describe("looksLikeEmail", () => {
    it("accepts a normal address", () => {
        expect(looksLikeEmail("edwar@gmail.com")).toBe(true);
    });

    it("rejects incomplete input", () => {
        expect(looksLikeEmail("edwar")).toBe(false);
        expect(looksLikeEmail("edwar@")).toBe(false);
    });
});

describe("legalIdError", () => {
    it("asks for 13-digit RUC when the company id is too short", () => {
        expect(
            legalIdError({
                legalId: "987654321",
                orgType: "company",
                countryCode: "EC",
                country: EC_COUNTRY,
            }),
        ).toBe("El RUC debe tener 13 dígitos.");
    });

    it("asks for 10-digit cédula for persona natural", () => {
        expect(
            legalIdError({
                legalId: "987654321",
                orgType: "individual",
                countryCode: "EC",
                country: EC_COUNTRY,
            }),
        ).toBe("La cédula debe tener 10 dígitos.");
    });

    it("accepts a 13-digit company RUC that matches the country pattern", () => {
        expect(
            legalIdError({
                legalId: "1790012345001",
                orgType: "company",
                countryCode: "EC",
                country: EC_COUNTRY,
            }),
        ).toBeNull();
    });
});

describe("collectRegisterFieldErrors", () => {
    it("reports duplicate email and invalid RUC at the same time", () => {
        const errors = collectRegisterFieldErrors({
            form: baseForm({
                email: "edwaryesidtalero@gmail.com",
                legal_id: "987654321",
            }),
            country: EC_COUNTRY,
            slugCheck: { available: true },
            emailCheck: { available: false, reason: "taken" },
            requiresCompliance: true,
        });
        expect(errors.email).toBe(EMAIL_TAKEN_MSG);
        expect(errors.legal_id).toBe("El RUC debe tener 13 dígitos.");
        expect(firstErrorField(errors)).toBe("email");
    });

    it("does not invent an email error when the address is still free", () => {
        const errors = collectRegisterFieldErrors({
            form: baseForm({ legal_id: "987654321" }),
            country: EC_COUNTRY,
            slugCheck: { available: true },
            emailCheck: { available: true, reason: null },
            requiresCompliance: true,
        });
        expect(errors.email).toBeUndefined();
        expect(errors.legal_id).toBeTruthy();
    });

    it("surfaces password mismatch next to confirm, not as a generic toast", () => {
        const errors = collectRegisterFieldErrors({
            form: baseForm({ confirmPassword: "otra" }),
            country: EC_COUNTRY,
            slugCheck: { available: true },
            emailCheck: { available: true },
            requiresCompliance: true,
        });
        expect(errors.confirmPassword).toBe("Las contraseñas no coinciden");
        expect(errors.email).toBeUndefined();
    });
});

describe("fieldErrorsFromApi", () => {
    it("maps the legacy English duplicate-email string onto the email field", () => {
        expect(fieldErrorsFromApi("Email already registered")).toEqual({
            email: EMAIL_TAKEN_MSG,
        });
    });

    it("maps a FastAPI list of loc/msg entries onto fields", () => {
        const mapped = fieldErrorsFromApi([
            { loc: ["body", "email"], msg: EMAIL_TAKEN_MSG, type: "value_error" },
            {
                loc: ["body", "legal_id"],
                msg: "El RUC debe tener 13 dígitos.",
                type: "value_error",
            },
        ]);
        expect(mapped.email).toBe(EMAIL_TAKEN_MSG);
        expect(mapped.legal_id).toBe("El RUC debe tener 13 dígitos.");
    });
});
