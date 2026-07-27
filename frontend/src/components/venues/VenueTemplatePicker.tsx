/**
 * Lista de plantillas de venue + opción de empezar en blanco.
 * Usado en Venues (diálogo crear), editor vacío y wizard de eventos.
 */
import { LayoutTemplate, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VENUE_TYPES } from "@/lib/venues";

function typeLabel(value) {
    return VENUE_TYPES.find((t) => t.value === value)?.label || value;
}

export default function VenueTemplatePicker({
    templates = [],
    loading = false,
    usingId = null,
    disabled = false,
    compact = false,
    onUseTemplate,
    onStartBlank,
    showBlankOption = true,
}: {
    templates?: Array<{
        id: string;
        slug?: string;
        name: string;
        type?: string;
        capacity_calculated?: number;
        description?: string;
    }>;
    loading?: boolean;
    usingId?: string | null;
    disabled?: boolean;
    compact?: boolean;
    onUseTemplate: (tpl: Record<string, unknown>) => void;
    onStartBlank?: () => void;
    showBlankOption?: boolean;
}) {
    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Cargando plantillas…</p>;
    }

    return (
        <div className="space-y-4" data-testid="venue-template-picker">
            <p className="text-xs text-muted-foreground">
                Elegí un layout listo o empezá en blanco y diseñalo en el editor.
            </p>

            {templates.length > 0 || (showBlankOption && onStartBlank) ? (
                <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
                    {showBlankOption && onStartBlank && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={onStartBlank}
                            data-testid="venue-start-blank"
                            className={`rounded-xl border border-dashed bg-card p-4 text-left transition w-full hover:border-foreground/20 ${
                                disabled ? "opacity-60 cursor-not-allowed" : ""
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className="h-9 w-9 rounded-lg bg-secondary text-muted-foreground grid place-items-center shrink-0">
                                    <PenLine className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm">Empezar en blanco</div>
                                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                        Canvas vacío para diseñar tu propio venue.
                                    </p>
                                </div>
                            </div>
                        </button>
                    )}
                    {templates.map((tpl) => {
                        const busy = usingId === tpl.id;
                        return (
                            <div
                                key={tpl.id}
                                className="rounded-xl border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-9 w-9 rounded-lg bg-secondary text-muted-foreground grid place-items-center shrink-0">
                                        <LayoutTemplate className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-sm leading-tight flex items-center gap-2">
                                            <span className="truncate">{tpl.name}</span>
                                            <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
                                                Plantilla
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {typeLabel(tpl.type)} · {tpl.capacity_calculated || 0} asientos
                                        </p>
                                        {!compact && tpl.description && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                {tpl.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    className="w-full"
                                    disabled={disabled || busy}
                                    onClick={() => onUseTemplate(tpl)}
                                    data-testid={`pick-template-${tpl.slug}`}
                                >
                                    {busy ? "Creando…" : "Usar plantilla"}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground rounded-xl border border-dashed p-4 text-center">
                    No hay plantillas disponibles todavía. Pedile al admin que cargue layouts base.
                </p>
            )}
        </div>
    );
}
