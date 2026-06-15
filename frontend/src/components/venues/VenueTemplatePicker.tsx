/**
 * Lista de plantillas de venue + opción de empezar en blanco.
 * Usado en Venues (diálogo crear), editor vacío y wizard de eventos.
 */
import { LayoutTemplate, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
}) {
    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Cargando plantillas…</p>;
    }

    return (
        <div className="space-y-4" data-testid="venue-template-picker">
            <p className="text-sm text-muted-foreground">
                Elegí un layout listo para usar. Después podés ajustar precios y publicar — no hace falta
                ser diseñador.
            </p>

            {templates.length > 0 ? (
                <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
                    {templates.map((tpl) => (
                        <Card
                            key={tpl.id}
                            className="border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50/70 transition-colors"
                        >
                            <CardContent className={`${compact ? "pt-3 pb-3" : "pt-4"} space-y-2`}>
                                <div className="flex items-start gap-3">
                                    <div className="h-9 w-9 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center shrink-0">
                                        <LayoutTemplate className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="font-medium text-sm leading-tight">{tpl.name}</h4>
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
                                    disabled={disabled || usingId === tpl.id}
                                    onClick={() => onUseTemplate(tpl)}
                                    data-testid={`pick-template-${tpl.slug}`}
                                >
                                    {usingId === tpl.id ? "Creando…" : "Usar esta plantilla"}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4 text-center">
                    No hay plantillas disponibles todavía. Podés empezar en blanco o pedirle al admin que
                    cargue layouts base.
                </p>
            )}

            {showBlankOption && onStartBlank && (
                <div className="pt-2 border-t">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled={disabled}
                        onClick={onStartBlank}
                        data-testid="venue-start-blank"
                    >
                        <PenLine className="h-4 w-4 mr-1.5" />
                        Empezar en blanco (modo avanzado)
                    </Button>
                </div>
            )}
        </div>
    );
}
