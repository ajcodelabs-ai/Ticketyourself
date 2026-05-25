/**
 * EventWizard — Phase 5. 7-section horizontal tabs.
 *  1. General           5. Formas de pago
 *  2. Fechas y ventas   6. Descuentos
 *  3. Media             7. Accesos y parámetros
 *  4. Localidades
 *
 * Used in both create (/app/eventos/nuevo) and edit (/app/eventos/:id/editar).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import EventVenueSection from "@/components/events/EventVenueSection";
import DiscountRulesPanel from "@/components/events/DiscountRulesPanel";
import {
    DURATION_PRESETS,
    SALES_START_PRESETS,
    SALES_END_PRESETS,
    inferDurationPreset,
    inferSalesStartPreset,
    inferSalesEndPreset,
    computeEndsAt,
    computeSalesStart,
    computeSalesEnd,
} from "@/lib/eventPresets";
import {
    Loader2,
    Save,
    Send,
    ChevronLeft,
    ChevronRight,
    AlertTriangle,
    CheckCircle2,
    Circle,
    Lock,
    ImageIcon,
    Upload,
    Trash2,
    GripVertical,
    Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
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

const STEPS = [
    { id: "info", label: "Información general" },
    { id: "venue_localidades", label: "Venue y localidades" },
    { id: "media", label: "Media" },
    { id: "payments", label: "Formas de pago" },
    { id: "discounts", label: "Descuentos" },
    { id: "access", label: "Accesos y parámetros" },
];

function defaultPayments() {
    return {
        stripe: { enabled: true },
        transfer: {
            enabled: false,
            bank_name: "",
            account_number: "",
            account_holder: "",
            instructions: "",
        },
        cash: { enabled: false, location: "", schedule: "", contact: "" },
    };
}

function defaultDiscounts() {
    return {
        disability_law: { enabled: false, percent: 50 },
        presale: { enabled: false, percent: 0, ends_at: null },
    };
}

function defaultAccessParams() {
    return {
        visibility: "public",
        access_type: "open",
        max_per_purchase: 10,
        max_per_email: null,
        refund_window_hours: 24,
        show_buyer_name_on_ticket: true,
    };
}

function makeInitial(d) {
    if (!d) {
        return {
            title: "",
            description: "",
            short_description: "",
            category: "entertainment",
            venue_name: "",
            venue_address: "",
            venue_city: "Quito",
            venue_country: "Ecuador",
            starts_at: "",
            ends_at: "",
            timezone: "America/Guayaquil",
            sales_start: "",
            sales_end: "",
            // Phase 9.6 — preset metadata for the new dropdown UX
            duration_preset: "2h",
            duration_minutes_custom: 120,
            sales_window_preset_start: "immediate",
            sales_window_preset_end: "at_start",
            pricing_type: "free",
            base_price_dollars: "",
            currency: "USD",
            capacity: "",
            unlimited_capacity: true,
            visibility: "public",
            no_seating_mode: false,
            venue_id: null,
            payment_methods: defaultPayments(),
            discounts: defaultDiscounts(),
            access_params: defaultAccessParams(),
        };
    }
    const startsIso = d.starts_at || null;
    const endsIso = d.ends_at || null;
    const durInfer = inferDurationPreset(startsIso, endsIso);
    return {
        title: d.title || "",
        description: d.description || "",
        short_description: d.short_description || "",
        category: d.category || "entertainment",
        venue_name: d.venue_name || "",
        venue_address: d.venue_address || "",
        venue_city: d.venue_city || "Quito",
        venue_country: d.venue_country || "Ecuador",
        starts_at: isoToLocalInput(d.starts_at),
        ends_at: isoToLocalInput(d.ends_at),
        timezone: d.timezone || "America/Guayaquil",
        sales_start: d.sales_start ? isoToLocalInput(d.sales_start) : "",
        sales_end: d.sales_end ? isoToLocalInput(d.sales_end) : "",
        duration_preset: d.duration_preset || durInfer.preset,
        duration_minutes_custom: durInfer.minutes,
        sales_window_preset_start:
            d.sales_window_preset_start || inferSalesStartPreset(startsIso, d.sales_start),
        sales_window_preset_end:
            d.sales_window_preset_end || inferSalesEndPreset(startsIso, d.sales_end),
        pricing_type: d.pricing_type || "free",
        base_price_dollars:
            d.base_price_cents != null ? (d.base_price_cents / 100).toFixed(2) : "",
        currency: d.currency || "USD",
        capacity: d.capacity != null ? String(d.capacity) : "",
        unlimited_capacity: d.capacity == null,
        visibility: d.visibility || "public",
        no_seating_mode: !d.venue_id && d.pricing_type !== undefined ? false : false,
        venue_id: d.venue_id || null,
        payment_methods: d.payment_methods || defaultPayments(),
        discounts: d.discounts || defaultDiscounts(),
        access_params: d.access_params || defaultAccessParams(),
    };
}

export default function EventWizard({ initial, mode = "create" }) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [form, setForm] = useState(() => makeInitial(initial));
    const [venueLocalities, setVenueLocalities] = useState([]);

    // Phase 9.5 — fetch venue localities so the discounts panel can offer a
    // locality multi-select for promo-code conditions.
    useEffect(() => {
        if (!initial?.venue_id) {
            setVenueLocalities([]);
            return;
        }
        api.get(`/venues/me/${initial.venue_id}`)
            .then((r) => {
                const elementsLocs = new Set();
                for (const el of r.data.elements || []) {
                    if (el.locality_id) elementsLocs.add(el.locality_id);
                }
                setVenueLocalities(
                    (r.data.localities || []).filter((l) => elementsLocs.has(l.id)),
                );
            })
            .catch(() => setVenueLocalities([]));
    }, [initial?.venue_id]);
    // Deep-linking: ?tab=info|venue_localidades|... wins over default.
    const initialStep =
        STEPS.find((s) => s.id === searchParams.get("tab"))?.id || "info";
    const [activeStep, setActiveStep] = useState(initialStep);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [eventId, setEventId] = useState(initial?.id || null);
    const [poster, setPoster] = useState(initial?.poster_url || null);
    const [banner, setBanner] = useState(initial?.banner_url || null);
    const [gallery, setGallery] = useState(initial?.gallery_urls || []);
    const [uploadingKind, setUploadingKind] = useState(null); // "poster"|"banner"|"gallery"

    useEffect(() => {
        if (initial) {
            setForm(makeInitial(initial));
            setPoster(initial.poster_url || null);
            setBanner(initial.banner_url || null);
            setGallery(initial.gallery_urls || []);
            setEventId(initial.id);
        }
    }, [initial]);

    const lockCritical = mode === "edit" && (initial?.tickets_sold || 0) > 0;

    const stepStatus = useMemo(() => evalStepStatus(form, poster), [form, poster]);
    const allValid = Object.values(stepStatus).every((s) => s !== "error");

    const update = (path, value) => {
        setForm((f) => {
            const next = { ...f };
            const keys = path.split(".");
            let cursor = next;
            for (let i = 0; i < keys.length - 1; i++) {
                cursor[keys[i]] = { ...cursor[keys[i]] };
                cursor = cursor[keys[i]];
            }
            cursor[keys[keys.length - 1]] = value;
            return next;
        });
    };

    const persist = async (publish = false) => {
        if (publish && !allValid) {
            toast.error("Hay secciones incompletas. Revisá los iconos rojos.");
            return null;
        }
        const payload = buildPayload(form);
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
                window.history.replaceState(null, "", `/app/eventos/${data.id}/editar`);
            }
            if (publish) {
                if (!result.poster_url) {
                    toast.error("Subí un poster antes de publicar.");
                    return result;
                }
                setPublishing(true);
                await api.post(`/events/me/${result.id}/publish`);
                toast.success("Evento publicado");
                navigate(`/app/eventos/${result.id}`);
            } else {
                toast.success(eventId ? "Cambios guardados" : "Borrador creado");
            }
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

    const ensureEventId = async () => {
        if (eventId) return eventId;
        const r = await persist(false);
        return r?.id || null;
    };

    const uploadImage = async (file, kind) => {
        if (!file) return;
        if (file.type && !ALLOWED_MIME.includes(file.type)) {
            toast.error(`Formato no soportado: ${file.type}. Aceptamos JPG, PNG, WEBP o HEIC.`);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error("La imagen supera los 5MB. Reducí su peso e intentá de nuevo.");
            return;
        }
        const id = await ensureEventId();
        if (!id) return;
        const fd = new FormData();
        fd.append("file", file);
        setUploadingKind(kind);
        try {
            const { data } = await api.post(`/events/me/${id}/${kind}`, fd);
            if (kind === "poster") setPoster(data.poster_url);
            else if (kind === "banner") setBanner(data.banner_url);
            else if (kind === "gallery") setGallery(data.gallery_urls || []);
            return data;
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message || "No se pudo subir la imagen.");
            return null;
        } finally {
            setUploadingKind(null);
        }
    };

    const uploadImages = async (files, kind) => {
        const list = Array.from(files || []);
        if (list.length === 0) return;
        // Single-image fields take only the first file selected.
        if (kind !== "gallery") {
            const r = await uploadImage(list[0], kind);
            if (r) toast.success(kind === "poster" ? "Póster actualizado" : "Banner actualizado");
            return;
        }
        // Gallery — iterate, respect 10-image cap.
        const remaining = Math.max(0, 10 - (gallery?.length || 0));
        if (remaining === 0) {
            toast.error("Ya tenés el máximo de 10 imágenes en la galería.");
            return;
        }
        const toUpload = list.slice(0, remaining);
        let uploaded = 0;
        for (const f of toUpload) {
            // eslint-disable-next-line no-await-in-loop
            const r = await uploadImage(f, "gallery");
            if (r) uploaded += 1;
        }
        if (list.length > remaining) {
            toast.warning(
                `Subimos ${uploaded} de ${list.length}. Llegaste al límite de 10.`,
            );
        } else if (uploaded > 0) {
            toast.success(
                uploaded === 1
                    ? "Imagen agregada a la galería"
                    : `${uploaded} imágenes agregadas a la galería`,
            );
        }
    };

    const deleteGalleryAt = async (index) => {
        if (!eventId) return;
        try {
            const { data } = await api.delete(`/events/me/${eventId}/gallery/${index}`);
            setGallery(data.gallery_urls);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const reorderGallery = async (newOrder) => {
        if (!eventId) return;
        try {
            const { data } = await api.patch(
                `/events/me/${eventId}/gallery/reorder`,
                { order: newOrder },
            );
            setGallery(data.gallery_urls);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    // Keep ?tab= in sync when user manually switches tab — supports deep
    // linking and back-from-venue-creation flow without remounting the wizard.
    const handleTabChange = (next) => {
        setActiveStep(next);
        const params = new URLSearchParams(searchParams);
        params.set("tab", next);
        setSearchParams(params, { replace: true });
    };
    const idx = STEPS.findIndex((s) => s.id === activeStep);
    const goPrev = () => handleTabChange(STEPS[Math.max(0, idx - 1)].id);
    const goNext = () => handleTabChange(STEPS[Math.min(STEPS.length - 1, idx + 1)].id);

    return (
        <div className="space-y-5" data-testid="event-wizard">
            <Tabs value={activeStep} onValueChange={handleTabChange}>
                <TabsList
                    className="w-full overflow-x-auto justify-start gap-1 h-auto p-1 flex-wrap sm:flex-nowrap"
                    data-testid="wizard-tabs"
                >
                    {STEPS.map((s, i) => {
                        const st = stepStatus[s.id];
                        return (
                            <TabsTrigger
                                key={s.id}
                                value={s.id}
                                className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                                data-testid={`tab-${s.id}`}
                            >
                                <StepIcon status={st} />
                                <span className="text-xs">{i + 1}.</span>
                                {s.label}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>

                <TabsContent value="info" className="mt-4">
                    <SectionInfo form={form} update={update} disabled={lockCritical} />
                </TabsContent>
                <TabsContent value="venue_localidades" className="mt-4">
                    <SectionVenueLocalidades
                        form={form}
                        update={update}
                        disabled={lockCritical}
                        event={initial}
                        onEventUpdated={(e) => onSaved?.(e)}
                    />
                </TabsContent>
                <TabsContent value="media" className="mt-4">
                    <SectionMedia
                        poster={poster}
                        banner={banner}
                        gallery={gallery}
                        uploadingKind={uploadingKind}
                        onUpload={uploadImages}
                        onDeleteGallery={deleteGalleryAt}
                        onReorderGallery={reorderGallery}
                        eventId={eventId}
                    />
                </TabsContent>
                <TabsContent value="payments" className="mt-4">
                    <SectionPayments form={form} update={update} />
                </TabsContent>
                <TabsContent value="discounts" className="mt-4">
                    <SectionDiscounts form={form} update={update} venueLocalities={venueLocalities} />
                </TabsContent>
                <TabsContent value="access" className="mt-4">
                    <SectionAccess form={form} update={update} />
                </TabsContent>
            </Tabs>

            {/* Footer ─────────────────────────────────────── */}
            <div className="sticky bottom-2 z-10 flex flex-wrap justify-between gap-2 bg-background/90 backdrop-blur p-3 rounded-xl border">
                <Button variant="outline" onClick={goPrev} disabled={idx === 0}>
                    <ChevronLeft className="h-4 w-4 mr-1.5" />
                    Anterior
                </Button>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        onClick={() => persist(false)}
                        disabled={saving || publishing}
                        data-testid="wizard-save-draft"
                    >
                        {saving ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-1.5" />
                        )}
                        Guardar borrador
                    </Button>
                    {idx < STEPS.length - 1 ? (
                        <Button onClick={goNext} data-testid="wizard-next">
                            Siguiente
                            <ChevronRight className="h-4 w-4 ml-1.5" />
                        </Button>
                    ) : (
                        <Button
                            onClick={() => persist(true)}
                            disabled={saving || publishing}
                            className="bg-primary"
                            data-testid="wizard-publish"
                        >
                            {publishing ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4 mr-1.5" />
                            )}
                            Publicar ahora
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function evalStepStatus(form, poster) {
    const s = {};
    // Combined info: title required + dates valid.
    const titleOk = form.title?.length >= 2;
    const datesOk =
        form.starts_at && form.ends_at && new Date(form.ends_at) > new Date(form.starts_at);
    s.info = titleOk && datesOk ? "ok" : titleOk || form.title ? "warn" : "error";
    s.media = poster ? "ok" : "warn";
    // Venue/localidades is OK when:
    //  • organizer marked the event as "general" (no seats) AND has pricing/free, OR
    //  • a venue is linked (locality pricing handled via separate endpoint).
    s.venue_localidades = form.no_seating_mode
        ? form.pricing_type === "free" || form.base_price_dollars
            ? "ok"
            : "warn"
        : form.venue_id
        ? "ok"
        : "warn";
    s.payments = "ok";
    s.discounts = "ok";
    s.access = form.access_params.max_per_purchase > 0 ? "ok" : "warn";
    return s;
}

function buildPayload(form) {
    const sa = form.sales_start ? localInputToIso(form.sales_start) : null;
    const se = form.sales_end ? localInputToIso(form.sales_end) : null;
    return {
        title: form.title,
        description: form.description,
        short_description: form.short_description,
        category: form.category,
        venue_name: form.venue_name,
        venue_address: form.venue_address,
        venue_city: form.venue_city,
        venue_country: form.venue_country,
        starts_at: localInputToIso(form.starts_at),
        ends_at: localInputToIso(form.ends_at),
        sales_start: sa,
        sales_end: se,
        timezone: form.timezone,
        pricing_type: form.pricing_type,
        base_price_cents:
            form.pricing_type === "free"
                ? 0
                : Math.round(parseFloat(form.base_price_dollars || "0") * 100),
        currency: form.currency,
        capacity: form.unlimited_capacity || form.capacity === ""
            ? null
            : parseInt(form.capacity, 10),
        visibility: form.access_params?.visibility || form.visibility,
        payment_methods: form.payment_methods,
        discounts: form.discounts,
        access_params: form.access_params,
    };
}

function StepIcon({ status }) {
    if (status === "ok")
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    if (status === "warn")
        return <Circle className="h-3.5 w-3.5 text-amber-500 fill-amber-500/30" />;
    if (status === "error")
        return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
    return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ── Section: Info (general + dates + sales window) ──────────────────────────
function SectionInfo({ form, update, disabled }) {
    return (
        <div className="space-y-5">
            {/* Datos generales */}
            <div className="space-y-4 rounded-xl border p-5 bg-card">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Datos del evento
                </h3>
                <Field label="Título del evento *" testId="wiz-title">
                    <Input
                        value={form.title}
                        onChange={(e) => update("title", e.target.value)}
                        maxLength={140}
                        disabled={disabled}
                        placeholder="Ej: Concierto Acústico"
                        data-testid="event-title-input"
                    />
                </Field>
                <Field label="Descripción corta (160 chars máx)">
                    <Textarea
                        value={form.short_description}
                        onChange={(e) => update("short_description", e.target.value)}
                        maxLength={160}
                        rows={2}
                        data-testid="wiz-short-input"
                    />
                </Field>
                <Field label="Descripción completa">
                    <Textarea
                        value={form.description}
                        onChange={(e) => update("description", e.target.value)}
                        maxLength={8000}
                        rows={6}
                        data-testid="wiz-desc-input"
                    />
                </Field>
                <Field label="Categoría">
                    <Select value={form.category} onValueChange={(v) => update("category", v)}>
                        <SelectTrigger data-testid="wiz-category">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {EVENT_CATEGORIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>
                                    {c.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            {/* Fechas */}
            <div className="space-y-4 rounded-xl border p-5 bg-card">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Cuándo
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Inicio *">
                        <Input
                            type="datetime-local"
                            value={form.starts_at}
                            onChange={(e) => update("starts_at", e.target.value)}
                            data-testid="wiz-starts"
                        />
                    </Field>
                    <Field label="Fin *">
                        <Input
                            type="datetime-local"
                            value={form.ends_at}
                            onChange={(e) => update("ends_at", e.target.value)}
                            data-testid="wiz-ends"
                        />
                    </Field>
                </div>
                <Field label="Zona horaria">
                    <Select value={form.timezone} onValueChange={(v) => update("timezone", v)}>
                        <SelectTrigger data-testid="wiz-tz">
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
                </Field>
                <div className="rounded-lg bg-secondary/40 border p-4 space-y-3">
                    <div className="text-sm font-medium flex items-center gap-2">
                        <Info className="h-4 w-4 text-primary" />
                        Ventana de venta
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Cuándo se habilita y cierra la compra de tickets. Si dejás vacíos,
                        abre ya y cierra al iniciar el evento.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Inicio venta">
                            <Input
                                type="datetime-local"
                                value={form.sales_start}
                                onChange={(e) => update("sales_start", e.target.value)}
                                data-testid="wiz-sales-start"
                            />
                        </Field>
                        <Field label="Fin venta">
                            <Input
                                type="datetime-local"
                                value={form.sales_end}
                                onChange={(e) => update("sales_end", e.target.value)}
                                data-testid="wiz-sales-end"
                            />
                        </Field>
                    </div>
                </div>
                <DisabledToggle
                    label="Evento multi-función"
                    helper="Múltiples fechas para el mismo evento"
                    tooltip="Próximamente — Fase 8"
                />
            </div>
        </div>
    );
}

// ── Section: General (legacy alias kept for reference) ──────────────────────
// SectionGeneral and SectionDates were merged into SectionInfo above.

// ── Section: Media ──────────────────────────────────────────────────────────
function SectionMedia({
    poster,
    banner,
    gallery,
    uploadingKind,
    onUpload,
    onDeleteGallery,
    onReorderGallery,
}) {
    const move = (from, to) => {
        if (to < 0 || to >= gallery.length) return;
        const order = gallery.map((_, i) => i);
        [order[from], order[to]] = [order[to], order[from]];
        onReorderGallery(order);
    };
    return (
        <div className="space-y-5" data-testid="section-media">
            {/* — Poster — */}
            <div className="rounded-xl border p-5 bg-card">
                <header className="mb-3">
                    <div className="flex items-center gap-2 text-base font-semibold">
                        <ImageIcon className="h-5 w-5 text-indigo-600" />
                        Póster del evento <span className="text-red-500">*</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        Imagen <strong>cuadrada</strong>: aparece en la grilla del
                        microsite y como portada del ticket PDF. Recomendado{" "}
                        <strong>1080 × 1080 px</strong>. JPG/PNG/WEBP/HEIC · 5 MB
                        máx.
                    </p>
                </header>
                <div className="max-w-xs">
                    <Dropzone
                        label=""
                        currentUrl={assetUrl(poster)}
                        onUpload={(f) => onUpload(f, "poster")}
                        uploading={uploadingKind === "poster"}
                        testid="wiz-poster"
                        aspect="square"
                    />
                </div>
            </div>

            {/* — Banner — */}
            <div className="rounded-xl border p-5 bg-card">
                <header className="mb-3">
                    <div className="flex items-center gap-2 text-base font-semibold">
                        <ImageIcon className="h-5 w-5 text-amber-600" />
                        Banner del evento <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        Imagen <strong>wide 16:9</strong>: se muestra como header
                        en la página pública del evento. Recomendado{" "}
                        <strong>1920 × 1080 px</strong>. JPG/PNG/WEBP/HEIC · 5 MB
                        máx.
                    </p>
                </header>
                <div className="max-w-2xl">
                    <Dropzone
                        label=""
                        currentUrl={assetUrl(banner)}
                        onUpload={(f) => onUpload(f, "banner")}
                        uploading={uploadingKind === "banner"}
                        testid="wiz-banner"
                        aspect="video"
                    />
                </div>
            </div>

            {/* — Gallery — */}
            <div className="rounded-xl border p-5 bg-card">
                <header className="mb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-base font-semibold">
                            <ImageIcon className="h-5 w-5 text-emerald-600" />
                            Galería <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                        </div>
                        <span className="text-xs text-muted-foreground" data-testid="wiz-gallery-counter">
                            {gallery.length} / 10
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        Hasta <strong>10 imágenes</strong> adicionales que se
                        muestran en la página pública. Podés arrastrar varias a
                        la vez y reordenarlas. JPG/PNG/WEBP/HEIC · 5 MB cada una.
                    </p>
                </header>
                <div
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
                    data-testid="wiz-gallery"
                >
                    {gallery.map((url, i) => (
                        <div
                            key={`${url}-${i}`}
                            className="relative rounded-lg overflow-hidden border group bg-secondary"
                            data-testid={`gallery-item-${i}`}
                        >
                            <img
                                src={assetUrl(url)}
                                alt={`gallery-${i + 1}`}
                                className="w-full aspect-square object-cover"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-end justify-between p-1.5">
                                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                                    <button
                                        type="button"
                                        className="bg-white/90 rounded p-1 text-xs disabled:opacity-50"
                                        onClick={() => move(i, i - 1)}
                                        disabled={i === 0}
                                        data-testid={`gallery-up-${i}`}
                                        title="Mover antes"
                                    >
                                        ↑
                                    </button>
                                    <button
                                        type="button"
                                        className="bg-white/90 rounded p-1 text-xs disabled:opacity-50"
                                        onClick={() => move(i, i + 1)}
                                        disabled={i === gallery.length - 1}
                                        data-testid={`gallery-down-${i}`}
                                        title="Mover después"
                                    >
                                        ↓
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className="opacity-0 group-hover:opacity-100 bg-red-600 text-white rounded p-1"
                                    onClick={() => onDeleteGallery(i)}
                                    data-testid={`gallery-delete-${i}`}
                                    title="Eliminar"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {gallery.length < 10 && (
                        <Dropzone
                            label=""
                            currentUrl={null}
                            onUpload={(f) => onUpload(f, "gallery")}
                            uploading={uploadingKind === "gallery"}
                            testid="wiz-gallery-add"
                            aspect="square"
                            compact
                            multiple
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Section: Locations ──────────────────────────────────────────────────────
// ── Section: Venue y localidades (combined Phase 9.5 tab) ───────────────────
function SectionVenueLocalidades({ form, update, disabled, event, onEventUpdated }) {
    const hasVenue = !!event?.venue_id;
    const noSeating = form.no_seating_mode && !hasVenue;
    return (
        <div className="space-y-4" data-testid="section-venue-localidades">
            {/* Toggle: evento sin asientos */}
            <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                <Switch
                    checked={noSeating}
                    onCheckedChange={(v) => {
                        if (v && hasVenue) {
                            toast.error(
                                "Para cambiar a evento general primero desvinculá el venue actual.",
                            );
                            return;
                        }
                        update("no_seating_mode", v);
                    }}
                    disabled={disabled || hasVenue}
                    data-testid="wiz-no-seating-toggle"
                />
                <div className="text-sm">
                    <p className="font-medium leading-tight">
                        Este es un evento sin asientos (general)
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Activá esto si tu evento no usa un mapa de asientos numerados (ej:
                        feria abierta, conferencia de pie). Mostramos un precio base único
                        y la capacidad total.
                    </p>
                </div>
            </div>

            {noSeating ? (
                /* Legacy general mode */
                <div className="space-y-3 rounded-xl border p-5 bg-card">
                    <h4 className="font-semibold text-sm">Datos del lugar</h4>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Nombre del lugar">
                            <Input
                                value={form.venue_name}
                                onChange={(e) => update("venue_name", e.target.value)}
                                data-testid="wiz-venue-name"
                            />
                        </Field>
                        <Field label="Ciudad">
                            <Input
                                value={form.venue_city}
                                onChange={(e) => update("venue_city", e.target.value)}
                                data-testid="wiz-venue-city"
                            />
                        </Field>
                    </div>
                    <Field label="Dirección">
                        <Input
                            value={form.venue_address}
                            onChange={(e) => update("venue_address", e.target.value)}
                            data-testid="wiz-venue-address"
                        />
                    </Field>

                    <div className="rounded-lg border overflow-hidden">
                        <div className="grid grid-cols-3 bg-secondary/40 px-3 py-2 text-xs font-medium uppercase">
                            <div>Tipo</div>
                            <div>Precio</div>
                            <div>Capacidad</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 px-3 py-3 items-center">
                            <Select
                                value={form.pricing_type}
                                onValueChange={(v) => update("pricing_type", v)}
                                disabled={disabled}
                            >
                                <SelectTrigger data-testid="wiz-pricing-type" className="h-8">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="free">Gratis</SelectItem>
                                    <SelectItem value="paid">Pago</SelectItem>
                                    <SelectItem value="donation">Donación</SelectItem>
                                </SelectContent>
                            </Select>
                            <div>
                                {form.pricing_type === "free" ? (
                                    <span className="text-sm text-muted-foreground">Sin costo</span>
                                ) : (
                                    <div className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="pl-6 h-8"
                                            value={form.base_price_dollars}
                                            onChange={(e) => update("base_price_dollars", e.target.value)}
                                            disabled={disabled}
                                            data-testid="wiz-price"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    min="0"
                                    className="h-8"
                                    value={form.unlimited_capacity ? "" : form.capacity}
                                    onChange={(e) => update("capacity", e.target.value)}
                                    disabled={form.unlimited_capacity}
                                    placeholder={form.unlimited_capacity ? "Sin límite" : "ej: 100"}
                                    data-testid="wiz-capacity"
                                />
                                <Switch
                                    checked={form.unlimited_capacity}
                                    onCheckedChange={(v) => update("unlimited_capacity", v)}
                                    data-testid="wiz-unlimited"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            ) : event?.id ? (
                /* Seated mode with venue */
                <EventVenueSection
                    event={event}
                    disabled={disabled}
                    onUpdated={onEventUpdated}
                />
            ) : (
                <div className="rounded-xl border bg-amber-50 border-amber-200 p-4 text-sm text-amber-900">
                    <Info className="h-4 w-4 inline mr-1" />
                    Guardá el evento (tab "Información general") antes de vincular un venue.
                </div>
            )}
        </div>
    );
}

// ── Section: Payments ───────────────────────────────────────────────────────
function SectionPayments({ form, update }) {
    if (form.pricing_type === "free") {
        return (
            <div
                className="rounded-xl border p-8 bg-card text-center text-muted-foreground"
                data-testid="section-payments"
            >
                <Info className="h-6 w-6 mx-auto mb-2" />
                Este evento es gratuito. No requiere métodos de pago.
            </div>
        );
    }
    const pm = form.payment_methods;
    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="section-payments">
            {/* Stripe */}
            <PaymentRow
                title="Tarjeta de crédito/débito (Stripe)"
                description="Pago automático con confirmación inmediata. No se puede desactivar."
                checked
                disabled
                testid="pay-stripe"
            />

            {/* Transfer */}
            <PaymentRow
                title="Transferencia bancaria"
                description="El comprador transfiere y vos confirmás manualmente desde el panel."
                checked={pm.transfer.enabled}
                onChange={(v) => update("payment_methods.transfer.enabled", v)}
                testid="pay-transfer"
            >
                {pm.transfer.enabled && (
                    <div className="space-y-3 pt-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <Field label="Banco">
                                <Input
                                    value={pm.transfer.bank_name}
                                    onChange={(e) =>
                                        update("payment_methods.transfer.bank_name", e.target.value)
                                    }
                                    data-testid="pay-transfer-bank"
                                />
                            </Field>
                            <Field label="Número de cuenta">
                                <Input
                                    value={pm.transfer.account_number}
                                    onChange={(e) =>
                                        update(
                                            "payment_methods.transfer.account_number",
                                            e.target.value,
                                        )
                                    }
                                    data-testid="pay-transfer-acc"
                                />
                            </Field>
                        </div>
                        <Field label="Titular de la cuenta">
                            <Input
                                value={pm.transfer.account_holder}
                                onChange={(e) =>
                                    update(
                                        "payment_methods.transfer.account_holder",
                                        e.target.value,
                                    )
                                }
                                data-testid="pay-transfer-holder"
                            />
                        </Field>
                        <Field label="Instrucciones (visible para el comprador)">
                            <Textarea
                                value={pm.transfer.instructions}
                                onChange={(e) =>
                                    update(
                                        "payment_methods.transfer.instructions",
                                        e.target.value,
                                    )
                                }
                                rows={3}
                                placeholder="Ej: Adjuntá el comprobante al WhatsApp +593..."
                                data-testid="pay-transfer-inst"
                            />
                        </Field>
                    </div>
                )}
            </PaymentRow>

            {/* Cash */}
            <PaymentRow
                title="Pago en efectivo"
                description="Pago en persona. Tickets se entregan al confirmar."
                checked={pm.cash.enabled}
                onChange={(v) => update("payment_methods.cash.enabled", v)}
                testid="pay-cash"
            >
                {pm.cash.enabled && (
                    <div className="space-y-3 pt-3">
                        <Field label="Lugar / punto de pago">
                            <Input
                                value={pm.cash.location}
                                onChange={(e) =>
                                    update("payment_methods.cash.location", e.target.value)
                                }
                                data-testid="pay-cash-location"
                            />
                        </Field>
                        <Field label="Horarios">
                            <Input
                                value={pm.cash.schedule}
                                onChange={(e) =>
                                    update("payment_methods.cash.schedule", e.target.value)
                                }
                                placeholder="Lun-Vie 9:00-18:00"
                                data-testid="pay-cash-schedule"
                            />
                        </Field>
                        <Field label="Contacto">
                            <Input
                                value={pm.cash.contact}
                                onChange={(e) =>
                                    update("payment_methods.cash.contact", e.target.value)
                                }
                                placeholder="+593..."
                                data-testid="pay-cash-contact"
                            />
                        </Field>
                    </div>
                )}
            </PaymentRow>
        </div>
    );
}

function PaymentRow({ title, description, checked, onChange, disabled, testid, children }) {
    return (
        <div className="rounded-lg border p-4" data-testid={testid}>
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                    <div className="font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <Switch
                    checked={checked}
                    onCheckedChange={onChange}
                    disabled={disabled}
                    data-testid={`${testid}-switch`}
                />
            </div>
            {children}
        </div>
    );
}

// ── Section: Discounts ──────────────────────────────────────────────────────
function SectionDiscounts({ form, update, venueLocalities = [] }) {
    const d = form.discounts;
    return (
        <div className="space-y-4" data-testid="section-discounts">
            <div className="rounded-lg border p-4 bg-card">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="font-medium">
                            Descuento por ley de discapacidad (Ecuador)
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Aplica 50% a quienes carguen documento de discapacidad. La
                            verificación se implementará en Fase 3b.
                        </div>
                    </div>
                    <Switch
                        checked={d.disability_law.enabled}
                        onCheckedChange={(v) =>
                            update("discounts.disability_law.enabled", v)
                        }
                        data-testid="disc-disability"
                    />
                </div>
            </div>

            <div className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="font-medium">Descuento por presale</div>
                        <div className="text-xs text-muted-foreground">
                            Porcentaje aplicado hasta la fecha límite.
                        </div>
                    </div>
                    <Switch
                        checked={d.presale.enabled}
                        onCheckedChange={(v) => update("discounts.presale.enabled", v)}
                        data-testid="disc-presale"
                    />
                </div>
                {d.presale.enabled && (
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                        <Field label="Porcentaje %">
                            <Input
                                type="number"
                                min="1"
                                max="80"
                                value={d.presale.percent}
                                onChange={(e) =>
                                    update(
                                        "discounts.presale.percent",
                                        parseInt(e.target.value || "0", 10),
                                    )
                                }
                                data-testid="disc-presale-percent"
                            />
                        </Field>
                        <Field label="Termina">
                            <Input
                                type="datetime-local"
                                value={
                                    d.presale.ends_at
                                        ? isoToLocalInput(d.presale.ends_at)
                                        : ""
                                }
                                onChange={(e) =>
                                    update(
                                        "discounts.presale.ends_at",
                                        e.target.value ? localInputToIso(e.target.value) : null,
                                    )
                                }
                                data-testid="disc-presale-ends"
                            />
                        </Field>
                    </div>
                )}
            </div>

            <DiscountRulesPanel
                rules={d.rules || []}
                onChange={(next) => update("discounts.rules", next)}
                localities={venueLocalities}
            />
        </div>
    );
}

// ── Section: Access ─────────────────────────────────────────────────────────
function SectionAccess({ form, update }) {
    const ap = form.access_params;
    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="section-access">
            <Field label="Visibilidad">
                <Select
                    value={ap.visibility}
                    onValueChange={(v) => {
                        update("access_params.visibility", v);
                        update("visibility", v);
                    }}
                >
                    <SelectTrigger data-testid="access-visibility">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="public">Público — aparece en tu microsite</SelectItem>
                        <SelectItem value="private">Privado — solo con link directo</SelectItem>
                    </SelectContent>
                </Select>
            </Field>

            <Field label="Tipo de acceso">
                <Select
                    value={ap.access_type}
                    onValueChange={(v) => update("access_params.access_type", v)}
                >
                    <SelectTrigger data-testid="access-type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="open">Abierto · cualquiera puede comprar</SelectItem>
                        <SelectItem value="link_only">
                            Solo con link · no aparece en listados
                        </SelectItem>
                        <SelectItem value="verified_list" disabled>
                            Lista verificada (próximamente)
                        </SelectItem>
                        <SelectItem value="access_code" disabled>
                            Código de acceso (próximamente)
                        </SelectItem>
                    </SelectContent>
                </Select>
            </Field>

            <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Máx. tickets por compra">
                    <Input
                        type="number"
                        min="1"
                        max="100"
                        value={ap.max_per_purchase}
                        onChange={(e) =>
                            update(
                                "access_params.max_per_purchase",
                                parseInt(e.target.value || "1", 10),
                            )
                        }
                        data-testid="access-max-purchase"
                    />
                </Field>
                <Field label="Máx. por persona / email (opcional)">
                    <Input
                        type="number"
                        min="1"
                        value={ap.max_per_email || ""}
                        onChange={(e) =>
                            update(
                                "access_params.max_per_email",
                                e.target.value ? parseInt(e.target.value, 10) : null,
                            )
                        }
                        placeholder="Sin límite"
                        data-testid="access-max-email"
                    />
                </Field>
            </div>

            <Field label="Reembolsos hasta X horas antes del evento">
                <Input
                    type="number"
                    min="0"
                    value={ap.refund_window_hours}
                    onChange={(e) =>
                        update(
                            "access_params.refund_window_hours",
                            parseInt(e.target.value || "0", 10),
                        )
                    }
                    data-testid="access-refund-window"
                />
            </Field>

            <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="text-sm">
                    <div className="font-medium">Mostrar nombre del comprador en el ticket</div>
                    <div className="text-xs text-muted-foreground">
                        Útil para tickets nominativos
                    </div>
                </div>
                <Switch
                    checked={ap.show_buyer_name_on_ticket}
                    onCheckedChange={(v) =>
                        update("access_params.show_buyer_name_on_ticket", v)
                    }
                    data-testid="access-show-name"
                />
            </div>
        </div>
    );
}

// ── Small atoms ─────────────────────────────────────────────────────────────
function Field({ label, children, testId }) {
    return (
        <div className="space-y-1.5" data-testid={testId}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

function DisabledToggle({ label, helper, tooltip }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 opacity-70">
                        <div className="text-sm">
                            <div className="font-medium flex items-center gap-2">
                                {label}
                                <Lock className="h-3 w-3" />
                            </div>
                            <div className="text-xs text-muted-foreground">{helper}</div>
                        </div>
                        <Switch checked={false} disabled />
                    </div>
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

function Dropzone({
    label,
    currentUrl,
    onUpload,
    testid,
    aspect = "square",
    compact = false,
    multiple = false,
    uploading = false,
}) {
    const id = `${testid}-input`;
    const ratio = aspect === "video" ? "aspect-video" : "aspect-square";
    return (
        <div className="space-y-1.5">
            {label && <Label>{label}</Label>}
            <label
                htmlFor={id}
                className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer transition ${ratio} ${
                    compact ? "min-h-0" : ""
                } ${
                    uploading
                        ? "border-primary bg-primary/5 cursor-wait"
                        : "hover:border-primary hover:bg-primary/5"
                }`}
                data-testid={testid}
                aria-busy={uploading}
            >
                {currentUrl ? (
                    <img
                        src={currentUrl}
                        alt={label || "preview"}
                        className="max-h-full max-w-full rounded object-contain"
                    />
                ) : (
                    <>
                        <ImageIcon className="h-7 w-7 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground text-center px-2">
                            {multiple ? "Click o arrastrá (varias)" : "Click o arrastrá"}
                        </span>
                    </>
                )}
                {uploading && (
                    <div
                        className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px] rounded-xl"
                        data-testid={`${testid}-spinner`}
                    >
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                )}
                <input
                    id={id}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/*"
                    multiple={multiple}
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                        const files = e.target.files;
                        e.target.value = "";
                        onUpload(files);
                    }}
                />
            </label>
        </div>
    );
}
