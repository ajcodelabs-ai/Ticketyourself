/**
 * Read-only mini canvas for platform venue templates in pickers/cards.
 * Reuses EditorCanvas so the preview matches the real editor geometry.
 */
import { useMemo } from "react";
import EditorCanvas from "@/components/venues/EditorCanvas";

const FALLBACK_CANVAS = {
    width: 1200,
    height: 800,
    background_color: "#f8fafc",
};

function localitiesById(list) {
    const map = {};
    for (const loc of list || []) {
        if (loc?.id) map[loc.id] = loc;
    }
    return map;
}

export default function VenueTemplateThumb({
    template,
    height = 140,
    className = "",
}) {
    const elements = template?.elements || [];
    const canvas = template?.canvas || FALLBACK_CANVAS;
    const locs = useMemo(
        () => localitiesById(template?.localities),
        [template?.localities],
    );
    const hasLayout = elements.length > 0;

    if (!hasLayout) {
        return (
            <div
                className={`rounded-lg border border-dashed bg-muted/40 grid place-items-center text-xs text-muted-foreground ${className}`}
                style={{ height }}
                data-testid="venue-template-thumb-empty"
            >
                Sin layout
            </div>
        );
    }

    return (
        <div
            className={`rounded-lg border overflow-hidden bg-card pointer-events-none ${className}`}
            data-testid={`venue-template-thumb-${template.slug || template.id}`}
        >
            <EditorCanvas
                canvas={canvas}
                elements={elements}
                localitiesById={locs}
                selection={[]}
                onSelect={() => {}}
                onUpdate={() => {}}
                onTransform={() => {}}
                onContextMenu={() => {}}
                onCanvasClick={() => {}}
                tool="select"
                readOnly
                height={height}
                autoFitKey={template.id}
            />
        </div>
    );
}
