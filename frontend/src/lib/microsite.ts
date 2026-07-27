/**
 * Microsite helpers — asset URL builder, defaults, font selection.
 */

export const TEMPLATE_OPTIONS = [
    {
        code: "estandar",
        name: "Estándar",
        description: "Hero + sobre nosotros + eventos + contacto.",
        category: "Clásico",
    },
    {
        code: "galeria",
        name: "Galería",
        description: "Hero grande + grid visual de eventos.",
        category: "Clásico",
    },
    {
        code: "evento_unico",
        name: "Evento Único",
        description: "Hero gigante + evento destacado.",
        category: "Clásico",
    },
    {
        code: "minimal",
        name: "Minimal",
        description: "Hero centrado + eventos + footer. Sin distracciones.",
        category: "Moderno",
    },
    {
        code: "showcase",
        name: "Showcase",
        description: "Galería de fotos + eventos visuales.",
        category: "Moderno",
    },
    {
        code: "cronologico",
        name: "Cronológico",
        description: "Eventos en lista vertical + about + contacto.",
        category: "Moderno",
    },
    {
        code: "landing",
        name: "Landing",
        description: "Hero + testimonios + FAQ + contacto. Ideal para conversión.",
        category: "Conversión",
    },
    {
        code: "portfolio",
        name: "Portfolio",
        description: "Galería + imagen destacada + about centrado.",
        category: "Conversión",
    },
];

export const FONT_OPTIONS = [
    { value: "Inter", label: "Inter", stack: "'Inter', system-ui, sans-serif" },
    { value: "Playfair Display", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
    { value: "Poppins", label: "Poppins", stack: "'Poppins', system-ui, sans-serif" },
];

export function fontStackFor(family) {
    const opt = FONT_OPTIONS.find((f) => f.value === family);
    return opt ? opt.stack : FONT_OPTIONS[0].stack;
}

export const RADIUS_OPTIONS = [
    { value: "sharp", label: "Recto" },
    { value: "rounded", label: "Redondeado" },
    { value: "pill", label: "Píldora" },
];

export const SHADOW_OPTIONS = [
    { value: "flat", label: "Plana" },
    { value: "soft", label: "Suave" },
    { value: "dramatic", label: "Dramática" },
];

export const DENSITY_OPTIONS = [
    { value: "compact", label: "Compacta" },
    { value: "cozy", label: "Cómoda" },
    { value: "spacious", label: "Amplia" },
];

export const RADIUS_VALUES = { sharp: "0.375rem", rounded: "1rem", pill: "9999px" };
export const SHADOW_VALUES = {
    flat: "none",
    soft: "0 1px 3px rgba(15,15,35,.08), 0 1px 2px rgba(15,15,35,.04)",
    dramatic: "0 25px 50px -12px rgba(15,15,35,.35)",
};
export const DENSITY_VALUES = {
    compact: "clamp(2rem, 4vw, 2.5rem)",
    cozy: "clamp(2.5rem, 6vw, 5rem)",
    spacious: "clamp(3.5rem, 8vw, 7rem)",
};

export function themeVars(branding) {
    return {
        "--ms-radius": RADIUS_VALUES[branding?.radius] || RADIUS_VALUES.rounded,
        "--ms-shadow": SHADOW_VALUES[branding?.shadow_style] || SHADOW_VALUES.soft,
        "--ms-space-section": DENSITY_VALUES[branding?.density] || DENSITY_VALUES.cozy,
    };
}

export function assetUrl(relativeOrFull) {
    if (!relativeOrFull) return null;
    if (/^https?:\/\//.test(relativeOrFull)) return relativeOrFull;
    const base = import.meta.env.VITE_BACKEND_URL || "";
    if (relativeOrFull.startsWith("/")) return base + relativeOrFull;
    return `${base}/${relativeOrFull}`;
}

export function shareTargets({ url, company, hero }) {
    const text = `Mirá ${company} en Ticket Yourself: ${hero || ""}`.trim();
    const encUrl = encodeURIComponent(url);
    const encText = encodeURIComponent(text);
    return {
        whatsapp: `https://wa.me/?text=${encText}%20${encUrl}`,
        email: `mailto:?subject=${encodeURIComponent(company)}&body=${encText}%20${encUrl}`,
        twitter: `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`,
    };
}
