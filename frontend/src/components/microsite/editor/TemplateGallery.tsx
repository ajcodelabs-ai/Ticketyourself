/**
 * Visual picker of ready-made microsite templates.
 */
import { Check, LayoutTemplate } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { MICROSITE_TEMPLATES, type MicrositeTemplatePreset } from "@/lib/micrositeTemplates";

function TemplateThumb({ preset }: { preset: MicrositeTemplatePreset }) {
    const { branding } = preset;
    return (
        <div
            className="h-[132px] overflow-hidden rounded-t-[inherit] relative"
            style={{ background: branding.secondary_color, fontFamily: branding.font_family }}
            aria-hidden
        >
            <div
                className="absolute inset-x-0 top-0 h-[58%]"
                style={{
                    background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.primary_color}bb)`,
                }}
            >
                <div className="px-3 pt-4 space-y-1.5">
                    <div className="h-2 w-16 rounded-full bg-white/85" />
                    <div className="h-1.5 w-24 rounded-full bg-white/50" />
                </div>
            </div>
            <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className="flex-1 h-9 bg-white/90 border border-black/5"
                        style={{
                            borderRadius:
                                branding.radius === "pill"
                                    ? 999
                                    : branding.radius === "sharp"
                                      ? 2
                                      : 8,
                            boxShadow: branding.shadow_style === "flat" ? "none" : "0 4px 10px rgba(0,0,0,.12)",
                        }}
                    />
                ))}
            </div>
        </div>
    );
}

export default function TemplateGallery({
    open,
    onOpenChange,
    activeCode,
    onApply,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activeCode?: string;
    onApply: (code: string) => void;
}) {
    const groups = [...new Set(MICROSITE_TEMPLATES.map((t) => t.category))];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-[min(960px,94vw)] max-h-[90vh] overflow-y-auto"
                data-testid="template-gallery"
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <LayoutTemplate className="h-5 w-5 text-primary" />
                        Elegí una plantilla
                    </DialogTitle>
                    <DialogDescription>
                        Ya viene armada: secciones, colores y textos. Después solo subís logo y
                        ajustás el nombre.
                    </DialogDescription>
                </DialogHeader>

                {groups.map((cat) => (
                    <div key={cat} className="space-y-2 mt-2">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                            {cat}
                        </p>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {MICROSITE_TEMPLATES.filter((t) => t.category === cat).map((preset) => {
                                const active = activeCode === preset.code;
                                return (
                                    <button
                                        key={preset.code}
                                        type="button"
                                        onClick={() => {
                                            onApply(preset.code);
                                            onOpenChange(false);
                                        }}
                                        className={`text-left rounded-xl border overflow-hidden transition bg-card ${
                                            active
                                                ? "border-primary ring-2 ring-primary/30"
                                                : "border-border hover:border-primary/50 hover:-translate-y-0.5"
                                        }`}
                                        data-testid={`template-card-${preset.code}`}
                                    >
                                        <TemplateThumb preset={preset} />
                                        <div className="p-3 space-y-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-sm">{preset.name}</span>
                                                {active && (
                                                    <Check className="h-4 w-4 text-primary shrink-0" />
                                                )}
                                            </div>
                                            <p className="text-[11px] text-muted-foreground leading-snug">
                                                {preset.blurb}
                                            </p>
                                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                                                {preset.audience}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </DialogContent>
        </Dialog>
    );
}
