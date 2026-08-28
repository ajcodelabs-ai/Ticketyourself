import { describe, expect, it } from "vitest";
import {
    A4_WH,
    TICKET_PAGE_FORMAT,
    TICKET_TEMPLATES,
    applyTicketTemplate,
    emptyDesign,
} from "./ticketDesignTemplates";

describe("ticketDesignTemplates", () => {
    it("defaults empty designs to A4 (email PDF)", () => {
        expect(emptyDesign().format).toBe("a4");
        expect(TICKET_PAGE_FORMAT).toBe("a4");
    });

    it("builds every template as an A4 page with in-bounds elements", () => {
        for (const tpl of TICKET_TEMPLATES) {
            const design = tpl.build();
            expect(design.format).toBe("a4");
            expect(design.elements.length).toBeGreaterThan(0);
            expect(design.elements.some((e) => e.type === "qr")).toBe(true);
            for (const el of design.elements) {
                expect(el.x).toBeGreaterThanOrEqual(0);
                expect(el.y).toBeGreaterThanOrEqual(0);
                expect(el.x + el.width).toBeLessThanOrEqual(1.001);
                expect(el.y + el.height).toBeLessThanOrEqual(1.001);
            }
        }
    });

    it("keeps the QR roughly square on A4", () => {
        for (const tpl of TICKET_TEMPLATES) {
            const qr = tpl.build().elements.find((e) => e.type === "qr");
            expect(qr).toBeTruthy();
            const renderedRatio = qr.width / qr.height;
            expect(renderedRatio).toBeCloseTo(1 / A4_WH, 2);
        }
    });

    it("applyTicketTemplate always writes A4 even if the previous design was digital", () => {
        const next = applyTicketTemplate("clasico", emptyDesign("digital"));
        expect(next.format).toBe("a4");
        expect(next.template_id).toBe("clasico");
    });

    it("keeps uploaded background and logo when switching templates", () => {
        const current = applyTicketTemplate("clasico", emptyDesign());
        current.background_url = "/api/events/assets/bg-1";
        current.elements = current.elements.map((e) =>
            e.type === "logo" ? { ...e, image_url: "/api/events/assets/logo-1" } : e,
        );
        const next = applyTicketTemplate("noche", current);
        expect(next.template_id).toBe("noche");
        expect(next.background_url).toBe("/api/events/assets/bg-1");
        expect(next.elements.find((e) => e.type === "logo")?.image_url).toBe(
            "/api/events/assets/logo-1",
        );
    });
});
