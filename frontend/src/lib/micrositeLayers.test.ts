import { describe, expect, it } from "vitest";
import { CORE_LAYER_IDS, resolveHeroLayers, rowGeometryFromGrid, snapRow } from "@/lib/micrositeLayers";

describe("resolveHeroLayers CTA href", () => {
    it("falls back to #events when content and saved layer href are empty", () => {
        const layers = resolveHeroLayers(
            [
                {
                    id: CORE_LAYER_IDS.cta,
                    role: "cta",
                    type: "button",
                    content: "Ver próximos eventos",
                    colStart: 1,
                    colSpan: 4,
                    row: 5,
                    align: "left",
                    href: null as unknown as string,
                },
            ],
            { hero_cta_text: "Ver próximos eventos", hero_cta_href: "" },
            "normal",
            "left",
        );
        const cta = layers.find((l) => l.role === "cta");
        expect(cta?.href).toBe("#events");
    });
});

function gridWithRows(rowsPx: string, gapPx = "4px") {
    const el = document.createElement("div");
    el.style.gridTemplateRows = rowsPx;
    el.style.rowGap = gapPx;
    document.body.appendChild(el);
    return el;
}

function gridWithRowsCentered(rowsPx: string, boxHeight: number, gapPx = "4px") {
    const el = gridWithRows(rowsPx, gapPx);
    el.style.alignContent = "center";
    el.getBoundingClientRect = () => ({ height: boxHeight }) as DOMRect;
    return el;
}

describe("rowGeometryFromGrid", () => {
    it("accumulates resolved row heights plus the gap between them into bounds, and exposes the raw (gap-free) heights", () => {
        const el = gridWithRows("80px 120px 60px 40px 90px 50px", "4px");
        expect(rowGeometryFromGrid(el)).toEqual({
            bounds: [0, 80, 204, 268, 312, 406, 460],
            heights: [80, 120, 60, 40, 90, 50],
        });
    });

    it("returns null when the grid hasn't resolved 6 real pixel tracks", () => {
        expect(rowGeometryFromGrid(gridWithRows("repeat(6, 1fr)"))).toBeNull();
        expect(rowGeometryFromGrid(gridWithRows("80px 120px"))).toBeNull();
    });

    it("shifts bounds (but not heights) down by half the leftover space when align-content centers short rows in a taller box", () => {
        // tracks + gaps sum to 460px; box is 560px tall (100px leftover, split
        // 50/50 top and bottom by align-content: center)
        const el = gridWithRowsCentered("80px 120px 60px 40px 90px 50px", 560, "4px");
        expect(rowGeometryFromGrid(el)).toEqual({
            bounds: [50, 130, 254, 318, 362, 456, 510],
            heights: [80, 120, 60, 40, 90, 50],
        });
    });

    it("doesn't shift when align-content isn't centering (e.g. rows already fill the box)", () => {
        const el = gridWithRowsCentered("80px 120px 60px 40px 90px 50px", 460, "4px");
        expect(rowGeometryFromGrid(el)?.bounds).toEqual([0, 80, 204, 268, 312, 406, 460]);
    });
});

describe("snapRow", () => {
    const rect = { top: 100, height: 460 } as DOMRect;

    it("maps a pointer position to the row whose real (non-equal) boundaries contain it", () => {
        const bounds = rowGeometryFromGrid(gridWithRows("80px 120px 60px 40px 90px 50px", "4px"))?.bounds;
        expect(snapRow(rect.top + 10, rect, bounds)).toBe(1); // inside row 1 (0-80)
        expect(snapRow(rect.top + 90, rect, bounds)).toBe(2); // inside row 2 (84-204)
        expect(snapRow(rect.top + 459, rect, bounds)).toBe(6); // inside row 6, near the bottom
    });

    it("falls back to equal division when no row boundaries are given", () => {
        expect(snapRow(rect.top + 10, rect)).toBe(1);
        expect(snapRow(rect.top + 459, rect)).toBe(6);
        expect(snapRow(rect.top + 10, rect, null)).toBe(1);
    });

    it("falls back to equal division when the grid element's rows aren't resolved yet", () => {
        const bounds = rowGeometryFromGrid(gridWithRows("repeat(6, 1fr)"))?.bounds;
        expect(snapRow(rect.top + 10, rect, bounds)).toBe(1);
    });
});
