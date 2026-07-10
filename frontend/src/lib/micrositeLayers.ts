/**
 * Hero grid layers — posicionamiento tipo page builder dentro del bloque Hero.
 */
import type { CSSProperties } from "react";
export type HeroLayerType = "heading" | "text" | "badge" | "button" | "image";
export type HeroLayerRole = "title" | "subtitle" | "cta";

export const CORE_LAYER_IDS = {
    title: "hero-core-title",
    subtitle: "hero-core-subtitle",
    cta: "hero-core-cta",
} as const;

export const CORE_LAYER_LABELS: Record<HeroLayerRole, string> = {
    title: "Título principal",
    subtitle: "Subtítulo",
    cta: "Botón CTA",
};

export type HeroLayerFontSize = "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
export type HeroLayerFontWeight = "normal" | "medium" | "semibold" | "bold";

export interface HeroLayer {
    id: string;
    type: HeroLayerType;
    content: string;
    /** Columna inicial 1–12 */
    colStart: number;
    /** Ancho en columnas 1–12 */
    colSpan: number;
    /** Fila 1–4 */
    row: number;
    align: "left" | "center" | "right";
    /** Capas fijas del hero (título, subtítulo, CTA) */
    role?: HeroLayerRole;
    /** Estilos opcionales */
    color?: string;
    fontSize?: HeroLayerFontSize;
    fontWeight?: HeroLayerFontWeight;
    /** Capa botón */
    href?: string;
    /** Capa imagen */
    imageUrl?: string;
}

export const GRID_COLS = 12;
export const GRID_ROWS = 6;

export const FONT_SIZE_CLASSES: Record<HeroLayerFontSize, string> = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
    xl: "text-xl",
    "2xl": "text-2xl",
    "3xl": "text-3xl",
};

export const FONT_WEIGHT_CLASSES: Record<HeroLayerFontWeight, string> = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
};

export function newLayerId(): string {
    return crypto.randomUUID?.() || `L-${Date.now()}`;
}

export function createHeroLayer(type: HeroLayerType = "text"): HeroLayer {
    const defaults: Record<HeroLayerType, Partial<HeroLayer>> = {
        heading: { content: "Nuevo título", colSpan: 8, row: 1, type: "heading", fontSize: "2xl", fontWeight: "bold" },
        text: { content: "Texto adicional", colSpan: 6, row: 4, type: "text", fontSize: "lg", fontWeight: "normal" },
        badge: { content: "Etiqueta", colSpan: 3, row: 4, type: "badge", fontSize: "sm", fontWeight: "semibold" },
        button: { content: "Ver eventos", colSpan: 4, row: 5, type: "button", href: "#events", fontSize: "base", fontWeight: "semibold" },
        image: { content: "", colSpan: 4, row: 4, type: "image", imageUrl: "" },
    };
    const d = defaults[type];
    return {
        id: newLayerId(),
        type,
        content: d.content || "",
        colStart: 1,
        colSpan: d.colSpan || 6,
        row: d.row || 2,
        align: "left",
        fontSize: d.fontSize,
        fontWeight: d.fontWeight,
        href: d.href,
        imageUrl: d.imageUrl,
    };
}

export function normalizeLayer(layer: HeroLayer): HeroLayer {
    const colSpan = Math.max(1, Math.min(GRID_COLS, layer.colSpan || 6));
    const colStart = Math.max(1, Math.min(GRID_COLS - colSpan + 1, layer.colStart || 1));
    const row = Math.max(1, Math.min(GRID_ROWS, layer.row || 1));
    return { ...layer, colSpan, colStart, row };
}

export function snapColStart(pointerX: number, rect: DOMRect, colSpan: number): number {
    const rel = pointerX - rect.left;
    const colWidth = rect.width / GRID_COLS;
    const raw = Math.floor(rel / colWidth) + 1;
    return Math.max(1, Math.min(GRID_COLS - colSpan + 1, raw));
}

export function snapRow(pointerY: number, rect: DOMRect): number {
    const rel = pointerY - rect.top;
    const rowHeight = rect.height / GRID_ROWS;
    const raw = Math.floor(rel / rowHeight) + 1;
    return Math.max(1, Math.min(GRID_ROWS, raw));
}

export function snapColSpan(pointerX: number, rect: DOMRect, colStart: number): number {
    const rel = pointerX - rect.left;
    const colWidth = rect.width / GRID_COLS;
    const endCol = Math.min(GRID_COLS, Math.max(colStart, Math.ceil(rel / colWidth)));
    return Math.max(1, Math.min(GRID_COLS - colStart + 1, endCol - colStart + 1));
}

export function layerTypographyClasses(layer: HeroLayer): string {
    const size = layer.fontSize ? FONT_SIZE_CLASSES[layer.fontSize] : "";
    const weight = layer.fontWeight ? FONT_WEIGHT_CLASSES[layer.fontWeight] : "";
    return [size, weight].filter(Boolean).join(" ");
}

export function layerInlineStyle(layer: HeroLayer): CSSProperties {
    return layer.color ? { color: layer.color } : {};
}

export const LAYER_TYPE_LABELS: Record<HeroLayerType, string> = {
    heading: "Título grande",
    text: "Párrafo",
    badge: "Etiqueta / badge",
    button: "Botón",
    image: "Imagen",
};

function blockAlign(align: string): HeroLayer["align"] {
    if (align === "center") return "center";
    if (align === "right") return "right";
    return "left";
}

export function defaultCoreLayers(
    content: Record<string, string>,
    variant: string,
    align: string,
): HeroLayer[] {
    const alignVal = blockAlign(align);
    const huge = variant === "huge";

    return [
        {
            id: CORE_LAYER_IDS.title,
            role: "title",
            type: "heading",
            content: content.hero_title || "",
            colStart: 1,
            colSpan: 12,
            row: 2,
            align: alignVal,
            fontSize: huge ? "3xl" : "2xl",
            fontWeight: "bold",
        },
        {
            id: CORE_LAYER_IDS.subtitle,
            role: "subtitle",
            type: "text",
            content: content.hero_subtitle || "",
            colStart: alignVal === "center" ? 2 : 1,
            colSpan: alignVal === "center" ? 10 : 12,
            row: 3,
            align: alignVal,
            fontSize: "lg",
            fontWeight: "normal",
        },
        {
            id: CORE_LAYER_IDS.cta,
            role: "cta",
            type: "button",
            content: content.hero_cta_text || "",
            href: content.hero_cta_href || "#events",
            colStart: alignVal === "center" ? 5 : 1,
            colSpan: 4,
            row: 5,
            align: alignVal,
            fontSize: "base",
            fontWeight: "semibold",
        },
    ];
}

export function isCoreLayer(layer: HeroLayer): boolean {
    return Boolean(
        layer.role ||
            layer.id === CORE_LAYER_IDS.title ||
            layer.id === CORE_LAYER_IDS.subtitle ||
            layer.id === CORE_LAYER_IDS.cta,
    );
}
export function resolveHeroLayers(
    rawLayers: HeroLayer[] | undefined,
    content: Record<string, string>,
    variant: string,
    align: string,
): HeroLayer[] {
    const stored = (rawLayers || []).map(normalizeLayer);
    const defaults = defaultCoreLayers(content, variant, align);
    const extras = stored.filter((l) => !isCoreLayer(l));

    const core = defaults.map((def) => {
        const saved = stored.find((l) => l.role === def.role || l.id === def.id);
        const merged = saved ? { ...def, ...saved, role: def.role, id: def.id } : def;
        return normalizeLayer({
            ...merged,
            content:
                def.role === "title"
                    ? content.hero_title ?? merged.content
                    : def.role === "subtitle"
                      ? content.hero_subtitle ?? merged.content
                      : content.hero_cta_text ?? merged.content,
            href: def.role === "cta" ? content.hero_cta_href ?? merged.href : merged.href,
        });
    });

    return [...extras, ...core].sort((a, b) => a.row - b.row || a.colStart - b.colStart);
}

export function applyHeroLayerPatch(
    rawLayers: HeroLayer[] | undefined,
    content: Record<string, string>,
    variant: string,
    align: string,
    layerId: string,
    patch: Partial<HeroLayer>,
): HeroLayer[] {
    return resolveHeroLayers(rawLayers, content, variant, align).map((l) =>
        l.id === layerId ? normalizeLayer({ ...l, ...patch }) : l,
    );
}
