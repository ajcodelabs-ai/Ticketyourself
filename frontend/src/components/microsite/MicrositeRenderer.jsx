/**
 * MicrositeRenderer: shared between editor preview and public microsite view.
 * Reads the microsite dict, applies branding via inline CSS variables, and
 * dispatches to the chosen template.
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
    Sparkles,
} from "lucide-react";
import api from "@/lib/api";
import { assetUrl, fontStackFor } from "@/lib/microsite";
import EventCard from "@/components/events/EventCard";

const SOCIAL_ICON = {
    instagram: Instagram,
    facebook: Facebook,
    twitter: Twitter,
    tiktok: Music,
    youtube: Youtube,
    whatsapp: MessageCircle,
};

function HeroBlock({ microsite, variant }) {
    const { content, branding } = microsite;
    const banner = assetUrl(branding.banner_url);
    const logo = assetUrl(branding.logo_url);

    const huge = variant === "huge";
    return (
        <section
            className={`relative overflow-hidden ${huge ? "py-24 md:py-32" : "py-16 md:py-24"}`}
            style={{
                background: banner
                    ? `linear-gradient(rgba(15,15,40,.55), rgba(15,15,40,.55)), url(${banner}) center/cover`
                    : `linear-gradient(135deg, ${branding.primary_color}, ${branding.primary_color}cc)`,
                color: "white",
            }}
            data-testid="ms-hero"
        >
            <div className="max-w-5xl mx-auto px-6 sm:px-10">
                {logo && (
                    <img
                        src={logo}
                        alt="logo"
                        className="h-16 w-16 rounded-full object-cover ring-4 ring-white/30 mb-6"
                        data-testid="ms-hero-logo"
                    />
                )}
                <h1
                    className={`font-bold leading-tight ${
                        huge ? "text-5xl md:text-7xl" : "text-4xl md:text-6xl"
                    }`}
                    data-testid="ms-hero-title"
                >
                    {content.hero_title}
                </h1>
                {content.hero_subtitle && (
                    <p
                        className="text-lg md:text-xl mt-4 max-w-2xl text-white/90"
                        data-testid="ms-hero-subtitle"
                    >
                        {content.hero_subtitle}
                    </p>
                )}
                {content.hero_cta_text && (
                    <button
                        type="button"
                        className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3 font-medium shadow-lg hover:scale-[1.03] transition"
                        style={{ background: "white", color: branding.primary_color }}
                        data-testid="ms-hero-cta"
                    >
                        <Sparkles className="h-4 w-4" />
                        {content.hero_cta_text}
                    </button>
                )}
            </div>
        </section>
    );
}

function AboutBlock({ microsite }) {
    const { content } = microsite;
    if (!content.about_title && !content.about_body) return null;
    return (
        <section className="py-16 md:py-20" data-testid="ms-about">
            <div className="max-w-3xl mx-auto px-6 sm:px-10">
                <h2 className="text-2xl md:text-3xl font-semibold mb-4">
                    {content.about_title}
                </h2>
                <p className="text-lg leading-relaxed text-foreground/80 whitespace-pre-wrap">
                    {content.about_body}
                </p>
            </div>
        </section>
    );
}

function EventsSection({ tenantSlug, primaryColor, layout = "grid" }) {
    const [events, setEvents] = useState(null);
    useEffect(() => {
        if (!tenantSlug) return;
        let alive = true;
        api.get(`/public/events?tenant_slug=${tenantSlug}`)
            .then((r) => alive && setEvents(r.data?.items || []))
            .catch(() => alive && setEvents([]));
        return () => {
            alive = false;
        };
    }, [tenantSlug]);

    if (events === null) {
        return (
            <section className="py-16 md:py-20 bg-secondary/40">
                <div className="max-w-5xl mx-auto px-6 text-center text-muted-foreground">
                    Cargando eventos…
                </div>
            </section>
        );
    }
    if (events.length === 0) {
        return (
            <section className="py-16 md:py-20 bg-secondary/40" data-testid="ms-events-empty">
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

    const now = Date.now();
    const upcoming = events.filter((e) => new Date(e.starts_at).getTime() > now);
    const past = events.filter((e) => new Date(e.starts_at).getTime() <= now);
    const cols =
        layout === "galeria"
            ? "sm:grid-cols-2 lg:grid-cols-3"
            : "sm:grid-cols-2 lg:grid-cols-3";

    return (
        <section className="py-16 md:py-20" data-testid="ms-events-section">
            <div className="max-w-6xl mx-auto px-6 sm:px-10 space-y-12">
                {upcoming.length > 0 && (
                    <div>
                        <h2 className="text-3xl md:text-4xl font-semibold mb-6">
                            Próximos eventos
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

function EventoUnicoFeatured({ tenantSlug }) {
    const [event, setEvent] = useState(null);
    useEffect(() => {
        let alive = true;
        api.get(`/public/events?tenant_slug=${tenantSlug}&limit=1`)
            .then((r) => alive && setEvent(r.data?.items?.[0] || null))
            .catch(() => alive && setEvent(null));
        return () => {
            alive = false;
        };
    }, [tenantSlug]);

    if (!event) {
        return null;
    }
    const formatted = new Intl.DateTimeFormat("es-EC", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(event.starts_at));
    return (
        <section className="py-16 md:py-20 px-6">
            <div className="max-w-3xl mx-auto rounded-3xl border bg-card overflow-hidden shadow-xl">
                {event.poster_url && (
                    <img
                        src={
                            event.poster_url.startsWith("http")
                                ? event.poster_url
                                : `${process.env.REACT_APP_BACKEND_URL || ""}${event.poster_url}`
                        }
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

function ContactBlock({ microsite }) {
    const { content } = microsite;
    const items = [
        { icon: Mail, value: content.contact_email, href: `mailto:${content.contact_email}` },
        { icon: Phone, value: content.contact_phone, href: `tel:${content.contact_phone}` },
        { icon: MapPin, value: content.address, href: null },
    ].filter((i) => i.value);
    if (items.length === 0) return null;
    return (
        <section className="py-14 md:py-16" data-testid="ms-contact">
            <div className="max-w-3xl mx-auto px-6 sm:px-10">
                <h2 className="text-2xl md:text-3xl font-semibold mb-6">Contacto</h2>
                <ul className="space-y-3 text-foreground/80">
                    {items.map(({ icon: Icon, value, href }) => (
                        <li key={value} className="flex items-center gap-3">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                            {href ? (
                                <a href={href} className="hover:underline">
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

function SocialFooter({ microsite }) {
    const { social_links: social, content, branding } = microsite;
    const entries = Object.entries(social || {}).filter(([_, v]) => v);
    if (entries.length === 0 && !content.contact_email) return null;
    return (
        <footer
            className="py-10"
            style={{ background: branding.secondary_color, color: "#1f1f33" }}
            data-testid="ms-footer"
        >
            <div className="max-w-5xl mx-auto px-6 sm:px-10 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="text-sm text-foreground/70">
                    © {new Date().getFullYear()} · Construido con Ticket Yourself
                </div>
                <div className="flex gap-3">
                    {entries.map(([k, v]) => {
                        const Icon = SOCIAL_ICON[k] || MessageCircle;
                        const href = k === "whatsapp" && !v.startsWith("http")
                            ? `https://wa.me/${v.replace(/[^0-9]/g, "")}`
                            : v;
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Templates                                                                */
/* ──────────────────────────────────────────────────────────────────────── */
function EstandarTemplate({ microsite, tenantSlug }) {
    const s = microsite.sections_enabled || {};
    return (
        <>
            {s.hero && <HeroBlock microsite={microsite} />}
            {s.about && <AboutBlock microsite={microsite} />}
            {s.events && (
                <EventsSection
                    tenantSlug={tenantSlug}
                    primaryColor={microsite.branding.primary_color}
                />
            )}
            {s.contact && <ContactBlock microsite={microsite} />}
            {s.social && <SocialFooter microsite={microsite} />}
        </>
    );
}

function GaleriaTemplate({ microsite, tenantSlug }) {
    const s = microsite.sections_enabled || {};
    return (
        <>
            {s.hero && <HeroBlock microsite={microsite} variant="huge" />}
            {s.events && (
                <EventsSection
                    tenantSlug={tenantSlug}
                    primaryColor={microsite.branding.primary_color}
                    layout="galeria"
                />
            )}
            {s.about && <AboutBlock microsite={microsite} />}
            {s.contact && <ContactBlock microsite={microsite} />}
            {s.social && <SocialFooter microsite={microsite} />}
        </>
    );
}

function EventoUnicoTemplate({ microsite, tenantSlug }) {
    const s = microsite.sections_enabled || {};
    return (
        <div className="min-h-screen flex flex-col">
            {s.hero && <HeroBlock microsite={microsite} variant="huge" />}
            {s.events && <EventoUnicoFeatured tenantSlug={tenantSlug} />}
            {s.about && <AboutBlock microsite={microsite} />}
            {s.contact && <ContactBlock microsite={microsite} />}
            {s.social && <SocialFooter microsite={microsite} />}
        </div>
    );
}

const TEMPLATES = {
    estandar: EstandarTemplate,
    galeria: GaleriaTemplate,
    evento_unico: EventoUnicoTemplate,
};

export default function MicrositeRenderer({ microsite, tenantSlug }) {
    if (!microsite) return null;
    const Template = TEMPLATES[microsite.template] || EstandarTemplate;
    const slug = tenantSlug || microsite.tenant_slug || microsite.slug;
    return (
        <div
            data-testid="microsite-root"
            style={{
                fontFamily: fontStackFor(microsite.branding.font_family),
                "--ms-primary": microsite.branding.primary_color,
                "--ms-secondary": microsite.branding.secondary_color,
            }}
        >
            <Template microsite={microsite} tenantSlug={slug} />
        </div>
    );
}
