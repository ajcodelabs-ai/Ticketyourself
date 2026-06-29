/**
 * Overlay sobre el canvas cuando el venue no tiene elementos todavía.
 */
import { useEffect, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { venuesApi } from "@/lib/venues";
import VenueTemplatePicker from "@/components/venues/VenueTemplatePicker";

export default function VenueEmptyCanvasOverlay({
    onApplied,
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
            <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border p-5 space-y-3 max-h-full overflow-y-auto">
                <div className="flex items-center gap-2">
                    <LayoutTemplate className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-semibold">Empezá con una plantilla</h3>
                </div>
                <VenueTemplatePicker
                    templates={templates}
                    loading={loading}
                    usingId={usingId}
                    disabled={disabled || !!usingId}
                    compact
                    onUseTemplate={applyTemplate}
                    showBlankOption={false}
                />
                <p className="text-xs text-muted-foreground text-center pt-1">
                    También podés usar la barra de herramientas de arriba para dibujar desde cero.
                </p>
            </div>
        </div>
    );
}
