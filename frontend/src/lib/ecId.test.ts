import { describe, expect, it } from "vitest";
import {
    buyerDocumentError,
    isValidEcCedula,
    isValidEcRuc,
    lawDocumentError,
    resolveLawDocumentId,
} from "./ecId";

describe("isValidEcCedula", () => {
    it("accepts a known cédula", () => {
        expect(isValidEcCedula("1710034065")).toBe(true);
    });

    it("rejects a bad check digit", () => {
        expect(isValidEcCedula("1710034066")).toBe(false);
        expect(isValidEcCedula("1234567890")).toBe(false);
    });

    it("allows third digit 6 (large cities)", () => {
        expect(isValidEcCedula("1760000008")).toBe(true);
        expect(isValidEcCedula("1780000004")).toBe(false);
    });
});

describe("isValidEcRuc", () => {
    it("accepts natural-person RUC (cédula + establishment)", () => {
        expect(isValidEcRuc("1710034065001")).toBe(true);
        expect(isValidEcRuc("1760000008001")).toBe(true);
        expect(isValidEcRuc("1710034065000")).toBe(false);
    });

    it("accepts private RUC with extended sequential (no módulo 11)", () => {
        expect(isValidEcRuc("0992547545001")).toBe(true);
    });

    it("accepts public RUC (third digit 6, módulo 11)", () => {
        expect(isValidEcRuc("1760000150001")).toBe(true);
    });
});

describe("buyerDocumentError", () => {
    it("only enforces cédula and RUC", () => {
        expect(buyerDocumentError("cedula", "1710034065")).toBeNull();
        expect(buyerDocumentError("ruc", "1710034065001")).toBeNull();
        expect(buyerDocumentError("cedula", "1234567890")).toMatch(/verificador/i);
        expect(buyerDocumentError("cedula", "123")).toMatch(/10 dígitos/i);
        expect(buyerDocumentError("pasaporte", "AB123")).toBeNull();
        expect(buyerDocumentError("exterior", "1020304050")).toBeNull();
        expect(buyerDocumentError("consumidor_final", "")).toBeNull();
    });

    it("rejects 10-digit numbers that fail the Registro Civil check digit", () => {
        expect(isValidEcCedula("1719205510")).toBe(false);
        expect(isValidEcCedula("1719429053")).toBe(false);
        expect(buyerDocumentError("cedula", "1719205510")).toMatch(/verificador/i);
    });
});

describe("lawDocumentError", () => {
    it("does not treat a foreign 10-digit ID as an Ecuador cédula", () => {
        expect(lawDocumentError("senior", "", "exterior", "1020304050")).toMatch(
            /cédula ecuatoriana/i,
        );
        expect(resolveLawDocumentId("", "exterior", "1020304050")).toBe("");
        expect(lawDocumentError("senior", "1710034065", "exterior", "1020304050")).toBeNull();
    });
});
