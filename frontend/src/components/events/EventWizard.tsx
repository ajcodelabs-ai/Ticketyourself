/**
 * EventWizard — organizer event create/edit.
 *
 * 8 sections (sidebar stepper):
 *  1. General — info principal · descripción · keywords · contenido avanzado
 *  2. Fechas y ventas — Cuándo (duration + sales presets) · Funciones
 *  3. Media — portada · principal · miniatura · gallery · Diseño de ticket
 *  4. Localidades — Dónde · precios/aforo · tipos de ticket · abono (si aplica)
 *  5. Formas de pago
 *  6. Descuentos
 *  7. Accesos — visibilidad · quién puede comprar · lista/códigos
 *  8. Parámetros — preguntas · límites · envío de eTicket
 *
 * Used in both create (/app/eventos/nuevo) and edit (/app/eventos/:id/editar).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import EventVenueSection from "@/components/events/EventVenueSection";
import DiscountRulesPanel from "@/components/events/DiscountRulesPanel";
import EventContentPanel from "@/components/events/EventContentPanel";
import TicketTypesPanel from "@/components/events/TicketTypesPanel";
import EventFunctionsPanel from "@/components/events/EventFunctionsPanel";
import SeasonPassPanel from "@/components/events/SeasonPassPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import GuestListPanel from "@/components/events/GuestListPanel";
import TicketDesignPanel from "@/components/events/TicketDesignPanel";
import AccessCodesPanel from "@/components/events/AccessCodesPanel";
import { capacityByLocality } from "@/lib/venues";
import ImageDropzone from "@/components/ui/ImageDropzone";
import SortableGallery from "@/components/ui/SortableGallery";
import DateTimePicker from "@/components/ui/DateTimePicker";
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
    Trash2,
    Info,
    CreditCard,
    Landmark,
    Banknote,
    Check,
    Smartphone,
    Percent,
    Accessibility,
    CalendarClock,
    Plus,
    X,
    Globe,
    Lock,
    Link2,
    Users,
    KeyRound,
    MessageSquareText,
    Ticket,
    Mail,
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
    TooltipTrigger,
    TooltipProvider,
} from "@/components/ui/tooltip";
import api, { formatApiError } from "@/lib/api";
import {
    defaultPaymentMethods,
    normalizePaymentMethodsForForm,
    resolveEnabledPaymentCodes,
    withEnabledCodes,
} from "@/lib/paymentMethods";
import {
    collectEventWizardIssues,
    stepLabelForIssue,
} from "@/lib/eventWizardValidation";
import { venuesApi } from "@/lib/venues";
import { assetUrl } from "@/lib/microsite";
import { useAuth } from "@/contexts/AuthContext";
import {
    EventMediaCompositePreview,
    MediaSlotMock,
} from "@/components/events/EventMediaPreview";
import {
    EVENT_CATEGORIES,
    PRICING_LABELS,
    isoToLocalInput,
    localInputToIso,
} from "@/lib/events";

const DEFAULT_TZ = import.meta.env.VITE_DEFAULT_TIMEZONE || "America/Guayaquil";

const TIMEZONES = [
    DEFAULT_TZ,
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
    { id: "general", label: "General" },
    { id: "fechas", label: "Fechas y ventas" },
    { id: "media", label: "Media" },
    { id: "localidades", label: "Localidades" },
    { id: "payments", label: "Formas de pago" },
    { id: "discounts", label: "Descuentos" },
    { id: "access", label: "Accesos" },
    { id: "params", label: "Parámetros" },
];

const MEDIA_SUBSTEPS = [
    { id: "images", label: "Imágenes", num: "3.1" },
    { id: "ticket", label: "Diseño de ticket", num: "3.2" },
];

/** Legacy ?tab= values → current step ids (deep-links / bookmarks). */
const TAB_ALIASES = {
    info: "general",
    content: "general",
    venue_localidades: "localidades",
    tipos_ticket: "localidades",
    abono: "localidades",
    funciones: "fechas",
    ticket_design: "media",
};

function defaultPayments() {
    return defaultPaymentMethods();
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
            timezone: DEFAULT_TZ,
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
            priority: 0,
            video_url: "",
            keywords: [],
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
        starts_at: isoToLocalInput(d.starts_at, d.timezone),
        ends_at: isoToLocalInput(d.ends_at, d.timezone),
            timezone: d.timezone || DEFAULT_TZ,
        sales_start_custom: d.sales_start ? isoToLocalInput(d.sales_start, d.timezone) : "",
        sales_end_custom: d.sales_end ? isoToLocalInput(d.sales_end, d.timezone) : "",
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
        payment_methods: normalizePaymentMethodsForForm(d.payment_methods),
        discounts: d.discounts || defaultDiscounts(),
        access_params: d.access_params || defaultAccessParams(),
        content: normalizeEventContent(d.content),
        ticket_delivery_mode: d.ticket_delivery_mode || "al_momento",
        ticket_delivery_hours: d.ticket_delivery_hours != null ? String(d.ticket_delivery_hours) : "",
        ticket_delivery_at: d.ticket_delivery_at ? isoToLocalInput(d.ticket_delivery_at, d.timezone) : "",
        multi_function_mode: d.multi_function_mode || "function",
        priority: d.priority ?? 0,
        video_url: d.video_url || "",
        keywords: d.keywords || [],
    };
}

export default function EventWizard({ initial = null, mode = "create" }) {
    const navigate = useNavigate();
    const { organizer } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [form, setForm] = useState(() => makeInitial(initial));
    const formRef = useRef(form);
    useEffect(() => { formRef.current = form; }, [form]);
    // `currentEvent` is the live event document mirrored from the backend after
    // each save / venue link. It feeds the venue picker + the pricing panel.
    const [currentEvent, setCurrentEvent] = useState(initial || null);
    const [venuesList, setVenuesList] = useState([]);
    const [venueLocalities, setVenueLocalities] = useState([]);
    const [saveIssues, setSaveIssues] = useState([]);
    const [issuesMode, setIssuesMode] = useState("draft"); // draft | publish


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
                            let capacity = 0;
                            try {
                                capacity = capacityByLocality(elements, l.id);
                            } catch {
                                capacity = 0;
                            }
                            return {
                                ...l,
                                price_cents: lp?.price_cents ?? l.default_price_cents ?? 0,
                                max_tickets_per_purchase: lp?.max_tickets_per_purchase ?? null,
                                capacity,
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

    // When building payload, use the latest form state via ref to avoid stale
    // closures in callbacks passed to child components (ensureEventId, etc.).
    const ensureEventId = async () => {
        if (eventId) return eventId;
        const r = await persist(false);
        return r?.id || null;
    };

    // Deep-linking: ?tab=general|fechas|... (legacy aliases remapped).
    const rawTab = searchParams.get("tab");
    const aliased = rawTab ? TAB_ALIASES[rawTab as keyof typeof TAB_ALIASES] : undefined;
    const initialStep =
        STEPS.find((s) => s.id === rawTab)?.id
        || STEPS.find((s) => s.id === aliased)?.id
        || "general";
    const [activeStep, setActiveStep] = useState(initialStep);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    // Venue chosen in Localidades before the first save (create flow steps 1→2).
    const [pendingVenueId, setPendingVenueId] = useState<string | null>(null);
    const [eventId, setEventId] = useState(initial?.id || null);
    const [poster, setPoster] = useState(initial?.poster_url || null);
    const [banner, setBanner] = useState(initial?.banner_url || null);
    const [small, setSmall] = useState(initial?.small_url || null);
    const [gallery, setGallery] = useState(initial?.gallery_urls || []);
    const [uploadingKind, setUploadingKind] = useState(null);
    const [mediaSubStep, setMediaSubStep] = useState("images"); // images | ticket

    useEffect(() => {
        if (initial) {
            setForm(makeInitial(initial));
            setCurrentEvent(initial);
            setPoster(initial.poster_url || null);
            setBanner(initial.banner_url || null);
            setSmall(initial.small_url || null);
            setGallery(initial.gallery_urls || []);
            setEventId(initial.id);
        }
    }, [initial]);

    const lockCritical = mode === "edit" && (initial?.tickets_sold || 0) > 0;

    // Live sale window — computed straight from the (possibly unsaved) form
    // state, same as buildPayload() does, so ticket types reflect whatever is
    // set in "Fechas y ventas" even before the first save.
    const liveSaleWindow = useMemo(() => {
        const startsIso = form.starts_at ? localInputToIso(form.starts_at, form.timezone) : null;
        return {
            sale_start: computeSalesStart(
                startsIso,
                form.sales_window_preset_start,
                form.sales_start_custom ? localInputToIso(form.sales_start_custom, form.timezone) : null,
            ),
            sale_end: computeSalesEnd(
                startsIso,
                form.sales_window_preset_end,
                form.sales_end_custom ? localInputToIso(form.sales_end_custom, form.timezone) : null,
            ),
        };
    }, [
        form.starts_at,
        form.sales_window_preset_start,
        form.sales_window_preset_end,
        form.sales_start_custom,
        form.sales_end_custom,
    ]);

    // When a venue is selected (linked or pending before first save), checkout
    // uses the seat map — ticket types / season pass stay hidden inside Localidades.
    const hasVenueSelected = !!(form.venue_id || currentEvent?.venue_id || pendingVenueId);

    const stepStatus = useMemo(
        () => evalStepStatus(form, poster, currentEvent, pendingVenueId),
        [form, poster, currentEvent, pendingVenueId],
    );

    const validationCtx = useMemo(
        () => ({
            form,
            poster,
            currentEvent,
            pendingVenueId,
            organizerStatus: organizer?.status || null,
        }),
        [form, poster, currentEvent, pendingVenueId, organizer?.status],
    );

    // Drop resolved issues as the organizer fills them in.
    useEffect(() => {
        if (!saveIssues.length) return;
        const stillOpen = collectEventWizardIssues({
            ...validationCtx,
            mode: issuesMode,
        });
        const openCodes = new Set(stillOpen.map((i) => i.code));
        setSaveIssues((prev) => {
            const next = prev.filter((i) => openCodes.has(i.code));
            return next.length === prev.length ? prev : next;
        });
    }, [validationCtx, issuesMode, saveIssues.length]);

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

    const showIssues = (issues, modeLabel) => {
        setIssuesMode(modeLabel);
        setSaveIssues(issues);
        const first = issues[0];
        if (first?.step) handleTabChange(first.step);
        const preview = issues
            .slice(0, 3)
            .map((i) => i.message)
            .join(" ");
        toast.error(
            issues.length === 1
                ? preview
                : `Faltan ${issues.length} cosas para ${modeLabel === "publish" ? "publicar" : "guardar"}.`,
            issues.length > 1 ? { description: preview } : undefined,
        );
    };

    const persist = async (publish = false) => {
        const modeKey = publish ? "publish" : "draft";
        const issues = collectEventWizardIssues({
            ...validationCtx,
            form: formRef.current,
            mode: modeKey,
        });
        if (issues.length) {
            showIssues(issues, modeKey);
            return null;
        }
        setSaveIssues([]);

        const payload = buildPayload(formRef.current);
        // Safety net if computeEndsAt returned empty despite duration checks.
        if (!payload.starts_at) {
            showIssues(
                [
                    {
                        step: "fechas",
                        code: "starts_at",
                        message: "Definí la fecha y hora de inicio en Fechas y ventas.",
                    },
                ],
                modeKey,
            );
            return null;
        }
        if (!payload.ends_at) {
            showIssues(
                [
                    {
                        step: "fechas",
                        code: "duration",
                        message: "Elegí la duración del evento en Fechas y ventas.",
                    },
                ],
                modeKey,
            );
            return null;
        }
        if (new Date(payload.ends_at) <= new Date(payload.starts_at)) {
            showIssues(
                [
                    {
                        step: "fechas",
                        code: "duration",
                        message: "La duración debe ser mayor a cero.",
                    },
                ],
                modeKey,
            );
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

            // Create flow: link the pending map after the draft exists (shape only;
            // localities/prices are configured next in the Localidades tab).
            const venueToLink = pendingVenueId && !result.venue_id ? pendingVenueId : null;
            if (venueToLink) {
                try {
                    const { data: linked } = await api.put(`/events/me/${result.id}/venue`, {
                        venue_id: venueToLink,
                        locality_pricing: [],
                        seat_holds_window_minutes: result.seat_holds_window_minutes || 10,
                    });
                    result = linked;
                    setCurrentEvent(linked);
                    setPendingVenueId(null);
                    update("venue_id", venueToLink);
                    update("no_seating_mode", false);
                } catch (linkErr) {
                    toast.error(
                        formatApiError(linkErr?.response?.data?.detail)
                            || "El borrador se guardó, pero no se pudo vincular el mapa.",
                    );
                }
            }

            if (publish) {
                if (!result.poster_url) {
                    showIssues(
                        [
                            {
                                step: "media",
                                code: "poster",
                                message:
                                    "Subí la imagen principal en Media (obligatoria para publicar).",
                            },
                        ],
                        "publish",
                    );
                    return result;
                }
                setPublishing(true);
                await api.post(`/events/me/${result.id}/publish`);
                toast.success("Evento publicado");
                navigate(`/app/eventos/${result.id}`);
            } else {
                const remaining = collectEventWizardIssues({
                    form: formRef.current,
                    poster: result.poster_url || poster,
                    currentEvent: result,
                    pendingVenueId: null,
                    mode: "publish",
                    organizerStatus: organizer?.status || null,
                });
                if (remaining.length) {
                    toast.success(
                        venueToLink
                            ? "Borrador creado y mapa vinculado"
                            : eventId
                              ? "Cambios guardados"
                              : "Borrador creado",
                        {
                            description: `Para publicar todavía falta: ${remaining
                                .slice(0, 2)
                                .map((i) => i.message.replace(/\.$/, ""))
                                .join("; ")}${remaining.length > 2 ? "…" : "."}`,
                        },
                    );
                } else {
                    toast.success(
                        venueToLink
                            ? "Borrador creado y mapa vinculado — agregá las localidades"
                            : eventId
                              ? "Cambios guardados"
                              : "Borrador creado",
                    );
                }
            }
            return result;
        } catch (e) {
            const status = e?.response?.status;
            const detail = e?.response?.data?.detail;
            const msg = formatApiError(detail) || e.message;
            // Map common API failures onto wizard steps when possible.
            if (status === 422 && typeof detail === "string" && /publicar/i.test(detail)) {
                toast.error(msg);
                setIssuesMode("publish");
                setSaveIssues(
                    collectEventWizardIssues({
                        ...validationCtx,
                        form: formRef.current,
                        mode: "publish",
                    }),
                );
            } else {
                toast.error(status ? `Error ${status}: ${msg}` : msg);
            }
            return null;
        } finally {
            setSaving(false);
            setPublishing(false);
        }
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
            else if (kind === "small") setSmall(data.small_url);
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
            if (r) {
                const msg =
                    kind === "poster"
                        ? "Imagen principal actualizada"
                        : kind === "small"
                        ? "Miniatura actualizada"
                        : "Portada actualizada";
                toast.success(msg);
            }
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
        <div className="space-y-4" data-testid="event-wizard">
            <Tabs value={activeStep} onValueChange={handleTabChange}>
                {/* Mobile: compact progress bar (hidden on lg+) */}
                <div className="lg:hidden flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5">
                    <StepIcon status={stepStatus[activeStep]} size="md" />
                    <span className="text-xs text-muted-foreground shrink-0">
                        {idx + 1}/{STEPS.length}
                    </span>
                    <span className="font-medium text-sm truncate">
                        {STEPS[idx]?.label}
                    </span>
                    <div className="ml-auto flex gap-0.5">
                        {STEPS.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => handleTabChange(s.id)}
                                aria-label={s.label}
                                className={`h-1.5 rounded-full transition-all ${
                                    s.id === activeStep
                                        ? "w-4 bg-primary"
                                        : stepStatus[s.id] === "ok"
                                        ? "w-1.5 bg-emerald-500"
                                        : stepStatus[s.id] === "warn"
                                        ? "w-1.5 bg-amber-400"
                                        : stepStatus[s.id] === "error"
                                        ? "w-1.5 bg-red-500"
                                        : "w-1.5 bg-muted-foreground/30"
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Desktop: sidebar layout */}
                <div className="lg:flex lg:gap-5 lg:items-start">
                    {/* ── Content area ── */}
                    <div className="flex-1 min-w-0">
                        <TabsContent value="general">
                            <SectionGeneral
                                form={form}
                                update={update}
                                disabled={lockCritical}
                            />
                        </TabsContent>
                        <TabsContent value="fechas">
                            <SectionFechas
                                form={form}
                                update={update}
                                disabled={lockCritical}
                                eventId={eventId}
                                localities={venueLocalities}
                            />
                        </TabsContent>
                        <TabsContent value="media">
                            <div className="space-y-5" data-testid="media-substeps">
                                {/* Mobile only: substep picker (desktop uses sidebar 3.1 / 3.2) */}
                                <div className="lg:hidden flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">
                                        Media · paso{" "}
                                        <strong className="text-foreground">
                                            {mediaSubStep === "images" ? "1" : "2"} de 2
                                        </strong>
                                    </p>
                                    <div
                                        className="inline-flex rounded-lg border bg-card p-0.5"
                                        role="tablist"
                                        aria-label="Subpasos de Media"
                                    >
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mediaSubStep === "images"}
                                            onClick={() => setMediaSubStep("images")}
                                            className={`rounded-md px-3 py-1.5 text-sm transition ${
                                                mediaSubStep === "images"
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                            data-testid="media-substep-images"
                                        >
                                            3.1 Imágenes
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mediaSubStep === "ticket"}
                                            onClick={() => setMediaSubStep("ticket")}
                                            className={`rounded-md px-3 py-1.5 text-sm transition ${
                                                mediaSubStep === "ticket"
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                            data-testid="media-substep-ticket"
                                        >
                                            3.2 Diseño de ticket
                                            {form.ticket_design?.elements?.length > 0 && (
                                                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {mediaSubStep === "images" ? (
                                    <div className="space-y-4">
                                        <SectionMedia
                                            poster={poster}
                                            banner={banner}
                                            small={small}
                                            gallery={gallery}
                                            uploadingKind={uploadingKind}
                                            onUpload={uploadImages}
                                            onDeleteGallery={deleteGalleryAt}
                                            onReorderGallery={reorderGallery}
                                            eventId={eventId}
                                        />
                                        <div className="flex justify-end border-t pt-4">
                                            <Button
                                                type="button"
                                                onClick={() => setMediaSubStep("ticket")}
                                                data-testid="media-goto-ticket"
                                            >
                                                Continuar a 3.2 Diseño de ticket
                                                <ChevronRight className="h-4 w-4 ml-1" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <SectionTicketDesign
                                            form={form}
                                            update={update}
                                            eventId={eventId}
                                        />
                                        <div className="flex justify-between border-t pt-4">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setMediaSubStep("images")}
                                                data-testid="media-goto-images"
                                            >
                                                <ChevronLeft className="h-4 w-4 mr-1" />
                                                Volver a 3.1 Imágenes
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                        <TabsContent value="localidades">
                            <div className="space-y-5">
                                <DondeBlock
                                    form={form}
                                    update={update}
                                    disabled={lockCritical}
                                    currentEvent={currentEvent}
                                />
                                <SectionVenueLocalidades
                                    form={form}
                                    update={update}
                                    disabled={lockCritical}
                                    event={currentEvent}
                                    onEventUpdated={setCurrentEvent}
                                    onJumpToInfo={() => handleTabChange("general")}
                                    onReturnFromVenueCreate={venuesList}
                                    pendingVenueId={pendingVenueId}
                                    onPendingVenueChange={setPendingVenueId}
                                />
                                {!hasVenueSelected && form.no_seating_mode && (
                                    <div className="space-y-5">
                                        <TicketTypesPanel
                                            eventId={eventId}
                                            localities={venueLocalities}
                                            eventSaleWindow={liveSaleWindow}
                                            timezone={form.timezone}
                                        />
                                        <SeasonPassPanel
                                            eventId={eventId}
                                            hasVenue={false}
                                            timezone={form.timezone}
                                        />
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                        <TabsContent value="payments">
                            <SectionPayments form={form} update={update} />
                        </TabsContent>
                        <TabsContent value="discounts">
                            <SectionDiscounts
                                form={form}
                                update={update}
                                venueLocalities={venueLocalities}
                                eventId={eventId}
                            />
                        </TabsContent>
                        <TabsContent value="access">
                            <SectionAccess form={form} update={update} eventId={eventId} />
                        </TabsContent>
                        <TabsContent value="params">
                            <SectionParams
                                form={form}
                                update={update}
                                venueLocalities={venueLocalities}
                            />
                        </TabsContent>
                    </div>

                    {/* ── Right sidebar — step navigator (desktop only) ── */}
                    <div className="hidden lg:block w-52 shrink-0 sticky top-20 self-start">
                        <TabsList
                            className="flex-col h-auto w-full p-1.5 gap-0.5 bg-card border rounded-xl shadow-sm"
                            data-testid="wizard-tabs"
                        >
                            {STEPS.map((s, i) => {
                                const st = stepStatus[s.id];
                                const isActive = s.id === activeStep;
                                const rowBg = isActive ? "" : (
                                    st === "ok"    ? "bg-emerald-50 dark:bg-emerald-950/25 hover:bg-emerald-100 dark:hover:bg-emerald-950/40" :
                                    st === "warn"  ? "bg-amber-50 dark:bg-amber-950/25 hover:bg-amber-100 dark:hover:bg-amber-950/40" :
                                    st === "error" ? "bg-red-50 dark:bg-red-950/25 hover:bg-red-100 dark:hover:bg-red-950/40" :
                                    ""
                                );
                                const numColor = isActive ? "text-primary-foreground/70" : (
                                    st === "ok"    ? "text-emerald-600 dark:text-emerald-400" :
                                    st === "warn"  ? "text-amber-600 dark:text-amber-400" :
                                    st === "error" ? "text-red-600 dark:text-red-400" :
                                    "text-muted-foreground"
                                );
                                const goMediaSub = (subId) => {
                                    setMediaSubStep(subId);
                                    if (activeStep !== "media") handleTabChange("media");
                                };
                                const imagesOk = !!poster;
                                const ticketOk = !!form.ticket_design?.elements?.length;

                                return (
                                    <div key={s.id} className="w-full space-y-0.5">
                                        <TabsTrigger
                                            value={s.id}
                                            className={`w-full justify-start gap-2 px-2.5 py-2 text-left rounded-lg
                                                       data-[state=active]:bg-primary data-[state=active]:text-primary-foreground
                                                       ${rowBg}`}
                                            data-testid={`tab-${s.id}`}
                                            onClick={() => {
                                                if (s.id === "media") setMediaSubStep("images");
                                            }}
                                        >
                                            <StepIcon status={st} size="md" />
                                            <span className={`text-[11px] shrink-0 ${numColor}`}>
                                                {i + 1}.
                                            </span>
                                            <span className="text-xs leading-tight">
                                                {s.label}
                                            </span>
                                        </TabsTrigger>

                                        {s.id === "media" && (
                                            <div
                                                className="pl-3 ml-2 border-l border-border/70 space-y-0.5"
                                                data-testid="media-sidebar-substeps"
                                            >
                                                {MEDIA_SUBSTEPS.map((sub) => {
                                                    const subActive =
                                                        isActive && mediaSubStep === sub.id;
                                                    const subDone =
                                                        sub.id === "images" ? imagesOk : ticketOk;
                                                    return (
                                                        <button
                                                            key={sub.id}
                                                            type="button"
                                                            onClick={() => goMediaSub(sub.id)}
                                                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition ${
                                                                subActive
                                                                    ? "bg-primary/15 text-primary font-medium"
                                                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                                            }`}
                                                            data-testid={`tab-media-${sub.id}`}
                                                            aria-current={subActive ? "step" : undefined}
                                                        >
                                                            <span
                                                                className={`h-3.5 w-3.5 shrink-0 rounded-full border flex items-center justify-center ${
                                                                    subDone
                                                                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-600"
                                                                        : "border-muted-foreground/40"
                                                                }`}
                                                            >
                                                                {subDone && (
                                                                    <Check className="h-2.5 w-2.5" />
                                                                )}
                                                            </span>
                                                            <span className="tabular-nums shrink-0 opacity-70">
                                                                {sub.num}
                                                            </span>
                                                            <span className="leading-tight truncate">
                                                                {sub.label}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </TabsList>
                    </div>
                </div>
            </Tabs>

            {/* Footer ─────────────────────────────────────── */}
            {saveIssues.length > 0 && (
                <div
                    className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 space-y-2"
                    data-testid="wizard-issues-panel"
                    role="alert"
                >
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-red-900">
                                {issuesMode === "publish"
                                    ? "No se puede publicar todavía"
                                    : "No se puede guardar el borrador todavía"}
                            </p>
                            <p className="text-xs text-red-800/80 mt-0.5">
                                Tocá cada ítem para ir a la sección que falta completar.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="text-xs text-red-800/70 hover:text-red-900 underline"
                            onClick={() => setSaveIssues([])}
                            data-testid="wizard-issues-dismiss"
                        >
                            Cerrar
                        </button>
                    </div>
                    <ul className="space-y-1.5 pl-6">
                        {saveIssues.map((issue) => (
                            <li key={issue.code}>
                                <button
                                    type="button"
                                    onClick={() => handleTabChange(issue.step)}
                                    className="text-left text-sm text-red-950 hover:underline"
                                    data-testid={`wizard-issue-${issue.code}`}
                                >
                                    <span className="font-medium">
                                        {stepLabelForIssue(issue.step, STEPS)}:
                                    </span>{" "}
                                    {issue.message}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

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
function evalStepStatus(form, poster, currentEvent, pendingVenueId = null) {
    const s: Record<string, string | undefined> = {};

    const titleOk = form.title?.length >= 2;
    const startsOk = !!form.starts_at;
    const durationOk = form.duration_preset && form.duration_preset !== "custom"
        ? true
        : Number(form.duration_minutes_custom || 0) > 0;
    const whereOk = form.no_seating_mode
        ? !!form.venue_name
        : !!(form.venue_id || currentEvent?.venue_id || pendingVenueId);

    // General: title only; location lives in Localidades (DondeBlock).
    s.general = titleOk ? "ok" : "error";

    // Fechas y ventas: start + duration required.
    s.fechas = startsOk && durationOk ? "ok" : startsOk ? "warn" : "error";

    // Media: warn until there's a poster (strongly recommended but not required).
    // Custom ticket design bumps it to ok even without poster.
    s.media = poster || currentEvent?.ticket_design?.elements?.length > 0
        ? "ok"
        : "warn";

    // Localidades: seated → venue_id; general → venue_name + pricing rules.
    const pricingOk =
        form.pricing_type === "free"
        || (form.pricing_type === "paid" && Number(form.base_price_dollars) > 0)
        || form.pricing_type === "donation";
    s.localidades = form.no_seating_mode
        ? !whereOk
            ? "warn"
            : pricingOk
            ? "ok"
            : form.pricing_type === "paid" && !Number(form.base_price_dollars)
            ? "error"
            : "warn"
        : whereOk
        ? "ok"
        : "warn";

    // Payments: at least one catalog code (free events skip this step)
    const enabledCodes = resolveEnabledPaymentCodes(form.payment_methods, {
        includeLegacyStripe: false,
    });
    s.payments = form.pricing_type === "free" || enabledCodes.length > 0 ? "ok" : "warn";

    // Discounts: ok only once the organizer has configured at least one rule
    const hasDiscount = form.discounts?.disability_law?.enabled
        || form.discounts?.presale?.enabled
        || (form.discounts?.rules?.length > 0);
    s.discounts = hasDiscount ? "ok" : undefined;

    // Accesos: visibility / access_type always have defaults
    s.access = form.visibility && form.access_params?.access_type ? "ok" : "warn";

    // Parámetros: purchase limits + delivery
    s.params = (form.access_params?.max_per_purchase ?? 0) > 0 ? "ok" : "warn";

    return s;
}

function buildPayload(form) {
    const tz = form.timezone || DEFAULT_TZ;
    const startsIso = form.starts_at ? localInputToIso(form.starts_at, tz) : null;
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
        form.sales_start_custom ? localInputToIso(form.sales_start_custom, tz) : null,
    );
    const salesEnd = computeSalesEnd(
        startsIso,
        form.sales_window_preset_end,
        form.sales_end_custom ? localInputToIso(form.sales_end_custom, tz) : null,
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
        visibility: form.visibility,
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
                ? localInputToIso(form.ticket_delivery_at, tz)
                : null,
        multi_function_mode: form.multi_function_mode || "function",
        priority: Number(form.priority) || 0,
        video_url: form.video_url || null,
        keywords: Array.isArray(form.keywords) ? form.keywords : [],
    };
}

function StepIcon({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
    const cls = size === "md" ? "h-4 w-4 shrink-0" : "h-3.5 w-3.5 shrink-0";
    if (status === "ok")
        return <CheckCircle2 className={`${cls} text-emerald-500`} />;
    if (status === "warn")
        return <Circle className={`${cls} text-amber-500 fill-amber-500/30`} />;
    if (status === "error")
        return <AlertTriangle className={`${cls} text-red-500`} />;
    return <Circle className={`${cls} text-muted-foreground/40`} />;
}

// ── Section: General (info principal + descripción) ─────────────────────────
function SectionGeneral({ form, update, disabled }) {
    const [keywordDraft, setKeywordDraft] = useState("");
    const keywords = Array.isArray(form.keywords) ? form.keywords : [];
    const categoryLabel =
        EVENT_CATEGORIES.find((c) => c.code === form.category)?.label || form.category;
    const pricingLabel = PRICING_LABELS[form.pricing_type] || form.pricing_type;

    const addKeyword = () => {
        const kw = keywordDraft.trim();
        if (!kw) return;
        if (keywords.includes(kw)) {
            setKeywordDraft("");
            return;
        }
        update("keywords", [...keywords, kw]);
        setKeywordDraft("");
    };

    const removeKeyword = (kw) => {
        update(
            "keywords",
            keywords.filter((k) => k !== kw),
        );
    };

    return (
        <div className="space-y-6" data-testid="section-general">
            <div>
                <h3 className="font-semibold text-base">General</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Nombre, tipo y textos del evento.
                    {form.title?.trim() && (
                        <>
                            {" · "}
                            <strong className="text-foreground">{form.title.trim()}</strong>
                        </>
                    )}
                    {categoryLabel && (
                        <>
                            {" · "}
                            <strong className="text-foreground">{categoryLabel}</strong>
                        </>
                    )}
                    {" · "}
                    <strong className="text-foreground">{pricingLabel}</strong>
                </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
                <section className="space-y-3" data-testid="info-datos-block">
                    <div>
                        <h4 className="text-sm font-medium">1. Información principal</h4>
                        <p className="text-xs text-muted-foreground">
                            Datos que identifican el evento en el microsite.
                        </p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
                        <Field label="Nombre *" testId="wiz-title">
                            <Input
                                value={form.title}
                                onChange={(e) => update("title", e.target.value)}
                                maxLength={140}
                                disabled={disabled}
                                placeholder="Ej: Concierto Acústico"
                                data-testid="event-title-input"
                            />
                        </Field>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <Field label="Tipo de evento">
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
                            <Field
                                label={
                                    <LabelWithTip
                                        text="Prioridad"
                                        tip="Si tenés varios eventos en el microsite, un número más alto aparece más arriba en el listado. Podés dejarlo en 0 si el orden por fecha te alcanza."
                                    />
                                }
                            >
                                <Input
                                    type="number"
                                    min="0"
                                    max="9999"
                                    value={form.priority ?? 0}
                                    onChange={(e) =>
                                        update("priority", parseInt(e.target.value || "0", 10))
                                    }
                                    disabled={disabled}
                                    data-testid="wiz-priority"
                                />
                            </Field>
                        </div>

                        <Field label="URL de video">
                            <Input
                                type="url"
                                value={form.video_url || ""}
                                onChange={(e) => update("video_url", e.target.value)}
                                disabled={disabled}
                                placeholder="https://youtube.com/watch?v=…"
                                data-testid="wiz-video-url"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Opcional · YouTube o Vimeo embebido en la página del evento.
                            </p>
                        </Field>

                        <div className="space-y-2">
                            <Label>Tipo de recaudación</Label>
                            <p className="text-xs text-muted-foreground -mt-1">
                                Define el resto del wizard (cobros, localidades, donación).
                            </p>
                            <div className="grid grid-cols-3 gap-2" data-testid="wiz-pricing-type">
                                {[
                                    {
                                        value: "paid",
                                        title: "Pago",
                                        description: "Cobrá por localidad o precio fijo.",
                                    },
                                    {
                                        value: "free",
                                        title: "Gratis",
                                        description: "Sin cobro. Reserva / inscripción.",
                                    },
                                    {
                                        value: "donation",
                                        title: "Donación",
                                        description: "El comprador elige el monto.",
                                    },
                                ].map((opt) => {
                                    const selected = form.pricing_type === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => update("pricing_type", opt.value)}
                                            data-testid={`wiz-pricing-${opt.value}`}
                                            className={`rounded-lg border p-3 text-left transition ${
                                                selected
                                                    ? "border-foreground/30 ring-1 ring-foreground/10 bg-card"
                                                    : "border-border hover:border-foreground/20 bg-card"
                                            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <div className="font-medium text-sm">{opt.title}</div>
                                                {selected && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-[10px] font-normal"
                                                    >
                                                        Activo
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                                {opt.description}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {form.pricing_type === "donation" && (
                            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                                <div className="min-w-0">
                                    <div className="font-medium text-sm">Emitir tickets tipo rifa</div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Cada ticket recibe un número secuencial para sorteos.
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
                </section>

                <section className="space-y-3" data-testid="info-desc-block">
                    <div>
                        <h4 className="text-sm font-medium">2. Descripción</h4>
                        <p className="text-xs text-muted-foreground">
                            Textos que ve el público en la página del evento.
                        </p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4 h-full">
                        <Field
                            label={
                                <span className="flex items-center justify-between w-full gap-2">
                                    <span>Descripción corta</span>
                                    <span className="text-[11px] font-normal text-muted-foreground">
                                        {(form.short_description || "").length}/160
                                    </span>
                                </span>
                            }
                        >
                            <Textarea
                                value={form.short_description}
                                onChange={(e) => update("short_description", e.target.value)}
                                maxLength={160}
                                rows={2}
                                placeholder="Resumen para listados y compartir"
                                data-testid="wiz-short-input"
                            />
                        </Field>
                        <Field
                            label={
                                <span className="flex items-center justify-between w-full gap-2">
                                    <span>Descripción completa</span>
                                    <span className="text-[11px] font-normal text-muted-foreground">
                                        {(form.description || "").length}/8000
                                    </span>
                                </span>
                            }
                        >
                            <Textarea
                                value={form.description}
                                onChange={(e) => update("description", e.target.value)}
                                maxLength={8000}
                                rows={7}
                                placeholder="Detalle del evento, artistas, horarios…"
                                data-testid="wiz-desc-input"
                            />
                        </Field>
                        <Field label="Palabras clave">
                            <div className="flex gap-2">
                                <Input
                                    value={keywordDraft}
                                    onChange={(e) => setKeywordDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            addKeyword();
                                        }
                                    }}
                                    placeholder="Ej: rock, familiar, outdoor"
                                    disabled={disabled}
                                    data-testid="wiz-keyword-input"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={addKeyword}
                                    disabled={disabled || !keywordDraft.trim()}
                                    data-testid="wiz-keyword-add"
                                >
                                    Agregar
                                </Button>
                            </div>
                            {keywords.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5 mt-2" data-testid="wiz-keywords">
                                    {keywords.map((kw) => (
                                        <Badge
                                            key={kw}
                                            variant="secondary"
                                            className="gap-1 pr-1"
                                        >
                                            {kw}
                                            <button
                                                type="button"
                                                onClick={() => removeKeyword(kw)}
                                                disabled={disabled}
                                                className="rounded-sm p-0.5 hover:bg-muted"
                                                aria-label={`Quitar ${kw}`}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground mt-1.5">
                                    Opcional · ayudan a buscar el evento en el microsite.
                                </p>
                            )}
                        </Field>
                    </div>
                </section>
            </div>

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium">3. Contenido avanzado</h4>
                    <p className="text-xs text-muted-foreground">
                        Agenda, FAQ, artistas u otros bloques opcionales.
                    </p>
                </div>
                <details className="rounded-xl border bg-card group open:pb-0">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 p-4 sm:p-5">
                        <span className="text-sm font-medium">Mostrar contenido avanzado</span>
                        <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                            <span className="group-open:hidden">Expandir</span>
                            <span className="hidden group-open:inline">Ocultar</span>
                        </Badge>
                    </summary>
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t pt-4">
                        <EventContentPanel
                            content={form.content}
                            update={update}
                            disabled={disabled}
                        />
                    </div>
                </details>
            </section>
        </div>
    );
}

function SectionFechas({ form, update, disabled, eventId, localities }) {
    const durationLabel =
        DURATION_PRESETS.find((p) => p.key === form.duration_preset)?.label
        || form.duration_preset;
    const salesStartLabel =
        SALES_START_PRESETS.find((p) => p.key === form.sales_window_preset_start)?.label
        || form.sales_window_preset_start;
    const modeLabel =
        form.multi_function_mode === "subevent" ? "Subeventos" : "Funciones";

    return (
        <div className="space-y-6" data-testid="section-fechas">
            <div>
                <h3 className="font-semibold text-base">Fechas y ventas</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Cuándo ocurre el evento y cuándo se pueden comprar tickets.
                    {form.starts_at && (
                        <>
                            {" · Inicio: "}
                            <strong className="text-foreground">
                                {form.starts_at.replace("T", " ")}
                            </strong>
                        </>
                    )}
                    {durationLabel && (
                        <>
                            {" · "}
                            <strong className="text-foreground">{durationLabel}</strong>
                        </>
                    )}
                    {" · "}
                    <strong className="text-foreground">{modeLabel}</strong>
                </p>
            </div>

            <CuandoBlock form={form} update={update} disabled={disabled} />

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium">3. Funciones o subeventos</h4>
                    <p className="text-xs text-muted-foreground">
                        Opcional · varias fechas, franjas o experiencias independientes.
                        Venta: <strong className="text-foreground">{salesStartLabel}</strong>
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <ChoiceCard
                        icon={CalendarClock}
                        title="Funciones"
                        description="El mismo show se repite en varias fechas u horarios."
                        selected={form.multi_function_mode !== "subevent"}
                        onSelect={() => update("multi_function_mode", "function")}
                        testid="wiz-multi-function-mode-function"
                        disabled={disabled}
                    />
                    <ChoiceCard
                        icon={CalendarClock}
                        title="Subeventos"
                        description="Experiencias independientes (VIP, cena, meet & greet)."
                        selected={form.multi_function_mode === "subevent"}
                        onSelect={() => update("multi_function_mode", "subevent")}
                        testid="wiz-multi-function-mode-subevent"
                        disabled={disabled}
                    />
                </div>
                {/* Keep legacy testid for e2e / tooling that looks for the mode control */}
                <input
                    type="hidden"
                    data-testid="wiz-multi-function-mode"
                    value={form.multi_function_mode || "function"}
                    readOnly
                />

                <div className="rounded-xl border bg-card p-4 sm:p-5">
                    <EventFunctionsPanel
                        eventId={eventId}
                        localities={localities}
                        mode={form.multi_function_mode}
                        timezone={form.timezone}
                    />
                </div>
            </section>
        </div>
    );
}

function CuandoBlock({ form, update, disabled }) {
    const startsValid = !!form.starts_at;
    return (
        <>
            <section className="space-y-3" data-testid="info-cuando-block">
                <div>
                    <h4 className="text-sm font-medium">1. Fecha y duración</h4>
                    <p className="text-xs text-muted-foreground">
                        Inicio del evento, cuánto dura y zona horaria.
                    </p>
                </div>
                <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Fecha y hora de inicio *">
                            <DateTimePicker
                                value={form.starts_at}
                                onChange={(v) => update("starts_at", v)}
                                disabled={disabled}
                                placeholder="Elegí cuándo empieza"
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
                </div>
            </section>

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" />
                        2. Ventana de venta
                    </h4>
                    <p className="text-xs text-muted-foreground">
                        Cuándo se habilita y se cierra la compra. Se calcula desde la fecha de inicio.
                    </p>
                </div>
                <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
                    {!startsValid && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            Definí primero la fecha de inicio para habilitar estos presets.
                        </p>
                    )}
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
                            <DateTimePicker
                                value={form.sales_start_custom}
                                onChange={(v) => update("sales_start_custom", v)}
                                disabled={disabled}
                                placeholder="Inicio de venta"
                                data-testid="wiz-sales-start-custom"
                            />
                        </Field>
                    )}
                    {form.sales_window_preset_end === "custom" && (
                        <Field label="Fin de venta — fecha personalizada">
                            <DateTimePicker
                                value={form.sales_end_custom}
                                onChange={(v) => update("sales_end_custom", v)}
                                disabled={disabled}
                                placeholder="Fin de venta"
                                data-testid="wiz-sales-end-custom"
                            />
                        </Field>
                    )}
                </div>
            </section>
        </>
    );
}

function DondeBlock({
    form,
    update,
    disabled,
    currentEvent,
}) {
    const seatedMode = !form.no_seating_mode; // ON => numbered venue
    const linkedVenueId = currentEvent?.venue_id || form.venue_id || null;
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

    const handleModeChange = (numbered) => {
        if (numbered && isDonation) {
            toast.error(
                "Los eventos de donación no admiten venue con asientos numerados.",
            );
            return;
        }
        if (!numbered && linkedVenueId) {
            toast.error(
                "Para cambiar a evento general primero desvinculá el mapa más abajo.",
            );
            return;
        }
        update("no_seating_mode", !numbered);
    };

    return (
        <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="info-donde-block">
            <div>
                <h3 className="font-semibold text-base">1. Tipo de lugar</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Con mapa de asientos o ubicación general con precio único.
                </p>
            </div>

            <div className="flex items-start gap-3 rounded-lg border bg-secondary/30 p-3">
                <Switch
                    checked={seatedMode}
                    onCheckedChange={handleModeChange}
                    disabled={disabled || (isDonation && !seatedMode)}
                    data-testid="wiz-seated-toggle"
                />
                <div className="text-sm">
                    <p className="font-medium leading-tight">
                        Asientos numerados (mapa)
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {isDonation
                            ? "No disponible en donación: el comprador elige el monto."
                            : seatedMode
                              ? "Activado: abajo elegís el mapa y definís el precio de cada localidad."
                              : "Apagado: solo nombre del lugar, dirección y un precio base."}
                    </p>
                </div>
            </div>

            {!seatedMode && (
                <GeneralLocationFields form={form} update={update} disabled={disabled} />
            )}
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

// ── Section: Venue y localidades (mapa + precios, o precio general) ─────────
function SectionVenueLocalidades({
    form,
    update,
    disabled,
    event,
    onEventUpdated,
    onJumpToInfo,
    onReturnFromVenueCreate,
    pendingVenueId = null,
    onPendingVenueChange,
}) {
    const hasVenue = !!(event?.venue_id || pendingVenueId);
    const isGeneralMode = form.no_seating_mode && !hasVenue;
    const seatedMode = !form.no_seating_mode;

    return (
        <div className="space-y-5" data-testid="section-venue-localidades">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                    Recaudación:{" "}
                    <strong className="text-foreground">
                        {PRICING_LABELS[form.pricing_type] || form.pricing_type}
                    </strong>
                </span>
                {onJumpToInfo && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onJumpToInfo}>
                        Cambiar en General
                    </Button>
                )}
            </div>

            {isGeneralMode && (
                <div className="space-y-3 rounded-xl border p-5 bg-card">
                    <div>
                        <h3 className="font-semibold text-base">2. Precio y capacidad</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Un solo precio para todo el evento (sin mapa de asientos).
                        </p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Precio (USD)</Label>
                            {form.pricing_type === "free" ? (
                                <p className="text-sm text-muted-foreground h-9 flex items-center">Sin costo</p>
                            ) : (
                                <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="pl-6"
                                        value={form.base_price_dollars}
                                        onChange={(e) => update("base_price_dollars", e.target.value)}
                                        disabled={disabled}
                                        data-testid="wiz-price"
                                    />
                                </div>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">Capacidad</Label>
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Switch
                                        checked={form.unlimited_capacity}
                                        onCheckedChange={(v) => update("unlimited_capacity", v)}
                                        data-testid="wiz-unlimited"
                                    />
                                    Sin límite
                                </label>
                            </div>
                            <Input
                                type="number"
                                min="0"
                                value={form.unlimited_capacity ? "" : form.capacity}
                                onChange={(e) => update("capacity", e.target.value)}
                                disabled={form.unlimited_capacity}
                                placeholder={form.unlimited_capacity ? "Sin límite" : "ej: 100"}
                                data-testid="wiz-capacity"
                            />
                        </div>
                    </div>
                </div>
            )}

            {seatedMode && (
                <div className="space-y-3">
                    <div>
                        <h3 className="font-semibold text-base">2. Escenario y localidades</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            El mapa es solo la forma. Nombre, color y precios son de este evento;
                            podés usar un subconjunto de las secciones del plano.
                        </p>
                    </div>
                    <EventVenueSection
                        event={event}
                        disabled={disabled}
                        onUpdated={onEventUpdated}
                        onReturnFromVenueCreate={onReturnFromVenueCreate}
                        pendingVenueId={pendingVenueId}
                        onPendingVenueChange={onPendingVenueChange}
                    />
                </div>
            )}
        </div>
    );
}

// ── Section: Media ──────────────────────────────────────────────────────────
function SectionMedia({
    poster,
    banner,
    small,
    gallery,
    uploadingKind,
    onUpload,
    onDeleteGallery,
    onReorderGallery,
    eventId: _eventId,
}) {
    const readyCount = [banner, poster, small].filter(Boolean).length;

    return (
        <div className="space-y-5" data-testid="section-media">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h3 className="font-semibold text-base">Imágenes del evento</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Cada número del mapa indica dónde aparece el arte. La imagen
                        principal es obligatoria para publicar.
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <Badge variant={poster ? "default" : "outline"}>
                        Principal {poster ? "✓" : "requerida"}
                    </Badge>
                    <Badge variant={banner ? "secondary" : "outline"}>Portada</Badge>
                    <Badge variant={small ? "secondary" : "outline"}>Miniatura</Badge>
                    <Badge variant={gallery.length ? "secondary" : "outline"}>
                        Galería {gallery.length}/10
                    </Badge>
                </div>
            </div>

            <EventMediaCompositePreview
                poster={poster}
                banner={banner}
                small={small}
                gallery={gallery}
                assetUrl={assetUrl}
            />

            {/* Imagen principal (poster) — required */}
            <div className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div>
                        <div className="font-medium flex items-center gap-2">
                            Imagen principal
                            <span className="text-red-500 text-sm">*</span>
                            {poster && (
                                <Badge variant="secondary" className="text-[10px] font-normal">Lista</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            ② Cards del microsite y ticket PDF · cuadrada · recomendado 1080×1080
                        </p>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="max-w-xs w-full">
                        <ImageDropzone
                            label=""
                            currentUrl={assetUrl(poster)}
                            onUpload={(f) => onUpload(f, "poster")}
                            uploading={uploadingKind === "poster"}
                            testid="wiz-poster"
                            aspect="square"
                        />
                    </div>
                    <MediaSlotMock kind="poster" src={poster} assetUrl={assetUrl} />
                </div>
            </div>

            {/* Portada + Miniatura */}
            <div className="grid lg:grid-cols-2 gap-4">
                <div className="rounded-xl border bg-card p-4 sm:p-5">
                    <div className="mb-3">
                        <div className="font-medium flex items-center gap-2">
                            Portada / hero
                            <span className="text-xs font-normal text-muted-foreground">opcional</span>
                            {banner && (
                                <Badge variant="secondary" className="text-[10px] font-normal">Lista</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            ① Cabecera de la página del evento · 16:9 · recomendado 1920×1080
                        </p>
                    </div>
                    <div className="space-y-3">
                        <ImageDropzone
                            label=""
                            currentUrl={assetUrl(banner)}
                            onUpload={(f) => onUpload(f, "banner")}
                            uploading={uploadingKind === "banner"}
                            testid="wiz-banner"
                            aspect="video"
                        />
                        <MediaSlotMock kind="banner" src={banner} assetUrl={assetUrl} />
                    </div>
                </div>

                <div className="rounded-xl border bg-card p-4 sm:p-5">
                    <div className="mb-3">
                        <div className="font-medium flex items-center gap-2">
                            Miniatura en listados
                            <span className="text-xs font-normal text-muted-foreground">opcional</span>
                            {small && (
                                <Badge variant="secondary" className="text-[10px] font-normal">Lista</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            ③ Thumb en listados · si no la subís, se usa la principal · recomendado 400×400
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        <div className="max-w-[220px] w-full">
                            <ImageDropzone
                                label=""
                                currentUrl={assetUrl(small)}
                                onUpload={(f) => onUpload(f, "small")}
                                uploading={uploadingKind === "small"}
                                testid="wiz-small"
                                aspect="square"
                            />
                        </div>
                        <MediaSlotMock kind="small" src={small} assetUrl={assetUrl} />
                    </div>
                </div>
            </div>

            {/* Gallery */}
            <div className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div>
                        <div className="font-medium flex items-center gap-2">
                            Fotos extras (galería)
                            <span className="text-xs font-normal text-muted-foreground">opcional</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            ④ Carrusel en la página del evento. Hasta 10. Arrastrá para reordenar.
                        </p>
                    </div>
                    <span className="text-xs text-muted-foreground" data-testid="wiz-gallery-counter">
                        {gallery.length} / 10
                    </span>
                </div>
                <div className="space-y-3">
                    <MediaSlotMock kind="gallery" src={gallery} assetUrl={assetUrl} />
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

            {readyCount === 0 && (
                <p className="text-xs text-muted-foreground">
                    Tip: empezá por la <strong>imagen principal</strong>; es la que más se ve
                    en el microsite y el ticket.
                </p>
            )}
        </div>
    );
}

// ── Section: Ticket design (M4) ─────────────────────────────────────────────
function SectionTicketDesign({ form, update, eventId }) {
    if (!eventId) {
        return (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="section-ticket-design">
                <p className="font-medium text-foreground">Diseño del ticket</p>
                <p className="mt-1">
                    Guardá primero la información general del evento para poder diseñar el ticket.
                </p>
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
    const hasMainDesign = !!form.ticket_design?.elements?.length;

    return (
        <div className="space-y-4" data-testid="section-ticket-design">
            <div>
                <h3 className="font-semibold text-base">Diseño del ticket</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Elegí una plantilla y tu logo. Si no diseñás nada, se usa el formato estándar de TYS.
                    {hasMainDesign && (
                        <> · <strong className="text-foreground">Plantilla activa</strong></>
                    )}
                </p>
            </div>

            <div className="rounded-xl border p-4 sm:p-5 bg-card space-y-3">
                <TicketDesignPanel
                    eventId={eventId}
                    slot="main"
                    design={form.ticket_design}
                    onChange={(next) => update("ticket_design", next)}
                />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                <div className="text-sm min-w-0">
                    <div className="font-medium">Diseño aparte para cortesías</div>
                    <div className="text-xs text-muted-foreground">
                        Si está apagado, las cortesías usan el mismo diseño de arriba.
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
                <div className="rounded-xl border p-4 sm:p-5 bg-card space-y-3">
                    <div className="text-sm font-medium">Diseño de cortesía</div>
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


const PAYMENT_CARD_ICONS = {
    nuvei: CreditCard,
    deuna: Smartphone,
    transfer: Landmark,
    cash: Banknote,
};

function SectionPayments({ form, update }) {
    const [catalog, setCatalog] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await api.get("/payment-methods");
                if (!cancelled) setCatalog(Array.isArray(data) ? data : []);
            } catch {
                if (!cancelled) {
                    setCatalog([
                        { code: "nuvei", name: "Nuvei", kind: "gateway", description: "Pago digital" },
                        { code: "deuna", name: "DeUna", kind: "gateway", description: "Pago digital" },
                        { code: "transfer", name: "Transferencia", kind: "manual", description: "Confirmación manual" },
                        { code: "cash", name: "Efectivo", kind: "manual", description: "Pago en persona" },
                    ]);
                }
            } finally {
                if (!cancelled) setCatalogLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (form.pricing_type === "free") {
        return (
            <div
                className="rounded-xl border border-dashed p-10 bg-card text-center"
                data-testid="section-payments"
            >
                <Info className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="font-medium">Evento gratuito</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    No hace falta configurar formas de pago. Los compradores confirman sin cobrar.
                </p>
            </div>
        );
    }

    const pm = form.payment_methods || defaultPayments();
    const selected = resolveEnabledPaymentCodes(pm, { includeLegacyStripe: false });
    const total = catalog.length || 4;

    const setCodes = (codes) => {
        update("payment_methods", withEnabledCodes(pm, codes));
    };

    const toggleCode = (code) => {
        if (selected.includes(code)) {
            setCodes(selected.filter((c) => c !== code));
        } else {
            setCodes([...selected, code]);
        }
    };

    return (
        <div className="space-y-5" data-testid="section-payments">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-semibold text-base">Formas de pago</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Elegí cómo podrán pagar los compradores.
                        {" · "}
                        <strong className="text-foreground" data-testid="pay-selected-count">
                            {selected.length} de {total} seleccionadas
                        </strong>
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCodes(catalog.map((c) => c.code))}
                        disabled={catalogLoading || catalog.length === 0}
                        data-testid="pay-select-all"
                    >
                        Seleccionar todo
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCodes([])}
                        data-testid="pay-clear"
                    >
                        Limpiar
                    </Button>
                </div>
            </div>

            {catalogLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando métodos…
                </div>
            ) : (
                <div className="grid sm:grid-cols-2 gap-3" data-testid="pay-method-grid">
                    {catalog.map((item) => {
                        const Icon = PAYMENT_CARD_ICONS[item.code] || CreditCard;
                        const on = selected.includes(item.code);
                        return (
                            <button
                                key={item.code}
                                type="button"
                                onClick={() => toggleCode(item.code)}
                                className={`relative text-left rounded-xl border p-4 transition ${
                                    on
                                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                        : "hover:bg-secondary/40"
                                }`}
                                data-testid={`pay-${item.code}`}
                                aria-pressed={on}
                            >
                                <div
                                    className={`absolute top-3 right-3 h-5 w-5 rounded-full border flex items-center justify-center ${
                                        on
                                            ? "bg-primary border-primary text-primary-foreground"
                                            : "border-muted-foreground/40"
                                    }`}
                                >
                                    {on && <Check className="h-3 w-3" />}
                                </div>
                                <div className="flex items-start gap-3 pr-6">
                                    <div className="rounded-lg bg-secondary p-2">
                                        <Icon className="h-5 w-5 text-foreground" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm">{item.name}</div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {item.description ||
                                                (item.kind === "gateway"
                                                    ? "Pago digital"
                                                    : "Confirmación manual")}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {selected.includes("transfer") && (
                <div className="rounded-xl border p-4 space-y-3" data-testid="pay-transfer-form">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Datos de transferencia
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Banco">
                            <Input
                                value={pm.transfer?.bank_name || ""}
                                onChange={(e) =>
                                    update("payment_methods.transfer.bank_name", e.target.value)
                                }
                                placeholder="Ej: Pichincha"
                                data-testid="pay-transfer-bank"
                            />
                        </Field>
                        <Field label="Número de cuenta">
                            <Input
                                value={pm.transfer?.account_number || ""}
                                onChange={(e) =>
                                    update("payment_methods.transfer.account_number", e.target.value)
                                }
                                data-testid="pay-transfer-acc"
                            />
                        </Field>
                    </div>
                    <Field label="Titular">
                        <Input
                            value={pm.transfer?.account_holder || ""}
                            onChange={(e) =>
                                update("payment_methods.transfer.account_holder", e.target.value)
                            }
                            data-testid="pay-transfer-holder"
                        />
                    </Field>
                    <Field label="Instrucciones">
                        <Textarea
                            value={pm.transfer?.instructions || ""}
                            onChange={(e) =>
                                update("payment_methods.transfer.instructions", e.target.value)
                            }
                            rows={3}
                            placeholder="Ej: Enviá el comprobante al WhatsApp +593…"
                            data-testid="pay-transfer-inst"
                        />
                    </Field>
                </div>
            )}

            {selected.includes("cash") && (
                <div className="rounded-xl border p-4 space-y-3" data-testid="pay-cash-form">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Punto de cobro en efectivo
                    </p>
                    <Field label="Lugar">
                        <Input
                            value={pm.cash?.location || ""}
                            onChange={(e) =>
                                update("payment_methods.cash.location", e.target.value)
                            }
                            placeholder="Taquilla / oficina"
                            data-testid="pay-cash-location"
                        />
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Horarios">
                            <Input
                                value={pm.cash?.schedule || ""}
                                onChange={(e) =>
                                    update("payment_methods.cash.schedule", e.target.value)
                                }
                                placeholder="Lun–Vie 9:00–18:00"
                                data-testid="pay-cash-schedule"
                            />
                        </Field>
                        <Field label="Contacto">
                            <Input
                                value={pm.cash?.contact || ""}
                                onChange={(e) =>
                                    update("payment_methods.cash.contact", e.target.value)
                                }
                                placeholder="+593…"
                                data-testid="pay-cash-contact"
                            />
                        </Field>
                    </div>
                </div>
            )}
        </div>
    );
}

function enabledPaymentMethodsOf(pm) {
    return resolveEnabledPaymentCodes(pm, { includeLegacyStripe: false });
}

// ── Section: Discounts ──────────────────────────────────────────────────────
function SectionDiscounts({ form, update, venueLocalities = [], eventId = null }) {
    const d = form.discounts;
    const rulesCount = (d.rules || []).filter((r) => r.enabled).length;

    return (
        <div className="space-y-6" data-testid="section-discounts">
            <div>
                <h3 className="font-semibold text-base">Descuentos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Configura descuentos por porcentaje, valor fijo o promociones 2x1.
                    {rulesCount > 0 && (
                        <> · <strong className="text-foreground">{rulesCount}</strong> activo{rulesCount !== 1 ? "s" : ""}</>
                    )}
                </p>
            </div>

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium">1. Beneficios fijos</h4>
                    <p className="text-xs text-muted-foreground">
                        Se aplican en checkout sin código promocional.
                    </p>
                </div>

                <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-3">
                        <div
                            className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                                d.disability_law.enabled
                                    ? "bg-teal-50 text-teal-800"
                                    : "bg-secondary text-muted-foreground"
                            }`}
                        >
                            <Accessibility className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium">Ley de discapacidad (Ecuador)</div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                50% de descuento para compradores que acrediten discapacidad.
                            </p>
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

                <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-3">
                        <div
                            className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                                d.presale.enabled
                                    ? "bg-teal-50 text-teal-800"
                                    : "bg-secondary text-muted-foreground"
                            }`}
                        >
                            <Percent className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium">Preventa</div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Porcentaje automático hasta una fecha límite.
                            </p>
                        </div>
                        <Switch
                            checked={d.presale.enabled}
                            onCheckedChange={(v) => update("discounts.presale.enabled", v)}
                            data-testid="disc-presale"
                        />
                    </div>
                    {d.presale.enabled && (
                        <div className="mt-4 pt-4 border-t grid sm:grid-cols-2 gap-3">
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
                                            ? isoToLocalInput(d.presale.ends_at, form.timezone)
                                            : ""
                                    }
                                    onChange={(e) =>
                                        update(
                                            "discounts.presale.ends_at",
                                            e.target.value
                                                ? localInputToIso(e.target.value, form.timezone)
                                                : null,
                                        )
                                    }
                                    data-testid="disc-presale-ends"
                                />
                            </Field>
                        </div>
                    )}
                </div>
            </section>

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium">2. Descuentos del evento</h4>
                    <p className="text-xs text-muted-foreground">
                        Con o sin código. Stacking máximo: 1 código + 1 automático/promo.
                    </p>
                </div>
                <DiscountRulesPanel
                    rules={d.rules || []}
                    onChange={(next) => update("discounts.rules", next)}
                    localities={venueLocalities}
                    enabledPaymentMethods={enabledPaymentMethodsOf(form.payment_methods)}
                />
            </section>

            {eventId && (
                <section className="space-y-3">
                    <div>
                        <h4 className="text-sm font-medium">3. Uso y conversión</h4>
                        <p className="text-xs text-muted-foreground">
                            Cómo rindieron tus reglas en órdenes pagadas.
                        </p>
                    </div>
                    <DiscountsReportPanel eventId={eventId} />
                </section>
            )}
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

    if (loading) {
        return (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Cargando reporte…
            </div>
        );
    }

    if (!report || report.length === 0) {
        return (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Todavía no hay usos registrados. El reporte aparece cuando haya órdenes pagadas con descuento.
            </div>
        );
    }

    return (
        <div className="rounded-xl border p-4 bg-card space-y-3" data-testid="discounts-report-panel">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                            <th className="py-2 pr-3 font-medium">Regla</th>
                            <th className="py-2 pr-3 font-medium">Influencer</th>
                            <th className="py-2 pr-3 text-right font-medium">Usos</th>
                            <th className="py-2 pr-3 text-right font-medium">Órdenes</th>
                            <th className="py-2 pr-3 text-right font-medium">Descuento</th>
                            <th className="py-2 text-right font-medium">Ingreso</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report.map((r) => (
                            <tr key={r.rule_id} className="border-b last:border-0" data-testid={`report-row-${r.rule_id}`}>
                                <td className="py-2.5 pr-3">
                                    <span className="font-medium">{r.name}</span>
                                    {r.code && (
                                        <code className="ml-1.5 text-[11px] bg-secondary px-1.5 py-0.5 rounded">
                                            {r.code}
                                        </code>
                                    )}
                                </td>
                                <td className="py-2.5 pr-3 text-muted-foreground text-xs">
                                    {r.influencer_name
                                        ? `${r.influencer_name}${r.channel ? ` · ${r.channel}` : ""}`
                                        : "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {r.uses_count}
                                    {r.max_uses ? `/${r.max_uses}` : ""}
                                </td>
                                <td className="py-2.5 pr-3 text-right">{r.orders_count}</td>
                                <td className="py-2.5 pr-3 text-right">
                                    ${(r.total_discount_cents / 100).toFixed(2)}
                                </td>
                                <td className="py-2.5 text-right font-medium">
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

// ── Section: Accesos ────────────────────────────────────────────────────────
const VISIBILITY_OPTIONS = [
    {
        value: "public",
        icon: Globe,
        title: "Público",
        description: "Aparece en tu microsite y cualquiera puede verlo.",
    },
    {
        value: "public_blocked",
        icon: Lock,
        title: "Público bloqueado",
        description: "Se ve en el microsite, pero solo compra con código o lista.",
    },
    {
        value: "private",
        icon: Link2,
        title: "Privado",
        description: "Solo con link directo. No aparece en listados.",
    },
];

const ACCESS_TYPE_OPTIONS = [
    {
        value: "open",
        icon: Globe,
        title: "Abierto",
        description: "Cualquiera puede comprar sin código ni lista.",
    },
    {
        value: "link_only",
        icon: Link2,
        title: "Solo con link",
        description: "No aparece en listados; hace falta el link directo.",
    },
    {
        value: "verified_list",
        icon: Users,
        title: "Lista verificada",
        description: "Solo quienes estén en la lista (email o cédula).",
    },
    {
        value: "access_code",
        icon: KeyRound,
        title: "Código de acceso",
        description: "El comprador ingresa un código para poder comprar.",
    },
];

function SectionAccess({ form, update, eventId }) {
    const ap = { ...defaultAccessParams(), ...(form.access_params || {}) };
    const visibilityLabel =
        VISIBILITY_OPTIONS.find((o) => o.value === form.visibility)?.title || form.visibility;
    const accessLabel =
        ACCESS_TYPE_OPTIONS.find((o) => o.value === ap.access_type)?.title || ap.access_type;
    const needsListOrCode =
        ap.access_type === "verified_list" || ap.access_type === "access_code";

    return (
        <div className="space-y-6" data-testid="section-access">
            <div>
                <h3 className="font-semibold text-base">Accesos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Quién ve el evento en el microsite y quién puede comprar.
                    El control en puerta se valida con el ticket/QR.
                    {" · "}
                    <strong className="text-foreground">{visibilityLabel}</strong>
                    {" · "}
                    <strong className="text-foreground">{accessLabel}</strong>
                </p>
            </div>

            <section className="space-y-3" data-testid="access-control-block">
                <div>
                    <h4 className="text-sm font-medium">1. Visibilidad</h4>
                    <p className="text-xs text-muted-foreground">
                        Define si el evento aparece en tu microsite.
                    </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3" data-testid="access-visibility">
                    {VISIBILITY_OPTIONS.map((opt) => (
                        <ChoiceCard
                            key={opt.value}
                            icon={opt.icon}
                            title={opt.title}
                            description={opt.description}
                            selected={form.visibility === opt.value}
                            onSelect={() => update("visibility", opt.value)}
                            testid={`access-visibility-${opt.value}`}
                        />
                    ))}
                </div>
            </section>

            <section className="space-y-3">
                <div>
                    <h4 className="text-sm font-medium">2. Quién puede comprar</h4>
                    <p className="text-xs text-muted-foreground">
                        Elegí un modo. Si usás lista o código, configurá los accesos abajo.
                    </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3" data-testid="access-type">
                    {ACCESS_TYPE_OPTIONS.map((opt) => (
                        <ChoiceCard
                            key={opt.value}
                            icon={opt.icon}
                            title={opt.title}
                            description={opt.description}
                            selected={ap.access_type === opt.value}
                            onSelect={() => update("access_params.access_type", opt.value)}
                            testid={`access-type-${opt.value}`}
                        />
                    ))}
                </div>
            </section>

            {needsListOrCode && (
                <section className="space-y-3">
                    <div>
                        <h4 className="text-sm font-medium">
                            3. {ap.access_type === "verified_list" ? "Lista de invitados" : "Códigos de acceso"}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            {ap.access_type === "verified_list"
                                ? "Agregá invitados uno a uno o importá un CSV."
                                : "Creá uno o más códigos con límite de usos y tickets."}
                        </p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 sm:p-5">
                        {/* `key` remounts the boundary (resetting hasError) whenever the
                            access type changes, instead of leaving a transient crash
                            permanently stuck behind the fallback for the rest of the wizard. */}
                        <ErrorBoundary
                            key={`guest-list-${ap.access_type}`}
                            fallback={
                                <p className="text-xs text-muted-foreground p-3">
                                    Error al cargar el panel. Reintenta más tarde.
                                </p>
                            }
                        >
                            {ap.access_type === "verified_list" && (
                                <GuestListPanel eventId={eventId} embedded />
                            )}
                        </ErrorBoundary>
                        <ErrorBoundary
                            key={`access-codes-${ap.access_type}`}
                            fallback={
                                <p className="text-xs text-muted-foreground p-3">
                                    Error al cargar el panel. Reintenta más tarde.
                                </p>
                            }
                        >
                            {ap.access_type === "access_code" && (
                                <AccessCodesPanel eventId={eventId} embedded />
                            )}
                        </ErrorBoundary>
                    </div>
                </section>
            )}
        </div>
    );
}

function ChoiceCard({ icon: Icon, title, description, selected, onSelect, testid, disabled = false }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={disabled}
            data-testid={testid}
            className={`rounded-xl border bg-card p-4 text-left transition w-full ${
                selected
                    ? "border-foreground/30 ring-1 ring-foreground/10"
                    : "border-border hover:border-foreground/20"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                        selected ? "bg-teal-50 text-teal-800" : "bg-secondary text-muted-foreground"
                    }`}
                >
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <div className="font-medium text-sm">{title}</div>
                        {selected && (
                            <Badge variant="secondary" className="text-[10px] font-normal">
                                Activo
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {description}
                    </p>
                </div>
            </div>
        </button>
    );
}

// ── Section: Parámetros ─────────────────────────────────────────────────────
function SectionParams({ form, update, venueLocalities = [] }) {
    const ap = form.access_params;
    const deliveryMode = form.ticket_delivery_mode || "al_momento";
    const questionsCount = (form.custom_questions || []).filter((q) => q.label?.trim()).length;

    const deliveryLabel = {
        al_momento: "Al momento de la compra",
        horas_antes: "X horas antes",
        fecha_especifica: "Fecha específica",
        manual: "Manual",
    }[deliveryMode] || deliveryMode;

    return (
        <div className="space-y-6" data-testid="section-params">
            <div>
                <h3 className="font-semibold text-base">Parámetros</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Preguntas en la compra, límites y cuándo se envía el eTicket.
                    {questionsCount > 0 && (
                        <>
                            {" · "}
                            <strong className="text-foreground">{questionsCount}</strong> pregunta
                            {questionsCount !== 1 ? "s" : ""}
                        </>
                    )}
                    {" · Envío: "}
                    <strong className="text-foreground">{deliveryLabel}</strong>
                </p>
            </div>

            <section className="space-y-3" data-testid="access-questions-block">
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                        <h4 className="text-sm font-medium flex items-center gap-2">
                            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                            1. Preguntas al comprador
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Campos extra en checkout (cédula, talla, etc.). Las respuestas quedan en cada orden.
                        </p>
                    </div>
                </div>
                <CustomQuestionsPanel
                    questions={form.custom_questions || []}
                    onChange={(next) => update("custom_questions", next)}
                    venueLocalities={venueLocalities}
                />
            </section>

            <section className="space-y-3" data-testid="access-purchase-block">
                <div>
                    <h4 className="text-sm font-medium flex items-center gap-2">
                        <Ticket className="h-4 w-4 text-muted-foreground" />
                        2. Límites de compra
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Topes por transacción y por comprador. Opcional.
                    </p>
                </div>
                <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field
                            label={
                                <LabelWithTip
                                    text="Máx. tickets por compra"
                                    tip={
                                        <>
                                            Tope por <strong>transacción</strong>, sumando todos los
                                            tipos de ticket. No se acumula entre compras distintas del
                                            mismo comprador — para eso usá &quot;Máx. por persona / email&quot;.
                                        </>
                                    }
                                />
                            }
                        >
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
                        <Field
                            label={
                                <LabelWithTip
                                    text="Máx. por persona / email"
                                    tip={
                                        <>
                                            Tope acumulado entre <strong>todas las compras</strong> de un
                                            mismo email a este evento. Si además configuraste un &quot;Máx.
                                            por comprador&quot; dentro de un tipo de ticket (paso Localidades),
                                            ese límite se aplica adicionalmente.
                                        </>
                                    }
                                />
                            }
                        >
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

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="text-sm min-w-0">
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
            </section>

            <section className="space-y-3" data-testid="access-delivery-block">
                <div>
                    <h4 className="text-sm font-medium flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        3. Envío del eTicket (QR)
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Cuándo se envían los QR por email al comprador.
                    </p>
                </div>
                <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
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
            </section>
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
        locality_ids: null,
    };
}

function CustomQuestionsPanel({ questions, onChange, venueLocalities = [] }) {
    const add = () => onChange([...questions, newCustomQuestion()]);
    const remove = (id) => onChange(questions.filter((q) => q.id !== id));
    const upd = (id, patch) =>
        onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));

    const toggleLocality = (q, locId) => {
        const current = Array.isArray(q.locality_ids) ? q.locality_ids : [];
        const next = current.includes(locId)
            ? current.filter((id) => id !== locId)
            : [...current, locId];
        // empty selection = all localities
        upd(q.id, { locality_ids: next.length ? next : null });
    };

    return (
        <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3" data-testid="custom-questions-panel">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    Se muestran al momento de la compra. Vacío = no se pide nada extra.
                </p>
                <Button size="sm" onClick={add} data-testid="cq-add" className="shrink-0">
                    <Plus className="h-4 w-4 mr-1.5" /> Nueva pregunta
                </Button>
            </div>

            {questions.length === 0 ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Sin preguntas todavía. Agregá una para pedir datos en el checkout.
                </div>
            ) : (
                <ul className="space-y-2" data-testid="cq-list">
                    {questions.map((q) => (
                        <li
                            key={q.id}
                            className="rounded-lg border p-3 space-y-2 bg-background"
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
                                        <SelectItem value="number">Número</SelectItem>
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
                            {venueLocalities.length > 0 && (
                                <div
                                    className="rounded-md border p-2 space-y-1.5"
                                    data-testid={`cq-localities-${q.id}`}
                                >
                                    <div className="text-xs font-medium text-muted-foreground">
                                        Localidades (vacío = todas)
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                        {venueLocalities.map((loc) => {
                                            const checked = Array.isArray(q.locality_ids)
                                                && q.locality_ids.includes(loc.id);
                                            return (
                                                <label
                                                    key={loc.id}
                                                    className="flex items-center gap-1.5 text-xs"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleLocality(q, loc.id)}
                                                        data-testid={`cq-loc-${q.id}-${loc.id}`}
                                                    />
                                                    {loc.name}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
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
function LabelWithTip({ text, tip }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            {text}
            <TooltipProvider delayDuration={150}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{tip}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </span>
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


