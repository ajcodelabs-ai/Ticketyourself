/**
 * MicrositeRenderer: shared between editor preview and public microsite view.
 * Reads the microsite dict, applies branding via inline CSS variables, and
 * dispatches to the chosen template.
 */
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
import { assetUrl, fontStackFor } from "@/lib/microsite";

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

function EventsPlaceholder() {
    return (
        <section
            className="py-16 md:py-20 bg-secondary/40"
            data-testid="ms-events-placeholder"
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
function EstandarTemplate({ microsite }) {
    const s = microsite.sections_enabled || {};
    return (
        <>
            {s.hero && <HeroBlock microsite={microsite} />}
            {s.about && <AboutBlock microsite={microsite} />}
            {s.events && <EventsPlaceholder />}
            {s.contact && <ContactBlock microsite={microsite} />}
            {s.social && <SocialFooter microsite={microsite} />}
        </>
    );
}

function GaleriaTemplate({ microsite }) {
    const s = microsite.sections_enabled || {};
    return (
        <>
            {s.hero && <HeroBlock microsite={microsite} variant="huge" />}
            {s.events && (
                <section className="py-16 md:py-20" data-testid="ms-galeria-grid">
                    <div className="max-w-6xl mx-auto px-6 sm:px-10">
                        <h2 className="text-3xl md:text-4xl font-semibold mb-8">
                            Galería de eventos
                        </h2>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="aspect-[4/5] rounded-2xl flex items-end p-5"
                                    style={{
                                        background: `linear-gradient(180deg, ${microsite.branding.primary_color}33 0%, ${microsite.branding.primary_color}cc 100%)`,
                                        color: "white",
                                    }}
                                >
                                    <span className="text-sm font-medium">
                                        Evento próximamente
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            )}
            {s.about && <AboutBlock microsite={microsite} />}
            {s.contact && <ContactBlock microsite={microsite} />}
            {s.social && <SocialFooter microsite={microsite} />}
        </>
    );
}

function EventoUnicoTemplate({ microsite }) {
    const s = microsite.sections_enabled || {};
    return (
        <div className="min-h-screen flex flex-col">
            {s.hero && <HeroBlock microsite={microsite} variant="huge" />}
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

export default function MicrositeRenderer({ microsite }) {
    if (!microsite) return null;
    const Template = TEMPLATES[microsite.template] || EstandarTemplate;
    return (
        <div
            data-testid="microsite-root"
            style={{
                fontFamily: fontStackFor(microsite.branding.font_family),
                "--ms-primary": microsite.branding.primary_color,
                "--ms-secondary": microsite.branding.secondary_color,
            }}
        >
            <Template microsite={microsite} />
        </div>
    );
}
