/**
 * Wireframe previews for event media placement in the wizard.
 * Schematic only — mirrors EventPublic / EventCard usage.
 */
import { ImageIcon, Ticket } from "lucide-react";

function resolveSrc(url, assetUrlFn) {
    if (url == null || url === "") return null;
    if (typeof url !== "string") return null;
    return typeof assetUrlFn === "function" ? assetUrlFn(url) : url;
}

function ImgOrPlaceholder({ src, className = "", alt = "" }) {
    if (src) {
        return (
            <img
                src={src}
                alt={alt}
                className={`object-cover w-full h-full ${className}`}
            />
        );
    }
    return (
        <div
            className={`w-full h-full flex items-center justify-center bg-muted/60 text-muted-foreground ${className}`}
        >
            <ImageIcon className="h-5 w-5 opacity-50" />
        </div>
    );
}

const SITE_MAP = [
    { id: "banner", n: "1", label: "Portada", where: "Hero de la página del evento" },
    { id: "poster", n: "2", label: "Principal", where: "Card del microsite + ticket PDF" },
    { id: "small", n: "3", label: "Miniatura", where: "Thumb en listados (si no hay, usa la principal)" },
    { id: "gallery", n: "4", label: "Galería", where: "Carrusel en la página del evento" },
];

/** Full-page schematic: site map + hero + card + list thumb + gallery. */
export function EventMediaCompositePreview({
    poster,
    banner,
    small,
    gallery = [],
    assetUrl: assetUrlFn,
    highlight = null,
}) {
    const heroSrc = resolveSrc(banner || poster, assetUrlFn);
    const posterSrc = resolveSrc(poster, assetUrlFn);
    const smallSrc = resolveSrc(small || poster, assetUrlFn);
    const thumbs = (gallery || []).filter((u) => typeof u === "string").slice(0, 4);
    const galleryLen = (gallery || []).filter((u) => typeof u === "string").length;
    const extra = Math.max(0, galleryLen - thumbs.length);

    return (
        <div
            className="rounded-xl border bg-card overflow-hidden"
            data-testid="media-composite-preview"
        >
            <div className="px-4 py-3 border-b space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-sm font-medium">Mapa del sitio · dónde va cada arte</div>
                        <p className="text-xs text-muted-foreground">
                            Vista previa aproximada de la página pública y los listados.
                        </p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Mock
                    </span>
                </div>
                <ol
                    className="grid sm:grid-cols-2 gap-2"
                    data-testid="media-site-map"
                >
                    {SITE_MAP.map((item) => {
                        const active = highlight === item.id;
                        return (
                            <li
                                key={item.id}
                                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                                    active
                                        ? "border-primary bg-primary/5"
                                        : "border-border/70 bg-secondary/20"
                                }`}
                            >
                                <span
                                    className={`mt-0.5 h-5 w-5 shrink-0 rounded-full grid place-items-center text-[10px] font-semibold ${
                                        active
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    {item.n}
                                </span>
                                <div className="min-w-0">
                                    <div className="font-medium">{item.label}</div>
                                    <div className="text-muted-foreground leading-snug">
                                        {item.where}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </div>

            <div className="p-3 sm:p-4 space-y-3 bg-secondary/20">
                {/* Hero */}
                <div className="space-y-1">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <span className="h-4 w-4 rounded-full bg-muted grid place-items-center text-[9px] font-semibold">
                            1
                        </span>
                        Página del evento · hero
                    </div>
                    <div
                        className={`relative aspect-video rounded-lg overflow-hidden border bg-muted/40 ${
                            highlight === "banner" ? "ring-2 ring-primary" : ""
                        }`}
                    >
                        <ImgOrPlaceholder src={heroSrc} alt="Hero preview" />
                        {!banner && poster && (
                            <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-background/80 px-1.5 py-0.5 rounded">
                                Usando principal (sin portada)
                            </span>
                        )}
                    </div>
                </div>

                {/* Content row: card + list thumb + gallery */}
                <div className="grid sm:grid-cols-[120px_1fr_1fr] gap-3 items-start">
                    <div className="space-y-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <span className="h-4 w-4 rounded-full bg-muted grid place-items-center text-[9px] font-semibold">
                                2
                            </span>
                            Card
                        </div>
                        <div
                            className={`rounded-lg border bg-card overflow-hidden shadow-sm ${
                                highlight === "poster" ? "ring-2 ring-primary" : ""
                            }`}
                        >
                            <div className="aspect-square">
                                <ImgOrPlaceholder src={posterSrc} alt="Poster" />
                            </div>
                            <div className="p-2 space-y-1">
                                <div className="h-2 w-[75%] rounded bg-muted" />
                                <div className="h-1.5 w-1/2 rounded bg-muted/70" />
                            </div>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Ticket className="h-3 w-3" />
                            También en el PDF del ticket
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <span className="h-4 w-4 rounded-full bg-muted grid place-items-center text-[9px] font-semibold">
                                3
                            </span>
                            Listado
                        </div>
                        <div
                            className={`flex items-center gap-2 rounded-lg border bg-card p-2 ${
                                highlight === "small" ? "ring-2 ring-primary" : ""
                            }`}
                        >
                            <div className="h-12 w-12 shrink-0 rounded overflow-hidden border bg-muted/40">
                                <ImgOrPlaceholder src={smallSrc} alt="List thumb" />
                            </div>
                            <div className="flex-1 space-y-1 min-w-0">
                                <div className="h-2 w-full rounded bg-muted" />
                                <div className="h-1.5 w-1/2 rounded bg-muted/70" />
                            </div>
                        </div>
                        {!small && poster && (
                            <p className="text-[10px] text-muted-foreground">
                                Sin miniatura → se usa la principal
                            </p>
                        )}
                    </div>

                    <div className="space-y-1 min-w-0">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <span className="h-4 w-4 rounded-full bg-muted grid place-items-center text-[9px] font-semibold">
                                4
                            </span>
                            Galería
                        </div>
                        <div
                            className={
                                highlight === "gallery" ? "rounded-lg ring-2 ring-primary p-0.5" : ""
                            }
                        >
                            {thumbs.length === 0 ? (
                                <div className="h-16 rounded-lg border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                                    Sin fotos de galería
                                </div>
                            ) : (
                                <div className="flex gap-1.5">
                                    {thumbs.map((url, i) => (
                                        <div
                                            key={`${url}-${i}`}
                                            className="h-16 w-16 shrink-0 rounded-md overflow-hidden border bg-muted/40"
                                        >
                                            <ImgOrPlaceholder
                                                src={resolveSrc(url, assetUrlFn)}
                                                alt={`Gallery ${i + 1}`}
                                            />
                                        </div>
                                    ))}
                                    {extra > 0 && (
                                        <div className="h-16 w-16 shrink-0 rounded-md border bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                                            +{extra}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Compact context silhouette next to a dropzone. */
export function MediaSlotMock({
    kind,
    src,
    assetUrl: assetUrlFn,
}) {
    if (kind === "banner") {
        const resolved = resolveSrc(src, assetUrlFn);
        return (
            <SlotFrame
                label="① Portada / hero de la página"
                testid="media-slot-banner"
            >
                <div className="aspect-video rounded-md overflow-hidden border bg-muted/40">
                    <ImgOrPlaceholder src={resolved} alt="Banner slot" />
                </div>
            </SlotFrame>
        );
    }

    if (kind === "poster") {
        const resolved = resolveSrc(src, assetUrlFn);
        return (
            <SlotFrame
                label="② Cards del microsite + ticket"
                testid="media-slot-poster"
            >
                <div className="w-[100px] rounded-md overflow-hidden border bg-card shadow-sm">
                    <div className="aspect-square">
                        <ImgOrPlaceholder src={resolved} alt="Poster slot" />
                    </div>
                    <div className="p-1.5 space-y-1">
                        <div className="h-1.5 w-full rounded bg-muted" />
                        <div className="h-1 w-2/3 rounded bg-muted/70" />
                    </div>
                </div>
            </SlotFrame>
        );
    }

    if (kind === "small") {
        const resolved = resolveSrc(src, assetUrlFn);
        return (
            <SlotFrame
                label="③ Thumb en listados"
                testid="media-slot-small"
            >
                <div className="flex items-center gap-2 rounded-md border bg-card p-1.5 w-full max-w-[200px]">
                    <div className="h-10 w-10 shrink-0 rounded overflow-hidden border bg-muted/40">
                        <ImgOrPlaceholder src={resolved} alt="Small slot" />
                    </div>
                    <div className="flex-1 space-y-1 min-w-0">
                        <div className="h-1.5 w-full rounded bg-muted" />
                        <div className="h-1 w-1/2 rounded bg-muted/70" />
                    </div>
                </div>
            </SlotFrame>
        );
    }

    // gallery — src is string[]
    const items = Array.isArray(src) ? src.filter((u) => typeof u === "string") : [];
    return (
        <SlotFrame
            label="④ Galería de la página"
            testid="media-slot-gallery"
        >
            <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className="h-10 w-10 rounded overflow-hidden border bg-muted/40"
                    >
                        <ImgOrPlaceholder
                            src={resolveSrc(items[i], assetUrlFn)}
                            alt={`Gallery thumb ${i + 1}`}
                        />
                    </div>
                ))}
            </div>
        </SlotFrame>
    );
}

function SlotFrame({ label, children, testid }) {
    return (
        <div className="space-y-1.5" data-testid={testid}>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}

export default EventMediaCompositePreview;
