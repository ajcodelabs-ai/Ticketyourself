/**
 * Overlay sobre el canvas cuando el venue no tiene elementos todavía.
 */
import { useEffect, useState } from "react";
import { LayoutTemplate, X } from "lucide-react";
import { toast } from "sonner";
import { venuesApi } from "@/lib/venues";
import { Button } from "@/components/ui/button";
import VenueTemplatePicker from "@/components/venues/VenueTemplatePicker";

export default function VenueEmptyCanvasOverlay({
    onApplied,
    onDismiss,
    disabled = false,
}) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [usingId, setUsingId] = useState(null);

    useEffect(() => {
        let mounted = true;
        venuesApi
            .listTemplates()
            .then((d) => mounted && setTemplates(d.items || []))
            .catch(() => mounted && setTemplates([]))
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, []);

    const applyTemplate = async (tpl) => {
        setUsingId(tpl.id);
        try {
            const elements = tpl.elements || [];
            const localities = tpl.localities || [];
            await onApplied({
                elements: JSON.parse(JSON.stringify(elements)),
                localities: JSON.parse(JSON.stringify(localities)),
                capacity_calculated: tpl.capacity_calculated,
            });
            toast.success(`Layout "${tpl.name}" aplicado. Revisá precios y publicá cuando esté listo.`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo aplicar la plantilla");
        } finally {
            setUsingId(null);
        }
    };

    return (
        <div
            className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-slate-50/95 backdrop-blur-[1px] rounded-lg border border-dashed border-indigo-200"
            data-testid="venue-empty-canvas-overlay"
        >
            <div className="relative max-w-lg w-full bg-white rounded-xl shadow-sm border p-5 space-y-3 max-h-full overflow-y-auto">
                {onDismiss && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 h-7 w-7 p-0 text-muted-foreground"
                        onClick={onDismiss}
                        data-testid="venue-empty-canvas-dismiss"
                        aria-label="Cerrar y dibujar mi propio venue"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
                <div className="flex items-center gap-2">
                    <LayoutTemplate className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-semibold">Empieza con una plantilla (opcional)</h3>
                </div>
                <VenueTemplatePicker
                    templates={templates}
                    loading={loading}
                    usingId={usingId}
                    disabled={disabled || !!usingId}
                    compact
                    onUseTemplate={applyTemplate}
                    showBlankOption={!!onDismiss}
                    onStartBlank={onDismiss}
                />
            </div>
        </div>
    );
}
