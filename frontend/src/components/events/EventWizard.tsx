/**
 * EventWizard — Phase 9.6.
 *
 * 6 sections (horizontal tabs):
 *  1. Información general — Datos · Cuándo (duration + sales presets) · Dónde (venue selector)
 *  2. Venue y localidades — pricing tables for the linked venue (or hint to pick one)
 *  3. Media — illustrated mockups + uploads (poster · banner · gallery)
 *  4. Formas de pago
 *  5. Descuentos
 *  6. Accesos y parámetros
 *
 * Used in both create (/app/eventos/nuevo) and edit (/app/eventos/:id/editar).
 *
 * Phase 9.6 changes:
 *  • Sales-window presets (start/end) and event duration are picked from dropdowns
 *    rather than raw datetime-local inputs. Internally we still persist
 *    `starts_at`/`ends_at`/`sales_start`/`sales_end`; the preset key is stored
 *    alongside so the form re-opens on the option the organizer chose.
 *  • Venue selection moved from the "Venue y localidades" tab into the "Dónde"
 *    sub-section of Información general. Linked-venue updates from PUT /venue
 *    propagate through `setCurrentEvent`, which fixes the previous bug where
 *    selecting a venue silently failed because `onSaved` was undefined.
 *  • Media tab now has inline SVG mockups above each dropzone so the organizer
 *    sees exactly where each image surfaces.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import EventVenueSection from "@/components/events/EventVenueSection";
import DiscountRulesPanel from "@/components/events/DiscountRulesPanel";
import EventContentPanel from "@/components/events/EventContentPanel";
import TicketTypesPanel from "@/components/events/TicketTypesPanel";
import EventFunctionsPanel from "@/components/events/EventFunctionsPanel";
import SeasonPassPanel from "@/components/events/SeasonPassPanel";
import GuestListPanel from "@/components/events/GuestListPanel";
import TicketDesignPanel from "@/components/events/TicketDesignPanel";
import AccessCodesPanel from "@/components/events/AccessCodesPanel";
import { capacityByLocality } from "@/lib/venues";
import ImageDropzone from "@/components/ui/ImageDropzone";
import SortableGallery from "@/components/ui/SortableGallery";
import { defaultEventContent, normalizeEventContent } from "@/lib/eventContent";
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
    ImageIcon,
    Trash2,
    Info,
    MapPin,
    Building2,
    PlusCircle,
    LayoutTemplate,
    ArrowRight,
    Unlink,
    Eye,
    CalendarClock,
    Plus,
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
import api, { formatApiError } from "@/lib/api";
import { venuesApi } from "@/lib/venues";
import { assetUrl } from "@/lib/microsite";
import {
    EVENT_CATEGORIES,
    PRICING_LABELS,
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
    { id: "content", label: "Contenido" },
    { id: "venue_localidades", label: "Venue y localidades" },
    { id: "tipos_ticket", label: "Tipos de ticket" },
    { id: "funciones", label: "Funciones" },
    { id: "abono", label: "Abono de Temporada" },
    { id: "media", label: "Media" },
    { id: "ticket_design", label: "Diseño de ticket" },
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
        rules: [],
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
            category: "other",
            venue_name: "",
            venue_address: "",
            venue_city: "Quito",
            venue_country: "Ecuador",
            starts_at: "",
            // ends_at is now computed from starts_at + duration_preset on submit
            ends_at: "",
            timezone: "America/Guayaquil",
            // Sales-window stored as ISO when "custom"; otherwise derived from presets.
            sales_start_custom: "",
            sales_end_custom: "",
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
            raffle_enabled: false,
            custom_questions: [],
            ticket_design: null,
            courtesy_ticket_design: null,
            // ON by default => event uses numbered seating with a venue.
            // (Internally `no_seating_mode === true` means "general / no seats".)
            no_seating_mode: false,
            venue_id: null,
            payment_methods: defaultPayments(),
            discounts: defaultDiscounts(),
            access_params: defaultAccessParams(),
            content: defaultEventContent(),
            ticket_delivery_mode: "al_momento",
            ticket_delivery_hours: "",
            ticket_delivery_at: "",
            multi_function_mode: "function",
        };
    }
    const startsIso = d.starts_at || null;
    const endsIso = d.ends_at || null;
    const durInfer = inferDurationPreset(startsIso, endsIso);
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
        sales_start_custom: d.sales_start ? isoToLocalInput(d.sales_start) : "",
        sales_end_custom: d.sales_end ? isoToLocalInput(d.sales_end) : "",
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
        raffle_enabled: !!d.raffle_enabled,
        custom_questions: d.custom_questions || [],
        ticket_design: d.ticket_design || null,
        courtesy_ticket_design: d.courtesy_ticket_design || null,
        // If event has a venue_id, force numbered mode regardless of legacy flags.
        no_seating_mode: !d.venue_id && !!d.venue_name && d.pricing_type !== undefined
            ? !d.venue_id // legacy events with venue_name but no venue_id default to general
            : false,
        venue_id: d.venue_id || null,
        payment_methods: d.payment_methods || defaultPayments(),
        discounts: d.discounts || defaultDiscounts(),
        access_params: d.access_params || defaultAccessParams(),
        content: normalizeEventContent(d.content),
        ticket_delivery_mode: d.ticket_delivery_mode || "al_momento",
        ticket_delivery_hours: d.ticket_delivery_hours != null ? String(d.ticket_delivery_hours) : "",
        ticket_delivery_at: d.ticket_delivery_at ? isoToLocalInput(d.ticket_delivery_at) : "",
        multi_function_mode: d.multi_function_mode || "function",
    };
}

export default function EventWizard({ initial = null, mode = "create" }) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [form, setForm] = useState(() => makeInitial(initial));
    // `currentEvent` is the live event document mirrored from the backend after
    // each save / venue link. It feeds the venue picker + the pricing panel.
    const [currentEvent, setCurrentEvent] = useState(initial || null);
    const [venuesList, setVenuesList] = useState([]);
    const [venueLocalities, setVenueLocalities] = useState([]);

    // Pull the organizer's published venues once for the dropdown picker.
    useEffect(() => {
        let alive = true;
        venuesApi
            .list({ status: "published" })
            .then((d) => {
                if (!alive) return;
                setVenuesList((d.items || []).filter((v) => v.status === "published"));
            })
            .catch(() => alive && setVenuesList([]));
        return () => {
            alive = false;
        };
    }, []);

    // Phase 9.5 — fetch venue localities so the discounts panel (and ticket
    // types) can offer a locality select with the event's actual configured
    // price (not just the venue template's default).
    useEffect(() => {
        if (!currentEvent?.venue_id) {
            setVenueLocalities([]);
            return;
        }
        api.get(`/venues/me/${currentEvent.venue_id}`)
            .then((r) => {
                const elements = r.data.elements || [];
                const elementsLocs = new Set();
                for (const el of elements) {
                    if (el.locality_id) elementsLocs.add(el.locality_id);
                }
                const pricingByLocality = {};
                for (const lp of currentEvent.locality_pricing || []) {
                    pricingByLocality[lp.locality_id] = lp;
                }
                setVenueLocalities(
                    (r.data.localities || [])
                        .filter((l) => elementsLocs.has(l.id))
                        .map((l) => {
                            const lp = pricingByLocality[l.id];
                            return {
                                ...l,
                                price_cents: lp?.price_cents ?? l.default_price_cents ?? 0,
                                max_tickets_per_purchase: lp?.max_tickets_per_purchase ?? null,
                                capacity: capacityByLocality(elements, l.id),
                            };
                        }),
                );
            })
            .catch(() => setVenueLocalities([]));
    }, [currentEvent?.venue_id, currentEvent?.locality_pricing]);

    // For numbered events, `venue_name` is set server-side from the linked venue
    // rather than typed by the organizer. Whenever `currentEvent` refreshes
    // (picking a venue, etc.) keep the form's copy in sync so a later "Guardar
    // borrador" never overwrites the backend value with stale form state —
    // this is what caused venue_name to silently reset to empty after linking.
    useEffect(() => {
        if (!currentEvent?.venue_id) return;
        update("venue_name", currentEvent.venue_name || "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentEvent?.venue_name, currentEvent?.venue_id]);

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
    const [uploadingKind, setUploadingKind] = useState(null);

    useEffect(() => {
        if (initial) {
            setForm(makeInitial(initial));
            setCurrentEvent(initial);
            setPoster(initial.poster_url || null);
            setBanner(initial.banner_url || null);
            setGallery(initial.gallery_urls || []);
            setEventId(initial.id);
        }
    }, [initial]);

    const lockCritical = mode === "edit" && (initial?.tickets_sold || 0) > 0;

    const stepStatus = useMemo(
        () => evalStepStatus(form, poster, currentEvent),
        [form, poster, currentEvent],
    );
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
        if (!payload.starts_at) {
            toast.error("Definí la fecha y hora de inicio.");
            return null;
        }
        if (!payload.ends_at) {
            toast.error("Elegí la duración del evento.");
            return null;
        }
        if (new Date(payload.ends_at) <= new Date(payload.starts_at)) {
            toast.error("La duración debe ser mayor a cero.");
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
            setCurrentEvent(result);
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
        if (kind !== "gallery") {
            const r = await uploadImage(list[0], kind);
            if (r) toast.success(kind === "poster" ? "Póster actualizado" : "Banner actualizado");
            return;
        }
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
                    <SectionInfo
                        form={form}
                        update={update}
                        disabled={lockCritical}
                        venues={venuesList}
                        currentEvent={currentEvent}
                        onEventUpdated={setCurrentEvent}
                        ensureEventId={ensureEventId}
                        onJumpToFunctions={() => handleTabChange("funciones")}
                    />
                </TabsContent>
                <TabsContent value="content" className="mt-4">
                    <EventContentPanel
                        content={form.content}
                        update={update}
                        disabled={lockCritical}
                    />
                </TabsContent>
                <TabsContent value="venue_localidades" className="mt-4">
                    <SectionVenueLocalidades
                        form={form}
                        update={update}
                        disabled={lockCritical}
                        event={currentEvent}
                        onEventUpdated={setCurrentEvent}
                        onJumpToInfo={() => handleTabChange("info")}
                    />
                </TabsContent>
                <TabsContent value="tipos_ticket" className="mt-4">
                    <TicketTypesPanel
                        eventId={eventId}
                        localities={venueLocalities}
                        eventSaleWindow={{
                            sale_start: currentEvent?.sales_start || null,
                            sale_end: currentEvent?.sales_end || null,
                        }}
                    />
                </TabsContent>
                <TabsContent value="funciones" className="mt-4">
                    <EventFunctionsPanel
                        eventId={eventId}
                        localities={venueLocalities}
                        mode={form.multi_function_mode}
                    />
                </TabsContent>
                <TabsContent value="abono" className="mt-4">
                    <SeasonPassPanel eventId={eventId} hasVenue={!!(form.venue_id || currentEvent?.venue_id)} />
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
                <TabsContent value="ticket_design" className="mt-4">
                    <SectionTicketDesign form={form} update={update} eventId={eventId} />
                </TabsContent>
                <TabsContent value="payments" className="mt-4">
                    <SectionPayments form={form} update={update} />
                </TabsContent>
                <TabsContent value="discounts" className="mt-4">
                    <SectionDiscounts
                        form={form}
                        update={update}
                        venueLocalities={venueLocalities}
                        eventId={eventId}
                    />
                </TabsContent>
                <TabsContent value="access" className="mt-4">
                    <SectionAccess form={form} update={update} eventId={eventId} />
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
function evalStepStatus(form, poster, currentEvent) {
    const s: Record<string, string> = {};
    const titleOk = form.title?.length >= 2;
    const startsOk = !!form.starts_at;
    // Duration is "ok" if a preset other than custom is picked, or custom with positive minutes.
    const durationOk = form.duration_preset && form.duration_preset !== "custom"
        ? true
        : Number(form.duration_minutes_custom || 0) > 0;
    // Venue picked OR general mode with required fields.
    const whereOk = form.no_seating_mode
        ? !!form.venue_name
        : !!(form.venue_id || currentEvent?.venue_id);
    s.info = titleOk && startsOk && durationOk && whereOk ? "ok" : titleOk ? "warn" : "error";
    s.content = "ok";
    s.media = poster ? "ok" : "warn";
    s.venue_localidades = form.no_seating_mode
        ? form.pricing_type === "free" || form.base_price_dollars
            ? "ok"
            : "warn"
        : form.venue_id || currentEvent?.venue_id
        ? "ok"
        : "warn";
    s.payments = "ok";
    s.discounts = "ok";
    s.access = form.access_params.max_per_purchase > 0 ? "ok" : "warn";
    return s;
}

function buildPayload(form) {
    const startsIso = form.starts_at ? localInputToIso(form.starts_at) : null;
    const endsIso = startsIso
        ? computeEndsAt(
              startsIso,
              form.duration_preset,
              Number(form.duration_minutes_custom || 0),
          )
        : null;
    const salesStart = computeSalesStart(
        startsIso,
        form.sales_window_preset_start,
        form.sales_start_custom ? localInputToIso(form.sales_start_custom) : null,
    );
    const salesEnd = computeSalesEnd(
        startsIso,
        form.sales_window_preset_end,
        form.sales_end_custom ? localInputToIso(form.sales_end_custom) : null,
    );
    return {
        title: form.title,
        description: form.description,
        short_description: form.short_description,
        category: form.category,
        venue_name: form.venue_name,
        venue_address: form.venue_address,
        venue_city: form.venue_city,
        venue_country: form.venue_country,
        starts_at: startsIso,
        ends_at: endsIso,
        sales_start: salesStart,
        sales_end: salesEnd,
        timezone: form.timezone,
        duration_preset: form.duration_preset,
        sales_window_preset_start: form.sales_window_preset_start,
        sales_window_preset_end: form.sales_window_preset_end,
        pricing_type: form.pricing_type,
        base_price_cents:
            form.pricing_type === "free"
                ? 0
                : Math.round(parseFloat(form.base_price_dollars || "0") * 100),
        currency: form.currency,
        capacity:
            form.unlimited_capacity || form.capacity === ""
                ? null
                : parseInt(form.capacity, 10),
        visibility: form.access_params?.visibility || form.visibility,
        raffle_enabled: form.pricing_type === "donation" ? !!form.raffle_enabled : false,
        custom_questions: (form.custom_questions || []).filter((q) => q.label?.trim()),
        ticket_design: form.ticket_design,
        courtesy_ticket_design: form.courtesy_ticket_design,
        payment_methods: form.payment_methods,
        discounts: form.discounts,
        access_params: form.access_params,
        content: form.content,
        ticket_delivery_mode: form.ticket_delivery_mode || "al_momento",
        ticket_delivery_hours:
            form.ticket_delivery_mode === "horas_antes" && form.ticket_delivery_hours
                ? parseInt(form.ticket_delivery_hours, 10)
                : null,
        ticket_delivery_at:
            form.ticket_delivery_mode === "fecha_especifica" && form.ticket_delivery_at
                ? localInputToIso(form.ticket_delivery_at)
                : null,
        multi_function_mode: form.multi_function_mode || "function",
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

// ── Section: Info (datos + cuándo + dónde) ──────────────────────────────────
function SectionInfo({
    form,
    update,
    disabled,
    venues,
    currentEvent,
    onEventUpdated,
    ensureEventId,
    onJumpToFunctions,
}) {
    return (
        <div className="space-y-5">
            <DatosBlock form={form} update={update} disabled={disabled} />
            <CuandoBlock
                form={form}
                update={update}
                disabled={disabled}
                onJumpToFunctions={onJumpToFunctions}
            />
            <DondeBlock
                form={form}
                update={update}
                disabled={disabled}
                venues={venues}
                currentEvent={currentEvent}
                onEventUpdated={onEventUpdated}
                ensureEventId={ensureEventId}
            />
        </div>
    );
}

function DatosBlock({ form, update, disabled }) {
    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="info-datos-block">
            <SubHeader icon="📝" title="Datos del evento" />
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
                <Select
                    value={form.category}
                    onValueChange={(v) => update("category", v)}
                >
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
            <Field label="Tipo de recaudación">
                <Select
                    value={form.pricing_type}
                    onValueChange={(v) => update("pricing_type", v)}
                    disabled={disabled}
                >
                    <SelectTrigger data-testid="wiz-pricing-type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="free">Gratis</SelectItem>
                        <SelectItem value="paid">Pago</SelectItem>
                        <SelectItem value="donation">Donación</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                    Define el resto del wizard: si es "Pago" vas a poder cobrar por
                    localidad o precio único; "Donación" no admite venue con asientos
                    numerados (el comprador elige el monto).
                </p>
            </Field>
            {form.pricing_type === "donation" && (
                <div className="sm:col-span-2 flex items-center justify-between rounded-lg border p-4 bg-card">
                    <div>
                        <div className="font-medium text-sm">Emitir tickets tipo RIFA</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Cada ticket recibe un número de rifa secuencial autogenerado,
                            útil para sorteos asociados a la donación.
                        </p>
                    </div>
                    <Switch
                        checked={!!form.raffle_enabled}
                        onCheckedChange={(v) => update("raffle_enabled", v)}
                        disabled={disabled}
                        data-testid="wiz-raffle-enabled"
                    />
                </div>
            )}
        </div>
    );
}

function CuandoBlock({ form, update, disabled, onJumpToFunctions }) {
    const startsValid = !!form.starts_at;
    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="info-cuando-block">
            <SubHeader icon="📅" title="Cuándo" />

            <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Fecha y hora de inicio *">
                    <Input
                        type="datetime-local"
                        value={form.starts_at}
                        onChange={(e) => update("starts_at", e.target.value)}
                        disabled={disabled}
                        data-testid="wiz-starts"
                    />
                </Field>
                <Field label="Duración *">
                    <Select
                        value={form.duration_preset}
                        onValueChange={(v) => update("duration_preset", v)}
                        disabled={disabled}
                    >
                        <SelectTrigger data-testid="wiz-duration-preset">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {DURATION_PRESETS.map((p) => (
                                <SelectItem key={p.key} value={p.key}>
                                    {p.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>
            {form.duration_preset === "custom" && (
                <Field label="Duración personalizada (minutos)">
                    <Input
                        type="number"
                        min="5"
                        step="5"
                        value={form.duration_minutes_custom || ""}
                        onChange={(e) =>
                            update(
                                "duration_minutes_custom",
                                parseInt(e.target.value || "0", 10),
                            )
                        }
                        disabled={disabled}
                        placeholder="Ej: 90"
                        data-testid="wiz-duration-custom"
                    />
                </Field>
            )}

            <Field label="Zona horaria">
                <Select
                    value={form.timezone}
                    onValueChange={(v) => update("timezone", v)}
                    disabled={disabled}
                >
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
                    <CalendarClock className="h-4 w-4 text-primary" />
                    Ventana de venta
                </div>
                <p className="text-xs text-muted-foreground">
                    Cuándo se habilita y se cierra la compra de tickets. Las opciones se
                    calculan desde tu fecha de inicio.
                </p>

                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Inicio de venta">
                        <Select
                            value={form.sales_window_preset_start}
                            onValueChange={(v) => update("sales_window_preset_start", v)}
                            disabled={disabled || !startsValid}
                        >
                            <SelectTrigger data-testid="wiz-sales-start-preset">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SALES_START_PRESETS.map((p) => (
                                    <SelectItem key={p.key} value={p.key}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="Fin de venta">
                        <Select
                            value={form.sales_window_preset_end}
                            onValueChange={(v) => update("sales_window_preset_end", v)}
                            disabled={disabled || !startsValid}
                        >
                            <SelectTrigger data-testid="wiz-sales-end-preset">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SALES_END_PRESETS.map((p) => (
                                    <SelectItem key={p.key} value={p.key}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>

                {form.sales_window_preset_start === "custom" && (
                    <Field label="Inicio de venta — fecha personalizada">
                        <Input
                            type="datetime-local"
                            value={form.sales_start_custom}
                            onChange={(e) => update("sales_start_custom", e.target.value)}
                            disabled={disabled}
                            data-testid="wiz-sales-start-custom"
                        />
                    </Field>
                )}
                {form.sales_window_preset_end === "custom" && (
                    <Field label="Fin de venta — fecha personalizada">
                        <Input
                            type="datetime-local"
                            value={form.sales_end_custom}
                            onChange={(e) => update("sales_end_custom", e.target.value)}
                            disabled={disabled}
                            data-testid="wiz-sales-end-custom"
                        />
                    </Field>
                )}
            </div>

            <div className="rounded-lg border p-3 bg-muted/30 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                        <div className="font-medium">Evento multi-función</div>
                        <div className="text-xs text-muted-foreground">
                            ¿Tu evento se repite en varias fechas u horarios, o agrupa varios
                            subeventos (sala VIP, cena, meet & greet)? Agregalos en la pestaña
                            "Funciones" — cada uno puede tener su propio venue, horario, aforo y
                            precios.
                        </div>
                    </div>
                    {onJumpToFunctions && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onJumpToFunctions}
                            data-testid="jump-to-functions"
                        >
                            Ir a Funciones
                        </Button>
                    )}
                </div>
                <Field label="¿Mismo show repetido o subeventos independientes?">
                    <Select
                        value={form.multi_function_mode}
                        onValueChange={(v) => update("multi_function_mode", v)}
                        disabled={disabled}
                    >
                        <SelectTrigger data-testid="wiz-multi-function-mode">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="function">
                                Funciones — el mismo show se repite (multifunción / franjas horarias)
                            </SelectItem>
                            <SelectItem value="subevent">
                                Subeventos — experiencias independientes (sala VIP, cena, meet &amp; greet)
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
            </div>
        </div>
    );
}

function DondeBlock({
    form,
    update,
    disabled,
    venues,
    currentEvent,
    onEventUpdated,
    ensureEventId,
}) {
    const seatedMode = !form.no_seating_mode; // ON => numbered venue
    const linkedVenueId = currentEvent?.venue_id || form.venue_id || null;
    const linkedVenue = useMemo(
        () => venues.find((v) => v.id === linkedVenueId) || null,
        [venues, linkedVenueId],
    );
    const [linking, setLinking] = useState(false);
    const isDonation = form.pricing_type === "donation";

    // Numbered seating is ON by default for every new event. If the organizer
    // picks "Donación" before linking a venue, switch to general mode right
    // away instead of leaving a disabled toggle stuck in the wrong state.
    useEffect(() => {
        if (isDonation && seatedMode && !linkedVenueId) {
            update("no_seating_mode", true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDonation, linkedVenueId]);

    const handlePickVenue = async (vid) => {
        if (!vid) return;
        const venue = venues.find((v) => v.id === vid);
        if (!venue) return;
        setLinking(true);
        try {
            const eid = await ensureEventId();
            if (!eid) return;
            const activeIds = new Set();
            for (const el of venue.elements || []) {
                if (el.locality_id) activeIds.add(el.locality_id);
            }
            const body = {
                venue_id: vid,
                locality_pricing: Array.from(activeIds).map((id) => {
                    const loc = venue.localities?.find((l) => l.id === id);
                    return {
                        locality_id: id,
                        price_cents: loc?.default_price_cents || 0,
                        max_tickets_per_purchase: null,
                    };
                }),
                seat_holds_window_minutes: 10,
            };
            const { data } = await api.put(`/events/me/${eid}/venue`, body);
            onEventUpdated(data);
            update("venue_id", vid);
            update("no_seating_mode", false);
            toast.success(`Venue "${venue.name}" vinculado al evento`);
        } catch (e) {
            toast.error(
                formatApiError(e?.response?.data?.detail) ||
                    e.message ||
                    "No se pudo vincular el venue.",
            );
        } finally {
            setLinking(false);
        }
    };

    const handleUnlink = async () => {
        if (!currentEvent?.id) {
            update("venue_id", null);
            return;
        }
        if ((currentEvent.tickets_sold || 0) > 0) {
            toast.error(
                "No podés cambiar el venue después de la primera venta.",
            );
            return;
        }
        const ok = window.confirm(
            "¿Desvincular el venue? Los precios por localidad se perderán.",
        );
        if (!ok) return;
        setLinking(true);
        try {
            await api.delete(`/events/me/${currentEvent.id}/venue`);
            onEventUpdated({
                ...currentEvent,
                venue_id: null,
                venue_slug: null,
                locality_pricing: [],
            });
            update("venue_id", null);
            toast.success("Venue desvinculado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLinking(false);
        }
    };

    const handleModeChange = (numbered) => {
        if (numbered && isDonation) {
            toast.error(
                "Los eventos de donación no admiten venue con asientos numerados.",
            );
            return;
        }
        if (!numbered && linkedVenueId) {
            toast.error(
                "Para cambiar a evento general primero desvinculá el venue actual.",
            );
            return;
        }
        update("no_seating_mode", !numbered);
    };

    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="info-donde-block">
            <SubHeader icon="📍" title="Dónde" />

            <div className="flex items-start gap-3 rounded-lg border bg-secondary/30 p-3">
                <Switch
                    checked={seatedMode}
                    onCheckedChange={handleModeChange}
                    disabled={disabled || linking || (isDonation && !seatedMode)}
                    data-testid="wiz-seated-toggle"
                />
                <div className="text-sm">
                    <p className="font-medium leading-tight">
                        ¿Tu evento tiene venue con asientos asignados?
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {isDonation
                            ? "No disponible para eventos de donación — el comprador elige el monto, no hay precio fijo por asiento."
                            : "Activado: usás un mapa de asientos numerados. Apagado: ingresás nombre, dirección y precio único (eventos generales)."}
                    </p>
                </div>
            </div>

            {seatedMode ? (
                <SeatedVenuePicker
                    venues={venues}
                    linkedVenue={linkedVenue}
                    linkedVenueId={linkedVenueId}
                    onPick={handlePickVenue}
                    onUnlink={handleUnlink}
                    disabled={disabled || linking}
                    linking={linking}
                    currentEventId={currentEvent?.id}
                />
            ) : (
                <GeneralLocationFields form={form} update={update} disabled={disabled} />
            )}
        </div>
    );
}

function SeatedVenuePicker({
    venues,
    linkedVenue,
    linkedVenueId,
    onPick,
    onUnlink,
    disabled,
    linking,
    currentEventId,
}) {
    if (venues.length === 0 && !linkedVenue) {
        const returnTo = currentEventId
            ? encodeURIComponent(`/app/eventos/${currentEventId}/editar?tab=info`)
            : encodeURIComponent("/app/eventos/nuevo");
        return (
            <div
                className="rounded-xl border-2 border-dashed p-6 text-center bg-secondary/30 space-y-3"
                data-testid="venue-empty-state"
            >
                <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-1">
                    <p className="font-medium">Todavía no tenés un venue publicado</p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        Lo más fácil: elegí una plantilla prediseñada, publicala y volvé acá para
                        vincularla. No necesitás diseñar el mapa desde cero.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                    <Button asChild size="sm" data-testid="venue-template-cta">
                        <a href={`/app/venues?create=1&return_to=${returnTo}`}>
                            <LayoutTemplate className="h-4 w-4 mr-1.5" />
                            Elegir plantilla
                            <ArrowRight className="h-4 w-4 ml-1.5" />
                        </a>
                    </Button>
                    <Button asChild size="sm" variant="outline" data-testid="venue-create-cta">
                        <a href={`/app/venues?return_to=${returnTo}`}>
                            <PlusCircle className="h-4 w-4 mr-1.5" />
                            Ver todos mis venues
                        </a>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3" data-testid="venue-picker">
            <Field label="Venue del evento">
                <Select
                    value={linkedVenueId || ""}
                    onValueChange={onPick}
                    disabled={disabled}
                >
                    <SelectTrigger data-testid="wiz-venue-select">
                        <SelectValue placeholder="Elegí un venue…" />
                    </SelectTrigger>
                    <SelectContent>
                        {venues.map((v) => (
                            <SelectItem
                                key={v.id}
                                value={v.id}
                                data-testid={`venue-opt-${v.slug}`}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <MapPin className="h-3.5 w-3.5" />
                                    {v.name}
                                    <span className="text-xs text-muted-foreground">
                                        · {v.capacity_calculated || 0} asientos
                                    </span>
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>

            {linkedVenue && (
                <div
                    className="rounded-lg border bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-3"
                    data-testid="venue-linked-card"
                >
                    <div className="flex items-center gap-3 text-sm">
                        <div className="h-9 w-9 rounded-md bg-primary/15 grid place-items-center">
                            <MapPin className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <div className="font-medium leading-tight">
                                {linkedVenue.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {linkedVenue.capacity_calculated || 0} asientos ·{" "}
                                {(linkedVenue.localities || []).length} localidad
                                {(linkedVenue.localities || []).length !== 1 ? "es" : ""}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            asChild
                            data-testid="venue-preview"
                        >
                            <a
                                href={`/o/${linkedVenue.tenant_slug}/venues/${linkedVenue.slug}/preview`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <Eye className="h-4 w-4 mr-1.5" />
                                Ver mapa
                            </a>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onUnlink}
                            disabled={disabled || linking}
                            className="text-red-600 hover:bg-red-50"
                            data-testid="venue-unlink"
                        >
                            {linking ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                                <Unlink className="h-4 w-4 mr-1.5" />
                            )}
                            Cambiar
                        </Button>
                    </div>
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                Configurás los precios por localidad en la pestaña <strong>Venue y
                localidades</strong>.
            </p>
        </div>
    );
}

function GeneralLocationFields({ form, update, disabled }) {
    return (
        <div className="space-y-3" data-testid="general-location-fields">
            <Field label="Nombre del lugar *">
                <Input
                    value={form.venue_name}
                    onChange={(e) => update("venue_name", e.target.value)}
                    disabled={disabled}
                    placeholder="Ej: Centro Cultural Metropolitano"
                    data-testid="wiz-venue-name"
                />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Dirección">
                    <Input
                        value={form.venue_address}
                        onChange={(e) => update("venue_address", e.target.value)}
                        disabled={disabled}
                        placeholder="Calle García Moreno N3-50"
                        data-testid="wiz-venue-address"
                    />
                </Field>
                <Field label="Ciudad">
                    <Input
                        value={form.venue_city}
                        onChange={(e) => update("venue_city", e.target.value)}
                        disabled={disabled}
                        data-testid="wiz-venue-city"
                    />
                </Field>
            </div>
        </div>
    );
}

// ── Section: Venue y localidades (now: pricing + canvas only) ───────────────
function SectionVenueLocalidades({
    form,
    update,
    disabled,
    event,
    onEventUpdated,
    onJumpToInfo,
}) {
    const hasVenue = !!event?.venue_id;
    const isGeneralMode = form.no_seating_mode && !hasVenue;

    return (
        <div className="space-y-4" data-testid="section-venue-localidades">
            <div className="flex items-center justify-between gap-3 rounded-xl border p-4 bg-card">
                <div>
                    <h4 className="font-semibold text-sm">Tipo de recaudación</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {form.pricing_type === "free" && "Gratis — la compra se confirma sin cobrar, sin importar el precio que pongas por localidad."}
                        {form.pricing_type === "paid" && "Pago — el precio real de cada localidad se define en la tabla de abajo."}
                        {form.pricing_type === "donation" && "Donación — el comprador elige el monto a aportar."}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" data-testid="venue-localidades-pricing-type-badge">
                        {PRICING_LABELS[form.pricing_type] || form.pricing_type}
                    </Badge>
                    {onJumpToInfo && (
                        <Button type="button" variant="outline" size="sm" onClick={onJumpToInfo}>
                            Cambiar
                        </Button>
                    )}
                </div>
            </div>

            {isGeneralMode && (
                <>
                    <div className="rounded-xl border-l-4 border-l-primary bg-secondary/30 p-4">
                        <p className="text-sm font-medium flex items-center gap-2">
                            <Info className="h-4 w-4 text-primary" />
                            Evento general (sin asientos numerados)
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Definí el precio base y la capacidad total. Si querés usar un
                            mapa con localidades, volvé a <strong>Información general → Dónde</strong>
                            {" "}y activá el toggle.
                        </p>
                    </div>

                    <div className="space-y-3 rounded-xl border p-5 bg-card">
                        <h4 className="font-semibold text-sm">Precio y capacidad</h4>
                        <div className="rounded-lg border overflow-hidden">
                            <div className="grid grid-cols-2 bg-secondary/40 px-3 py-2 text-xs font-medium uppercase">
                                <div>Precio</div>
                                <div>Capacidad</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 px-3 py-3 items-center">
                                <div>
                                    {form.pricing_type === "free" ? (
                                        <span className="text-sm text-muted-foreground">
                                            Sin costo
                                        </span>
                                    ) : (
                                        <div className="relative">
                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                $
                                            </span>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="pl-6 h-8"
                                                value={form.base_price_dollars}
                                                onChange={(e) =>
                                                    update("base_price_dollars", e.target.value)
                                                }
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
                                        placeholder={
                                            form.unlimited_capacity ? "Sin límite" : "ej: 100"
                                        }
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
                </>
            )}

            {!isGeneralMode && !hasVenue && (
                <div className="rounded-xl border-l-4 border-l-amber-500 bg-amber-50 border-amber-200 p-5 text-sm text-amber-900">
                    <div className="flex items-start gap-2">
                        <Info className="h-5 w-5 flex-shrink-0" />
                        <div className="space-y-1">
                            <p className="font-medium">Primero elegí un venue</p>
                            <p className="text-amber-900/80">
                                Configurá el venue en{" "}
                                <button
                                    type="button"
                                    onClick={onJumpToInfo}
                                    className="underline font-medium"
                                    data-testid="jump-to-info"
                                >
                                    Información general → Dónde
                                </button>
                                . Una vez vinculado, acá vas a ver el mapa interactivo y
                                la tabla de precios por localidad.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {!isGeneralMode && hasVenue && (
                <EventVenueSection
                    event={event}
                    disabled={disabled}
                    onUpdated={onEventUpdated}
                />
            )}
        </div>
    );
}

// ── Section: Media ──────────────────────────────────────────────────────────
function SectionMedia({
    poster,
    banner,
    gallery,
    uploadingKind,
    onUpload,
    onDeleteGallery,
    onReorderGallery,
    eventId: _eventId,
}) {
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
                <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-start">
                    <PosterMockup hasImage={!!poster} />
                    <div className="w-full max-w-xs">
                        <ImageDropzone
                            label=""
                            currentUrl={assetUrl(poster)}
                            onUpload={(f) => onUpload(f, "poster")}
                            uploading={uploadingKind === "poster"}
                            testid="wiz-poster"
                            aspect="square"
                        />
                    </div>
                </div>
            </div>

            {/* — Banner — */}
            <div className="rounded-xl border p-5 bg-card">
                <header className="mb-3">
                    <div className="flex items-center gap-2 text-base font-semibold">
                        <ImageIcon className="h-5 w-5 text-amber-600" />
                        Banner del evento{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                            (opcional)
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        Imagen <strong>wide 16:9</strong>: se muestra como header en
                        la página pública del evento. Recomendado{" "}
                        <strong>1920 × 1080 px</strong>. JPG/PNG/WEBP/HEIC · 5 MB
                        máx.
                    </p>
                </header>
                <div className="grid sm:grid-cols-[1fr_minmax(0,2fr)] gap-4 items-start">
                    <BannerMockup hasImage={!!banner} />
                    <ImageDropzone
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
                            Galería{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                                (opcional)
                            </span>
                        </div>
                        <span
                            className="text-xs text-muted-foreground"
                            data-testid="wiz-gallery-counter"
                        >
                            {gallery.length} / 10
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        Hasta <strong>10 imágenes</strong> adicionales. Arrastrá para
                        reordenar, soltá archivos para subir. JPG/PNG/WEBP/HEIC · 5 MB
                        cada una.
                    </p>
                </header>
                <div className="grid md:grid-cols-[1fr_minmax(0,2fr)] gap-4 items-start">
                    <GalleryMockup count={gallery.length} />
                    <SortableGallery
                        gallery={gallery}
                        assetUrl={assetUrl}
                        uploadingKind={uploadingKind}
                        onUpload={onUpload}
                        onDelete={onDeleteGallery}
                        onReorder={onReorderGallery}
                    />
                </div>
            </div>
        </div>
    );
}

// ── Section: Ticket design (M4) ─────────────────────────────────────────────
function SectionTicketDesign({ form, update, eventId }) {
    if (!eventId) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground p-6 rounded-xl border">
                <Info className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                    Guardá primero la información general del evento para diseñar el ticket.
                </span>
            </div>
        );
    }
    // Whether the courtesy panel is shown is a local UI choice, independent
    // from whether it has any elements yet (a freshly-enabled design starts
    // empty). Persistence-wise, "off" is saved as an empty-elements design —
    // the generic PUT diff can't clear a field back to `null`, but the
    // renderer already treats empty elements the same as "no design" (falls
    // back to inheriting the main one).
    const [showCourtesy, setShowCourtesy] = useState(
        () => !!form.courtesy_ticket_design?.elements?.length,
    );
    return (
        <div className="space-y-6" data-testid="section-ticket-design">
            <div className="rounded-xl border p-5 bg-card space-y-3">
                <div>
                    <div className="font-medium">Diseño del ticket</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Subí un fondo, posicioná tu logo, el QR y la información del
                        asistente. Si no diseñás nada, se usa el formato estándar de TYS.
                    </p>
                </div>
                <TicketDesignPanel
                    eventId={eventId}
                    slot="main"
                    design={form.ticket_design}
                    onChange={(next) => update("ticket_design", next)}
                />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="text-sm">
                    <div className="font-medium">Diseño separado para cortesías</div>
                    <div className="text-xs text-muted-foreground">
                        Para invitados sin costo. Si lo dejás apagado, las cortesías
                        heredan el diseño principal.
                    </div>
                </div>
                <Switch
                    checked={showCourtesy}
                    onCheckedChange={(v) => {
                        setShowCourtesy(v);
                        if (!v) {
                            update("courtesy_ticket_design", {
                                format: form.courtesy_ticket_design?.format || "digital",
                                background_color: form.courtesy_ticket_design?.background_color || "#ffffff",
                                background_url: form.courtesy_ticket_design?.background_url || null,
                                elements: [],
                            });
                        }
                    }}
                    data-testid="td-use-courtesy"
                />
            </div>

            {showCourtesy && (
                <div className="rounded-xl border p-5 bg-card space-y-3">
                    <div className="font-medium text-sm">Diseño de cortesía</div>
                    <TicketDesignPanel
                        eventId={eventId}
                        slot="courtesy"
                        design={form.courtesy_ticket_design}
                        onChange={(next) => update("courtesy_ticket_design", next)}
                    />
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
            <PaymentRow
                title="Tarjeta de crédito/débito (Stripe)"
                description="Pago automático con confirmación inmediata. No se puede desactivar."
                checked
                disabled
                testid="pay-stripe"
            />

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

function PaymentRow({ title, description, checked, onChange = undefined, disabled = false, testid, children = null }) {
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
function SectionDiscounts({ form, update, venueLocalities = [], eventId = null }) {
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

            {eventId && <DiscountsReportPanel eventId={eventId} />}
        </div>
    );
}

function DiscountsReportPanel({ eventId }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        setLoading(true);
        api
            .get(`/events/me/${eventId}/discounts/report`)
            .then(({ data }) => {
                if (active) setReport(data.rules || []);
            })
            .catch(() => active && setReport([]))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [eventId]);

    if (loading || !report || report.length === 0) return null;

    return (
        <div className="rounded-lg border p-4 bg-card space-y-3" data-testid="discounts-report-panel">
            <div>
                <div className="font-medium">Reporte de uso y conversión</div>
                <div className="text-xs text-muted-foreground">
                    Cuántas órdenes pagadas usaron cada regla, y cuánto descuento e
                    ingreso generaron — útil para medir códigos de influencer.
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                            <th className="py-1.5 pr-3">Regla</th>
                            <th className="py-1.5 pr-3">Influencer</th>
                            <th className="py-1.5 pr-3 text-right">Usos</th>
                            <th className="py-1.5 pr-3 text-right">Órdenes pagadas</th>
                            <th className="py-1.5 pr-3 text-right">Descuento otorgado</th>
                            <th className="py-1.5 text-right">Ingreso atribuido</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report.map((r) => (
                            <tr key={r.rule_id} className="border-b last:border-0" data-testid={`report-row-${r.rule_id}`}>
                                <td className="py-1.5 pr-3">
                                    {r.name}
                                    {r.code && (
                                        <code className="ml-1.5 text-xs bg-secondary px-1 py-0.5 rounded">
                                            {r.code}
                                        </code>
                                    )}
                                </td>
                                <td className="py-1.5 pr-3 text-muted-foreground">
                                    {r.influencer_name
                                        ? `${r.influencer_name}${r.channel ? ` · ${r.channel}` : ""}`
                                        : "—"}
                                </td>
                                <td className="py-1.5 pr-3 text-right">
                                    {r.uses_count}
                                    {r.max_uses ? `/${r.max_uses}` : ""}
                                </td>
                                <td className="py-1.5 pr-3 text-right">{r.orders_count}</td>
                                <td className="py-1.5 pr-3 text-right">
                                    ${(r.total_discount_cents / 100).toFixed(2)}
                                </td>
                                <td className="py-1.5 text-right">
                                    ${(r.total_revenue_cents / 100).toFixed(2)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Section: Access ─────────────────────────────────────────────────────────
function SectionAccess({ form, update, eventId }) {
    const ap = form.access_params;
    const deliveryMode = form.ticket_delivery_mode || "al_momento";
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
                        <SelectItem value="public_blocked">
                            Público bloqueado — aparece en tu microsite, pero solo se puede
                            comprar con código o estando en lista
                        </SelectItem>
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
                        <SelectItem value="verified_list">Lista verificada</SelectItem>
                        <SelectItem value="access_code">Código de acceso</SelectItem>
                    </SelectContent>
                </Select>
            </Field>

            {ap.access_type === "verified_list" && <GuestListPanel eventId={eventId} />}
            {ap.access_type === "access_code" && <AccessCodesPanel eventId={eventId} />}

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

            {/* eTicket delivery */}
            <div className="rounded-lg border p-4 space-y-3">
                <div>
                    <div className="font-medium text-sm">Envío del eTicket (QR)</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                        Define cuándo se envían los QR por email al comprador.
                    </div>
                </div>
                <Field label="Modo de envío">
                    <Select
                        value={deliveryMode}
                        onValueChange={(v) => update("ticket_delivery_mode", v)}
                    >
                        <SelectTrigger data-testid="access-delivery-mode">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="al_momento">
                                Al momento de la compra
                            </SelectItem>
                            <SelectItem value="horas_antes">
                                X horas antes del evento
                            </SelectItem>
                            <SelectItem value="fecha_especifica">
                                En una fecha específica
                            </SelectItem>
                            <SelectItem value="manual">
                                Manual — el organizador los envía
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                {deliveryMode === "horas_antes" && (
                    <Field label="Horas antes del evento">
                        <Input
                            type="number"
                            min="1"
                            max="720"
                            value={form.ticket_delivery_hours}
                            onChange={(e) =>
                                update("ticket_delivery_hours", e.target.value)
                            }
                            placeholder="24"
                            data-testid="access-delivery-hours"
                        />
                    </Field>
                )}
                {deliveryMode === "fecha_especifica" && (
                    <Field label="Fecha y hora de envío">
                        <Input
                            type="datetime-local"
                            value={form.ticket_delivery_at}
                            onChange={(e) =>
                                update("ticket_delivery_at", e.target.value)
                            }
                            data-testid="access-delivery-at"
                        />
                    </Field>
                )}
            </div>

            <CustomQuestionsPanel
                questions={form.custom_questions || []}
                onChange={(next) => update("custom_questions", next)}
            />
        </div>
    );
}

// ── §4.2.8 — Preguntas adicionales al comprador ─────────────────────────────
function newCustomQuestion() {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: "",
        type: "text",
        required: false,
        options: [],
    };
}

function CustomQuestionsPanel({ questions, onChange }) {
    const add = () => onChange([...questions, newCustomQuestion()]);
    const remove = (id) => onChange(questions.filter((q) => q.id !== id));
    const upd = (id, patch) =>
        onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));

    return (
        <div className="rounded-lg border p-4 bg-card space-y-3" data-testid="custom-questions-panel">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="font-medium">Preguntas adicionales al comprador</div>
                    <div className="text-xs text-muted-foreground">
                        Se muestran al momento de la compra. Las respuestas quedan
                        visibles en el detalle de cada orden.
                    </div>
                </div>
                <Button size="sm" onClick={add} data-testid="cq-add">
                    <Plus className="h-4 w-4 mr-1.5" /> Agregar pregunta
                </Button>
            </div>

            {questions.length === 0 ? (
                <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                    Sin preguntas adicionales todavía.
                </div>
            ) : (
                <ul className="space-y-2" data-testid="cq-list">
                    {questions.map((q) => (
                        <li
                            key={q.id}
                            className="rounded-lg border p-3 space-y-2"
                            data-testid={`cq-row-${q.id}`}
                        >
                            <div className="grid sm:grid-cols-[1fr_140px] gap-2">
                                <Input
                                    value={q.label}
                                    onChange={(e) => upd(q.id, { label: e.target.value })}
                                    placeholder="Ej: ¿Restricción alimentaria?"
                                    data-testid={`cq-label-${q.id}`}
                                />
                                <Select
                                    value={q.type}
                                    onValueChange={(v) => upd(q.id, { type: v })}
                                >
                                    <SelectTrigger data-testid={`cq-type-${q.id}`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="text">Texto libre</SelectItem>
                                        <SelectItem value="select">Opción múltiple</SelectItem>
                                        <SelectItem value="checkbox">Sí / No</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {q.type === "select" && (
                                <Input
                                    value={(q.options || []).join(", ")}
                                    onChange={(e) =>
                                        upd(q.id, {
                                            options: e.target.value
                                                .split(",")
                                                .map((s) => s.trim())
                                                .filter(Boolean),
                                        })
                                    }
                                    placeholder="Opciones separadas por coma: Vegetariano, Vegano, Ninguna"
                                    data-testid={`cq-options-${q.id}`}
                                />
                            )}
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 text-sm">
                                    <Switch
                                        checked={!!q.required}
                                        onCheckedChange={(v) => upd(q.id, { required: v })}
                                        data-testid={`cq-required-${q.id}`}
                                    />
                                    Obligatoria
                                </label>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => remove(q.id)}
                                    className="text-red-600 hover:bg-red-50"
                                    data-testid={`cq-remove-${q.id}`}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Small atoms ─────────────────────────────────────────────────────────────
function SubHeader({ icon, title }) {
    return (
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <span aria-hidden>{icon}</span>
            {title}
        </h3>
    );
}

function Field({ label, children, testId = undefined }) {
    return (
        <div className="space-y-1.5" data-testid={testId}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

// ── Media mockups (Item 4) ──────────────────────────────────────────────────
function PosterMockup({ hasImage }) {
    return (
        <figure
            className="rounded-xl border bg-secondary/30 p-3 max-w-[200px]"
            data-testid="poster-mockup"
        >
            <svg viewBox="0 0 180 240" className="w-full h-auto" aria-hidden="true">
                <rect width="180" height="240" rx="14" fill="#FFFFFF" stroke="#E2E8F0" />
                <rect
                    x="14"
                    y="14"
                    width="152"
                    height="152"
                    rx="8"
                    fill={hasImage ? "#6366F1" : "#EEF2FF"}
                    stroke="#6366F1"
                    strokeWidth="1.5"
                    strokeDasharray={hasImage ? "0" : "5 4"}
                    fillOpacity={hasImage ? "0.18" : "1"}
                />
                <text
                    x="90"
                    y="93"
                    fontSize="10"
                    textAnchor="middle"
                    fill="#6366F1"
                    fontWeight="600"
                >
                    Tu póster
                </text>
                <rect x="14" y="180" width="120" height="8" rx="3" fill="#94A3B8" />
                <rect x="14" y="196" width="80" height="6" rx="3" fill="#CBD5E1" />
                <rect x="14" y="212" width="60" height="14" rx="7" fill="#6366F1" opacity="0.9" />
                <text x="44" y="222" fontSize="7" textAnchor="middle" fill="#FFFFFF" fontWeight="600">
                    Ver evento
                </text>
            </svg>
            <figcaption className="text-[11px] text-muted-foreground text-center mt-1.5">
                Cómo se ve en la grilla
            </figcaption>
        </figure>
    );
}

function BannerMockup({ hasImage }) {
    return (
        <figure
            className="rounded-xl border bg-secondary/30 p-3"
            data-testid="banner-mockup"
        >
            <svg viewBox="0 0 320 200" className="w-full h-auto" aria-hidden="true">
                <rect width="320" height="200" rx="12" fill="#FFFFFF" stroke="#E2E8F0" />
                <rect
                    x="10"
                    y="10"
                    width="300"
                    height="90"
                    rx="6"
                    fill={hasImage ? "#F59E0B" : "#FEF3C7"}
                    stroke="#D97706"
                    strokeWidth="1.5"
                    strokeDasharray={hasImage ? "0" : "5 4"}
                    fillOpacity={hasImage ? "0.25" : "1"}
                />
                <text
                    x="160"
                    y="60"
                    fontSize="11"
                    textAnchor="middle"
                    fill="#92400E"
                    fontWeight="600"
                >
                    Banner del evento (1920×1080)
                </text>
                <rect x="20" y="112" width="160" height="10" rx="3" fill="#1E293B" />
                <rect x="20" y="128" width="220" height="6" rx="3" fill="#94A3B8" />
                <rect x="20" y="140" width="180" height="6" rx="3" fill="#CBD5E1" />
                <rect x="20" y="158" width="80" height="22" rx="11" fill="#6366F1" />
                <text x="60" y="174" fontSize="9" textAnchor="middle" fill="#FFFFFF" fontWeight="700">
                    Comprar
                </text>
            </svg>
            <figcaption className="text-[11px] text-muted-foreground text-center mt-1.5">
                Header de la página pública del evento
            </figcaption>
        </figure>
    );
}

function GalleryMockup({ count }) {
    const filled = Math.min(count, 4);
    return (
        <figure
            className="rounded-xl border bg-secondary/30 p-3"
            data-testid="gallery-mockup"
        >
            <svg viewBox="0 0 240 180" className="w-full h-auto" aria-hidden="true">
                <rect width="240" height="180" rx="12" fill="#FFFFFF" stroke="#E2E8F0" />
                <text x="120" y="18" fontSize="9" textAnchor="middle" fill="#475569" fontWeight="600">
                    Galería del evento
                </text>
                {[0, 1, 2, 3].map((i) => {
                    const x = 16 + (i % 4) * 54;
                    const isFilled = i < filled;
                    return (
                        <g key={i}>
                            <rect
                                x={x}
                                y={32}
                                width="48"
                                height="48"
                                rx="6"
                                fill={isFilled ? "#10B981" : "#ECFDF5"}
                                stroke="#10B981"
                                strokeWidth="1.2"
                                strokeDasharray={isFilled ? "0" : "4 3"}
                                fillOpacity={isFilled ? "0.3" : "1"}
                            />
                            {isFilled && (
                                <text
                                    x={x + 24}
                                    y={59}
                                    fontSize="8"
                                    textAnchor="middle"
                                    fill="#047857"
                                    fontWeight="700"
                                >
                                    {i + 1}
                                </text>
                            )}
                        </g>
                    );
                })}
                <rect x="16" y="98" width="208" height="60" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="120" y="125" fontSize="8" textAnchor="middle" fill="#64748B">
                    Carousel scroll
                </text>
                <text x="120" y="140" fontSize="7" textAnchor="middle" fill="#94A3B8">
                    ←  ●  ○  ○  →
                </text>
            </svg>
            <figcaption className="text-[11px] text-muted-foreground text-center mt-1.5">
                Sección galería de la página pública
            </figcaption>
        </figure>
    );
}
