/**
 * Panel para gestionar capas del Hero (grid 12 cols) con estilos y tipos extra.
 */
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    GRID_COLS,
    GRID_ROWS,
    LAYER_TYPE_LABELS,
    CORE_LAYER_LABELS,
    applyHeroLayerPatch,
    createHeroLayer,
    isCoreLayer,
    normalizeLayer,
    resolveHeroLayers,
    type HeroLayer,
    type HeroLayerFontSize,
    type HeroLayerFontWeight,
    type HeroLayerType,
} from "@/lib/micrositeLayers";
import type { MicrositeBlock } from "@/lib/micrositeBlocks";

function SortableLayerRow({
    layer,
    selected,
    onSelect,
    onUpdate,
    onRemove,
    onUploadImage,
    uploadingImage,
    canRemove = true,
}: {
    layer: HeroLayer;
    selected: boolean;
    onSelect: () => void;
    onUpdate: (patch: Partial<HeroLayer>) => void;
    onRemove: () => void;
    onUploadImage?: (file: File) => Promise<string | null>;
    uploadingImage?: boolean;
    canRemove?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
        id: layer.id,
    });
    const style = { transform: CSS.Transform.toString(transform), transition };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-lg border p-3 space-y-2 text-sm ${
                selected ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid={`hero-layer-row-${layer.id}`}
        >
            <div className="flex items-center gap-2">
                <button type="button" className="cursor-grab p-1" {...attributes} {...listeners}>
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                </button>
                <button type="button" className="flex-1 text-left font-medium truncate" onClick={onSelect}>
                    {(layer.role ? CORE_LAYER_LABELS[layer.role] : LAYER_TYPE_LABELS[layer.type])} —{" "}
                    {layer.content.slice(0, 24) || (layer.imageUrl ? "img" : "…")}
                </button>
                {canRemove && (
                    <button type="button" onClick={onRemove} className="text-destructive p-1">
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {layer.type !== "image" && (
                <Input
                    value={layer.content}
                    onChange={(e) => onUpdate({ content: e.target.value })}
                    maxLength={120}
                    placeholder="Contenido"
                />
            )}

            {(layer.type === "button" || layer.role === "cta") && (
                <div className="space-y-1">
                    <Label className="text-[10px]">Enlace del botón</Label>
                    <Select value={layer.href || "#events"} onValueChange={(v) => onUpdate({ href: v })}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {HERO_CTA_HREF_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {layer.type === "image" && (
                <div className="flex items-center gap-2">
                    {layer.imageUrl ? (
                        <img
                            src={assetUrl(layer.imageUrl) || ""}
                            alt=""
                            className="h-10 w-14 object-cover rounded border"
                        />
                    ) : (
                        <div className="h-10 w-14 rounded border bg-muted grid place-items-center text-[10px] text-muted-foreground">
                            sin img
                        </div>
                    )}
                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f && onUploadImage) {
                                    const url = await onUploadImage(f);
                                    if (url) onUpdate({ imageUrl: url });
                                }
                            }}
                        />
                        <Button asChild variant="outline" size="sm" disabled={uploadingImage}>
                            <span>
                                {uploadingImage ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Upload className="h-3 w-3" />
                                )}
                            </span>
                        </Button>
                    </label>
                </div>
            )}

            {layer.type !== "image" && selected && (
                <div className="grid grid-cols-3 gap-2 pt-1 border-t">
                    <div>
                        <Label className="text-[10px]">Color</Label>
                        <input
                            type="color"
                            value={layer.color || "#ffffff"}
                            onChange={(e) => onUpdate({ color: e.target.value })}
                            className="h-8 w-full cursor-pointer rounded border"
                        />
                    </div>
                    <div>
                        <Label className="text-[10px]">Tamaño</Label>
                        <Select
                            value={layer.fontSize || "base"}
                            onValueChange={(v) => onUpdate({ fontSize: v as HeroLayerFontSize })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(["sm", "base", "lg", "xl", "2xl", "3xl"] as HeroLayerFontSize[]).map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {s}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-[10px]">Peso</Label>
                        <Select
                            value={layer.fontWeight || "normal"}
                            onValueChange={(v) => onUpdate({ fontWeight: v as HeroLayerFontWeight })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(["normal", "medium", "semibold", "bold"] as HeroLayerFontWeight[]).map((w) => (
                                    <SelectItem key={w} value={w}>
                                        {w}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-4 gap-2">
                <div>
                    <Label className="text-[10px]">Col</Label>
                    <Select
                        value={String(layer.colStart)}
                        onValueChange={(v) => onUpdate({ colStart: Number(v) })}
                    >
                        <SelectTrigger className="h-8 text-xs">
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
                </div>
                <div>
                    <Label className="text-[10px]">Ancho</Label>
                    <Select
                        value={String(layer.colSpan)}
                        onValueChange={(v) => onUpdate({ colSpan: Number(v) })}
                    >
                        <SelectTrigger className="h-8 text-xs">
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
                </div>
                <div>
                    <Label className="text-[10px]">Fila</Label>
                    <Select
                        value={String(layer.row)}
                        onValueChange={(v) => onUpdate({ row: Number(v) })}
                    >
                        <SelectTrigger className="h-8 text-xs">
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
                <div>
                    <Label className="text-[10px]">Alinear</Label>
                    <Select
                        value={layer.align}
                        onValueChange={(v) => onUpdate({ align: v as HeroLayer["align"] })}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="left">Izq</SelectItem>
                            <SelectItem value="center">Centro</SelectItem>
                            <SelectItem value="right">Der</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}

export default function HeroLayersEditor({
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
    const content = (microsite.content || {}) as Record<string, string>;
    const variant = (block.props.variant as string) || "normal";
    const align = (block.props.align as string) || "left";
    const storedLayers = ((block.props.layers as HeroLayer[]) || []).map(normalizeLayer);
    const layers = resolveHeroLayers(storedLayers, content, variant, align);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const persistPatch = (layerId: string, patch: Partial<HeroLayer>) => {
        const target = layers.find((l) => l.id === layerId);
        if (target?.role === "title" && patch.content !== undefined) {
            onUpdateContent?.({ hero_title: patch.content });
        }
        if (target?.role === "subtitle" && patch.content !== undefined) {
            onUpdateContent?.({ hero_subtitle: patch.content });
        }
        if (target?.role === "cta") {
            if (patch.content !== undefined) onUpdateContent?.({ hero_cta_text: patch.content });
            if (patch.href !== undefined) onUpdateContent?.({ hero_cta_href: patch.href });
        }
        onUpdateLayers(applyHeroLayerPatch(storedLayers, content, variant, align, layerId, patch));
    };

    const addLayer = (type: HeroLayerType) => {
        const extras = storedLayers.filter((l) => !isCoreLayer(l));
        const newLayer = createHeroLayer(type);
        onUpdateLayers(resolveHeroLayers([...extras, newLayer], content, variant, align));
        onSelectLayer(newLayer.id);
    };

    const layerTypes: HeroLayerType[] = ["heading", "text", "badge", "button", "image"];

    return (
        <div className="space-y-3 pt-3 border-t" data-testid="hero-layers-editor">
            <div>
                <Label className="text-sm font-semibold">Capas del hero</Label>
                <p className="text-xs text-muted-foreground">
                    Título, subtítulo y botón también se mueven en la cuadrícula. Las capas fijas no se pueden eliminar.
                </p>
            </div>
            <div className="flex flex-wrap gap-1">
                {layerTypes.map((t) => (
                    <Button
                        key={t}
                        variant="outline"
                        size="sm"
                        onClick={() => addLayer(t)}
                        data-testid={`add-hero-layer-${t}`}
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {LAYER_TYPE_LABELS[t]}
                    </Button>
                ))}
            </div>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active, over }) => {
                    if (!over || active.id === over.id) return;
                    const oldIndex = layers.findIndex((l) => l.id === active.id);
                    const newIndex = layers.findIndex((l) => l.id === over.id);
                    if (oldIndex >= 0 && newIndex >= 0) {
                        onUpdateLayers(arrayMove(layers, oldIndex, newIndex));
                    }
                }}
            >
                <SortableContext items={layers.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {layers.map((layer) => (
                            <SortableLayerRow
                                key={layer.id}
                                layer={layer}
                                selected={selectedLayerId === layer.id}
                                onSelect={() => onSelectLayer(layer.id)}
                                onUpdate={(patch) => persistPatch(layer.id, patch)}
                                onRemove={() => {
                                    const extras = storedLayers.filter(
                                        (l) => !isCoreLayer(l) && l.id !== layer.id,
                                    );
                                    onUpdateLayers(resolveHeroLayers(extras, content, variant, align));
                                    if (selectedLayerId === layer.id) onSelectLayer(null);
                                }}
                                canRemove={!layer.role}
                                onUploadImage={onUploadGallery}
                                uploadingImage={uploadingGallery}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}
