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
    type: "logo" | "qr" | "text" | "shape";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    image_url?: string | null;
    field?: string | null;
    text?: string | null;
    font_size?: number;
    color?: string | null;
    align?: "left" | "center" | "right";
    // shape-only: fill (`color`, above) and/or an outline. A dashed shape
    // reads as a divider/perforation line rather than a solid block.
    stroke?: string | null;
    stroke_width?: number;
    dash?: boolean;
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

/** A filled and/or outlined rectangle — color blocks, accent bars, dividers,
 * "card" backgrounds behind grouped text or the QR. Dashed reads as a
 * perforation/divider line rather than a solid block. */
function shape(
    id: string,
    opts: {
        x: number;
        y: number;
        width: number;
        height: number;
        color?: string | null;
        stroke?: string | null;
        stroke_width?: number;
        dash?: boolean;
    },
): TicketDesignElement {
    return el({
        id,
        type: "shape",
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
        color: opts.color ?? null,
        stroke: opts.stroke ?? null,
        stroke_width: opts.stroke_width ?? 1,
        dash: !!opts.dash,
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

/** Classic light A4, refreshed — brand bar, accent rule, a grouped "card"
 * for event details and a framed QR instead of loose text on white. */
function buildClasico(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const ink = "#0f172a";
    const muted = "#64748b";
    const accent = "#0d9488";
    const card = "#f1f5f9";
    const line = "#e2e8f0";
    const qr = centeredSquare(0.40, 0.68);
    const logo = square(0.14);
    return {
        format,
        template_id: "clasico",
        background_url: null,
        background_color: "#ffffff",
        elements: [
            shape("clasico-topbar", { x: 0, y: 0, width: 1, height: 0.014, color: accent }),
            el({ id: "clasico-logo", type: "logo", x: 0.08, y: 0.06, ...logo, image_url: null }),
            text("clasico-org", "organizer_name", {
                x: 0.26, y: 0.075, width: 0.66, height: 0.06, font_size: 12, color: muted,
            }),
            shape("clasico-divider", { x: 0.08, y: 0.19, width: 0.84, height: 0.004, color: line }),
            shape("clasico-title-accent", { x: 0.08, y: 0.235, width: 0.012, height: 0.09, color: accent }),
            text("clasico-title", "title", {
                x: 0.115, y: 0.22, width: 0.80, height: 0.12, font_size: 25, color: ink,
            }),
            shape("clasico-card", { x: 0.08, y: 0.38, width: 0.84, height: 0.20, color: card }),
            text("clasico-date", "starts_at", {
                x: 0.11, y: 0.41, width: 0.78, height: 0.05, font_size: 13, color: muted,
            }),
            text("clasico-venue", "venue", {
                x: 0.11, y: 0.47, width: 0.78, height: 0.05, font_size: 13, color: muted,
            }),
            text("clasico-holder", "holder_name", {
                x: 0.11, y: 0.53, width: 0.78, height: 0.05, font_size: 14, color: ink,
            }),
            text("clasico-price", "price", {
                x: 0.08, y: 0.60, width: 0.42, height: 0.05, font_size: 14, color: accent,
            }),
            text("clasico-order", "order_number", {
                x: 0.50, y: 0.60, width: 0.42, height: 0.05, font_size: 12, color: muted, align: "right",
            }),
            shape("clasico-qr-card", {
                x: qr.x - 0.03, y: qr.y - 0.02, width: qr.width + 0.06, height: qr.height + 0.04,
                color: "#ffffff", stroke: line, stroke_width: 1,
            }),
            el({ id: "clasico-qr", type: "qr", ...qr }),
        ],
    };
}

/** Dark concert page, refreshed — a full-height accent spine, an editorial
 * kicker line above the title, and a light "spotlight" card framing the QR
 * against the dark background. */
function buildNoche(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const fg = "#f8fafc";
    const soft = "#94a3b8";
    const accent = "#f43f5e";
    const qr = centeredSquare(0.38, 0.68);
    const logo = square(0.13);
    return {
        format,
        template_id: "noche",
        background_url: null,
        background_color: "#0f172a",
        elements: [
            shape("noche-spine", { x: 0, y: 0, width: 0.025, height: 1, color: accent }),
            el({ id: "noche-logo", type: "logo", x: 0.10, y: 0.06, ...logo, image_url: null }),
            text("noche-org", "organizer_name", {
                x: 0.27, y: 0.075, width: 0.63, height: 0.06, font_size: 11, color: soft,
            }),
            shape("noche-kicker", { x: 0.10, y: 0.20, width: 0.14, height: 0.008, color: accent }),
            text("noche-title", "title", {
                x: 0.10, y: 0.215, width: 0.82, height: 0.15, font_size: 30, color: fg,
            }),
            text("noche-date", "starts_at", {
                x: 0.10, y: 0.40, width: 0.82, height: 0.05, font_size: 13, color: soft,
            }),
            text("noche-venue", "venue", {
                x: 0.10, y: 0.46, width: 0.82, height: 0.05, font_size: 13, color: soft,
            }),
            text("noche-holder", "holder_name", {
                x: 0.10, y: 0.53, width: 0.82, height: 0.05, font_size: 14, color: fg,
            }),
            shape("noche-perforation", {
                x: 0.10, y: 0.62, width: 0.80, height: 0.003, color: soft, dash: true,
            }),
            shape("noche-qr-card", {
                x: qr.x - 0.035, y: qr.y - 0.024, width: qr.width + 0.07, height: qr.height + 0.048,
                color: fg,
            }),
            el({ id: "noche-qr", type: "qr", ...qr }),
        ],
    };
}

/** Centered minimal A4, refreshed — one accent rule and a thin outlined QR
 * frame do the work instead of flat, unrelated lines of text. */
function buildMinimal(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const ink = "#1e293b";
    const soft = "#64748b";
    const accent = "#0ea5e9";
    const line = "#e2e8f0";
    const logo = square(0.16);
    const qr = centeredSquare(0.34, 0.65);
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
                y: 0.07,
                ...logo,
                image_url: null,
            }),
            shape("min-accent", { x: 0.42, y: 0.20, width: 0.16, height: 0.006, color: accent }),
            text("min-title", "title", {
                x: 0.08, y: 0.24, width: 0.84, height: 0.10, font_size: 24, color: ink, align: "center",
            }),
            text("min-date", "starts_at", {
                x: 0.08, y: 0.36, width: 0.84, height: 0.05, font_size: 13, color: soft, align: "center",
            }),
            text("min-venue", "venue", {
                x: 0.08, y: 0.42, width: 0.84, height: 0.05, font_size: 13, color: soft, align: "center",
            }),
            text("min-holder", "holder_name", {
                x: 0.08, y: 0.49, width: 0.84, height: 0.05, font_size: 14, color: ink, align: "center",
            }),
            shape("min-divider", { x: 0.30, y: 0.60, width: 0.40, height: 0.004, color: line }),
            shape("min-qr-frame", {
                x: qr.x - 0.02, y: qr.y - 0.014, width: qr.width + 0.04, height: qr.height + 0.028,
                stroke: line, stroke_width: 1,
            }),
            el({ id: "min-qr", type: "qr", ...qr }),
        ],
    };
}

/** Strong two-tone page, refreshed — a darker "stub" band with a
 * perforation line splits the page like a real ticket, and an accent chip
 * lifts the price instead of letting it blend into the body text. */
function buildBold(format: TicketFormat = TICKET_PAGE_FORMAT): TicketDesign {
    const fg = "#ffffff";
    const soft = "#ccfbf1";
    const dark = "#042f2e";
    const accent = "#fbbf24";
    // Stub takes 40% of the page (not 28%) so the QR card can be bigger and
    // there's no dead gap between the venue line and the perforation.
    const qr = centeredSquare(0.30, 0.694);
    const logo = square(0.14);
    return {
        format,
        template_id: "bold",
        background_url: null,
        background_color: "#0f766e",
        elements: [
            text("bold-org", "organizer_name", {
                x: 0.08, y: 0.05, width: 0.44, height: 0.06, font_size: 12, color: soft,
            }),
            shape("bold-price-chip", { x: 0.55, y: 0.045, width: 0.37, height: 0.06, color: accent }),
            text("bold-price", "price", {
                x: 0.57, y: 0.05, width: 0.33, height: 0.05, font_size: 14, color: dark, align: "right",
            }),
            el({ id: "bold-logo", type: "logo", x: 0.08, y: 0.14, ...logo, image_url: null }),
            text("bold-title", "title", {
                x: 0.08, y: 0.27, width: 0.84, height: 0.12, font_size: 27, color: fg,
            }),
            text("bold-holder", "holder_name", {
                x: 0.08, y: 0.41, width: 0.84, height: 0.05, font_size: 14, color: fg,
            }),
            text("bold-date", "starts_at", {
                x: 0.08, y: 0.47, width: 0.84, height: 0.04, font_size: 12, color: soft,
            }),
            text("bold-venue", "venue", {
                x: 0.08, y: 0.52, width: 0.84, height: 0.04, font_size: 12, color: soft,
            }),
            shape("bold-stub", { x: 0, y: 0.60, width: 1, height: 0.40, color: dark }),
            shape("bold-perforation", { x: 0, y: 0.595, width: 1, height: 0.004, color: fg, dash: true }),
            shape("bold-qr-card", {
                x: qr.x - 0.03, y: qr.y - 0.022, width: qr.width + 0.06, height: qr.height + 0.044,
                color: fg,
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
