import { describe, expect, it } from "vitest";
import { formatApiError, formatBlobApiError } from "./api";

// jsdom's Blob has no .text()/.arrayBuffer() (real browsers have had it for
// years) — polyfill just enough for these tests; formatBlobApiError itself
// needs no change since production Blob implementations already support it.
if (typeof Blob.prototype.text !== "function") {
    Blob.prototype.text = function (this: Blob) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(this);
        });
    };
}

describe("formatApiError", () => {
    it("returns a generic message when detail is null", () => {
        expect(formatApiError(null)).toBe("Algo salió mal. Inténtalo de nuevo.");
    });

    it("returns the string detail as-is", () => {
        expect(formatApiError("Custom error")).toBe("Custom error");
    });

    it("keeps a custom Spanish value_error instead of replacing it", () => {
        expect(
            formatApiError([
                {
                    loc: ["body", "email"],
                    msg: "Este correo ya está registrado",
                    type: "value_error",
                },
            ]),
        ).toContain("Este correo ya está registrado");
    });
});

describe("formatBlobApiError", () => {
    // TI-80: requests made with `responseType: "blob"` still get a Blob body
    // on error even when the server sent JSON — err.response.data.detail is
    // always undefined there, silently hiding the real backend message.
    it("parses a JSON error body delivered as a Blob and extracts detail", async () => {
        const blob = new Blob([JSON.stringify({ detail: "File missing from disk" })], {
            type: "application/json",
        });
        const err = { response: { data: blob } };
        expect(await formatBlobApiError(err, "fallback")).toBe("File missing from disk");
    });

    it("falls back to the caller-supplied message for a non-JSON blob (a real file)", async () => {
        const blob = new Blob(["%PDF-1.4 binary garbage"], { type: "application/pdf" });
        const err = { response: { data: blob } };
        expect(await formatBlobApiError(err, "No se pudo cargar la vista previa")).toBe(
            "No se pudo cargar la vista previa",
        );
    });

    it("falls back to the caller-supplied message when there's no response at all", async () => {
        const err = { message: "Network Error" };
        expect(await formatBlobApiError(err, "No se pudo descargar")).toBe(
            "No se pudo descargar",
        );
    });

    it("still reads a plain JSON error body when responseType wasn't blob", async () => {
        const err = { response: { data: { detail: "Not found" } } };
        expect(await formatBlobApiError(err, "fallback")).toBe("Not found");
    });
});
