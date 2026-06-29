/**
 * TicketDesignPanel — M4 drag & drop visual ticket designer.
 *
 * Elements are stored as fractions [0,1] of the canvas so the same design
 * renders correctly at any output size (digital / A4 / PVC) — see
 * backend/services/pdf_service.py's FORMAT_PAGE_SIZES for the matching
 * real-world page sizes used when actually rendering the PDF.
 *
 * The canvas here is an editing surface, not the renderer — organizers use
 * the "Vista previa" button to render the real reportlab output (with
 * sample data) inline below the canvas.
 */
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Group } from "react-konva";
import { toast } from "sonner";
import {
    Image as ImageIcon, QrCode, Type, Trash2, Upload, Loader2, Eye, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import api from "@/lib/api";

const FORMAT_RATIOS = { digital: 800 / 360, a4: 595.27 / 841.89, pvc: 85.6 / 54 };
const FORMAT_LABELS = {
    digital: "Digital (email)",
    a4: "Imprimible (A4)",
    pvc: "Gafete / PVC (kiosco)",
};
const FIELD_LABELS = {
    title: "Título del evento",
    starts_at: "Fecha y hora",
    venue: "Lugar",
    holder_name: "Nombre del asistente",
    holder_email: "Email del asistente",
    price: "Precio / aporte",
    seat_or_raffle: "Asiento o N° de rifa",
    order_number: "N° de orden",
    organizer_name: "Organizador",
    custom: "Texto personalizado",
};
const DISPLAY_W = 560;

function defaultDesign() {
    return { format: "digital", background_url: null, background_color: "#ffffff", elements: [] };
}

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
            return;
        }
        const el = new window.Image();
        el.crossOrigin = "anonymous";
        el.onload = () => setImg(el);
        el.src = url;
        return () => setImg(null);
    }, [url]);
    return img;
}

function newElement(type) {
    const base = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type };
    if (type === "logo") return { ...base, x: 0.05, y: 0.05, width: 0.2, height: 0.2, image_url: null };
    if (type === "qr") return { ...base, x: 0.72, y: 0.55, width: 0.23, height: 0.4 };
    return {
        ...base, x: 0.05, y: 0.3, width: 0.55, height: 0.1,
        field: "title", text: null, font_size: 16, color: "#1f1f33", align: "left",
    };
}

export default function TicketDesignPanel({ eventId, design, onChange, slot = "main" }) {
    const safeDesign = design || defaultDesign();
    const [selectedId, setSelectedId] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const stageRef = useRef(null);
    const trRef = useRef(null);
    const shapeRefs = useRef({});

    const ratio = FORMAT_RATIOS[safeDesign.format] || FORMAT_RATIOS.digital;
    const displayH = Math.round(DISPLAY_W / ratio);

    const bgImg = useHtmlImage(backendAbsoluteUrl(safeDesign.background_url));
    const selected = safeDesign.elements.find((e) => e.id === selectedId) || null;

    useEffect(() => {
        const tr = trRef.current;
        if (!tr) return;
        const node = selectedId ? shapeRefs.current[selectedId] : null;
        tr.nodes(node ? [node] : []);
        tr.getLayer()?.batchDraw();
    }, [selectedId, safeDesign.elements.length]);

    // Revoke the last generated preview's blob URL on unmount / regeneration
    // so we don't leak memory across edits.
    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const updateDesign = (patch) => onChange({ ...safeDesign, ...patch });
    const updateElement = (id, patch) =>
        updateDesign({ elements: safeDesign.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    const addElement = (type) => {
        const el = newElement(type);
        updateDesign({ elements: [...safeDesign.elements, el] });
        setSelectedId(el.id);
    };
    const removeSelected = () => {
        if (!selectedId) return;
        updateDesign({ elements: safeDesign.elements.filter((e) => e.id !== selectedId) });
        setSelectedId(null);
    };

    const handleTransformEnd = (id) => {
        const node = shapeRefs.current[id];
        if (!node) return;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const el = safeDesign.elements.find((e) => e.id === id);
        if (!el) return;
        updateElement(id, {
            x: node.x() / DISPLAY_W,
            y: node.y() / displayH,
            width: Math.max(0.02, (el.width * sx)),
            height: Math.max(0.02, (el.height * sy)),
        });
    };

    const handleDragEnd = (id, node) => {
        updateElement(id, { x: node.x() / DISPLAY_W, y: node.y() / displayH });
    };

    const uploadAsset = async (file, role) => {
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
            } else if (selectedId) {
                updateElement(selectedId, { image_url: data.url });
            }
            toast.success("Imagen subida");
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
            // Persist the in-progress design first — the preview endpoint reads
            // from the saved event, not the live canvas state, and this button
            // should always reflect exactly what's on screen right now.
            const field = slot === "courtesy" ? "courtesy_ticket_design" : "ticket_design";
            await api.put(`/events/me/${eventId}`, { [field]: safeDesign });

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
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (e: any) {
            toast.error(e.message || "No se pudo generar el PDF de prueba");
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <div className="space-y-3" data-testid={`ticket-design-panel-${slot}`}>
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    value={safeDesign.format}
                    onValueChange={(v) => updateDesign({ format: v })}
                >
                    <SelectTrigger className="w-48" data-testid={`td-format-${slot}`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(FORMAT_LABELS).map(([k, label]) => (
                            <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => addElement("logo")} data-testid={`td-add-logo-${slot}`}>
                    <ImageIcon className="h-4 w-4 mr-1.5" /> Logo
                </Button>
                <Button size="sm" variant="outline" onClick={() => addElement("qr")} data-testid={`td-add-qr-${slot}`}>
                    <QrCode className="h-4 w-4 mr-1.5" /> QR
                </Button>
                <Button size="sm" variant="outline" onClick={() => addElement("text")} data-testid={`td-add-text-${slot}`}>
                    <Type className="h-4 w-4 mr-1.5" /> Texto
                </Button>
                <label className="inline-flex">
                    <Button size="sm" variant="outline" asChild disabled={uploading}>
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
                    disabled={previewing || !safeDesign.elements.length}
                    data-testid={`td-preview-${slot}`}
                >
                    {previewing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
                    Vista previa
                </Button>
                {previewUrl && (
                    <Button size="sm" variant="ghost" asChild>
                        <a href={previewUrl} target="_blank" rel="noreferrer" data-testid={`td-preview-open-${slot}`}>
                            <ExternalLink className="h-4 w-4 mr-1.5" />
                            Abrir / descargar
                        </a>
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap gap-4">
                <div
                    className="border rounded-lg overflow-hidden shrink-0"
                    style={{ width: DISPLAY_W, height: displayH }}
                    data-testid={`td-canvas-${slot}`}
                >
                    <Stage
                        ref={stageRef}
                        width={DISPLAY_W}
                        height={displayH}
                        onMouseDown={(e) => {
                            if (e.target === e.target.getStage()) setSelectedId(null);
                        }}
                    >
                        <Layer>
                            <Rect x={0} y={0} width={DISPLAY_W} height={displayH} fill={safeDesign.background_color || "#ffffff"} />
                            {bgImg && (
                                <KonvaImage image={bgImg} x={0} y={0} width={DISPLAY_W} height={displayH} listening={false} />
                            )}
                            {safeDesign.elements.map((el) => (
                                <DesignElementNode
                                    key={el.id}
                                    el={el}
                                    displayW={DISPLAY_W}
                                    displayH={displayH}
                                    isSelected={selectedId === el.id}
                                    onSelect={() => setSelectedId(el.id)}
                                    onDragEnd={(node) => handleDragEnd(el.id, node)}
                                    registerRef={(node) => { shapeRefs.current[el.id] = node; }}
                                />
                            ))}
                            <Transformer
                                ref={trRef}
                                rotateEnabled={false}
                                onTransformEnd={() => selectedId && handleTransformEnd(selectedId)}
                            />
                        </Layer>
                    </Stage>
                </div>

                <div className="w-64 space-y-3" data-testid={`td-properties-${slot}`}>
                    {!selected ? (
                        <p className="text-xs text-muted-foreground">
                            Hacé click en un elemento del ticket para editarlo, o agregá uno nuevo
                            con los botones de arriba.
                        </p>
                    ) : (
                        <>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium uppercase text-muted-foreground">
                                    {selected.type === "logo" ? "Logo" : selected.type === "qr" ? "Código QR" : "Texto"}
                                </span>
                                <Button variant="ghost" size="icon" onClick={removeSelected} data-testid={`td-remove-${slot}`}>
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                            </div>

                            {selected.type === "logo" && (
                                <label className="inline-flex w-full">
                                    <Button size="sm" variant="outline" className="w-full" asChild disabled={uploading}>
                                        <span>
                                            <Upload className="h-4 w-4 mr-1.5" /> Subir logo
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
                            )}

                            {selected.type === "text" && (
                                <>
                                    <div className="space-y-1.5">
                                        <Label>Contenido</Label>
                                        <Select
                                            value={selected.field || "custom"}
                                            onValueChange={(v) => updateElement(selected.id, { field: v })}
                                        >
                                            <SelectTrigger data-testid={`td-field-${slot}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(FIELD_LABELS).map(([k, label]) => (
                                                    <SelectItem key={k} value={k}>{label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {selected.field === "custom" && (
                                        <div className="space-y-1.5">
                                            <Label>Texto fijo</Label>
                                            <Input
                                                value={selected.text || ""}
                                                onChange={(e) => updateElement(selected.id, { text: e.target.value })}
                                                data-testid={`td-text-${slot}`}
                                            />
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1.5">
                                            <Label>Tamaño</Label>
                                            <Input
                                                type="number"
                                                min="6"
                                                max="72"
                                                value={selected.font_size || 14}
                                                onChange={(e) => updateElement(selected.id, { font_size: parseInt(e.target.value, 10) || 14 })}
                                                data-testid={`td-font-size-${slot}`}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Color</Label>
                                            <Input
                                                type="color"
                                                value={selected.color || "#1f1f33"}
                                                onChange={(e) => updateElement(selected.id, { color: e.target.value })}
                                                className="h-9 cursor-pointer"
                                                data-testid={`td-color-${slot}`}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Alineación</Label>
                                        <Select
                                            value={selected.align || "left"}
                                            onValueChange={(v) => updateElement(selected.id, { align: v })}
                                        >
                                            <SelectTrigger data-testid={`td-align-${slot}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="left">Izquierda</SelectItem>
                                                <SelectItem value="center">Centro</SelectItem>
                                                <SelectItem value="right">Derecha</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            )}

                            <p className="text-xs text-muted-foreground">
                                Arrastrá para mover, usá las esquinas para cambiar el tamaño.
                            </p>
                        </>
                    )}
                </div>
            </div>

            {/* Real preview — the canvas above is an editing surface (shows
                {{field}} placeholders); this is the actual reportlab PDF with
                sample data, so fonts/scaling/poster match exactly what buyers get. */}
            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Vista previa real
                </div>
                {previewUrl ? (
                    <iframe
                        src={previewUrl}
                        title="Vista previa del ticket"
                        className="w-full border rounded-lg"
                        style={{ height: 600 }}
                        data-testid={`td-preview-frame-${slot}`}
                    />
                ) : (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {safeDesign.elements.length
                            ? "Hacé click en \"Vista previa\" para ver el ticket con datos de muestra."
                            : "Agregá al menos un elemento (logo, QR o texto) para poder generar una vista previa."}
                    </div>
                )}
            </div>
        </div>
    );
}

function DesignElementNode({ el, displayW, displayH, isSelected, onSelect, onDragEnd, registerRef }) {
    const x = el.x * displayW;
    const y = el.y * displayH;
    const w = el.width * displayW;
    const h = el.height * displayH;
    const logoImg = useHtmlImage(el.type === "logo" ? backendAbsoluteUrl(el.image_url) : null);

    const common = {
        x, y, draggable: true,
        onClick: onSelect,
        onTap: onSelect,
        onDragEnd: (e) => onDragEnd(e.target),
        ref: registerRef,
    };

    if (el.type === "qr") {
        return (
            <Group {...common} width={w} height={h}>
                <Rect
                    width={w}
                    height={h}
                    fill="#f1f1f6"
                    stroke={isSelected ? "#6366f1" : "#c7c7d6"}
                    strokeWidth={isSelected ? 2 : 1}
                    dash={[6, 4]}
                />
                <Text width={w} height={h} text="QR" fontSize={Math.min(w, h) * 0.2} fill="#9292a8" align="center" verticalAlign="middle" />
            </Group>
        );
    }
    if (el.type === "logo") {
        if (logoImg) {
            return <KonvaImage {...common} image={logoImg} width={w} height={h} />;
        }
        return (
            <Group {...common} width={w} height={h}>
                <Rect
                    width={w}
                    height={h}
                    fill="#f1f1f6"
                    stroke={isSelected ? "#6366f1" : "#c7c7d6"}
                    strokeWidth={isSelected ? 2 : 1}
                />
                <Text width={w} height={h} text="LOGO" fontSize={Math.min(w, h) * 0.18} fill="#9292a8" align="center" verticalAlign="middle" />
            </Group>
        );
    }
    // text
    return (
        <Text
            {...common}
            width={w}
            height={h}
            text={el.field === "custom" ? (el.text || "Texto") : `{{${el.field || "title"}}}`}
            fontSize={el.font_size || 14}
            fill={el.color || "#1f1f33"}
            align={el.align || "left"}
            verticalAlign="middle"
            stroke={isSelected ? "#6366f1" : undefined}
            strokeWidth={isSelected ? 0.6 : 0}
        />
    );
}
