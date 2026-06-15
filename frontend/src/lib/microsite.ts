/**
 * Microsite helpers — asset URL builder, defaults, font selection.
 * Single source of truth so the editor + preview + public view stay in sync.
 */

export const TEMPLATE_OPTIONS = [
    {
        code: "estandar",
        name: "Estándar",
        description: "Hero + sobre nosotros + listado de eventos + footer con redes.",
    },
    {
        code: "galeria",
        name: "Galería",
        description: "Hero grande + grid visual de eventos con foco en imágenes.",
    },
    {
        code: "evento_unico",
        name: "Evento Único",
        description: "Una sola página con hero gigante y CTA principal.",
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
