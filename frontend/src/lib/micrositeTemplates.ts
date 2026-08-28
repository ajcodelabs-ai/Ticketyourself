/**
 * Opinionated microsite templates: layout + visual identity + starter copy.
 * Layout codes match backend TEMPLATES / blocksForTemplate.
 */
import { blocksForTemplate, hasHtmlContent } from "@/lib/micrositeBlocks";

export const FACTORY_CONTENT = {
    hero_subtitle: "Eventos en vivo, tickets sin complicaciones.",
    hero_cta_text: "Ver eventos",
    about_title: "Sobre nosotros",
    about_body:
        "Somos un equipo apasionado por crear experiencias inolvidables. Descubrí nuestros próximos eventos y unite a la comunidad.",
};

export type TemplateBranding = {
    primary_color: string;
    secondary_color: string;
    font_family: string;
    radius: string;
    shadow_style: string;
    density: string;
};

export type MicrositeTemplatePreset = {
    code: string;
    name: string;
    blurb: string;
    audience: string;
    category: string;
    branding: TemplateBranding;
    content: {
        hero_subtitle: string;
        hero_cta_text: string;
        about_title: string;
        about_body: string;
    };
};

export const MICROSITE_TEMPLATES: MicrositeTemplatePreset[] = [
    {
        code: "estandar",
        name: "Productora",
        blurb: "Portada clara, tus eventos y un contacto. Lista para publicar.",
        audience: "Cualquier productora",
        category: "Listo para usar",
        branding: {
            primary_color: "#4f46e5",
            secondary_color: "#f1f5f9",
            font_family: "Inter",
            radius: "rounded",
            shadow_style: "soft",
            density: "cozy",
        },
        content: {
            hero_subtitle: "Eventos en vivo, tickets sin complicaciones.",
            hero_cta_text: "Ver próximos eventos",
            about_title: "Sobre nosotros",
            about_body:
                "Producimos experiencias en vivo con una sola idea: que comprar tu entrada sea tan fácil como ganas de ir.",
        },
    },
    {
        code: "galeria",
        name: "Escenario",
        blurb: "Hero grande y grilla visual. Pensada para conciertos y fiestas.",
        audience: "Conciertos y nightlife",
        category: "Listo para usar",
        branding: {
            primary_color: "#ea580c",
            secondary_color: "#1c1917",
            font_family: "Poppins",
            radius: "rounded",
            shadow_style: "dramatic",
            density: "compact",
        },
        content: {
            hero_subtitle: "La noche se enciende acá. Próximas fechas, un solo lugar.",
            hero_cta_text: "Ver fechas",
            about_title: "La casa",
            about_body:
                "Sonido, luces y una pista que se llena. Seguinos y no te pierdas el próximo show.",
        },
    },
    {
        code: "evento_unico",
        name: "Telón",
        blurb: "Un evento protagonista. Ideal si vendés una sola función.",
        audience: "Teatro y danza",
        category: "Listo para usar",
        branding: {
            primary_color: "#9f1239",
            secondary_color: "#fff1f2",
            font_family: "Playfair Display",
            radius: "sharp",
            shadow_style: "soft",
            density: "spacious",
        },
        content: {
            hero_subtitle: "Una función. Una historia. Reservá tu butaca.",
            hero_cta_text: "Reservar entradas",
            about_title: "La compañía",
            about_body:
                "Montamos obras para ver de cerca. Cada temporada una historia distinta, el mismo cuidado en escena.",
        },
    },
    {
        code: "cronologico",
        name: "Agenda",
        blurb: "Lista de fechas, una debajo de otra. Perfecta para ciclos y charlas.",
        audience: "Conferencias y ciclos",
        category: "Listo para usar",
        branding: {
            primary_color: "#1e3a5f",
            secondary_color: "#f8fafc",
            font_family: "Inter",
            radius: "sharp",
            shadow_style: "flat",
            density: "cozy",
        },
        content: {
            hero_subtitle: "El calendario de este trimestre, en un solo vistazo.",
            hero_cta_text: "Ver agenda",
            about_title: "Quiénes somos",
            about_body:
                "Organizamos encuentros para aprender y conectar. Inscribite a la próxima fecha o recorré las que vienen.",
        },
    },
    {
        code: "minimal",
        name: "Blanco",
        blurb: "Casi nada de ruido: título, eventos y redes.",
        audience: "Marcas sobrias",
        category: "Listo para usar",
        branding: {
            primary_color: "#111827",
            secondary_color: "#fafafa",
            font_family: "Inter",
            radius: "sharp",
            shadow_style: "flat",
            density: "spacious",
        },
        content: {
            hero_subtitle: "Lo esencial: las fechas y el ticket.",
            hero_cta_text: "Ver eventos",
            about_title: "Sobre nosotros",
            about_body: "",
        },
    },
    {
        code: "showcase",
        name: "Festival",
        blurb: "Galería + eventos. Para ferias, festivales y marcas visuales.",
        audience: "Festivales y ferias",
        category: "Con fotos",
        branding: {
            primary_color: "#0f766e",
            secondary_color: "#ecfdf5",
            font_family: "Poppins",
            radius: "pill",
            shadow_style: "soft",
            density: "cozy",
        },
        content: {
            hero_subtitle: "Tres días, un mismo pulso. Mirá la grilla y asegurá tu pase.",
            hero_cta_text: "Ver grilla",
            about_title: "El festival",
            about_body:
                "Música, comida y calle. Subí tus fotos de ediciones anteriores desde el editor cuando las tengas.",
        },
    },
    {
        code: "landing",
        name: "Afiche",
        blurb: "Hero, FAQ y testimonios. Para convertir visitas en tickets.",
        audience: "Un lanzamiento",
        category: "Con fotos",
        branding: {
            primary_color: "#be123c",
            secondary_color: "#fff7ed",
            font_family: "Poppins",
            radius: "rounded",
            shadow_style: "dramatic",
            density: "compact",
        },
        content: {
            hero_subtitle: "El evento del año ya tiene fecha. No te quedes afuera.",
            hero_cta_text: "Quiero mi entrada",
            about_title: "Por qué ir",
            about_body:
                "Artistas, horario y cómo llegar. Completá las preguntas frecuentes desde el editor en un minuto.",
        },
    },
    {
        code: "portfolio",
        name: "Dossier",
        blurb: "Galería y texto. Menos ticketera, más marca.",
        audience: "Estudios y colectivos",
        category: "Con fotos",
        branding: {
            primary_color: "#44403c",
            secondary_color: "#f5f5f4",
            font_family: "Playfair Display",
            radius: "sharp",
            shadow_style: "soft",
            density: "spacious",
        },
        content: {
            hero_subtitle: "Proyectos, obra y próximos encuentros.",
            hero_cta_text: "Conocenos",
            about_title: "Estudio",
            about_body:
                "Trabajamos con imagen, escena y público. Esta página es el dossier: fotos arriba, historia acá.",
        },
    },
];

export const TEMPLATE_OPTIONS = MICROSITE_TEMPLATES.map((t) => ({
    code: t.code,
    name: t.name,
    description: t.blurb,
    category: t.category,
}));

export function getTemplatePreset(code: string): MicrositeTemplatePreset {
    return MICROSITE_TEMPLATES.find((t) => t.code === code) || MICROSITE_TEMPLATES[0];
}

export function isFactoryCopy(content: Record<string, string> | undefined | null): boolean {
    const sub = (content?.hero_subtitle || "").trim();
    if (!sub) return true;
    return sub === FACTORY_CONTENT.hero_subtitle;
}

export function buildTemplateUpdate(
    code: string,
    microsite: Record<string, any>,
    companyName: string,
): {
    template: string;
    blocks: ReturnType<typeof blocksForTemplate>;
    branding: Record<string, unknown>;
    content: Record<string, string>;
} {
    const preset = getTemplatePreset(code);
    const currentBranding = (microsite?.branding || {}) as Record<string, unknown>;
    const currentContent = { ...((microsite?.content || {}) as Record<string, string>) };

    const branding = {
        ...currentBranding,
        ...preset.branding,
        logo_url: currentBranding.logo_url ?? null,
        banner_url: currentBranding.banner_url ?? null,
        custom_css: currentBranding.custom_css ?? "",
    };

    // Only the copy the template actually changes. Re-sending contact_email
    // (and other untouched fields) re-runs API validation — demo uses
    // hola@demo-org.test, which EmailStr used to reject as a reserved TLD.
    const content: Record<string, string> = {};
    if (!currentContent.hero_title?.trim()) content.hero_title = companyName;
    if (isFactoryCopy(currentContent)) {
        content.hero_subtitle = preset.content.hero_subtitle;
        content.hero_cta_text = preset.content.hero_cta_text;
        if (preset.content.about_title) content.about_title = preset.content.about_title;
        if (!hasHtmlContent(currentContent.about_body_html)) {
            content.about_body = preset.content.about_body;
        }
    }
    if (!currentContent.hero_cta_href) content.hero_cta_href = "#events";

    return {
        template: code,
        blocks: blocksForTemplate(code),
        branding,
        content,
    };
}
