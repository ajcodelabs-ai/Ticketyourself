/**
 * Lista de plantillas de venue + opción de empezar en blanco.
 * Usado en Venues (diálogo crear), editor vacío y wizard de eventos.
 */
import { useState } from "react";
import { LayoutTemplate, PenLine, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { VENUE_TYPES } from "@/lib/venues";
import VenueTemplateThumb from "@/components/venues/VenueTemplateThumb";

function typeLabel(value) {
    return VENUE_TYPES.find((t) => t.value === value)?.label || value;
}

export default function VenueTemplatePicker({
    templates = [],
    loading = false,
    usingId = null,
    disabled = false,
    disabledReason = null,
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
        canvas?: Record<string, unknown>;
        elements?: unknown[];
        localities?: unknown[];
    }>;
    loading?: boolean;
    usingId?: string | null;
    disabled?: boolean;
    disabledReason?: string | null;
    compact?: boolean;
    onUseTemplate: (tpl: Record<string, unknown>) => void;
    onStartBlank?: () => void;
    showBlankOption?: boolean;
}) {
    const [previewTemplate, setPreviewTemplate] = useState<Record<string, unknown> | null>(null);

    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Cargando plantillas…</p>;
    }

    return (
        <>
        <div className="space-y-4" data-testid="venue-template-picker">
            <p className="text-xs text-muted-foreground">
                Elegí un layout listo o empezá en blanco y diseñalo en el editor.
            </p>

            {disabled && disabledReason && (
                <p
                    className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2"
                    data-testid="venue-template-disabled-reason"
                >
                    {disabledReason}
                </p>
            )}

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
                                <VenueTemplateThumb
                                    template={tpl}
                                    height={compact ? 110 : 140}
                                />
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
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="flex-none"
                                        onClick={() => setPreviewTemplate(tpl)}
                                        data-testid={`preview-template-${tpl.slug}`}
                                        title="Previsualizar plantilla"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="flex-1"
                                        disabled={disabled || busy}
                                        onClick={() => onUseTemplate(tpl)}
                                        data-testid={`pick-template-${tpl.slug}`}
                                    >
                                        {busy ? "Creando…" : "Usar plantilla"}
                                    </Button>
                                </div>
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

        {/* Preview dialog */}
        <Dialog open={!!previewTemplate} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
            <DialogContent className="max-w-3xl w-[95vw]" data-testid="venue-template-preview-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
                        {(previewTemplate as any)?.name || "Plantilla"}
                        <Badge variant="secondary" className="text-[10px] font-normal">Plantilla</Badge>
                    </DialogTitle>
                </DialogHeader>
                {previewTemplate && (
                    <div className="space-y-4">
                        <VenueTemplateThumb template={previewTemplate as any} height={380} />
                        <div className="text-sm text-muted-foreground space-y-1">
                            <p>
                                <span className="font-medium text-foreground">Tipo:</span>{" "}
                                {typeLabel((previewTemplate as any).type)}
                            </p>
                            <p>
                                <span className="font-medium text-foreground">Capacidad:</span>{" "}
                                {(previewTemplate as any).capacity_calculated || 0} asientos
                            </p>
                            {(previewTemplate as any).description && (
                                <p>
                                    <span className="font-medium text-foreground">Descripción:</span>{" "}
                                    {(previewTemplate as any).description}
                                </p>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setPreviewTemplate(null)}>
                                Cerrar
                            </Button>
                            <Button
                                disabled={disabled}
                                onClick={() => {
                                    onUseTemplate(previewTemplate);
                                    setPreviewTemplate(null);
                                }}
                                data-testid="venue-template-preview-use"
                            >
                                Usar esta plantilla
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
        </>
    );
}
