import { describe, expect, it } from "vitest";
import {
    DOCUMENT_TYPES,
    documentTypeFieldLabel,
    formatEinvoiceError,
} from "./einvoice";

describe("DOCUMENT_TYPES", () => {
    it("includes SRI 08 identificación del exterior", () => {
        expect(DOCUMENT_TYPES.map((t) => t.value)).toContain("exterior");
        expect(documentTypeFieldLabel("exterior")).toBe(
            "Identificación del exterior",
        );
    });
});

describe("formatEinvoiceError", () => {
    it("translates Dátil punto de emisión JSON into Spanish copy", () => {
        const raw = JSON.stringify({
            errors: [
                {
                    details: "Punto de emision no existe",
                    message: "Punto de emision no existe",
                    code: "INVALID_RECEIPT",
                },
            ],
        });
        const msg = formatEinvoiceError(raw);
        expect(msg.toLowerCase()).toContain("punto de emisión");
        expect(msg).toContain("app.datil.co");
        expect(msg).not.toContain("INVALID_RECEIPT");
    });

    it("passes through a plain message", () => {
        expect(formatEinvoiceError("Clave inválida")).toBe("Clave inválida");
    });
});
