import { describe, expect, it } from "vitest";
import { FACTORY_CONTENT, buildTemplateUpdate, isFactoryCopy } from "@/lib/micrositeTemplates";

describe("buildTemplateUpdate", () => {
    const base = {
        branding: {
            primary_color: "#4f46e5",
            logo_url: "/logo.png",
            banner_url: "/banner.jpg",
        },
        content: {
            hero_title: "Mi productora",
            hero_subtitle: FACTORY_CONTENT.hero_subtitle,
            hero_cta_text: FACTORY_CONTENT.hero_cta_text,
        },
    };

    it("applies layout, colors and starter copy but keeps logo and title", () => {
        const next = buildTemplateUpdate("galeria", base, "Mi productora");
        expect(next.template).toBe("galeria");
        expect(next.branding.primary_color).toBe("#ea580c");
        expect(next.branding.logo_url).toBe("/logo.png");
        expect(next.branding.banner_url).toBe("/banner.jpg");
        expect(next.content.hero_title).toBeUndefined();
        expect(next.content.hero_subtitle).toContain("noche");
        expect(next.content.contact_email).toBeUndefined();
        expect(next.blocks.some((b) => b.type === "events")).toBe(true);
    });

    it("does not resend contact fields that the template does not own", () => {
        const next = buildTemplateUpdate(
            "galeria",
            {
                ...base,
                content: {
                    ...base.content,
                    contact_email: "hola@demo-org.test",
                    contact_phone: "+593 99 123 4567",
                    address: "Quito",
                },
            },
            "Mi productora",
        );
        expect(next.content).not.toHaveProperty("contact_email");
        expect(next.content).not.toHaveProperty("contact_phone");
        expect(next.content).not.toHaveProperty("address");
    });

    it("does not overwrite custom copy", () => {
        const next = buildTemplateUpdate(
            "evento_unico",
            {
                ...base,
                content: {
                    hero_title: "Custom",
                    hero_subtitle: "Texto propio que escribí",
                    hero_cta_text: "Comprar ahora",
                },
            },
            "Custom",
        );
        expect(next.content.hero_subtitle).toBeUndefined();
        expect(next.content.hero_cta_text).toBeUndefined();
    });

    it("detects factory copy", () => {
        expect(isFactoryCopy({ hero_subtitle: FACTORY_CONTENT.hero_subtitle })).toBe(true);
        expect(isFactoryCopy({ hero_subtitle: "Otra cosa" })).toBe(false);
    });
});
