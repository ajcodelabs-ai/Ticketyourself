/**
 * Curated ticket design templates — A4 portrait (email PDF).
 * Coordinates are fractions [0,1] of the canvas — same contract as pdf_service.
 */
export type TicketFormat = "digital" | "a4" | "pvc";

/** Tickets are emailed as a one-page A4 PDF. */
export const TICKET_PAGE_FORMAT: TicketFormat = "a4";

/** A4 width / height in points (ReportLab). Used to keep QR/logo squares. */
export const A4_WH = 595.27 / 841.89;

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

/** Square box on an A4 portrait page (frac width → matching frac height). */
function square(fracW: number): { width: number; height: number } {
    return { width: fracW, height: fracW * A4_WH };
}

function centeredSquare(fracW: number, y: number) {
    const box = square(fracW);
    return { ...box, x: (1 - fracW) / 2, y };
}

export type TicketTemplate = {
    id: string;
    name: string;
    blurb: string;
    previewBg: string;
    previewFg: string;
    build: (format?: TicketFormat) => TicketDesign;
};

/** Classic light A4 — header, event details, large QR for the door. */
function buildClasico(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const ink = "#0f172a";
    const muted = "#64748b";
    const qr = centeredSquare(0.42, 0.58);
    const logo = square(0.16);
    return {
        format,
        template_id: "clasico",
        background_url: null,
        background_color: "#ffffff",
        elements: [
            el({ id: "clasico-logo", type: "logo", x: 0.08, y: 0.05, ...logo, image_url: null }),
            text("clasico-org", "organizer_name", {
                x: 0.28, y: 0.06, width: 0.64, height: 0.08, font_size: 12, color: muted,
            }),
            text("clasico-title", "title", {
                x: 0.08, y: 0.18, width: 0.84, height: 0.10, font_size: 26, color: ink,
            }),
            text("clasico-date", "starts_at", {
                x: 0.08, y: 0.30, width: 0.84, height: 0.05, font_size: 13, color: muted,
            }),
            text("clasico-venue", "venue", {
                x: 0.08, y: 0.36, width: 0.84, height: 0.05, font_size: 13, color: muted,
            }),
            text("clasico-holder", "holder_name", {
                x: 0.08, y: 0.44, width: 0.84, height: 0.05, font_size: 14, color: ink,
            }),
            text("clasico-price", "price", {
                x: 0.08, y: 0.50, width: 0.40, height: 0.05, font_size: 14, color: "#0d9488",
            }),
            text("clasico-order", "order_number", {
                x: 0.50, y: 0.50, width: 0.42, height: 0.05, font_size: 12, color: muted, align: "right",
            }),
            el({ id: "clasico-qr", type: "qr", ...qr }),
        ],
    };
}

/** Dark concert page — title first, QR lower third. */
function buildNoche(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const fg = "#f8fafc";
    const soft = "#94a3b8";
    const qr = centeredSquare(0.40, 0.58);
    const logo = square(0.14);
    return {
        format,
        template_id: "noche",
        background_url: null,
        background_color: "#0f172a",
        elements: [
            el({ id: "noche-logo", type: "logo", x: 0.08, y: 0.05, ...logo, image_url: null }),
            text("noche-org", "organizer_name", {
                x: 0.26, y: 0.06, width: 0.66, height: 0.07, font_size: 11, color: soft,
            }),
            text("noche-title", "title", {
                x: 0.08, y: 0.18, width: 0.84, height: 0.14, font_size: 28, color: fg,
            }),
            text("noche-date", "starts_at", {
                x: 0.08, y: 0.34, width: 0.84, height: 0.05, font_size: 13, color: soft,
            }),
            text("noche-venue", "venue", {
                x: 0.08, y: 0.40, width: 0.84, height: 0.05, font_size: 13, color: soft,
            }),
            text("noche-holder", "holder_name", {
                x: 0.08, y: 0.48, width: 0.84, height: 0.05, font_size: 14, color: fg,
            }),
            el({ id: "noche-qr", type: "qr", ...qr }),
        ],
    };
}

/** Centered sparse A4 — plenty of white space for a clean email PDF. */
function buildMinimal(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const ink = "#1e293b";
    const soft = "#64748b";
    const logo = square(0.18);
    const qr = centeredSquare(0.36, 0.58);
    return {
        format,
        template_id: "minimal",
        background_url: null,
        background_color: "#f8fafc",
        elements: [
            el({
                id: "min-logo",
                type: "logo",
                x: (1 - logo.width) / 2,
                y: 0.06,
                ...logo,
                image_url: null,
            }),
            text("min-title", "title", {
                x: 0.08, y: 0.22, width: 0.84, height: 0.10, font_size: 24, color: ink, align: "center",
            }),
            text("min-date", "starts_at", {
                x: 0.08, y: 0.34, width: 0.84, height: 0.05, font_size: 13, color: soft, align: "center",
            }),
            text("min-venue", "venue", {
                x: 0.08, y: 0.40, width: 0.84, height: 0.05, font_size: 13, color: soft, align: "center",
            }),
            text("min-holder", "holder_name", {
                x: 0.08, y: 0.48, width: 0.84, height: 0.05, font_size: 14, color: ink, align: "center",
            }),
            el({ id: "min-qr", type: "qr", ...qr }),
        ],
    };
}

/** Strong color page — big type, QR in the lower third. */
function buildBold(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const fg = "#ffffff";
    const soft = "#ccfbf1";
    const qr = centeredSquare(0.40, 0.56);
    const logo = square(0.14);
    return {
        format,
        template_id: "bold",
        background_url: null,
        background_color: "#0f766e",
        elements: [
            text("bold-org", "organizer_name", {
                x: 0.08, y: 0.05, width: 0.55, height: 0.06, font_size: 12, color: soft,
            }),
            text("bold-price", "price", {
                x: 0.55, y: 0.05, width: 0.37, height: 0.06, font_size: 14, color: fg, align: "right",
            }),
            el({ id: "bold-logo", type: "logo", x: 0.08, y: 0.13, ...logo, image_url: null }),
            text("bold-title", "title", {
                x: 0.08, y: 0.26, width: 0.84, height: 0.12, font_size: 28, color: fg,
            }),
            text("bold-holder", "holder_name", {
                x: 0.08, y: 0.40, width: 0.84, height: 0.05, font_size: 14, color: fg,
            }),
            text("bold-date", "starts_at", {
                x: 0.08, y: 0.46, width: 0.84, height: 0.04, font_size: 12, color: soft,
            }),
            text("bold-venue", "venue", {
                x: 0.08, y: 0.51, width: 0.84, height: 0.04, font_size: 12, color: soft,
            }),
            el({ id: "bold-qr", type: "qr", ...qr }),
        ],
    };
}

export const TICKET_TEMPLATES: TicketTemplate[] = [
    {
        id: "clasico",
        name: "Clásico",
        blurb: "Página A4 clara, lista para imprimir o abrir en el mail.",
        previewBg: "#ffffff",
        previewFg: "#0f172a",
        build: buildClasico,
    },
    {
        id: "noche",
        name: "Noche",
        blurb: "Fondo oscuro para shows. QR grande para la puerta.",
        previewBg: "#0f172a",
        previewFg: "#f8fafc",
        build: buildNoche,
    },
    {
        id: "minimal",
        name: "Minimal",
        blurb: "Centrado y sobrio, una hoja A4 con lo esencial.",
        previewBg: "#f8fafc",
        previewFg: "#1e293b",
        build: buildMinimal,
    },
    {
        id: "bold",
        name: "Bold",
        blurb: "Color fuerte y tipografía grande en formato carta.",
        previewBg: "#0f766e",
        previewFg: "#ffffff",
        build: buildBold,
    },
];

export function emptyDesign(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    return {
        format,
        template_id: null,
        background_url: null,
        background_color: "#ffffff",
        elements: [],
    };
}

/** Apply a template, keeping logo / background assets when possible. Always A4. */
export function applyTicketTemplate(
    templateId: string,
    current: TicketDesign | null | undefined,
): TicketDesign {
    const tpl = TICKET_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return emptyDesign(TICKET_PAGE_FORMAT);
    const next = tpl.build(TICKET_PAGE_FORMAT);
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
