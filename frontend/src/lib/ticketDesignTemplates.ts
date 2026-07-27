/**
 * Curated ticket design templates.
 * Coordinates are fractions [0,1] of the canvas — same contract as pdf_service.
 */
export type TicketFormat = "digital" | "a4" | "pvc";

export type TicketDesignElement = {
    id: string;
    type: "logo" | "qr" | "text";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    image_url?: string | null;
    field?: string | null;
    text?: string | null;
    font_size?: number;
    color?: string;
    align?: "left" | "center" | "right";
};

export type TicketDesign = {
    format: TicketFormat;
    background_url?: string | null;
    background_color: string;
    elements: TicketDesignElement[];
    template_id?: string | null;
};

function el(
    partial: Omit<TicketDesignElement, "id"> & { id?: string },
): TicketDesignElement {
    return {
        id: partial.id || `${partial.type}-${partial.field || "x"}-${Math.random().toString(36).slice(2, 7)}`,
        rotation: 0,
        ...partial,
    };
}

function text(
    id: string,
    field: string,
    opts: {
        x: number;
        y: number;
        width: number;
        height: number;
        font_size: number;
        color: string;
        align?: "left" | "center" | "right";
        text?: string;
    },
): TicketDesignElement {
    return el({
        id,
        type: "text",
        field,
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
        font_size: opts.font_size,
        color: opts.color,
        align: opts.align || "left",
        text: opts.text ?? null,
    });
}

export type TicketTemplate = {
    id: string;
    name: string;
    blurb: string;
    /** Swatch shown on the picker card */
    previewBg: string;
    previewFg: string;
    build: (format?: TicketFormat) => TicketDesign;
};

/** Classic light ticket — logo + info left, QR right. */
function buildClasico(format: TicketFormat = "digital"): TicketDesign {
    const ink = "#0f172a";
    const muted = "#64748b";
    return {
        format,
        template_id: "clasico",
        background_url: null,
        background_color: "#ffffff",
        elements: [
            el({ id: "clasico-logo", type: "logo", x: 0.04, y: 0.08, width: 0.16, height: 0.28, image_url: null }),
            text("clasico-title", "title", {
                x: 0.24, y: 0.08, width: 0.5, height: 0.22, font_size: 20, color: ink, align: "left",
            }),
            text("clasico-price", "price", {
                x: 0.74, y: 0.1, width: 0.22, height: 0.16, font_size: 14, color: "#0d9488", align: "right",
            }),
            text("clasico-venue", "venue", {
                x: 0.04, y: 0.48, width: 0.55, height: 0.12, font_size: 12, color: muted,
            }),
            text("clasico-date", "starts_at", {
                x: 0.04, y: 0.62, width: 0.55, height: 0.12, font_size: 12, color: muted,
            }),
            text("clasico-holder", "holder_name", {
                x: 0.04, y: 0.78, width: 0.55, height: 0.14, font_size: 13, color: ink,
            }),
            el({ id: "clasico-qr", type: "qr", x: 0.68, y: 0.42, width: 0.28, height: 0.5 }),
        ],
    };
}

/** Dark modern ticket. */
function buildNoche(format: TicketFormat = "digital"): TicketDesign {
    const fg = "#f8fafc";
    const soft = "#94a3b8";
    return {
        format,
        template_id: "noche",
        background_url: null,
        background_color: "#0f172a",
        elements: [
            el({ id: "noche-logo", type: "logo", x: 0.05, y: 0.1, width: 0.14, height: 0.26, image_url: null }),
            text("noche-org", "organizer_name", {
                x: 0.22, y: 0.12, width: 0.5, height: 0.12, font_size: 11, color: soft,
            }),
            text("noche-title", "title", {
                x: 0.05, y: 0.4, width: 0.58, height: 0.22, font_size: 22, color: fg,
            }),
            text("noche-date", "starts_at", {
                x: 0.05, y: 0.68, width: 0.55, height: 0.1, font_size: 12, color: soft,
            }),
            text("noche-venue", "venue", {
                x: 0.05, y: 0.8, width: 0.55, height: 0.12, font_size: 12, color: soft,
            }),
            el({ id: "noche-qr", type: "qr", x: 0.68, y: 0.28, width: 0.27, height: 0.52 }),
        ],
    };
}

/** Centered minimal. */
function buildMinimal(format: TicketFormat = "digital"): TicketDesign {
    const ink = "#1e293b";
    const soft = "#64748b";
    return {
        format,
        template_id: "minimal",
        background_url: null,
        background_color: "#f8fafc",
        elements: [
            el({ id: "min-logo", type: "logo", x: 0.4, y: 0.06, width: 0.2, height: 0.22, image_url: null }),
            text("min-title", "title", {
                x: 0.08, y: 0.32, width: 0.84, height: 0.16, font_size: 20, color: ink, align: "center",
            }),
            text("min-date", "starts_at", {
                x: 0.1, y: 0.5, width: 0.8, height: 0.1, font_size: 12, color: soft, align: "center",
            }),
            text("min-venue", "venue", {
                x: 0.1, y: 0.6, width: 0.8, height: 0.1, font_size: 12, color: soft, align: "center",
            }),
            el({ id: "min-qr", type: "qr", x: 0.38, y: 0.72, width: 0.24, height: 0.24 }),
        ],
    };
}

/** Bold band — teal header feel via background + strong type. */
function buildBold(format: TicketFormat = "digital"): TicketDesign {
    const fg = "#ffffff";
    const soft = "#ccfbf1";
    return {
        format,
        template_id: "bold",
        background_url: null,
        background_color: "#0f766e",
        elements: [
            text("bold-org", "organizer_name", {
                x: 0.05, y: 0.08, width: 0.55, height: 0.1, font_size: 11, color: soft,
            }),
            text("bold-price", "price", {
                x: 0.65, y: 0.08, width: 0.3, height: 0.12, font_size: 14, color: fg, align: "right",
            }),
            text("bold-title", "title", {
                x: 0.05, y: 0.28, width: 0.58, height: 0.24, font_size: 22, color: fg,
            }),
            text("bold-holder", "holder_name", {
                x: 0.05, y: 0.58, width: 0.55, height: 0.12, font_size: 13, color: fg,
            }),
            text("bold-date", "starts_at", {
                x: 0.05, y: 0.74, width: 0.55, height: 0.1, font_size: 11, color: soft,
            }),
            text("bold-venue", "venue", {
                x: 0.05, y: 0.86, width: 0.55, height: 0.1, font_size: 11, color: soft,
            }),
            el({ id: "bold-qr", type: "qr", x: 0.68, y: 0.35, width: 0.27, height: 0.5 }),
            el({ id: "bold-logo", type: "logo", x: 0.72, y: 0.08, width: 0.2, height: 0.22, image_url: null }),
        ],
    };
}

export const TICKET_TEMPLATES: TicketTemplate[] = [
    {
        id: "clasico",
        name: "Clásico",
        blurb: "Limpio y claro, ideal para la mayoría de eventos.",
        previewBg: "#ffffff",
        previewFg: "#0f172a",
        build: buildClasico,
    },
    {
        id: "noche",
        name: "Noche",
        blurb: "Fondo oscuro para shows y conciertos.",
        previewBg: "#0f172a",
        previewFg: "#f8fafc",
        build: buildNoche,
    },
    {
        id: "minimal",
        name: "Minimal",
        blurb: "Centrado y sobrio, poca información.",
        previewBg: "#f8fafc",
        previewFg: "#1e293b",
        build: buildMinimal,
    },
    {
        id: "bold",
        name: "Bold",
        blurb: "Color fuerte y tipografía grande.",
        previewBg: "#0f766e",
        previewFg: "#ffffff",
        build: buildBold,
    },
];

export function emptyDesign(format: TicketFormat = "digital"): TicketDesign {
    return {
        format,
        template_id: null,
        background_url: null,
        background_color: "#ffffff",
        elements: [],
    };
}

/** Apply a template, keeping logo / background assets when possible. */
export function applyTicketTemplate(
    templateId: string,
    current: TicketDesign | null | undefined,
): TicketDesign {
    const tpl = TICKET_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return emptyDesign(current?.format || "digital");
    const next = tpl.build(current?.format || "digital");
    const prevLogo = (current?.elements || []).find((e) => e.type === "logo" && e.image_url);
    if (prevLogo?.image_url) {
        next.elements = next.elements.map((e) =>
            e.type === "logo" ? { ...e, image_url: prevLogo.image_url } : e,
        );
    }
    if (current?.background_url) {
        next.background_url = current.background_url;
    }
    return next;
}

export function detectTemplateId(design: TicketDesign | null | undefined): string | null {
    if (!design?.elements?.length) return null;
    if (design.template_id) return design.template_id;
    return null;
}
