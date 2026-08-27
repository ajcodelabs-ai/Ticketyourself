/**
 * Properties panel for the selected block or global theme settings.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import RichTextEditor from "@/components/editor/RichTextEditor";
import {
    BLOCK_CONTENT_FIELDS,
    HERO_CTA_HREF_OPTIONS,
    blockLabel,
    hasHtmlContent,
    type BlockType,
    type MicrositeBlock,
} from "@/lib/micrositeBlocks";
import {
    FONT_OPTIONS,
    TEMPLATE_OPTIONS,
    RADIUS_OPTIONS,
    SHADOW_OPTIONS,
    DENSITY_OPTIONS,
    RADIUS_VALUES,
    SHADOW_VALUES,
    assetUrl,
} from "@/lib/microsite";
import {
    ImageBlockEditor,
    GalleryBlockEditor,
    FaqBlockEditor,
    TestimonialsBlockEditor,
} from "@/components/microsite/editor/BlockContentEditors";

function ContentField({ label, value, textarea, maxLength, onChange, testid }) {
    const len = (value || "").length;
    const Component = textarea ? Textarea : Input;
    return (
        <div className="space-y-1.5">
            <div className="flex justify-between">
                <Label>{label}</Label>
                {maxLength && (
                    <span
                        className={`text-xs ${len > maxLength * 0.9 ? "text-amber-600" : "text-muted-foreground"}`}
                    >
                        {len}/{maxLength}
                    </span>
                )}
            </div>
            <Component
                value={value}
                onChange={(e) => onChange(e.target.value)}
                maxLength={maxLength}
                rows={textarea ? 4 : undefined}
                data-testid={testid}
            />
        </div>
    );
}

function AssetField({ label, currentUrl, onUpload, uploading, shape, testid }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex items-center gap-3">
                {currentUrl ? (
                    <img
                        src={currentUrl}
                        alt={label}
                        className={`object-cover ring-2 ring-border ${
                            shape === "circle" ? "h-14 w-14 rounded-full" : "h-14 w-24 rounded-md"
                        }`}
                    />
                ) : (
                    <div
                        className={`bg-secondary border ${
                            shape === "circle" ? "h-14 w-14 rounded-full" : "h-14 w-24 rounded-md"
                        } grid place-items-center text-xs text-muted-foreground`}
                    >
                        sin
                    </div>
                )}
                <label className="cursor-pointer">
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        data-testid={testid}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onUpload(f);
                            e.target.value = "";
                        }}
                    />
                    <Button asChild variant="outline" size="sm" disabled={uploading}>
                        <span>
                            {uploading ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            Subir
                        </span>
                    </Button>
                </label>
            </div>
        </div>
    );
}

function BlockVariantFields({
    block,
    onUpdateProps,
}: {
    block: MicrositeBlock;
    onUpdateProps: (props: Record<string, unknown>) => void;
}) {
    if (block.type === "hero") {
        return (
            <div className="space-y-3">
                <div className="space-y-2">
                    <Label>Tamaño del hero</Label>
                    <Select
                        value={(block.props.variant as string) || "normal"}
                        onValueChange={(v) => onUpdateProps({ variant: v })}
                    >
                        <SelectTrigger data-testid="prop-hero-variant">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="huge">Grande</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Alineación</Label>
                    <Select
                        value={(block.props.align as string) || "left"}
                        onValueChange={(v) => onUpdateProps({ align: v })}
                    >
                        <SelectTrigger data-testid="prop-hero-align">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="left">Izquierda</SelectItem>
                            <SelectItem value="center">Centro</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        );
    }
    if (block.type === "about") {
        return (
            <div className="space-y-2">
                <Label>Alineación</Label>
                <Select
                    value={(block.props.align as string) || "left"}
                    onValueChange={(v) => onUpdateProps({ align: v })}
                >
                    <SelectTrigger data-testid="prop-about-align">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="left">Izquierda</SelectItem>
                        <SelectItem value="center">Centro</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        );
    }
    if (block.type === "events") {
        return (
            <div className="space-y-2">
                <Label>Layout de eventos</Label>
                <Select
                    value={(block.props.layout as string) || "grid"}
                    onValueChange={(v) => onUpdateProps({ layout: v })}
                >
                    <SelectTrigger data-testid="prop-events-layout">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="grid">Grid estándar</SelectItem>
                        <SelectItem value="galeria">Galería visual</SelectItem>
                        <SelectItem value="list">Lista cronológica</SelectItem>
                        <SelectItem value="featured">Evento destacado</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        );
    }
    if (block.type === "spacer") {
        return (
            <div className="space-y-2">
                <Label>Altura</Label>
                <Select
                    value={(block.props.height as string) || "md"}
                    onValueChange={(v) => onUpdateProps({ height: v })}
                >
                    <SelectTrigger data-testid="prop-spacer-height">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="sm">Pequeño</SelectItem>
                        <SelectItem value="md">Mediano</SelectItem>
                        <SelectItem value="lg">Grande</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        );
    }
    return null;
}

function HeroCtaHrefField({ value, onChange }) {
    const preset = HERO_CTA_HREF_OPTIONS.find((o) => o.value === value);
    const selectValue = preset ? value : value ? "custom" : "#events";

    return (
        <div className="space-y-2">
            <Label>Destino del botón</Label>
            <Select
                value={selectValue}
                onValueChange={(v) => {
                    if (v === "custom") onChange("");
                    else onChange(v);
                }}
            >
                <SelectTrigger data-testid="prop-hero-cta-href-select">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {HERO_CTA_HREF_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {(selectValue === "custom" || (!preset && value)) && (
                <Input
                    value={value || ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="https://... o #seccion"
                    data-testid="prop-hero-cta-href-custom"
                />
            )}
        </div>
    );
}

export function BlockPropertiesPanel({
    block,
    microsite,
    onUpdateProps,
    onUpdateContent,
    onUpdateSocial,
    onUploadGallery,
    uploadingGallery = false,
    selectedLayerId = null,
    onSelectLayer = undefined,
}: {
    block: MicrositeBlock;
    microsite: Record<string, unknown>;
    onUpdateProps: (props: Record<string, unknown>) => void;
    onUpdateContent: (patch: Record<string, string>) => void;
    onUpdateSocial: (patch: Record<string, string>) => void;
    onUploadGallery?: (file: File) => Promise<string | null>;
    uploadingGallery?: boolean;
    selectedLayerId?: string | null;
    onSelectLayer?: (id: string | null) => void;
}) {
    const content = (microsite.content || {}) as Record<string, string>;
    const fields = (BLOCK_CONTENT_FIELDS[block.type as BlockType] || []).filter(
        (f) =>
            block.type !== "hero" ||
            !["hero_title", "hero_subtitle", "hero_cta_text", "hero_cta_href"].includes(f.key),
    );

    return (
        <div className="space-y-4" data-testid="block-properties-panel">
            <div>
                <h3 className="text-sm font-semibold">{blockLabel(block.type)}</h3>
                <p className="text-xs text-muted-foreground">Editá las propiedades de esta sección</p>
            </div>

            <BlockVariantFields block={block} onUpdateProps={onUpdateProps} />

            {fields.map((f) =>
                f.key === "hero_cta_href" ? (
                    <HeroCtaHrefField
                        key={f.key}
                        value={content[f.key] || "#events"}
                        onChange={(v) => onUpdateContent({ [f.key]: v })}
                    />
                ) : (
                    <ContentField
                        key={f.key}
                        label={f.label}
                        value={content[f.key] || ""}
                        textarea={f.textarea}
                        maxLength={f.maxLength}
                        onChange={(v) => onUpdateContent({ [f.key]: v })}
                        testid={`prop-content-${f.key}`}
                    />
                ),
            )}

            {/* Hero layer controls live in the top ribbon above preview */}
            {block.type === "hero" && (
                <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-3 bg-muted/30">
                    Los textos y capas del hero se editan en la <strong>barra superior</strong> sobre la
                    vista previa.
                </p>
            )}

            {block.type === "about" && (
                <div className="space-y-2">
                    <Label>Contenido (texto enriquecido)</Label>
                    <RichTextEditor
                        value={content.about_body_html || content.about_body || ""}
                        onChange={(html) => onUpdateContent({ about_body_html: html })}
                        placeholder="Contá la historia de tu organización…"
                        testid="prop-about-rich"
                    />
                    {!hasHtmlContent(content.about_body_html) && content.about_body && (
                        <p className="text-xs text-muted-foreground">
                            Tip: el texto plano anterior se muestra hasta que guardes contenido enriquecido.
                        </p>
                    )}
                </div>
            )}

            {block.type === "image" && onUploadGallery && (
                <ImageBlockEditor
                    block={block}
                    onUpdateProps={onUpdateProps}
                    onUploadGallery={onUploadGallery}
                    uploading={uploadingGallery}
                />
            )}

            {block.type === "gallery" && onUploadGallery && (
                <GalleryBlockEditor
                    block={block}
                    onUpdateProps={onUpdateProps}
                    onUploadGallery={onUploadGallery}
                    uploading={uploadingGallery}
                />
            )}

            {block.type === "faq" && (
                <FaqBlockEditor block={block} onUpdateProps={onUpdateProps} />
            )}

            {block.type === "testimonials" && onUploadGallery && (
                <TestimonialsBlockEditor
                    block={block}
                    onUpdateProps={onUpdateProps}
                    onUploadGallery={onUploadGallery}
                    uploading={uploadingGallery}
                />
            )}

            {block.type === "social" && (
                <div className="space-y-3 pt-2 border-t">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Redes sociales
                    </Label>
                    {Object.entries((microsite.social_links || {}) as Record<string, string>).map(
                        ([k, rawValue]) => (
                            <div key={k} className="space-y-1.5">
                                <Label className="capitalize text-sm">{k}</Label>
                                <Input
                                    value={typeof rawValue === "string" ? rawValue : ""}
                                    placeholder={k === "whatsapp" ? "+593..." : "https://..."}
                                    onChange={(e) => onUpdateSocial({ [k]: e.target.value })}
                                    data-testid={`prop-social-${k}`}
                                />
                            </div>
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

function ThemeSwatchGroup({
    label,
    options,
    value,
    onChange,
    renderSwatch,
    testidPrefix,
}: {
    label: string;
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    renderSwatch: (value: string) => any;
    testidPrefix: string;
}) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="grid grid-cols-3 gap-2">
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border text-[11px] transition ${
                            value === opt.value
                                ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                                : "border-border hover:border-primary/50"
                        }`}
                        data-testid={`${testidPrefix}-${opt.value}`}
                    >
                        {renderSwatch(opt.value)}
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function ThemePanel({
    microsite,
    onApplyTemplate,
    onUpdateBranding,
    uploadAsset,
    uploadingAsset,
}: {
    microsite: Record<string, unknown>;
    onApplyTemplate: (code: string) => void;
    onUpdateBranding: (patch: Record<string, string>) => void;
    uploadAsset: (file: File, type: string) => void;
    uploadingAsset: string | null;
}) {
    const branding = (microsite.branding || {}) as Record<string, string>;

    const categories = [...new Set(TEMPLATE_OPTIONS.map((t) => t.category))];

    return (
        <div className="space-y-5" data-testid="theme-panel">
            <div>
                <h3 className="text-sm font-semibold mb-2">Plantillas rápidas</h3>
                <p className="text-xs text-muted-foreground mb-3">
                    Aplicá un diseño prearmado. Podés reordenar y personalizar después.
                </p>
                {categories.map((cat) => (
                    <div key={cat} className="mb-4">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                            {cat}
                        </p>
                        <div className="space-y-2">
                            {TEMPLATE_OPTIONS.filter((t) => t.category === cat).map((t) => {
                                const active = microsite.template === t.code;
                                return (
                                    <button
                                        key={t.code}
                                        type="button"
                                        onClick={() => onApplyTemplate(t.code)}
                                        className={`w-full text-left p-3 rounded-lg border transition text-sm ${
                                            active
                                                ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                                                : "border-border hover:border-primary/50"
                                        }`}
                                        data-testid={`template-${t.code}`}
                                    >
                                        <div className="font-medium">{t.name}</div>
                                        <div className="text-xs text-muted-foreground">{t.description}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="space-y-4 pt-2 border-t">
                <h3 className="text-sm font-semibold">Tema global</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                        <Label>Color primario</Label>
                        <input
                            type="color"
                            value={branding.primary_color}
                            onChange={(e) => onUpdateBranding({ primary_color: e.target.value })}
                            className="h-10 w-full rounded border"
                            data-testid="color-primary"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Color secundario</Label>
                        <input
                            type="color"
                            value={branding.secondary_color}
                            onChange={(e) => onUpdateBranding({ secondary_color: e.target.value })}
                            className="h-10 w-full rounded border"
                            data-testid="color-secondary"
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>Tipografía</Label>
                    <Select
                        value={branding.font_family}
                        onValueChange={(v) => onUpdateBranding({ font_family: v })}
                    >
                        <SelectTrigger data-testid="font-select">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FONT_OPTIONS.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <ThemeSwatchGroup
                    label="Forma"
                    options={RADIUS_OPTIONS}
                    value={branding.radius || "rounded"}
                    onChange={(v) => onUpdateBranding({ radius: v })}
                    renderSwatch={(v) => (
                        <span
                            className="h-6 w-10 bg-secondary border border-border/60"
                            style={{ borderRadius: RADIUS_VALUES[v] }}
                        />
                    )}
                    testidPrefix="radius"
                />
                <ThemeSwatchGroup
                    label="Sombra"
                    options={SHADOW_OPTIONS}
                    value={branding.shadow_style || "soft"}
                    onChange={(v) => onUpdateBranding({ shadow_style: v })}
                    renderSwatch={(v) => (
                        <span
                            className="h-6 w-10 rounded-md bg-card border border-border/60"
                            style={{ boxShadow: SHADOW_VALUES[v] }}
                        />
                    )}
                    testidPrefix="shadow"
                />
                <ThemeSwatchGroup
                    label="Densidad"
                    options={DENSITY_OPTIONS}
                    value={branding.density || "cozy"}
                    onChange={(v) => onUpdateBranding({ density: v })}
                    renderSwatch={(v) => (
                        <div className="h-6 w-10 flex flex-col justify-center gap-[3px]">
                            <span
                                className="h-[2px] w-full bg-secondary-foreground/40 rounded-full"
                                style={{
                                    marginBlock:
                                        v === "compact" ? "1px" : v === "spacious" ? "5px" : "3px",
                                }}
                            />
                            <span
                                className="h-[2px] w-full bg-secondary-foreground/40 rounded-full"
                                style={{
                                    marginBlock:
                                        v === "compact" ? "1px" : v === "spacious" ? "5px" : "3px",
                                }}
                            />
                        </div>
                    )}
                    testidPrefix="density"
                />
                <AssetField
                    label="Logo"
                    currentUrl={assetUrl(branding.logo_url)}
                    onUpload={(f) => uploadAsset(f, "logo")}
                    uploading={uploadingAsset === "logo"}
                    shape="circle"
                    testid="upload-logo"
                />
                <AssetField
                    label="Banner del hero"
                    currentUrl={assetUrl(branding.banner_url)}
                    onUpload={(f) => uploadAsset(f, "banner")}
                    uploading={uploadingAsset === "banner"}
                    shape="rect"
                    testid="upload-banner"
                />
            </div>
        </div>
    );
}

export function PublishPanel({
    microsite,
    organizer,
    onTogglePublish,
}: {
    microsite: Record<string, unknown>;
    organizer: Record<string, unknown>;
    onTogglePublish: () => void;
}) {
    const publishedAt = microsite.published_at as string | undefined;

    return (
        <div className="space-y-4" data-testid="publish-panel">
            <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="published-switch">Página publicada</Label>
                <Switch
                    id="published-switch"
                    checked={Boolean(microsite.published)}
                    onCheckedChange={onTogglePublish}
                    data-testid="publish-switch"
                />
            </div>
            {microsite.published && organizer?.slug && (
                <div className="space-y-2 text-xs text-muted-foreground">
                    <p>
                        Publicado en{" "}
                        <code className="bg-secondary px-1 rounded">
                            {String(organizer.slug)}.ticketyourself.com
                        </code>
                    </p>
                    {publishedAt && (
                        <p>
                            Desde:{" "}
                            {new Date(publishedAt).toLocaleString("es-EC", {
                                dateStyle: "medium",
                                timeStyle: "short",
                            })}
                        </p>
                    )}
                </div>
            )}
            {!microsite.published && (
                <p className="text-xs text-muted-foreground">
                    Los cambios se guardan como borrador. Al publicar se crea una versión en el
                    historial automáticamente.
                </p>
            )}
        </div>
    );
}
