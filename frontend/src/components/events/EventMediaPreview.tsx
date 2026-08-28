/**
 * Wireframe previews for event media placement in the wizard.
 * Schematic only — mirrors EventPublic / EventCard usage.
 */
import { ImageIcon } from "lucide-react";

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
                label="② Cards de tu página + ticket"
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
