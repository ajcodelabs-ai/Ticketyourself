/**
 * EventForm — full event editor used by /eventos/nuevo and /eventos/:id/editar.
 * Single form on one page with collapsible sections (no multi-step wizard,
 * per Phase 3a scope).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Upload, ImageIcon, Save, Send, Lock } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { assetUrl } from "@/lib/microsite";
import {
    EVENT_CATEGORIES,
    isoToLocalInput,
    localInputToIso,
} from "@/lib/events";

const TIMEZONES = [
    "America/Guayaquil",
    "America/Bogota",
    "America/Lima",
    "America/Mexico_City",
    "America/Argentina/Buenos_Aires",
];

const ALLOWED_MIME = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
];

export default function EventForm({ initial, onSaved, mode = "create" }) {
    const [form, setForm] = useState(() => makeInitial(initial));
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [poster, setPoster] = useState(initial?.poster_url || null);
    const [banner, setBanner] = useState(initial?.banner_url || null);
    const [eventId, setEventId] = useState(initial?.id || null);
    const [uploadingKind, setUploadingKind] = useState(null);

    useEffect(() => {
        if (initial) {
            setForm(makeInitial(initial));
            setPoster(initial.poster_url || null);
            setBanner(initial.banner_url || null);
            setEventId(initial.id || null);
        }
    }, [initial]);

    const lockCritical =
        mode === "edit" && initial?.tickets_sold > 0;

    const update = (key) => (val) =>
        setForm((f) => ({ ...f, [key]: typeof val === "object" && val?.target ? val.target.value : val }));

    const persist = async (publish = false) => {
        // Required fields if publishing.
        if (publish) {
            if (!form.title || !form.starts_at || !form.ends_at || !form.venue_name) {
                toast.error("Para publicar necesitás título, fechas y venue.");
                return null;
            }
        }
        const payload = {
            ...form,
            starts_at: localInputToIso(form.starts_at),
            ends_at: localInputToIso(form.ends_at),
            base_price_cents:
                form.pricing_type === "free"
                    ? 0
                    : Math.round(parseFloat(form.base_price_dollars || "0") * 100),
            capacity:
                form.unlimited_capacity || form.capacity === ""
                    ? null
                    : parseInt(form.capacity, 10),
        };
        delete payload.unlimited_capacity;
        delete payload.base_price_dollars;

        // Validate dates
        if (!payload.starts_at || !payload.ends_at) {
            toast.error("Definí fecha de inicio y fin.");
            return null;
        }
        if (new Date(payload.ends_at) <= new Date(payload.starts_at)) {
            toast.error("La fecha de fin debe ser posterior al inicio.");
            return null;
        }

        setSaving(true);
        try {
            let result;
            if (eventId) {
                const { data } = await api.put(`/events/me/${eventId}`, payload);
                result = data;
            } else {
                const { data } = await api.post("/events/me", payload);
                result = data;
                setEventId(data.id);
            }
            if (publish && !result.poster_url) {
                toast.error("Subí un poster antes de publicar.");
                return result;
            }
            if (publish) {
                setPublishing(true);
                await api.post(`/events/me/${result.id}/publish`);
                toast.success("Evento publicado");
            } else {
                toast.success(eventId ? "Cambios guardados" : "Borrador creado");
            }
            onSaved?.(result.id);
            return result;
        } catch (e) {
            const status = e?.response?.status;
            const msg = formatApiError(e?.response?.data?.detail) || e.message;
            toast.error(status ? `Error ${status}: ${msg}` : msg);
            return null;
        } finally {
            setSaving(false);
            setPublishing(false);
        }
    };

    const uploadImage = async (file, kind) => {
        if (!file) return;
        if (file.type && !ALLOWED_MIME.includes(file.type)) {
            toast.error(`Formato no soportado: ${file.type}`);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error("La imagen supera los 5MB");
            return;
        }
        // We need a saved event before uploading the image (assets reference event_id).
        let id = eventId;
        if (!id) {
            const created = await persist(false);
            id = created?.id;
            if (!id) return;
        }
        setUploadingKind(kind);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post(`/events/me/${id}/${kind}`, fd);
            if (kind === "poster") setPoster(data.poster_url);
            if (kind === "banner") setBanner(data.banner_url);
            toast.success(kind === "poster" ? "Poster subido" : "Banner subido");
        } catch (e) {
            const msg = formatApiError(e?.response?.data?.detail) || e.message;
            toast.error(msg);
        } finally {
            setUploadingKind(null);
        }
    };

    return (
        <div className="space-y-5" data-testid="event-form">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Información básica</CardTitle>
                    <CardDescription>Lo que vas a mostrar al público.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Título</Label>
                        <Input
                            value={form.title}
                            onChange={update("title")}
                            data-testid="event-title-input"
                            maxLength={140}
                            placeholder="Ej: Concierto Acústico"
                            disabled={lockCritical}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Categoría</Label>
                        <Select value={form.category} onValueChange={update("category")}>
                            <SelectTrigger data-testid="event-category-select">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EVENT_CATEGORIES.map((c) => (
                                    <SelectItem
                                        key={c.code}
                                        value={c.code}
                                        data-testid={`event-cat-${c.code}`}
                                    >
                                        {c.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Descripción corta (max 160 caracteres)</Label>
                        <Textarea
                            value={form.short_description}
                            onChange={update("short_description")}
                            maxLength={160}
                            rows={2}
                            data-testid="event-short-input"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Descripción completa</Label>
                        <Textarea
                            value={form.description}
                            onChange={update("description")}
                            maxLength={8000}
                            rows={6}
                            data-testid="event-desc-input"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Imágenes</CardTitle>
                    <CardDescription>JPG/PNG/WEBP/HEIC, máx 5MB.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-5">
                    <ImageDropzone
                        label="Poster (vertical, recomendado)"
                        currentUrl={assetUrl(poster)}
                        onUpload={(f) => uploadImage(f, "poster")}
                        uploading={uploadingKind === "poster"}
                        testid="event-poster-upload"
                    />
                    <ImageDropzone
                        label="Banner (opcional, hero del evento)"
                        currentUrl={assetUrl(banner)}
                        onUpload={(f) => uploadImage(f, "banner")}
                        uploading={uploadingKind === "banner"}
                        testid="event-banner-upload"
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Cuándo y dónde</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Inicio</Label>
                            <Input
                                type="datetime-local"
                                value={form.starts_at}
                                onChange={update("starts_at")}
                                data-testid="event-starts-input"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Fin</Label>
                            <Input
                                type="datetime-local"
                                value={form.ends_at}
                                onChange={update("ends_at")}
                                data-testid="event-ends-input"
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Zona horaria</Label>
                        <Select value={form.timezone} onValueChange={update("timezone")}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TIMEZONES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {t}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Nombre del lugar</Label>
                            <Input
                                value={form.venue_name}
                                onChange={update("venue_name")}
                                data-testid="event-venue-input"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Ciudad</Label>
                            <Input value={form.venue_city} onChange={update("venue_city")} />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Dirección</Label>
                        <Input
                            value={form.venue_address}
                            onChange={update("venue_address")}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        Tickets y precio
                        {lockCritical && (
                            <span className="text-xs text-amber-700 inline-flex items-center gap-1">
                                <Lock className="h-3.5 w-3.5" /> bloqueado · ya hay ventas
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <RadioGroup
                        value={form.pricing_type}
                        onValueChange={update("pricing_type")}
                        className="grid sm:grid-cols-3 gap-2"
                    >
                        {[
                            { v: "free", label: "Gratis" },
                            { v: "paid", label: "Pago" },
                            { v: "donation", label: "Donación" },
                        ].map((opt) => (
                            <label
                                key={opt.v}
                                htmlFor={`pricing-${opt.v}`}
                                className={`rounded-lg border p-3 cursor-pointer flex items-center gap-2 ${
                                    form.pricing_type === opt.v
                                        ? "border-primary bg-primary/5"
                                        : "border-border"
                                } ${lockCritical ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <RadioGroupItem
                                    value={opt.v}
                                    id={`pricing-${opt.v}`}
                                    disabled={lockCritical}
                                    data-testid={`event-pricing-${opt.v}`}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </RadioGroup>
                    {form.pricing_type !== "free" && (
                        <div className="space-y-1.5 max-w-xs">
                            <Label>
                                {form.pricing_type === "donation"
                                    ? "Aporte sugerido (USD)"
                                    : "Precio (USD)"}
                            </Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                    $
                                </span>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="pl-7"
                                    value={form.base_price_dollars}
                                    onChange={update("base_price_dollars")}
                                    disabled={lockCritical}
                                    data-testid="event-price-input"
                                />
                            </div>
                        </div>
                    )}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>Capacidad</Label>
                            <label
                                htmlFor="cap-unlimited"
                                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"
                            >
                                <Switch
                                    id="cap-unlimited"
                                    checked={form.unlimited_capacity}
                                    onCheckedChange={update("unlimited_capacity")}
                                    data-testid="event-unlimited-switch"
                                />
                                Sin límite
                            </label>
                        </div>
                        <Input
                            type="number"
                            min="0"
                            value={form.unlimited_capacity ? "" : form.capacity}
                            onChange={update("capacity")}
                            disabled={form.unlimited_capacity}
                            placeholder={form.unlimited_capacity ? "Sin límite" : "ej: 100"}
                            data-testid="event-capacity-input"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Visibilidad</CardTitle>
                </CardHeader>
                <CardContent>
                    <RadioGroup
                        value={form.visibility}
                        onValueChange={update("visibility")}
                        className="grid sm:grid-cols-2 gap-2"
                    >
                        {[
                            { v: "public", label: "Público — aparece en tu microsite" },
                            {
                                v: "public_blocked",
                                label: "Público bloqueado — aparece, pero compra requiere código o lista",
                            },
                            { v: "private", label: "Privado — solo con link directo" },
                        ].map((opt) => (
                            <label
                                key={opt.v}
                                htmlFor={`vis-${opt.v}`}
                                className={`rounded-lg border p-3 cursor-pointer flex items-center gap-2 ${
                                    form.visibility === opt.v
                                        ? "border-primary bg-primary/5"
                                        : "border-border"
                                }`}
                            >
                                <RadioGroupItem
                                    value={opt.v}
                                    id={`vis-${opt.v}`}
                                    data-testid={`event-vis-${opt.v}`}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </RadioGroup>
                </CardContent>
            </Card>

            <div className="sticky bottom-2 z-10 flex flex-wrap justify-end gap-2 bg-background/80 backdrop-blur p-3 rounded-xl border">
                <Button
                    variant="outline"
                    onClick={() => persist(false)}
                    disabled={saving || publishing}
                    data-testid="event-save-draft-btn"
                >
                    {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                    Guardar como borrador
                </Button>
                <Button
                    onClick={() => persist(true)}
                    disabled={saving || publishing}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    data-testid="event-publish-btn"
                >
                    {publishing ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                        <Send className="h-4 w-4 mr-1.5" />
                    )}
                    Publicar ahora
                </Button>
            </div>
        </div>
    );
}

function makeInitial(d) {
    if (!d) {
        return {
            title: "",
            description: "",
            short_description: "",
            category: "other",
            venue_name: "",
            venue_address: "",
            venue_city: "Quito",
            venue_country: "Ecuador",
            starts_at: "",
            ends_at: "",
            timezone: "America/Guayaquil",
            pricing_type: "free",
            base_price_dollars: "",
            currency: "USD",
            capacity: "",
            unlimited_capacity: true,
            visibility: "public",
        };
    }
    return {
        title: d.title || "",
        description: d.description || "",
        short_description: d.short_description || "",
        category: d.category || "other",
        venue_name: d.venue_name || "",
        venue_address: d.venue_address || "",
        venue_city: d.venue_city || "Quito",
        venue_country: d.venue_country || "Ecuador",
        starts_at: isoToLocalInput(d.starts_at),
        ends_at: isoToLocalInput(d.ends_at),
        timezone: d.timezone || "America/Guayaquil",
        pricing_type: d.pricing_type || "free",
        base_price_dollars:
            d.base_price_cents != null ? (d.base_price_cents / 100).toFixed(2) : "",
        currency: d.currency || "USD",
        capacity: d.capacity != null ? String(d.capacity) : "",
        unlimited_capacity: d.capacity == null,
        visibility: d.visibility || "public",
    };
}

function ImageDropzone({ label, currentUrl, onUpload, uploading, testid }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <label
                htmlFor={`${testid}-input`}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 cursor-pointer min-h-[180px] transition ${
                    uploading
                        ? "border-primary bg-primary/5 cursor-wait"
                        : "border-border/70 hover:border-primary hover:bg-primary/5"
                }`}
            >
                {currentUrl ? (
                    <img
                        src={currentUrl}
                        alt={label}
                        className="max-h-32 rounded shadow-sm"
                    />
                ) : uploading ? (
                    <>
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-sm text-primary">Subiendo…</span>
                    </>
                ) : (
                    <>
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground text-center">
                            <strong className="text-primary">Hacé click para subir</strong>
                            <br />
                            JPG/PNG/WEBP/HEIC · 5MB máx
                        </span>
                    </>
                )}
                <input
                    id={`${testid}-input`}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/*"
                    className="sr-only"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        onUpload(f);
                    }}
                    disabled={uploading}
                    data-testid={testid}
                />
                {currentUrl && !uploading && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Upload className="h-3 w-3" /> Reemplazar
                    </span>
                )}
            </label>
        </div>
    );
}
