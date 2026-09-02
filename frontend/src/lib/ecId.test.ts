import { describe, expect, it } from "vitest";
import {
    buyerDocumentError,
    isValidEcCedula,
    isValidEcRuc,
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
        expect(buyerDocumentError("cedula", "1234567890")).toMatch(/cédula/i);
        expect(buyerDocumentError("pasaporte", "AB123")).toBeNull();
        expect(buyerDocumentError("consumidor_final", "")).toBeNull();
    });
});
