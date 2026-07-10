/**
 * Barra flotante de estilos para capas del hero (color, tamaño, peso).
 */
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { HeroLayer, HeroLayerFontSize, HeroLayerFontWeight } from "@/lib/micrositeLayers";

const FONT_SIZES: { value: HeroLayerFontSize; label: string }[] = [
    { value: "sm", label: "Pequeño" },
    { value: "base", label: "Normal" },
    { value: "lg", label: "Grande" },
    { value: "xl", label: "XL" },
    { value: "2xl", label: "2XL" },
    { value: "3xl", label: "3XL" },
];

const FONT_WEIGHTS: { value: HeroLayerFontWeight; label: string }[] = [
    { value: "normal", label: "Normal" },
    { value: "medium", label: "Medio" },
    { value: "semibold", label: "Semi" },
    { value: "bold", label: "Negrita" },
];

export default function LayerStyleToolbar({
    layer,
    onUpdate,
    showTypography = true,
}: {
    layer: HeroLayer;
    onUpdate: (patch: Partial<HeroLayer>) => void;
    showTypography?: boolean;
}) {
    return (
        <div
            className="absolute -top-9 left-0 z-20 flex items-center gap-1.5 rounded-lg border bg-background/95 backdrop-blur px-2 py-1 shadow-md text-xs"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            data-testid={`layer-style-toolbar-${layer.id}`}
        >
            <Label className="sr-only">Color</Label>
            <input
                type="color"
                value={layer.color || "#ffffff"}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Color del texto"
                data-testid={`layer-color-${layer.id}`}
            />
            {showTypography && (
                <>
                    <Select
                        value={layer.fontSize || "base"}
                        onValueChange={(v) => onUpdate({ fontSize: v as HeroLayerFontSize })}
                    >
                        <SelectTrigger className="h-6 w-[72px] text-[10px] px-1.5">
                            <SelectValue />
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
                        value={layer.fontWeight || "normal"}
                        onValueChange={(v) => onUpdate({ fontWeight: v as HeroLayerFontWeight })}
                    >
                        <SelectTrigger className="h-6 w-[68px] text-[10px] px-1.5">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FONT_WEIGHTS.map((w) => (
                                <SelectItem key={w.value} value={w.value}>
                                    {w.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </>
            )}
        </div>
    );
}
