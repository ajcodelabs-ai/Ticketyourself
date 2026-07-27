/**
 * Microsite page-builder — block types, presets, and migration helpers.
 */
export type BlockType =
    | "hero"
    | "about"
    | "events"
    | "contact"
    | "social"
    | "spacer"
    | "image"
    | "gallery"
    | "faq"
    | "testimonials";

export interface FaqItem {
    id: string;
    question: string;
    answer_html: string;
}

export interface TestimonialItem {
    id: string;
    name: string;
    role: string;
    quote: string;
    avatar_url?: string | null;
}

export interface GalleryImage {
    id: string;
    url: string;
    asset_id?: string;
}

export interface MicrositeBlock {
    id: string;
    type: BlockType;
    enabled: boolean;
    props: Record<string, unknown>;
}

/** Block types that can only appear once per page. */
export const SINGLETON_BLOCK_TYPES: BlockType[] = [
    "hero",
    "about",
    "events",
    "contact",
    "social",
];

export const BLOCK_CATALOG: {
    type: BlockType;
    label: string;
    description: string;
    icon: string;
}[] = [
    { type: "hero", label: "Hero", description: "Portada con título, subtítulo y botón", icon: "🎯" },
    { type: "about", label: "Sobre nosotros", description: "Texto enriquecido sobre la organización", icon: "📝" },
    { type: "events", label: "Eventos", description: "Listado automático de eventos publicados", icon: "🎟️" },
    { type: "image", label: "Imagen", description: "Imagen destacada con pie de foto", icon: "🖼️" },
    { type: "gallery", label: "Galería", description: "Grid de imágenes de tu organización", icon: "📸" },
    { type: "testimonials", label: "Testimonios", description: "Opiniones de asistentes o clientes", icon: "💬" },
    { type: "faq", label: "FAQ", description: "Preguntas frecuentes en acordeón", icon: "❓" },
    { type: "contact", label: "Contacto", description: "Email, teléfono y dirección", icon: "📞" },
    { type: "social", label: "Redes / Footer", description: "Iconos de redes y pie de página", icon: "🔗" },
    { type: "spacer", label: "Espaciador", description: "Espacio vertical entre secciones", icon: "↕️" },
];

const DEFAULT_PROPS: Record<BlockType, Record<string, unknown>> = {
    hero: { variant: "normal", align: "left", layers: [] },
    about: { align: "left" },
    events: { layout: "grid" },
    contact: {},
    social: {},
    spacer: { height: "md" },
    image: { image_url: null, caption: "", layout: "contained" },
    gallery: { images: [], columns: 3, layout: "grid" },
    faq: { title: "Preguntas frecuentes", items: [] },
    testimonials: { title: "Testimonios", items: [] },
};

const TEMPLATE_PRESETS: Record<string, Omit<MicrositeBlock, "id">[]> = {
    estandar: [
        { type: "hero", enabled: true, props: { variant: "normal", align: "left" } },
        { type: "about", enabled: true, props: { align: "left" } },
        { type: "events", enabled: true, props: { layout: "grid" } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
    galeria: [
        { type: "hero", enabled: true, props: { variant: "huge", align: "center" } },
        { type: "events", enabled: true, props: { layout: "galeria" } },
        { type: "about", enabled: true, props: { align: "center" } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
    evento_unico: [
        { type: "hero", enabled: true, props: { variant: "huge", align: "center" } },
        { type: "events", enabled: true, props: { layout: "featured" } },
        { type: "about", enabled: true, props: { align: "left" } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
    minimal: [
        { type: "hero", enabled: true, props: { variant: "normal", align: "center" } },
        { type: "events", enabled: true, props: { layout: "grid" } },
        { type: "social", enabled: true, props: {} },
    ],
    showcase: [
        { type: "hero", enabled: true, props: { variant: "huge", align: "center" } },
        { type: "gallery", enabled: true, props: { columns: 3, layout: "grid", images: [] } },
        { type: "events", enabled: true, props: { layout: "galeria" } },
        { type: "social", enabled: true, props: {} },
    ],
    cronologico: [
        { type: "hero", enabled: true, props: { variant: "normal", align: "left" } },
        { type: "events", enabled: true, props: { layout: "list" } },
        { type: "about", enabled: true, props: { align: "left" } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
    landing: [
        { type: "hero", enabled: true, props: { variant: "huge", align: "center" } },
        { type: "about", enabled: true, props: { align: "center" } },
        { type: "events", enabled: true, props: { layout: "grid" } },
        {
            type: "testimonials",
            enabled: true,
            props: { title: "Lo que dicen nuestros asistentes", items: [] },
        },
        { type: "faq", enabled: true, props: { title: "Preguntas frecuentes", items: [] } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
    portfolio: [
        { type: "hero", enabled: true, props: { variant: "normal", align: "center" } },
        { type: "gallery", enabled: true, props: { columns: 2, layout: "masonry", images: [] } },
        { type: "about", enabled: true, props: { align: "center" } },
        { type: "image", enabled: true, props: { layout: "full", caption: "", image_url: null } },
        { type: "contact", enabled: true, props: {} },
        { type: "social", enabled: true, props: {} },
    ],
};

export function newBlockId(): string {
    return crypto.randomUUID?.() || `b-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createBlock(
    type: BlockType,
    opts: { enabled?: boolean; props?: Record<string, unknown> } = {},
): MicrositeBlock {
    return {
        id: newBlockId(),
        type,
        enabled: opts.enabled ?? true,
        props: { ...DEFAULT_PROPS[type], ...(opts.props || {}) },
    };
}

export function blocksForTemplate(
    template: string,
    sectionsEnabled: Record<string, boolean> = {},
): MicrositeBlock[] {
    const preset = TEMPLATE_PRESETS[template] || TEMPLATE_PRESETS.estandar;
    return preset.map((spec) => {
        const sectionKey = spec.type === "social" ? "social" : spec.type;
        const enabled =
            sectionKey in sectionsEnabled
                ? sectionsEnabled[sectionKey] ?? spec.enabled
                : spec.enabled;
        return createBlock(spec.type, { enabled, props: spec.props });
    });
}

export function resolveBlocks(microsite: {
    blocks?: MicrositeBlock[];
    template?: string;
    sections_enabled?: Record<string, boolean>;
}): MicrositeBlock[] {
    if (microsite.blocks?.length) return microsite.blocks;
    return blocksForTemplate(microsite.template || "estandar", microsite.sections_enabled || {});
}

export function blockLabel(type: BlockType): string {
    return BLOCK_CATALOG.find((b) => b.type === type)?.label || type;
}

export function sectionsFromBlocks(blocks: MicrositeBlock[]): Record<string, boolean> {
    const out: Record<string, boolean> = {
        hero: false,
        about: false,
        events: false,
        contact: false,
        social: false,
    };
    for (const block of blocks) {
        const key = block.type === "social" ? "social" : block.type;
        if (key in out && block.enabled) out[key] = true;
    }
    return out;
}

export function hasHtmlContent(html: string | undefined | null): boolean {
    if (!html) return false;
    return html.replace(/<[^>]+>/g, "").trim().length > 0;
}

/** Content field keys editable per block type (global content object). */
export const BLOCK_CONTENT_FIELDS: Record<
    BlockType,
    { key: string; label: string; textarea?: boolean; maxLength?: number; rich?: boolean }[]
> = {
    hero: [
        { key: "hero_title", label: "Título", maxLength: 80 },
        { key: "hero_subtitle", label: "Subtítulo", textarea: true, maxLength: 200 },
        { key: "hero_cta_text", label: "Texto del botón", maxLength: 30 },
        { key: "hero_cta_href", label: "Enlace del botón", maxLength: 500 },
    ],
    about: [{ key: "about_title", label: "Título", maxLength: 80 }],
    events: [],
    contact: [
        { key: "contact_email", label: "Email" },
        { key: "contact_phone", label: "Teléfono", maxLength: 40 },
        { key: "address", label: "Dirección", maxLength: 200 },
    ],
    social: [],
    spacer: [],
    image: [],
    gallery: [],
    faq: [],
    testimonials: [],
};

export const HERO_CTA_HREF_OPTIONS = [
    { value: "#events", label: "Scroll a eventos" },
    { value: "#contact", label: "Scroll a contacto" },
    { value: "custom", label: "URL personalizada" },
];

export function defaultFaqItem(): FaqItem {
    return { id: newBlockId(), question: "", answer_html: "" };
}

export function defaultTestimonial(): TestimonialItem {
    return { id: newBlockId(), name: "", role: "", quote: "", avatar_url: null };
}
