import { describe, expect, it } from "vitest";
import {
    contractStatusLabel,
    mimeShortLabel,
    orgStatusLabel,
    orgTypeLabel,
    planDisplayName,
    referenceRows,
    socialLinkRows,
    subscriptionStatusLabel,
    uafeRows,
    verificationFeeLabel,
    yesNo,
    plainTextFromHtml,
} from "./organizerAdminLabels";

describe("status labels", () => {
    it("translates account and subscription tokens", () => {
        expect(orgStatusLabel("pending")).toBe("Pendiente");
        expect(orgStatusLabel("approved")).toBe("Aprobado");
        expect(subscriptionStatusLabel("none")).toBe("Sin suscripción");
        expect(subscriptionStatusLabel("past_due")).toBe("Pago atrasado");
        expect(subscriptionStatusLabel("canceled")).toBe("Cancelada");
        expect(orgTypeLabel("individual")).toBe("Persona natural");
        expect(verificationFeeLabel("waived")).toBe("Exonerada");
        expect(contractStatusLabel("signed")).toBe("Firmado");
        expect(yesNo(true)).toBe("Sí");
        expect(yesNo(false)).toBe("No");
    });
});

describe("uafeRows", () => {
    it("renders Ecuador UAFE fields without JSON keys", () => {
        const rows = uafeRows({
            funds_origin_detail: "Empresa de desarrollo de software",
            funds_origin_declared: true,
            accepts_uafe_obligations: true,
        });
        expect(rows.map((r) => r.label)).toEqual([
            "Declaró origen lícito de fondos",
            "Origen de los fondos",
            "Aceptó obligaciones UAFE",
        ]);
        expect(rows[0].value).toBe("Sí");
        expect(rows[1].value).toBe("Empresa de desarrollo de software");
        expect(rows[2].ok).toBe(true);
    });

    it("still shows unknown extra keys as rows", () => {
        const rows = uafeRows({ extra_flag: false });
        expect(rows).toEqual([
            {
                key: "extra_flag",
                label: "extra flag",
                value: "No",
                kind: "bool",
                ok: false,
            },
        ]);
    });

    it("returns empty for missing payloads", () => {
        expect(uafeRows(null)).toEqual([]);
        expect(uafeRows([])).toEqual([]);
    });
});

describe("referenceRows / socialLinkRows", () => {
    it("keeps name, phone and relation as a table row", () => {
        expect(
            referenceRows([{ name: "Juanpa", phone: "3217122798", relation: "Empleado" }]),
        ).toEqual([
            { key: "0", name: "Juanpa", phone: "3217122798", relation: "Empleado" },
        ]);
    });

    it("drops empty references", () => {
        expect(referenceRows([{ name: "", phone: "" }])).toEqual([]);
    });

    it("labels social networks and builds a URL from a handle", () => {
        const rows = socialLinkRows({
            instagram: "@alvaro",
            website: "https://example.com",
            empty: "",
        });
        expect(rows).toEqual([
            {
                key: "instagram",
                label: "Instagram",
                value: "@alvaro",
                href: "https://instagram.com/alvaro",
            },
            {
                key: "website",
                label: "Sitio web",
                value: "https://example.com",
                href: "https://example.com",
            },
        ]);
    });
});

describe("mimeShortLabel", () => {
    it("shortens common mime types", () => {
        expect(mimeShortLabel("application/pdf")).toBe("PDF");
        expect(mimeShortLabel("image/jpeg")).toBe("Imagen");
    });
});

describe("planDisplayName", () => {
    const plans = [
        { code: "basico", name: "Básico" },
        { code: "pro", name: "Profesional" },
    ];

    it("resolves the catalog name and falls back to the code", () => {
        expect(planDisplayName("basico", plans)).toBe("Básico");
        expect(planDisplayName("pro", plans)).toBe("Profesional");
        expect(planDisplayName("legacy", plans)).toBe("legacy");
        expect(planDisplayName("", plans)).toBe("");
    });
});

describe("plainTextFromHtml", () => {
    it("strips Verificante HTML summaries", () => {
        expect(plainTextFromHtml("<p>Riesgo <b>bajo</b></p><ul><li>OK</li></ul>")).toBe(
            "Riesgo bajo OK",
        );
    });

    it("unescapes entities once so &amp;lt; does not become <", () => {
        expect(plainTextFromHtml("A &amp; B")).toBe("A & B");
        expect(plainTextFromHtml("&lt;script&gt;")).toBe("<script>");
        expect(plainTextFromHtml("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    });
});
