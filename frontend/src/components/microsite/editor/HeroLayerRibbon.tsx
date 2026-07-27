/**
 * Ribbon horizontal estilo PowerPoint para editar capas del hero.
 */
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Heading1,
    ImagePlus,
    Loader2,
    MousePointerClick,
    Tag,
    Trash2,
    Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { assetUrl } from "@/lib/microsite";
import { HERO_CTA_HREF_OPTIONS } from "@/lib/micrositeBlocks";
import {
    addHeroLayer,
    getHeroLayersContext,
    patchHeroLayer,
    removeHeroLayer,
} from "@/lib/heroLayerActions";
import {
    CORE_LAYER_LABELS,
    GRID_COLS,
    GRID_ROWS,
    LAYER_TYPE_LABELS,
    type HeroLayer,
    type HeroLayerFontSize,
    type HeroLayerFontWeight,
    type HeroLayerType,
} from "@/lib/micrositeLayers";
import type { MicrositeBlock } from "@/lib/micrositeBlocks";
import { cn } from "@/lib/utils";

const INSERT_ITEMS: { type: HeroLayerType; icon: typeof Type; label: string }[] = [
    { type: "heading", icon: Heading1, label: "Título" },
    { type: "text", icon: Type, label: "Párrafo" },
    { type: "badge", icon: Tag, label: "Badge" },
    { type: "button", icon: MousePointerClick, label: "Botón" },
    { type: "image", icon: ImagePlus, label: "Imagen" },
];

const FONT_SIZES: { value: HeroLayerFontSize; label: string }[] = [
    { value: "sm", label: "Pequeño" },
    { value: "base", label: "Normal" },
    { value: "lg", label: "Grande" },
    { value: "xl", label: "XL" },
    { value: "2xl", label: "2XL" },
    { value: "3xl", label: "3XL" },
];

function layerLabel(layer: HeroLayer): string {
    if (layer.role) return CORE_LAYER_LABELS[layer.role];
    return LAYER_TYPE_LABELS[layer.type];
}

function RibbonDivider() {
    return <div className="w-px h-8 bg-border shrink-0 mx-1" aria-hidden />;
}

export default function HeroLayerRibbon({
    block,
    microsite,
    selectedLayerId,
    onSelectLayer,
    onUpdateLayers,
    onUpdateContent,
    onUploadGallery,
    uploadingGallery,
}: {
    block: MicrositeBlock;
    microsite: Record<string, unknown>;
    selectedLayerId: string | null;
    onSelectLayer: (id: string | null) => void;
    onUpdateLayers: (layers: HeroLayer[]) => void;
    onUpdateContent?: (patch: Record<string, string>) => void;
    onUploadGallery?: (file: File) => Promise<string | null>;
    uploadingGallery?: boolean;
}) {
    const ctx = getHeroLayersContext(block, microsite);
    const selected = ctx.layers.find((l) => l.id === selectedLayerId) || null;

    const updateSelected = (patch: Partial<HeroLayer>) => {
        if (!selected) return;
        onUpdateLayers(patchHeroLayer(ctx, selected.id, patch, onUpdateContent));
    };

    const handleAdd = (type: HeroLayerType) => {
        const { layers, newLayerId } = addHeroLayer(ctx, type);
        onUpdateLayers(layers);
        onSelectLayer(newLayerId);
    };

    const handleRemove = () => {
        if (!selected || selected.role) return;
        onUpdateLayers(removeHeroLayer(ctx, selected.id));
        onSelectLayer(null);
    };

    return (
        <div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            data-testid="hero-layer-ribbon"
        >
            {/* Fila 1: selector de capas + insertar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
                    Hero
                </span>
                <RibbonDivider />
                <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                    {ctx.layers.map((layer) => (
                        <button
                            key={layer.id}
                            type="button"
                            onClick={() => onSelectLayer(layer.id)}
                            className={cn(
                                "text-xs px-2.5 py-1 rounded-md border transition truncate max-w-[140px]",
                                selectedLayerId === layer.id
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background hover:bg-secondary border-border",
                            )}
                            data-testid={`ribbon-layer-tab-${layer.id}`}
                            title={layer.content || layerLabel(layer)}
                        >
                            {layerLabel(layer)}
                        </button>
                    ))}
                </div>
                <RibbonDivider />
                <div className="flex items-center gap-1 flex-wrap shrink-0">
                    <span className="text-[10px] text-muted-foreground mr-1 hidden sm:inline">Insertar</span>
                    {INSERT_ITEMS.map(({ type, icon: Icon, label }) => (
                        <Button
                            key={type}
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleAdd(type)}
                            data-testid={`ribbon-add-${type}`}
                        >
                            <Icon className="h-3 w-3 mr-1" />
                            {label}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Fila 2: propiedades de la capa seleccionada (ribbon contextual) */}
            {selected ? (
                <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground shrink-0">
                        {layerLabel(selected)}
                    </span>
                    <RibbonDivider />

                    {selected.type !== "image" && (
                        <>
                            <Input
                                value={selected.content}
                                onChange={(e) => updateSelected({ content: e.target.value })}
                                maxLength={120}
                                placeholder="Texto"
                                className="h-8 w-44 sm:w-56 text-xs"
                                data-testid="ribbon-layer-content"
                            />
                            <RibbonDivider />
                        </>
                    )}

                    {(selected.type === "button" || selected.role === "cta") && (
                        <>
                            <Select
                                value={selected.href || "#events"}
                                onValueChange={(v) => updateSelected({ href: v })}
                            >
                                <SelectTrigger className="h-8 w-36 text-xs" data-testid="ribbon-layer-href">
                                    <SelectValue placeholder="Enlace" />
                                </SelectTrigger>
                                <SelectContent>
                                    {HERO_CTA_HREF_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <RibbonDivider />
                        </>
                    )}

                    {selected.type === "image" && (
                        <>
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const f = e.target.files?.[0];
                                        e.target.value = "";
                                        if (f && onUploadGallery) {
                                            const url = await onUploadGallery(f);
                                            if (url) updateSelected({ imageUrl: url });
                                        }
                                    }}
                                />
                                <Button asChild variant="outline" size="sm" className="h-8" disabled={uploadingGallery}>
                                    <span className="text-xs">
                                        {uploadingGallery ? (
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                        ) : (
                                            <ImagePlus className="h-3 w-3 mr-1" />
                                        )}
                                        Subir imagen
                                    </span>
                                </Button>
                            </label>
                            {selected.imageUrl && (
                                <img
                                    src={assetUrl(selected.imageUrl) || ""}
                                    alt=""
                                    className="h-8 w-12 object-cover rounded border"
                                />
                            )}
                            <RibbonDivider />
                        </>
                    )}

                    {/* Layout */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Col</span>
                        <Select
                            value={String(selected.colStart)}
                            onValueChange={(v) => updateSelected({ colStart: Number(v) })}
                        >
                            <SelectTrigger className="h-8 w-14 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: GRID_COLS }, (_, i) => i + 1).map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-[10px] text-muted-foreground">Ancho</span>
                        <Select
                            value={String(selected.colSpan)}
                            onValueChange={(v) => updateSelected({ colSpan: Number(v) })}
                        >
                            <SelectTrigger className="h-8 w-14 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: GRID_COLS }, (_, i) => i + 1).map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-[10px] text-muted-foreground">Fila</span>
                        <Select
                            value={String(selected.row)}
                            onValueChange={(v) => updateSelected({ row: Number(v) })}
                        >
                            <SelectTrigger className="h-8 w-14 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: GRID_ROWS }, (_, i) => i + 1).map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <RibbonDivider />

                    {/* Alineación */}
                    <div className="flex items-center gap-0.5">
                        {(
                            [
                                { value: "left", icon: AlignLeft },
                                { value: "center", icon: AlignCenter },
                                { value: "right", icon: AlignRight },
                            ] as const
                        ).map(({ value, icon: Icon }) => (
                            <Button
                                key={value}
                                variant={selected.align === value ? "default" : "outline"}
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => updateSelected({ align: value })}
                                title={value}
                            >
                                <Icon className="h-3.5 w-3.5" />
                            </Button>
                        ))}
                    </div>

                    {selected.type !== "image" && (
                        <>
                            <RibbonDivider />
                            <input
                                type="color"
                                value={selected.color || "#ffffff"}
                                onChange={(e) => updateSelected({ color: e.target.value })}
                                className="h-8 w-8 cursor-pointer rounded border shrink-0"
                                title="Color"
                            />
                            <Select
                                value={selected.fontSize || "base"}
                                onValueChange={(v) => updateSelected({ fontSize: v as HeroLayerFontSize })}
                            >
                                <SelectTrigger className="h-8 w-24 text-xs">
                                    <SelectValue placeholder="Tamaño" />
                                </SelectTrigger>
                                <SelectContent>
                                    {FONT_SIZES.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={selected.fontWeight || "normal"}
                                onValueChange={(v) => updateSelected({ fontWeight: v as HeroLayerFontWeight })}
                            >
                                <SelectTrigger className="h-8 w-24 text-xs">
                                    <SelectValue placeholder="Peso" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="normal">Normal</SelectItem>
                                    <SelectItem value="medium">Medio</SelectItem>
                                    <SelectItem value="semibold">Semi</SelectItem>
                                    <SelectItem value="bold">Negrita</SelectItem>
                                </SelectContent>
                            </Select>
                        </>
                    )}

                    {!selected.role && (
                        <>
                            <RibbonDivider />
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-destructive hover:text-destructive"
                                onClick={handleRemove}
                                data-testid="ribbon-layer-delete"
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Eliminar
                            </Button>
                        </>
                    )}
                </div>
            ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                    Seleccioná una capa en el preview o en las pestañas de arriba para editarla.
                </div>
            )}
        </div>
    );
}
