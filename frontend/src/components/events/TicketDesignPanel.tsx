/**
 * TicketDesignPanel — template-first ticket designer.
 *
 * Organizers pick a curated layout, optionally set color / logo / fondo,
 * and preview the real PDF. Free-form element editing was removed to keep
 * the wizard simple; the stored JSON shape is unchanged for pdf_service.
 */
import { useEffect, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group } from "react-konva";
import { toast } from "sonner";
import {
    Upload, Loader2, Eye, ExternalLink, Check, RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import api from "@/lib/api";
import {
    TICKET_TEMPLATES,
    applyTicketTemplate,
    detectTemplateId,
    emptyDesign,
    type TicketDesign,
} from "@/lib/ticketDesignTemplates";

const FORMAT_RATIOS = { digital: 800 / 360, a4: 595.27 / 841.89, pvc: 85.6 / 54 };
const FORMAT_LABELS = {
    digital: "Digital (email)",
    a4: "Imprimible (A4)",
    pvc: "Gafete / PVC",
};
const DISPLAY_W = 520;

const BG_PALETTE = [
    "#ffffff", "#f8fafc", "#0f172a", "#0f766e",
    "#134e4a", "#1e3a5f", "#fef3c7", "#ecfdf5",
];

function backendAbsoluteUrl(relativeUrl) {
    if (!relativeUrl) return null;
    const base = import.meta.env.VITE_BACKEND_URL || "";
    return `${base}${relativeUrl}`;
}

function useHtmlImage(url) {
    const [img, setImg] = useState(null);
    useEffect(() => {
        if (!url) {
            setImg(null);
            return undefined;
        }
        const el = new window.Image();
        el.crossOrigin = "anonymous";
        el.onload = () => setImg(el);
        el.src = url;
        return () => setImg(null);
    }, [url]);
    return img;
}

function MiniPreview({ template }) {
    return (
        <div
            className="h-20 w-full rounded-md border overflow-hidden relative"
            style={{ backgroundColor: template.previewBg }}
        >
            <div
                className="absolute left-2 top-2 h-5 w-5 rounded-sm opacity-80"
                style={{ backgroundColor: template.previewFg, opacity: 0.25 }}
            />
            <div
                className="absolute left-9 top-2.5 h-2 w-16 rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.55 }}
            />
            <div
                className="absolute left-9 top-6 h-1.5 w-12 rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.3 }}
            />
            <div
                className="absolute right-2 bottom-2 h-10 w-10 rounded-sm border border-dashed"
                style={{ borderColor: template.previewFg, opacity: 0.45 }}
            />
        </div>
    );
}

export default function TicketDesignPanel({ eventId, design, onChange, slot = "main" }) {
    const safeDesign: TicketDesign = design || emptyDesign();
    const selectedTemplateId = detectTemplateId(safeDesign);
    const [uploading, setUploading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);

    const ratio = FORMAT_RATIOS[safeDesign.format] || FORMAT_RATIOS.digital;
    const displayH = Math.round(DISPLAY_W / ratio);
    const bgImg = useHtmlImage(backendAbsoluteUrl(safeDesign.background_url));
    const hasDesign = (safeDesign.elements || []).length > 0;

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const updateDesign = (patch: Partial<TicketDesign>) => onChange({ ...safeDesign, ...patch });

    const pickTemplate = (templateId: string) => {
        const next = applyTicketTemplate(templateId, safeDesign);
        onChange(next);
        setPreviewUrl(null);
        toast.success("Plantilla aplicada");
    };

    const clearDesign = () => {
        onChange(emptyDesign(safeDesign.format));
        setPreviewUrl(null);
        toast.message("Se usará el ticket estándar de TYS");
    };

    const setLogoOnDesign = (url: string) => {
        const elements = [...(safeDesign.elements || [])];
        const idx = elements.findIndex((e) => e.type === "logo");
        if (idx >= 0) {
            elements[idx] = { ...elements[idx], image_url: url };
        } else {
            elements.unshift({
                id: `logo-${Date.now()}`,
                type: "logo",
                x: 0.05,
                y: 0.08,
                width: 0.18,
                height: 0.28,
                image_url: url,
            });
        }
        updateDesign({ elements });
    };

    const uploadAsset = async (file, role: "background" | "logo") => {
        setUploading(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const { data } = await api.post(
                `/events/me/${eventId}/ticket-design/asset?slot=${slot}&role=${role}`,
                form,
                { headers: { "Content-Type": "multipart/form-data" } },
            );
            if (role === "background") {
                updateDesign({ background_url: data.url });
            } else {
                if (!hasDesign) {
                    const next = applyTicketTemplate("clasico", safeDesign);
                    next.elements = next.elements.map((e) =>
                        e.type === "logo" ? { ...e, image_url: data.url } : e,
                    );
                    onChange(next);
                } else {
                    setLogoOnDesign(data.url);
                }
            }
            toast.success(role === "logo" ? "Logo actualizado" : "Fondo actualizado");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo subir la imagen");
        } finally {
            setUploading(false);
        }
    };

    const generatePreview = async () => {
        if (!eventId) return;
        setPreviewing(true);
        try {
            // The preview PDF endpoint reads the persisted design, so we save it
            // first — this design edit lands in the DB even if the rest of the
            // wizard form is never submitted.
            const field = slot === "courtesy" ? "courtesy_ticket_design" : "ticket_design";
            await api.put(`/events/me/${eventId}`, { [field]: safeDesign });
            toast.message("Diseño guardado para generar la vista previa");

            const base = import.meta.env.VITE_BACKEND_URL || "";
            const token = localStorage.getItem("tys_access_token");
            const res = await fetch(
                `${base}/api/events/me/${eventId}/ticket-design/preview.pdf?slot=${slot}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.detail || "No se pudo generar el PDF de prueba");
            }
            const blob = await res.blob();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (e: any) {
            toast.error(e.message || "No se pudo generar el PDF de prueba");
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <div className="space-y-5" data-testid={`ticket-design-panel-${slot}`}>
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <div className="text-sm font-medium">Plantilla</div>
                    {hasDesign && !selectedTemplateId && (
                        <Badge variant="secondary" data-testid={`td-custom-badge-${slot}`}>
                            Diseño personalizado (heredado)
                        </Badge>
                    )}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                    {hasDesign && !selectedTemplateId
                        ? "Este evento tiene un diseño hecho antes de las plantillas. Elegir una plantilla lo reemplaza por completo."
                        : "Cada una ya trae logo, datos del evento y QR. Después solo personalizás color y logo."}
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid={`td-templates-${slot}`}>
                    {TICKET_TEMPLATES.map((tpl) => {
                        const active = selectedTemplateId === tpl.id;
                        return (
                            <button
                                key={tpl.id}
                                type="button"
                                onClick={() => pickTemplate(tpl.id)}
                                className={`text-left rounded-xl border p-2.5 transition hover:border-foreground/30 ${
                                    active
                                        ? "border-foreground ring-2 ring-foreground/15"
                                        : "border-border"
                                }`}
                                data-testid={`td-template-${tpl.id}-${slot}`}
                            >
                                <MiniPreview template={tpl} />
                                <div className="mt-2 flex items-start justify-between gap-1">
                                    <div>
                                        <div className="text-sm font-medium leading-tight">{tpl.name}</div>
                                        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                            {tpl.blurb}
                                        </div>
                                    </div>
                                    {active && <Check className="h-4 w-4 shrink-0 text-teal-700" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-secondary/20 p-3">
                <div className="space-y-1.5">
                    <Label className="text-xs">Formato</Label>
                    <Select
                        value={safeDesign.format}
                        onValueChange={(v) => updateDesign({ format: v as TicketDesign["format"] })}
                    >
                        <SelectTrigger className="w-44" data-testid={`td-format-${slot}`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(FORMAT_LABELS).map(([k, label]) => (
                                <SelectItem key={k} value={k}>{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">Color de fondo</Label>
                    <div className="flex items-center gap-1.5">
                        {BG_PALETTE.map((c) => (
                            <button
                                key={c}
                                type="button"
                                title={c}
                                onClick={() => updateDesign({ background_color: c })}
                                className={`h-7 w-7 rounded-full border-2 ${
                                    (safeDesign.background_color || "").toLowerCase() === c
                                        ? "border-foreground scale-110"
                                        : "border-border"
                                }`}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                        <Input
                            type="color"
                            value={safeDesign.background_color || "#ffffff"}
                            onChange={(e) => updateDesign({ background_color: e.target.value })}
                            className="h-7 w-9 p-0.5 cursor-pointer"
                            data-testid={`td-bg-color-${slot}`}
                        />
                    </div>
                </div>

                <label className="inline-flex">
                    <Button size="sm" variant="outline" asChild disabled={uploading || !eventId}>
                        <span>
                            <Upload className="h-4 w-4 mr-1.5" /> Logo
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], "logo")}
                                data-testid={`td-upload-logo-${slot}`}
                            />
                        </span>
                    </Button>
                </label>

                <label className="inline-flex">
                    <Button size="sm" variant="outline" asChild disabled={uploading || !eventId}>
                        <span>
                            <Upload className="h-4 w-4 mr-1.5" /> Fondo
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0], "background")}
                                data-testid={`td-upload-bg-${slot}`}
                            />
                        </span>
                    </Button>
                </label>

                <Button
                    size="sm"
                    variant="secondary"
                    onClick={generatePreview}
                    disabled={previewing || !hasDesign || !eventId}
                    data-testid={`td-preview-${slot}`}
                >
                    {previewing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
                    Vista previa
                </Button>

                {previewUrl && (
                    <Button size="sm" variant="ghost" asChild>
                        <a href={previewUrl} target="_blank" rel="noreferrer" data-testid={`td-preview-open-${slot}`}>
                            <ExternalLink className="h-4 w-4 mr-1.5" /> Abrir PDF
                        </a>
                    </Button>
                )}

                {hasDesign && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={clearDesign}
                        data-testid={`td-clear-${slot}`}
                    >
                        <RotateCcw className="h-4 w-4 mr-1.5" /> Usar estándar TYS
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap gap-4 items-start">
                <div
                    className="border rounded-lg overflow-hidden shrink-0 shadow-sm"
                    style={{ width: DISPLAY_W, height: displayH }}
                    data-testid={`td-canvas-${slot}`}
                >
                    {hasDesign ? (
                        <Stage width={DISPLAY_W} height={displayH} listening={false}>
                            <Layer listening={false}>
                                <Rect
                                    x={0}
                                    y={0}
                                    width={DISPLAY_W}
                                    height={displayH}
                                    fill={safeDesign.background_color || "#ffffff"}
                                />
                                {bgImg && (
                                    <KonvaImage
                                        image={bgImg}
                                        x={0}
                                        y={0}
                                        width={DISPLAY_W}
                                        height={displayH}
                                    />
                                )}
                                {safeDesign.elements.map((el) => (
                                    <DesignElementNode
                                        key={el.id}
                                        el={el}
                                        displayW={DISPLAY_W}
                                        displayH={displayH}
                                    />
                                ))}
                            </Layer>
                        </Stage>
                    ) : (
                        <div
                            className="h-full w-full flex items-center justify-center text-center p-6 bg-muted/40"
                            style={{ width: DISPLAY_W, height: displayH }}
                        >
                            <p className="text-sm text-muted-foreground max-w-xs">
                                Elegí una plantilla arriba. Si no diseñás nada, los compradores
                                reciben el ticket estándar de Ticket Yourself.
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-[200px] text-xs text-muted-foreground space-y-2 pt-1">
                    <p>
                        La vista de la izquierda es un esquema. Usá <strong>Vista previa</strong> para
                        ver el PDF real con datos de ejemplo (lo mismo que recibe el comprador).
                    </p>
                    {safeDesign.background_url && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => updateDesign({ background_url: null })}
                        >
                            Quitar imagen de fondo
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Vista previa real
                </div>
                {previewUrl ? (
                    <iframe
                        src={previewUrl}
                        title="Vista previa del ticket"
                        className="w-full border rounded-lg"
                        style={{ height: 520 }}
                        data-testid={`td-preview-frame-${slot}`}
                    />
                ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {hasDesign
                            ? "Hacé click en \"Vista previa\" para ver el ticket con datos de muestra."
                            : "Elegí una plantilla para poder generar la vista previa."}
                    </div>
                )}
            </div>
        </div>
    );
}

function DesignElementNode({ el, displayW, displayH }) {
    const x = el.x * displayW;
    const y = el.y * displayH;
    const w = el.width * displayW;
    const h = el.height * displayH;
    const logoImg = useHtmlImage(el.type === "logo" ? backendAbsoluteUrl(el.image_url) : null);

    if (el.type === "qr") {
        return (
            <Group x={x} y={y} width={w} height={h}>
                <Rect width={w} height={h} fill="#f1f1f6" stroke="#c7c7d6" strokeWidth={1} dash={[6, 4]} />
                <Text
                    width={w}
                    height={h}
                    text="QR"
                    fontSize={Math.min(w, h) * 0.2}
                    fill="#9292a8"
                    align="center"
                    verticalAlign="middle"
                />
            </Group>
        );
    }
    if (el.type === "logo") {
        return (
            <Group x={x} y={y} width={w} height={h}>
                {logoImg ? (
                    <KonvaImage image={logoImg} width={w} height={h} />
                ) : (
                    <>
                        <Rect width={w} height={h} fill="#f1f1f6" stroke="#c7c7d6" strokeWidth={1} />
                        <Text
                            width={w}
                            height={h}
                            text="LOGO"
                            fontSize={Math.min(w, h) * 0.18}
                            fill="#9292a8"
                            align="center"
                            verticalAlign="middle"
                        />
                    </>
                )}
            </Group>
        );
    }
    return (
        <Text
            x={x}
            y={y}
            width={w}
            height={h}
            text={el.field === "custom" ? (el.text || "Texto") : `{{${el.field || "title"}}}`}
            fontSize={el.font_size || 14}
            fill={el.color || "#1f1f33"}
            align={el.align || "left"}
            verticalAlign="middle"
        />
    );
}
