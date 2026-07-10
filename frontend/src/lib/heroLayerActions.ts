/**
 * Acciones compartidas para editar capas del hero (ribbon + panel).
 */
import {
    applyHeroLayerPatch,
    createHeroLayer,
    isCoreLayer,
    normalizeLayer,
    resolveHeroLayers,
    type HeroLayer,
    type HeroLayerType,
} from "@/lib/micrositeLayers";
import type { MicrositeBlock } from "@/lib/micrositeBlocks";

export function getHeroLayersContext(
    block: MicrositeBlock,
    microsite: Record<string, unknown>,
) {
    const content = (microsite.content || {}) as Record<string, string>;
    const variant = (block.props.variant as string) || "normal";
    const align = (block.props.align as string) || "left";
    const storedLayers = ((block.props.layers as HeroLayer[]) || []).map(normalizeLayer);
    const layers = resolveHeroLayers(storedLayers, content, variant, align);
    return { content, variant, align, storedLayers, layers };
}

export function patchHeroLayer(
    ctx: ReturnType<typeof getHeroLayersContext>,
    layerId: string,
    patch: Partial<HeroLayer>,
    onUpdateContent?: (patch: Record<string, string>) => void,
): HeroLayer[] {
    const target = ctx.layers.find((l) => l.id === layerId);
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
    return applyHeroLayerPatch(ctx.storedLayers, ctx.content, ctx.variant, ctx.align, layerId, patch);
}

export function addHeroLayer(
    ctx: ReturnType<typeof getHeroLayersContext>,
    type: HeroLayerType,
): { layers: HeroLayer[]; newLayerId: string } {
    const extras = ctx.storedLayers.filter((l) => !isCoreLayer(l));
    const newLayer = createHeroLayer(type);
    const layers = resolveHeroLayers([...extras, newLayer], ctx.content, ctx.variant, ctx.align);
    return { layers, newLayerId: newLayer.id };
}

export function removeHeroLayer(
    ctx: ReturnType<typeof getHeroLayersContext>,
    layerId: string,
): HeroLayer[] {
    const extras = ctx.storedLayers.filter((l) => !isCoreLayer(l) && l.id !== layerId);
    return resolveHeroLayers(extras, ctx.content, ctx.variant, ctx.align);
}
