import { describe, expect, it } from "vitest";
import { CORE_LAYER_IDS, resolveHeroLayers } from "@/lib/micrositeLayers";

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
