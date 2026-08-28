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
import api, { formatApiError } from "@/lib/api";
import {
    TICKET_TEMPLATES,
    applyTicketTemplate,
    detectTemplateId,
    emptyDesign,
    A4_WH,
    type TicketDesign,
} from "@/lib/ticketDesignTemplates";

const FORMAT_RATIOS = { digital: 800 / 360, a4: A4_WH, pvc: 85.6 / 54 };
const A4_PREVIEW_H = 520;

const BG_PALETTE = [
    "#ffffff", "#f8fafc", "#0f172a", "#0f766e",
    "#134e4a", "#1e3a5f", "#fef3c7", "#ecfdf5",
];

const ALLOWED_TICKET_IMG_MIME = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
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
        let cancelled = false;
        const el = new window.Image();
        // Do not set crossOrigin: this canvas is never exported (PDF is
        // server-side). anonymous CORS fails silently on localhost vs 127.0.0.1.
        el.onload = () => {
            if (!cancelled) setImg(el);
        };
        el.onerror = () => {
            if (!cancelled) setImg(null);
        };
        el.src = url;
        return () => {
            cancelled = true;
        };
    }, [url]);
    return img;
}

function MiniPreview({ template, photoUrl }) {
    return (
        <div
            className="mx-auto w-full max-w-[120px] rounded-md border overflow-hidden relative"
            style={{
                backgroundColor: template.previewBg,
                backgroundImage: photoUrl ? `url("${photoUrl}")` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
                aspectRatio: "210 / 297",
            }}
        >
            <div
                className="absolute left-[12%] top-[8%] h-[9%] w-[18%] rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.25 }}
            />
            <div
                className="absolute left-[34%] top-[9%] h-[4%] w-[52%] rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.5 }}
            />
            <div
                className="absolute left-[12%] top-[22%] h-[6%] w-[76%] rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.45 }}
            />
            <div
                className="absolute left-[12%] top-[32%] h-[3%] w-[60%] rounded-sm"
                style={{ backgroundColor: template.previewFg, opacity: 0.25 }}
            />
            <div
                className="absolute left-[28%] bottom-[10%] rounded-sm border border-dashed"
                style={{
                    borderColor: template.previewFg,
                    opacity: 0.45,
                    width: "44%",
                    aspectRatio: "1",
                }}
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

    const ratio = FORMAT_RATIOS[safeDesign.format] || FORMAT_RATIOS.a4;
    const isPortrait = ratio < 1;
    const displayH = isPortrait ? A4_PREVIEW_H : Math.round(420 / ratio);
    const displayW = isPortrait ? Math.round(A4_PREVIEW_H * ratio) : 420;
    const bgAbsUrl = backendAbsoluteUrl(safeDesign.background_url);
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
                x: 0.08,
                y: 0.05,
                width: 0.16,
                height: 0.16 * A4_WH,
                image_url: url,
            });
        }
        updateDesign({ elements });
    };

    const uploadAsset = async (file, role: "background" | "logo") => {
        if (!file) return;
        if (file.type && !ALLOWED_TICKET_IMG_MIME.includes(file.type)) {
            toast.error(`Formato no soportado: ${file.type}. Aceptamos JPG, PNG, WEBP o HEIC.`);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error("La imagen supera los 5MB. Reducí su peso e intentá de nuevo.");
            return;
        }
        setUploading(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const { data } = await api.post(
                `/events/me/${eventId}/ticket-design/asset?slot=${slot}&role=${role}`,
                form,
            );
            if (role === "background") {
                if (!hasDesign) {
                    onChange(
                        applyTicketTemplate(selectedTemplateId || "clasico", {
                            ...safeDesign,
                            background_url: data.url,
                        }),
                    );
                } else {
                    updateDesign({ background_url: data.url });
                }
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
            toast.error(
                formatApiError(e?.response?.data?.detail) ||
                    e?.message ||
                    "No se pudo subir la imagen",
            );
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
                        : "Hoja A4 vertical: es el PDF que llega por email y se puede imprimir. Después personalizás color, logo y fondo."}
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
                                <MiniPreview
                                    template={tpl}
                                    photoUrl={active ? bgAbsUrl : null}
                                />
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
                <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-auto pb-0.5">
                    Formato fijo: <strong className="text-foreground">A4</strong> (una página, envío por email).
                </p>
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
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = "";
                                    if (f) uploadAsset(f, "logo");
                                }}
                                data-testid={`td-upload-logo-${slot}`}
                            />
                        </span>
                    </Button>
                </label>

                <label className="inline-flex items-center gap-1.5">
                    {bgAbsUrl && (
                        <img
                            src={bgAbsUrl}
                            alt=""
                            className="h-7 w-7 rounded border object-cover"
                        />
                    )}
                    <Button size="sm" variant="outline" asChild disabled={uploading || !eventId}>
                        <span>
                            <Upload className="h-4 w-4 mr-1.5" /> Fondo
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = "";
                                    if (f) uploadAsset(f, "background");
                                }}
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
                    className="relative border rounded-lg overflow-hidden shrink-0 shadow-sm"
                    style={{
                        width: displayW,
                        height: displayH,
                        backgroundColor: safeDesign.background_color || "#ffffff",
                    }}
                    data-testid={`td-canvas-${slot}`}
                >
                    {bgAbsUrl && (
                        <img
                            src={bgAbsUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            data-testid={`td-canvas-bg-${slot}`}
                        />
                    )}
                    {hasDesign ? (
                        <Stage
                            width={displayW}
                            height={displayH}
                            listening={false}
                            className="relative"
                            style={{ background: "transparent" }}
                        >
                            <Layer listening={false}>
                                {safeDesign.elements.map((el) => (
                                    <DesignElementNode
                                        key={el.id}
                                        el={el}
                                        displayW={displayW}
                                        displayH={displayH}
                                    />
                                ))}
                            </Layer>
                        </Stage>
                    ) : (
                        <div
                            className="h-full w-full flex items-center justify-center text-center p-6 bg-muted/40"
                            style={{ width: displayW, height: displayH }}
                        >
                            <p className="text-sm text-muted-foreground max-w-xs">
                                Elegí una plantilla A4 arriba. Si no diseñás nada, los compradores
                                reciben el ticket estándar de Ticket Yourself.
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-[200px] text-xs text-muted-foreground space-y-2 pt-1">
                    <p>
                        La vista de la izquierda es un esquema de la hoja A4. Usá{" "}
                        <strong>Vista previa</strong> para ver el PDF real con datos de ejemplo
                        (lo mismo que llega por email).
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
                        style={{ height: 640 }}
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
