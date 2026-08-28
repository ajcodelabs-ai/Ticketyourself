/**
 * Capa individual del hero con drag en tiempo real, resize y edición inline.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, ImagePlus, Sparkles } from "lucide-react";
import InlineEditable from "@/components/microsite/editor/InlineEditable";
import { assetUrl } from "@/lib/microsite";
import { isSafeHref } from "@/lib/sanitizeHtml";
import {
    layerInlineStyle,
    layerTypographyClasses,
    normalizeLayer,
    snapColSpan,
    snapColStart,
    snapRow,
    type HeroLayer,
} from "@/lib/micrositeLayers";
import { cn } from "@/lib/utils";

type LayerPreview = Pick<HeroLayer, "colStart" | "colSpan" | "row">;

function scrollOrNavigate(href: string | undefined) {
    if (!href || !isSafeHref(href)) return;
    const target = href.trim();
    if (target.startsWith("#")) {
        const id = target.slice(1);
        const escaped =
            typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
        const el =
            document.getElementById(id) ||
            document.querySelector(`[data-ms-anchor="${escaped}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }
    window.open(target, target.startsWith("http") ? "_blank" : "_self", "noopener,noreferrer");
}

export default function HeroLayerItem({
    layer,
    editorMode,
    isSelected,
    showGrid,
    huge = false,
    primaryColor,
    onSelect,
    onUpdate,
    onUploadImage,
    uploadingImage,
}: {
    layer: HeroLayer;
    editorMode: boolean;
    isSelected: boolean;
    showGrid: boolean;
    huge?: boolean;
    primaryColor?: string;
    onSelect: () => void;
    onUpdate: (patch: Partial<HeroLayer>) => void;
    onUploadImage?: (file: File) => Promise<string | null>;
    uploadingImage?: boolean;
}) {
    const [preview, setPreview] = useState<LayerPreview | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const display = preview ? normalizeLayer({ ...layer, ...preview }) : layer;

    const alignClass =
        display.align === "center"
            ? "text-center"
            : display.align === "right"
              ? "text-right"
              : "text-left";

    const typeClass =
        layer.type === "badge"
            ? "inline-block uppercase tracking-widest px-3 py-1 rounded-full bg-white/20 backdrop-blur"
            : layer.type === "button"
              ? "inline-flex items-center gap-2 rounded-full px-6 py-2.5 shadow-lg bg-white text-gray-900"
              : "";

    const typography = layerTypographyClasses(layer);
    const inlineStyle = layerInlineStyle(layer);

    const bindGridDrag = (e: ReactPointerEvent, mode: "move" | "resize") => {
        if (!editorMode || !showGrid) return;
        if ((e.target as HTMLElement).closest("[data-inline-editable]")) return;
        if ((e.target as HTMLElement).closest("[data-layer-toolbar]")) return;

        e.stopPropagation();
        e.preventDefault();
        onSelect();

        const grid = (e.currentTarget as HTMLElement).closest("[data-hero-grid]");
        if (!grid) return;
        const rect = grid.getBoundingClientRect();

        const onMove = (ev: globalThis.PointerEvent) => {
            ev.preventDefault();
            if (mode === "move") {
                setPreview({
                    colStart: snapColStart(ev.clientX, rect, layer.colSpan),
                    colSpan: layer.colSpan,
                    row: snapRow(ev.clientY, rect),
                });
            } else {
                setPreview({
                    colStart: layer.colStart,
                    colSpan: snapColSpan(ev.clientX, rect, layer.colStart),
                    row: layer.row,
                });
            }
        };

        const onUp = (ev: globalThis.PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (mode === "move") {
                onUpdate(
                    normalizeLayer({
                        ...layer,
                        colStart: snapColStart(ev.clientX, rect, layer.colSpan),
                        row: snapRow(ev.clientY, rect),
                    }),
                );
            } else {
                onUpdate(
                    normalizeLayer({
                        ...layer,
                        colSpan: snapColSpan(ev.clientX, rect, layer.colStart),
                    }),
                );
            }
            setPreview(null);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const renderContent = () => {
        if (layer.role === "title") {
            return (
                <InlineEditable
                    as="h1"
                    value={layer.content}
                    onChange={(v) => onUpdate({ content: v })}
                    enabled={editorMode}
                    className={cn(
                        "font-bold leading-tight",
                        !layer.fontSize && (huge ? "text-5xl md:text-7xl" : "text-4xl md:text-6xl"),
                        typography,
                    )}
                    style={inlineStyle}
                    placeholder="Título del hero"
                    testid="ms-hero-title"
                    onSelect={onSelect}
                />
            );
        }

        if (layer.role === "subtitle") {
            return (
                <InlineEditable
                    as="p"
                    value={layer.content}
                    onChange={(v) => onUpdate({ content: v })}
                    enabled={editorMode}
                    multiline
                    className={cn(
                        !layer.fontSize && "text-lg md:text-xl text-white/90",
                        typography,
                    )}
                    style={inlineStyle}
                    placeholder="Subtítulo"
                    testid="ms-hero-subtitle"
                    onSelect={onSelect}
                />
            );
        }

        if (layer.role === "cta" || layer.type === "button") {
            const ctaClass =
                layer.role === "cta"
                    ? "inline-flex items-center gap-2 rounded-full px-7 py-3 font-medium shadow-lg bg-white text-gray-900"
                    : cn(typeClass, typography);

            if (editorMode) {
                return (
                    <InlineEditable
                        value={layer.content}
                        onChange={(v) => onUpdate({ content: v })}
                        enabled
                        className={ctaClass}
                        style={inlineStyle}
                        placeholder="Texto del botón"
                        testid={layer.role === "cta" ? "ms-hero-cta" : undefined}
                        onSelect={onSelect}
                    />
                );
            }
            if (!layer.content) return null;
            return (
                <button
                    type="button"
                    onClick={() => scrollOrNavigate(layer.href || "#events")}
                    className={cn(ctaClass, "hover:scale-[1.03] transition")}
                    style={{
                        ...inlineStyle,
                        color: inlineStyle.color || primaryColor || "#111",
                        background: layer.role === "cta" ? "white" : undefined,
                    }}
                    data-testid={layer.role === "cta" ? "ms-hero-cta" : undefined}
                >
                    <Sparkles className="h-4 w-4" />
                    {layer.content}
                </button>
            );
        }

        if (layer.type === "image") {
            const url = assetUrl(layer.imageUrl);
            if (!url) {
                return (
                    <button
                        type="button"
                        className="w-full min-h-[80px] rounded-lg border-2 border-dashed border-white/40 flex flex-col items-center justify-center gap-1 text-white/70 text-xs hover:bg-white/10 transition"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect();
                            fileRef.current?.click();
                        }}
                        disabled={uploadingImage}
                        data-testid={`hero-layer-image-upload-${layer.id}`}
                    >
                        <ImagePlus className="h-5 w-5" />
                        {uploadingImage ? "Subiendo…" : "Subir imagen"}
                    </button>
                );
            }
            return (
                <img
                    src={url}
                    alt={layer.content || "Imagen"}
                    className="w-full h-auto max-h-48 object-contain rounded-lg"
                />
            );
        }

        return (
            <InlineEditable
                value={layer.content}
                onChange={(v) => onUpdate({ content: v })}
                enabled={editorMode}
                as={layer.type === "heading" ? "h2" : "p"}
                className={cn(
                    layer.type === "heading" && !layer.fontSize && "text-2xl md:text-3xl font-bold",
                    layer.type === "text" && !layer.fontSize && "text-base md:text-lg text-white/90",
                    typeClass,
                    typography,
                )}
                style={inlineStyle}
                placeholder="Texto…"
                onSelect={onSelect}
            />
        );
    };

    return (
        <div
            style={{
                gridColumn: `${display.colStart} / span ${display.colSpan}`,
                gridRow: display.row,
                transition: preview ? "none" : "grid-column 0.15s, grid-row 0.15s",
            }}
            className={cn(
                "relative self-center group",
                alignClass,
                editorMode && showGrid && "touch-none",
                editorMode && isSelected && "z-10",
                !editorMode || !showGrid ? "px-0" : "",
            )}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
            data-testid={`hero-layer-${layer.id}`}
        >
            {editorMode && showGrid && (
                <div
                    className={cn(
                        "absolute inset-0 rounded pointer-events-none border-2 transition-colors",
                        isSelected ? "border-amber-400" : "border-transparent group-hover:border-white/30",
                        preview && "border-amber-300 border-dashed",
                    )}
                />
            )}

            {editorMode && showGrid && isSelected && (
                <>
                    <div
                        className="absolute -left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing rounded bg-background/90 border p-0.5 shadow"
                        onPointerDown={(e) => bindGridDrag(e, "move")}
                        title="Arrastrar"
                        data-testid={`hero-layer-drag-${layer.id}`}
                    >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div
                        className="absolute -right-1 top-1/2 -translate-y-1/2 z-10 cursor-ew-resize rounded bg-background/90 border px-0.5 py-2 shadow"
                        onPointerDown={(e) => bindGridDrag(e, "resize")}
                        title="Redimensionar ancho"
                        data-testid={`hero-layer-resize-${layer.id}`}
                    />
                </>
            )}

            <div
                className={cn(editorMode && showGrid && "pl-4 pr-4")}
                onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("[data-inline-editable]")) return;
                    if (!isSelected && editorMode && showGrid) bindGridDrag(e, "move");
                }}
            >
                {renderContent()}
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && onUploadImage) {
                        const url = await onUploadImage(file);
                        if (url) onUpdate({ imageUrl: url });
                    }
                }}
            />
        </div>
    );
}
