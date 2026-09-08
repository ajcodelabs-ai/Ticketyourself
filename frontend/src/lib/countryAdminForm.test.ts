import { describe, expect, it } from "vitest";
import {
    buildComplianceSchema,
    buildLegalIdPattern,
    countryToDraft,
    DEFAULT_COMPLIANCE_SCHEMA,
    describeLegalIdPattern,
    draftToCountryPayload,
    exampleLegalId,
    legalIdFormatForKind,
    parseComplianceForm,
    parseLegalIdPattern,
} from "./countryAdminForm";

describe("parseLegalIdPattern / buildLegalIdPattern", () => {
    it("round-trips Ecuador cédula-or-RUC", () => {
        const stored = "^(\\d{10}|\\d{13})$";
        const parsed = parseLegalIdPattern(stored);
        expect(parsed).toEqual({ kind: "digits_either", eitherA: 10, eitherB: 13 });
        expect(buildLegalIdPattern(parsed)).toBe(stored);
        expect(describeLegalIdPattern(stored)).toContain("10 o 13");
    });

    it("round-trips an exact digit count", () => {
        expect(parseLegalIdPattern("^\\d{11}$")).toEqual({ kind: "digits_exact", digits: 11 });
        expect(buildLegalIdPattern({ kind: "digits_exact", digits: 11 })).toBe("^\\d{11}$");
    });

    it("round-trips a digit range", () => {
        expect(parseLegalIdPattern("^\\d{8,11}$")).toEqual({
            kind: "digits_range",
            minDigits: 8,
            maxDigits: 11,
        });
        expect(buildLegalIdPattern({ kind: "digits_range", minDigits: 8, maxDigits: 11 })).toBe(
            "^\\d{8,11}$",
        );
    });

    it("treats empty as no format check", () => {
        expect(parseLegalIdPattern(null)).toEqual({ kind: "none" });
        expect(buildLegalIdPattern({ kind: "none" })).toBeNull();
    });

    it("keeps an unknown regex as custom", () => {
        const weird = "^[A-Z]{4}\\d{6}$";
        expect(parseLegalIdPattern(weird)).toEqual({ kind: "custom", customPattern: weird });
        expect(buildLegalIdPattern({ kind: "custom", customPattern: weird })).toBe(weird);
    });
});

describe("compliance form", () => {
    it("reads the Ecuador seed schema", () => {
        const form = parseComplianceForm(DEFAULT_COMPLIANCE_SCHEMA);
        expect(form.pepEnabled).toBe(true);
        expect(form.pepRequireDetails).toBe(true);
        expect(form.uafeEnabled).toBe(true);
        expect(form.refsEnabled).toBe(true);
        expect(form.refsMin).toBe(1);
    });

    it("omits UAFE when the admin turns it off", () => {
        const schema = buildComplianceSchema({
            pepEnabled: true,
            pepRequireDetails: true,
            pepLabel: "PEP",
            uafeEnabled: false,
            refsEnabled: true,
            refsMin: 1,
            refsMax: 3,
        });
        expect(schema.uafe).toBeUndefined();
        expect(schema.references.max_count).toBe(3);
        expect(schema.pep.require_details_if_true).toBe(true);
    });

    it("returns null when every extra declaration is off", () => {
        expect(
            buildComplianceSchema({
                pepEnabled: false,
                pepRequireDetails: false,
                pepLabel: "",
                uafeEnabled: false,
                refsEnabled: false,
                refsMin: 1,
                refsMax: 5,
            }),
        ).toBeNull();
    });

    it("treats a UAFE block without fields as enabled", () => {
        const form = parseComplianceForm({
            uafe: { label: "Declaración UAFE" },
        });
        expect(form.uafeEnabled).toBe(true);
        expect(buildComplianceSchema(form).uafe.fields).toHaveLength(3);
    });
});

describe("country draft", () => {
    it("maps Ecuador seed into friendly options", () => {
        const draft = countryToDraft({
            code: "EC",
            name: "Ecuador",
            is_active: true,
            requires_compliance: true,
            legal_id_label: "RUC / Cédula",
            legal_id_pattern: "^(\\d{10}|\\d{13})$",
            compliance_schema: DEFAULT_COMPLIANCE_SCHEMA,
            sort_order: 0,
        });
        expect(draft.legalIdFormat.kind).toBe("digits_either");
        expect(draft.complianceForm.pepEnabled).toBe(true);
        const payload = draftToCountryPayload(draft);
        expect(payload.legal_id_pattern).toBe("^(\\d{10}|\\d{13})$");
        expect(payload.compliance_schema.uafe.fields).toHaveLength(3);
    });

    it("keeps extra declarations off when the schema is empty", () => {
        const draft = countryToDraft({
            code: "CO",
            name: "Colombia",
            is_active: true,
            requires_compliance: true,
            legal_id_label: "NIT",
            legal_id_pattern: null,
            compliance_schema: null,
            sort_order: 10,
        });
        expect(draft.complianceForm.pepEnabled).toBe(false);
        expect(draft.complianceForm.uafeEnabled).toBe(false);
        expect(draft.legalIdFormat.kind).toBe("none");
    });

    it("switches format kinds without losing digit counts", () => {
        const either = { kind: "digits_either", eitherA: 10, eitherB: 13 };
        expect(legalIdFormatForKind(either, "digits_exact")).toEqual({
            kind: "digits_exact",
            digits: 10,
        });
        expect(exampleLegalId(either)).toBe("1111111111 o 1111111111111");
    });
});
