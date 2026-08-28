/**
 * Individual microsite block renderers — shared by public view and editor preview.
 */
import { useEffect, useState } from "react";
import {
    Instagram,
    Facebook,
    Twitter,
    Youtube,
    Music,
    MessageCircle,
    Mail,
    Phone,
    MapPin,
} from "lucide-react";
import { sanitizeHtml, isSafeHref } from "@/lib/sanitizeHtml";
import api from "@/lib/api";
import { assetUrl } from "@/lib/microsite";
import EventCard from "@/components/events/EventCard";
import { formatEventDate } from "@/lib/events";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { hasHtmlContent, type FaqItem, type GalleryImage, type MicrositeBlock, type TestimonialItem } from "@/lib/micrositeBlocks";
import { Quote } from "lucide-react";
import InlineEditable from "@/components/microsite/editor/InlineEditable";
import GridOverlay from "@/components/microsite/editor/GridOverlay";
import HeroLayerItem from "@/components/microsite/editor/HeroLayerItem";
import { patchHeroLayer } from "@/lib/heroLayerActions";
import {
    normalizeLayer,
    resolveHeroLayers,
    type HeroLayer,
} from "@/lib/micrositeLayers";
import { cn } from "@/lib/utils";

export type BlockEditorCtx = {
    microsite: Record<string, unknown>;
    tenantSlug: string;
    selectedBlockId?: string;
    selectedLayerId?: string | null;
    editorMode?: boolean;
    showGrid?: boolean;
    onSelectBlock?: (id: string | null) => void;
    onSelectLayer?: (id: string | null) => void;
    onUpdateContent?: (patch: Record<string, string>) => void;
    onUpdateBlockProps?: (blockId: string, props: Record<string, unknown>) => void;
    onUploadGallery?: (file: File) => Promise<string | null>;
    uploadingGallery?: boolean;
};

const SOCIAL_ICON = {
    instagram: Instagram,
    facebook: Facebook,
    twitter: Twitter,
    tiktok: Music,
    youtube: Youtube,
    whatsapp: MessageCircle,
};

const SPACER_HEIGHT = { sm: "py-8", md: "py-16", lg: "py-24" };

/** Stable hash targets for hero CTAs (`#events`, `#contact`). Block UUID stays in data-block-id. */
function sectionAnchorProps(anchor: string, blockId?: string, testid?: string) {
    return {
        id: anchor,
        "data-block-id": blockId,
        "data-ms-anchor": anchor,
        ...(testid ? { "data-testid": testid } : {}),
    };
}

function eventStartMs(event: { starts_at?: string }): number | null {
    if (!event?.starts_at) return null;
    const ms = new Date(event.starts_at).getTime();
    return Number.isFinite(ms) ? ms : null;
}

export function HeroBlockView({
    microsite,
    block,
    blockId,
    editorCtx,
}: {
    microsite: Record<string, unknown>;
    block: MicrositeBlock;
    blockId?: string;
    editorCtx?: Pick<
        BlockEditorCtx,
        | "editorMode"
        | "showGrid"
        | "selectedLayerId"
        | "onSelectLayer"
        | "onUpdateContent"
        | "onUpdateBlockProps"
        | "onUploadGallery"
        | "uploadingGallery"
    >;
}) {
    const content = (microsite.content || {}) as Record<string, string>;
    const branding = (microsite.branding || {}) as Record<string, string>;
    const banner = assetUrl(branding.banner_url);
    const logo = assetUrl(branding.logo_url);
    const variant = block.props.variant as string;
    const align = block.props.align as string;
    const huge = variant === "huge";
    const editorMode = Boolean(editorCtx?.editorMode);
    const showGrid = Boolean(editorCtx?.showGrid);
    const storedLayers = ((block.props.layers as HeroLayer[]) || []).map(normalizeLayer);
    const allLayers = resolveHeroLayers(storedLayers, content, variant, align);

    const handleLayerUpdate = (layerId: string, patch: Partial<HeroLayer>) => {
        const ctx = { content, variant, align, storedLayers, layers: allLayers };
        const next = patchHeroLayer(ctx, layerId, patch, editorCtx?.onUpdateContent);
        editorCtx?.onUpdateBlockProps?.(block.id, { layers: next });
    };

    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className={cn(
                "relative overflow-hidden",
                huge ? "min-h-[520px] md:min-h-[640px]" : "min-h-[420px] md:min-h-[520px]",
            )}
            style={{
                background: banner
                    ? `linear-gradient(rgba(15,15,40,.55), rgba(15,15,40,.55)), url(${banner}) center/cover`
                    : `linear-gradient(135deg, ${branding.primary_color}, ${branding.primary_color}cc)`,
                color: "white",
            }}
            data-testid="ms-hero"
        >
            {editorMode && showGrid && <GridOverlay />}

            {logo && (
                <img
                    src={logo}
                    alt="logo"
                    className="absolute top-6 left-6 sm:left-10 z-[7] h-16 w-16 rounded-full object-cover ring-4 ring-white/30"
                    data-testid="ms-hero-logo"
                />
            )}

            <div
                data-hero-grid
                className={cn(
                    "absolute inset-0 z-[6]",
                    "max-w-6xl mx-auto left-0 right-0 px-6 sm:px-10",
                    "grid grid-cols-12 grid-rows-6 gap-x-2 gap-y-1",
                )}
            >
                {allLayers.map((layer) => (
                    <HeroLayerItem
                        key={layer.id}
                        layer={layer}
                        editorMode={editorMode}
                        showGrid={showGrid}
                        huge={huge}
                        isSelected={editorCtx?.selectedLayerId === layer.id}
                        primaryColor={branding.primary_color}
                        onSelect={() => editorCtx?.onSelectLayer?.(layer.id)}
                        onUpdate={(patch) => handleLayerUpdate(layer.id, patch)}
                        onUploadImage={editorCtx?.onUploadGallery}
                        uploadingImage={editorCtx?.uploadingGallery}
                    />
                ))}
            </div>
        </section>
    );
}

export function AboutBlockView({
    microsite,
    block,
    blockId,
    editorCtx,
}: {
    microsite: Record<string, unknown>;
    block: MicrositeBlock;
    blockId?: string;
    editorCtx?: Pick<BlockEditorCtx, "editorMode" | "onUpdateContent">;
}) {
    const content = (microsite.content || {}) as Record<string, string>;
    const align = block.props.align as string;
    const bodyHtml = content.about_body_html;
    const hasRich = hasHtmlContent(bodyHtml);
    const hasPlain = Boolean(content.about_body?.trim());
    const editorMode = Boolean(editorCtx?.editorMode);
    if (!editorMode && !content.about_title && !hasRich && !hasPlain) return null;
    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className="py-[var(--ms-space-section)]"
            data-testid="ms-about"
        >
            <div
                className={`max-w-3xl mx-auto px-6 sm:px-10 ${
                    align === "center" ? "text-center" : ""
                }`}
            >
                <InlineEditable
                    as="h2"
                    value={content.about_title || ""}
                    onChange={(v) => editorCtx?.onUpdateContent?.({ about_title: v })}
                    enabled={editorMode}
                    className="text-2xl md:text-3xl font-semibold mb-4"
                    placeholder="Título sobre nosotros"
                />
                {hasRich && !editorMode ? (
                    <div
                        className="prose prose-lg max-w-none text-foreground/80"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
                    />
                ) : editorMode ? (
                    <InlineEditable
                        as="p"
                        value={content.about_body || ""}
                        onChange={(v) => editorCtx?.onUpdateContent?.({ about_body: v })}
                        enabled
                        multiline
                        className="text-lg leading-relaxed text-foreground/80 whitespace-pre-wrap"
                        placeholder="Contenido (usá el panel para rich text)"
                    />
                ) : hasPlain ? (
                    <p className="text-lg leading-relaxed text-foreground/80 whitespace-pre-wrap">
                        {content.about_body}
                    </p>
                ) : null}
            </div>
        </section>
    );
}

export function EventsBlockView({
    tenantSlug,
    primaryColor,
    block,
    blockId,
}: {
    tenantSlug: string;
    primaryColor: string;
    block: MicrositeBlock;
    blockId?: string;
}) {
    const layout = block.props.layout as string;
    const [events, setEvents] = useState(null);

    useEffect(() => {
        if (!tenantSlug) return;
        let alive = true;
        api.get("/public/events", { params: { tenant_slug: tenantSlug } })
            .then((r) => {
                const data = r.data;
                const items = Array.isArray(data) ? data : data?.items || [];
                if (alive) setEvents(items);
            })
            .catch(() => alive && setEvents([]));
        return () => {
            alive = false;
        };
    }, [tenantSlug]);

    if (layout === "featured") {
        return (
            <FeaturedEventView tenantSlug={tenantSlug} blockId={blockId} events={events} />
        );
    }

    if (events === null) {
        return (
            <section
                {...sectionAnchorProps("events", blockId, "ms-events-loading")}
                className="py-[var(--ms-space-section)] bg-secondary/40"
            >
                <div className="max-w-5xl mx-auto px-6 text-center text-muted-foreground">
                    Cargando eventos…
                </div>
            </section>
        );
    }
    if (events.length === 0) {
        return <EmptyEventsSection blockId={blockId} />;
    }

    const now = Date.now();
    const byPriorityThenDate = (a, b) => {
        const pd = (Number(b.priority) || 0) - (Number(a.priority) || 0);
        if (pd !== 0) return pd;
        const ta = eventStartMs(a) ?? Number.MAX_SAFE_INTEGER;
        const tb = eventStartMs(b) ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
    };
    const upcoming = events
        .filter((e) => {
            const t = eventStartMs(e);
            return t === null || t > now;
        })
        .sort(byPriorityThenDate);
    const past = events
        .filter((e) => {
            const t = eventStartMs(e);
            return t !== null && t <= now;
        })
        .sort(byPriorityThenDate);
    const isList = layout === "list";
    const cols = isList ? "grid-cols-1 max-w-2xl mx-auto" : "sm:grid-cols-2 lg:grid-cols-3";

    return (
        <section
            {...sectionAnchorProps("events", blockId, "ms-events-section")}
            className="py-[var(--ms-space-section)] scroll-mt-6"
        >
            <div className="max-w-6xl mx-auto px-6 sm:px-10 space-y-12">
                {upcoming.length > 0 && (
                    <div>
                        <h2 className="text-3xl md:text-4xl font-semibold mb-6">
                            {isList ? "Calendario de eventos" : "Próximos eventos"}
                        </h2>
                        <div className={`grid gap-5 ${cols}`}>
                            {upcoming.map((ev) => (
                                <EventCard
                                    key={ev.id}
                                    event={ev}
                                    tenantSlug={tenantSlug}
                                    primaryColor={primaryColor}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {past.length > 0 && (
                    <div>
                        <h3 className="text-xl font-semibold mb-4 text-muted-foreground">
                            Eventos pasados
                        </h3>
                        <div className={`grid gap-5 ${cols} opacity-80`}>
                            {past.map((ev) => (
                                <EventCard
                                    key={ev.id}
                                    event={ev}
                                    tenantSlug={tenantSlug}
                                    primaryColor={primaryColor}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

function EmptyEventsSection({ blockId }: { blockId?: string }) {
    return (
        <section
            {...sectionAnchorProps("events", blockId, "ms-events-empty")}
            className="py-[var(--ms-space-section)] bg-secondary/40 scroll-mt-6"
        >
            <div className="max-w-5xl mx-auto px-6 sm:px-10 text-center">
                <p className="text-sm uppercase tracking-widest text-muted-foreground">
                    Próximamente
                </p>
                <h2 className="text-3xl md:text-4xl font-semibold mt-2 mb-3">
                    Eventos en preparación
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                    Estamos cargando los próximos eventos. Volvé pronto o seguinos en redes
                    sociales para no perderte ninguno.
                </p>
            </div>
        </section>
    );
}

function FeaturedEventView({ tenantSlug, blockId, events }) {
    if (events === null) {
        return (
            <section
                {...sectionAnchorProps("events", blockId, "ms-events-loading")}
                className="py-[var(--ms-space-section)] bg-secondary/40"
            >
                <div className="max-w-5xl mx-auto px-6 text-center text-muted-foreground">
                    Cargando eventos…
                </div>
            </section>
        );
    }
    const now = Date.now();
    const byPriorityThenDate = (a, b) => {
        const pd = (Number(b.priority) || 0) - (Number(a.priority) || 0);
        if (pd !== 0) return pd;
        const ta = eventStartMs(a) ?? Number.MAX_SAFE_INTEGER;
        const tb = eventStartMs(b) ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
    };
    const upcoming = (events || [])
        .filter((e) => {
            const t = eventStartMs(e);
            return t === null || t > now;
        })
        .sort(byPriorityThenDate);
    const event = upcoming[0] || events?.[0] || null;
    if (!event) return <EmptyEventsSection blockId={blockId} />;

    const formatted = formatEventDate(event.starts_at, event.timezone);

    return (
        <section
            {...sectionAnchorProps("events", blockId, "ms-events-section")}
            className="py-[var(--ms-space-section)] px-6 scroll-mt-6"
        >
            <div className="max-w-3xl mx-auto rounded-[var(--ms-radius)] border bg-card overflow-hidden shadow-[var(--ms-shadow)]">
                {event.poster_url && (
                    <img
                        src={assetUrl(event.poster_url)}
                        alt={event.title}
                        className="w-full aspect-[16/9] object-cover"
                    />
                )}
                <div className="p-8 space-y-3">
                    <h2 className="text-3xl md:text-4xl font-bold">{event.title}</h2>
                    <p className="text-muted-foreground">{formatted}</p>
                    <p className="text-foreground/80 leading-relaxed">
                        {event.description || event.short_description}
                    </p>
                    <a
                        href={`/o/${tenantSlug}/e/${event.slug}`}
                        className="inline-block mt-4 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90"
                    >
                        Comprar entradas
                    </a>
                </div>
            </div>
        </section>
    );
}

export function ContactBlockView({
    microsite,
    blockId,
    editorCtx,
}: {
    microsite: Record<string, unknown>;
    blockId?: string;
    editorCtx?: Pick<BlockEditorCtx, "editorMode" | "onUpdateContent">;
}) {
    const content = (microsite.content || {}) as Record<string, string>;
    const editorMode = Boolean(editorCtx?.editorMode);
    const fields = [
        { icon: Mail, key: "contact_email", placeholder: "Email de contacto", href: (v: string) => `mailto:${v}` },
        { icon: Phone, key: "contact_phone", placeholder: "Teléfono", href: (v: string) => `tel:${v}` },
        { icon: MapPin, key: "address", placeholder: "Dirección", href: null },
    ] as const;

    const items = fields
        .map((f) => ({ ...f, value: content[f.key] || "" }))
        .filter((i) => i.value || editorMode);

    if (items.length === 0 && !editorMode) return null;

    return (
        <section
            {...sectionAnchorProps("contact", blockId, "ms-contact")}
            className="py-[var(--ms-space-section)] scroll-mt-6"
        >
            <div className="max-w-3xl mx-auto px-6 sm:px-10">
                <h2 className="text-2xl md:text-3xl font-semibold mb-6">Contacto</h2>
                <ul className="space-y-3 text-foreground/80">
                    {(items.length
                        ? items
                        : fields.map((f) => ({ ...f, value: content[f.key] || "" }))
                    ).map(({ icon: Icon, key, placeholder, href, value }) => (
                        <li key={key} className="flex items-center gap-3">
                            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                            {editorMode ? (
                                <InlineEditable
                                    value={value || content[key] || ""}
                                    onChange={(v) => editorCtx?.onUpdateContent?.({ [key]: v })}
                                    enabled
                                    className="flex-1"
                                    placeholder={placeholder}
                                    testid={`ms-contact-${key}`}
                                />
                            ) : href && value ? (
                                <a href={href(value)} className="hover:underline">
                                    {value}
                                </a>
                            ) : (
                                <span>{value}</span>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

export function SocialBlockView({
    microsite,
    blockId,
}: {
    microsite: Record<string, unknown>;
    blockId?: string;
}) {
    const social = (microsite.social_links || {}) as Record<string, string>;
    const branding = (microsite.branding || {}) as Record<string, string>;
    const entries = Object.entries(social).filter(([_, v]) => v);
    if (entries.length === 0) return null;
    return (
        <footer
            id={blockId ? `block-${blockId}` : undefined}
            className="py-10"
            style={{ background: branding.secondary_color, color: "#1f1f33" }}
            data-testid="ms-footer"
        >
            <div className="max-w-5xl mx-auto px-6 sm:px-10 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="text-sm text-foreground/70">
                    © {new Date().getFullYear()} · Construido con Ticket Yourself
                </div>
                <div className="flex gap-3">
                    {entries.map(([k, rawUrl]) => {
                        const v = String(rawUrl ?? "");
                        const Icon = SOCIAL_ICON[k] || MessageCircle;
                        const href =
                            k === "whatsapp" && !v.startsWith("http")
                                ? `https://wa.me/${v.replace(/[^0-9]/g, "")}`
                                : v;
                        if (!isSafeHref(href)) return null;
                        return (
                            <a
                                key={k}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="h-9 w-9 rounded-full bg-white/70 hover:bg-white grid place-items-center transition"
                                data-testid={`ms-social-${k}`}
                                aria-label={k}
                            >
                                <Icon className="h-4 w-4" />
                            </a>
                        );
                    })}
                </div>
            </div>
        </footer>
    );
}

export function SpacerBlockView({ block }: { block: MicrositeBlock }) {
    const height = (block.props.height as string) || "md";
    return (
        <div
            className={SPACER_HEIGHT[height] || SPACER_HEIGHT.md}
            aria-hidden="true"
            data-testid="ms-spacer"
        />
    );
}

export function ImageBlockView({ block, blockId }: { block: MicrositeBlock; blockId?: string }) {
    const imageUrl = assetUrl(block.props.image_url as string);
    const caption = (block.props.caption as string) || "";
    const layout = (block.props.layout as string) || "contained";
    if (!imageUrl) {
        return (
            <section className="py-12 px-6" data-testid="ms-image-empty">
                <div className="max-w-4xl mx-auto h-48 rounded-[var(--ms-radius)] border border-dashed grid place-items-center text-muted-foreground text-sm">
                    Añadí una imagen desde el panel de propiedades
                </div>
            </section>
        );
    }
    const inner = (
        <>
            <img src={imageUrl} alt={caption || "Imagen"} className="w-full object-cover" />
            {caption && (
                <p className="text-sm text-muted-foreground text-center mt-3 px-4">{caption}</p>
            )}
        </>
    );
    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className={layout === "full" ? "py-0" : "py-12 px-6"}
            data-testid="ms-image"
        >
            {layout === "full" ? (
                inner
            ) : (
                <div className="max-w-4xl mx-auto">{inner}</div>
            )}
        </section>
    );
}

export function GalleryBlockView({ block, blockId }: { block: MicrositeBlock; blockId?: string }) {
    const images = (block.props.images as GalleryImage[]) || [];
    const columns = (block.props.columns as number) || 3;
    const colClass =
        columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3";

    if (images.length === 0) {
        return (
            <section className="py-12 px-6" data-testid="ms-gallery-empty">
                <div className="max-w-5xl mx-auto h-40 rounded-[var(--ms-radius)] border border-dashed grid place-items-center text-muted-foreground text-sm">
                    Añadí imágenes a la galería
                </div>
            </section>
        );
    }

    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className="py-[var(--ms-space-section)] px-6"
            data-testid="ms-gallery"
        >
            <div className={`max-w-6xl mx-auto grid gap-3 ${colClass}`}>
                {images.map((img) => (
                    <div key={img.id} className="rounded-[var(--ms-radius)] overflow-hidden border aspect-square">
                        <img
                            src={assetUrl(img.url) || ""}
                            alt=""
                            className="w-full h-full object-cover hover:scale-105 transition duration-300"
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

export function FaqBlockView({
    block,
    blockId,
    editorCtx,
}: {
    block: MicrositeBlock;
    blockId?: string;
    editorCtx?: Pick<BlockEditorCtx, "editorMode" | "onUpdateBlockProps">;
}) {
    const editorMode = Boolean(editorCtx?.editorMode);
    const title = (block.props.title as string) || "Preguntas frecuentes";
    const items = ((block.props.items as FaqItem[]) || []).filter(
        (it) => it.question?.trim() || editorMode,
    );
    if (items.length === 0 && !editorMode) return null;

    const updateItems = (next: FaqItem[]) => {
        editorCtx?.onUpdateBlockProps?.(block.id, { items: next });
    };

    const stripHtml = (html: string) =>
        html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className="py-[var(--ms-space-section)] px-6"
            data-testid="ms-faq"
        >
            <div className="max-w-2xl mx-auto">
                {editorMode ? (
                    <InlineEditable
                        as="h2"
                        value={title}
                        onChange={(v) => editorCtx?.onUpdateBlockProps?.(block.id, { title: v })}
                        enabled
                        className="text-2xl md:text-3xl font-semibold mb-6 text-center block"
                        placeholder="Título de FAQ"
                        testid="ms-faq-title"
                    />
                ) : (
                    <h2 className="text-2xl md:text-3xl font-semibold mb-6 text-center">{title}</h2>
                )}
                <Accordion type="single" collapsible className="w-full">
                    {items.map((item, i) => (
                        <AccordionItem key={item.id || i} value={`faq-${i}`}>
                            <AccordionTrigger className="text-left">
                                {editorMode ? (
                                    <InlineEditable
                                        value={item.question || ""}
                                        onChange={(v) =>
                                            updateItems(
                                                items.map((it, idx) =>
                                                    idx === i ? { ...it, question: v } : it,
                                                ),
                                            )
                                        }
                                        enabled
                                        className="flex-1 text-left"
                                        placeholder="Pregunta"
                                        testid={`ms-faq-q-${i}`}
                                    />
                                ) : (
                                    item.question
                                )}
                            </AccordionTrigger>
                            <AccordionContent>
                                {editorMode ? (
                                    <InlineEditable
                                        value={stripHtml(item.answer_html || "")}
                                        onChange={(v) =>
                                            updateItems(
                                                items.map((it, idx) =>
                                                    idx === i
                                                        ? { ...it, answer_html: `<p>${v}</p>` }
                                                        : it,
                                                ),
                                            )
                                        }
                                        enabled
                                        multiline
                                        className="text-sm text-muted-foreground w-full"
                                        placeholder="Respuesta"
                                        testid={`ms-faq-a-${i}`}
                                    />
                                ) : (
                                    <div
                                        className="prose prose-sm max-w-none text-muted-foreground"
                                        dangerouslySetInnerHTML={{
                                            __html: sanitizeHtml(item.answer_html || ""),
                                        }}
                                    />
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>
        </section>
    );
}

export function TestimonialsBlockView({
    block,
    blockId,
    editorCtx,
}: {
    block: MicrositeBlock;
    blockId?: string;
    editorCtx?: Pick<BlockEditorCtx, "editorMode" | "onUpdateBlockProps">;
}) {
    const editorMode = Boolean(editorCtx?.editorMode);
    const title = (block.props.title as string) || "Testimonios";
    const items = ((block.props.items as TestimonialItem[]) || []).filter(
        (it) => it.quote?.trim() || editorMode,
    );
    if (items.length === 0 && !editorMode) return null;

    const updateItems = (next: TestimonialItem[]) => {
        editorCtx?.onUpdateBlockProps?.(block.id, { items: next });
    };

    return (
        <section
            id={blockId ? `block-${blockId}` : undefined}
            className="py-[var(--ms-space-section)] px-6 bg-secondary/30"
            data-testid="ms-testimonials"
        >
            <div className="max-w-5xl mx-auto">
                {editorMode ? (
                    <InlineEditable
                        as="h2"
                        value={title}
                        onChange={(v) => editorCtx?.onUpdateBlockProps?.(block.id, { title: v })}
                        enabled
                        className="text-2xl md:text-3xl font-semibold mb-8 text-center block"
                        placeholder="Título"
                        testid="ms-testimonials-title"
                    />
                ) : (
                    <h2 className="text-2xl md:text-3xl font-semibold mb-8 text-center">{title}</h2>
                )}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {items.map((item, i) => (
                        <div
                            key={item.id}
                            className="rounded-[var(--ms-radius)] border bg-card p-6 shadow-[var(--ms-shadow)] flex flex-col gap-3"
                        >
                            <Quote className="h-6 w-6 text-primary/40" />
                            {editorMode ? (
                                <InlineEditable
                                    value={item.quote || ""}
                                    onChange={(v) =>
                                        updateItems(
                                            items.map((it, idx) =>
                                                idx === i ? { ...it, quote: v } : it,
                                            ),
                                        )
                                    }
                                    enabled
                                    multiline
                                    className="text-foreground/80 leading-relaxed flex-1"
                                    placeholder="Cita del testimonio"
                                    testid={`ms-testimonial-quote-${i}`}
                                />
                            ) : (
                                <p className="text-foreground/80 leading-relaxed flex-1">
                                    &ldquo;{item.quote}&rdquo;
                                </p>
                            )}
                            <div className="flex items-center gap-3 pt-2 border-t">
                                {item.avatar_url ? (
                                    <img
                                        src={assetUrl(item.avatar_url) || ""}
                                        alt={item.name}
                                        className="h-10 w-10 rounded-full object-cover"
                                    />
                                ) : (
                                    <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold text-sm">
                                        {(item.name || "?")[0]}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    {editorMode ? (
                                        <>
                                            <InlineEditable
                                                value={item.name || ""}
                                                onChange={(v) =>
                                                    updateItems(
                                                        items.map((it, idx) =>
                                                            idx === i ? { ...it, name: v } : it,
                                                        ),
                                                    )
                                                }
                                                enabled
                                                className="font-medium text-sm block"
                                                placeholder="Nombre"
                                                testid={`ms-testimonial-name-${i}`}
                                            />
                                            <InlineEditable
                                                value={item.role || ""}
                                                onChange={(v) =>
                                                    updateItems(
                                                        items.map((it, idx) =>
                                                            idx === i ? { ...it, role: v } : it,
                                                        ),
                                                    )
                                                }
                                                enabled
                                                className="text-xs text-muted-foreground block"
                                                placeholder="Cargo / rol"
                                                testid={`ms-testimonial-role-${i}`}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <div className="font-medium text-sm">{item.name}</div>
                                            {item.role && (
                                                <div className="text-xs text-muted-foreground">{item.role}</div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export function renderBlock(block: MicrositeBlock, ctx: BlockEditorCtx) {
    if (!block.enabled) return null;

    const {
        microsite,
        tenantSlug,
        selectedBlockId,
        selectedLayerId,
        editorMode,
        showGrid,
        onSelectBlock,
        onSelectLayer,
        onUpdateContent,
        onUpdateBlockProps,
        onUploadGallery,
        uploadingGallery,
    } = ctx;
    const branding = (microsite.branding || {}) as Record<string, string>;
    const isSelected = editorMode && selectedBlockId === block.id;
    const editorCtx = editorMode
        ? {
              editorMode,
              showGrid,
              selectedLayerId,
              onSelectLayer,
              onUpdateContent,
              onUpdateBlockProps,
              onUploadGallery,
              uploadingGallery,
          }
        : undefined;

    let inner = null;
    switch (block.type) {
        case "hero":
            inner = (
                <HeroBlockView
                    microsite={microsite}
                    block={block}
                    blockId={block.id}
                    editorCtx={editorCtx}
                />
            );
            break;
        case "about":
            inner = (
                <AboutBlockView
                    microsite={microsite}
                    block={block}
                    blockId={block.id}
                    editorCtx={editorCtx}
                />
            );
            break;
        case "events":
            inner = (
                <EventsBlockView
                    tenantSlug={tenantSlug}
                    primaryColor={branding.primary_color}
                    block={block}
                    blockId={block.id}
                />
            );
            break;
        case "contact":
            inner = (
                <ContactBlockView microsite={microsite} blockId={block.id} editorCtx={editorCtx} />
            );
            break;
        case "social":
            inner = <SocialBlockView microsite={microsite} blockId={block.id} />;
            break;
        case "spacer":
            inner = <SpacerBlockView block={block} />;
            break;
        case "image":
            inner = <ImageBlockView block={block} blockId={block.id} />;
            break;
        case "gallery":
            inner = <GalleryBlockView block={block} blockId={block.id} />;
            break;
        case "faq":
            inner = <FaqBlockView block={block} blockId={block.id} editorCtx={editorCtx} />;
            break;
        case "testimonials":
            inner = (
                <TestimonialsBlockView block={block} blockId={block.id} editorCtx={editorCtx} />
            );
            break;
        default:
            return null;
    }

    if (!editorMode) return <div key={block.id}>{inner}</div>;

    return (
        <div
            key={block.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
                e.stopPropagation();
                onSelectBlock?.(block.id);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectBlock?.(block.id);
                }
            }}
            className={`relative cursor-pointer transition ring-inset ${
                isSelected
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:ring-2 hover:ring-primary/40 hover:ring-offset-1"
            }`}
            data-testid={`editor-block-${block.id}`}
            data-block-type={block.type}
        >
            {isSelected && (
                <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wide pointer-events-none">
                    {block.type}
                </div>
            )}
            {inner}
        </div>
    );
}
