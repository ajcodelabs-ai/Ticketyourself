/**
 * Simple-mode panel: template + collapsible setup groups.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    LayoutTemplate,
    Sparkles,
    Upload,
    Loader2,
} from "lucide-react";
import { getTemplatePreset } from "@/lib/micrositeTemplates";
import { assetUrl } from "@/lib/microsite";

function MiniAsset({
    label,
    currentUrl,
    onUpload,
    uploading,
    shape,
    testid,
}: {
    label: string;
    currentUrl: string | null;
    onUpload: (file: File) => void;
    uploading: boolean;
    shape: "circle" | "rect";
    testid: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <div className="flex items-center gap-3">
                {currentUrl ? (
                    <img
                        src={currentUrl}
                        alt={label}
                        className={`object-cover ring-2 ring-border ${
                            shape === "circle" ? "h-12 w-12 rounded-full" : "h-12 w-20 rounded-md"
                        }`}
                    />
                ) : (
                    <div
                        className={`bg-secondary border grid place-items-center text-[10px] text-muted-foreground ${
                            shape === "circle" ? "h-12 w-12 rounded-full" : "h-12 w-20 rounded-md"
                        }`}
                    >
                        —
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

export default function QuickSetupPanel({
    microsite,
    onOpenGallery,
    onUpdateContent,
    onUpdateBranding,
    onUpdateSocial,
    uploadAsset,
    uploadingAsset,
}: {
    microsite: Record<string, any>;
    onOpenGallery: () => void;
    onUpdateContent: (patch: Record<string, string>) => void;
    onUpdateBranding: (patch: Record<string, string>) => void;
    onUpdateSocial: (patch: Record<string, string>) => void;
    uploadAsset: (file: File, type: string) => void;
    uploadingAsset: string | null;
}) {
    const branding = (microsite.branding || {}) as Record<string, string>;
    const content = (microsite.content || {}) as Record<string, string>;
    const social = (microsite.social_links || {}) as Record<string, string>;
    const preset = getTemplatePreset(microsite.template);
    const [openItem, setOpenItem] = useState("brand");

    return (
        <div className="space-y-4" data-testid="quick-setup-panel">
            <div className="rounded-xl border overflow-hidden">
                <div
                    className="h-14"
                    style={{
                        background: `linear-gradient(135deg, ${branding.primary_color || "#4f46e5"}, ${
                            branding.primary_color || "#4f46e5"
                        }aa)`,
                    }}
                />
                <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <p className="text-sm font-semibold">{preset.name}</p>
                            <p className="text-xs text-muted-foreground">{preset.audience}</p>
                        </div>
                        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={onOpenGallery}
                        data-testid="open-template-gallery"
                    >
                        <LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />
                        Cambiar plantilla
                    </Button>
                </div>
            </div>

            <Accordion
                type="single"
                collapsible
                value={openItem}
                onValueChange={setOpenItem}
                className="space-y-2"
            >
                <AccordionItem
                    value="brand"
                    className="border rounded-xl px-3 bg-card"
                    data-testid="setup-section-brand"
                >
                    <AccordionTrigger className="py-3 hover:no-underline">
                        <span className="flex items-center gap-2.5 min-w-0">
                            <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-bold tabular-nums">
                                1
                            </span>
                            <span className="text-left min-w-0">
                                <span className="block text-sm font-semibold">Tu marca</span>
                                <span className="block text-[11px] font-normal text-muted-foreground">
                                    Logo, portada y color
                                </span>
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-3">
                        <MiniAsset
                            label="Logo"
                            currentUrl={assetUrl(branding.logo_url)}
                            onUpload={(f) => uploadAsset(f, "logo")}
                            uploading={uploadingAsset === "logo"}
                            shape="circle"
                            testid="upload-logo"
                        />
                        <MiniAsset
                            label="Foto de portada"
                            currentUrl={assetUrl(branding.banner_url)}
                            onUpload={(f) => uploadAsset(f, "banner")}
                            uploading={uploadingAsset === "banner"}
                            shape="rect"
                            testid="upload-banner"
                        />
                        <div className="space-y-1.5">
                            <Label className="text-xs">Color de marca</Label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={branding.primary_color || "#4f46e5"}
                                    onChange={(e) => onUpdateBranding({ primary_color: e.target.value })}
                                    className="h-10 w-14 rounded border cursor-pointer"
                                    data-testid="color-primary"
                                />
                                <span className="text-xs text-muted-foreground font-mono">
                                    {branding.primary_color || "#4f46e5"}
                                </span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem
                    value="copy"
                    className="border rounded-xl px-3 bg-card"
                    data-testid="setup-section-copy"
                >
                    <AccordionTrigger className="py-3 hover:no-underline">
                        <span className="flex items-center gap-2.5 min-w-0">
                            <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-bold tabular-nums">
                                2
                            </span>
                            <span className="text-left min-w-0">
                                <span className="block text-sm font-semibold">Textos de portada</span>
                                <span className="block text-[11px] font-normal text-muted-foreground">
                                    Título, subtítulo y botón
                                </span>
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Título</Label>
                            <Input
                                value={content.hero_title || ""}
                                onChange={(e) => onUpdateContent({ hero_title: e.target.value })}
                                maxLength={80}
                                data-testid="quick-hero-title"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Subtítulo</Label>
                            <Textarea
                                value={content.hero_subtitle || ""}
                                onChange={(e) => onUpdateContent({ hero_subtitle: e.target.value })}
                                maxLength={200}
                                rows={3}
                                data-testid="quick-hero-subtitle"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Texto del botón</Label>
                            <Input
                                value={content.hero_cta_text || ""}
                                onChange={(e) => onUpdateContent({ hero_cta_text: e.target.value })}
                                maxLength={30}
                                data-testid="quick-hero-cta"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem
                    value="contact"
                    className="border rounded-xl px-3 bg-card"
                    data-testid="setup-section-contact"
                >
                    <AccordionTrigger className="py-3 hover:no-underline">
                        <span className="flex items-center gap-2.5 min-w-0">
                            <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-bold tabular-nums">
                                3
                            </span>
                            <span className="text-left min-w-0">
                                <span className="block text-sm font-semibold">Contacto</span>
                                <span className="block text-[11px] font-normal text-muted-foreground">
                                    Email, WhatsApp e Instagram
                                </span>
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Email</Label>
                            <Input
                                value={content.contact_email || ""}
                                onChange={(e) => onUpdateContent({ contact_email: e.target.value })}
                                placeholder="hola@tuorganizacion.com"
                                data-testid="quick-contact-email"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">WhatsApp</Label>
                            <Input
                                value={social.whatsapp || ""}
                                onChange={(e) => onUpdateSocial({ whatsapp: e.target.value })}
                                placeholder="+593..."
                                data-testid="quick-social-whatsapp"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Instagram</Label>
                            <Input
                                value={social.instagram || ""}
                                onChange={(e) => onUpdateSocial({ instagram: e.target.value })}
                                placeholder="https://instagram.com/..."
                                data-testid="quick-social-instagram"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
}
