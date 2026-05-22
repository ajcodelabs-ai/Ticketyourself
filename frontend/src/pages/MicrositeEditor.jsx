/**
 * MicrositeEditor: 40/60 split layout — config panel on the left, live preview on the right.
 * Mobile: panel becomes a stacked accordion-ish flow above the preview.
 *
 * Every form change is debounced 300ms then persisted via PUT /api/microsite/me.
 * Optimistic local state ensures the preview updates instantly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import MicrositeRenderer from "@/components/microsite/MicrositeRenderer";
import ShareModal from "@/components/microsite/ShareModal";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { TEMPLATE_OPTIONS, FONT_OPTIONS, assetUrl } from "@/lib/microsite";
import { PUBLIC_DOMAIN, previewMicrositePath } from "@/lib/config";
import {
    Eye,
    ExternalLink,
    Monitor,
    Smartphone,
    Share2,
    Upload,
    Loader2,
} from "lucide-react";

const TEXT_LIMITS = {
    hero_title: 80,
    hero_subtitle: 200,
    hero_cta_text: 30,
    about_title: 80,
    about_body: 1000,
};

export default function MicrositeEditor() {
    const { organizer } = useAuth();
    const navigate = useNavigate();
    const [microsite, setMicrosite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [previewMode, setPreviewMode] = useState("desktop");
    const [shareOpen, setShareOpen] = useState(false);
    const [uploadingAsset, setUploadingAsset] = useState(null);
    const saveTimer = useRef(null);

    // Initial load
    useEffect(() => {
        let active = true;
        api.get("/microsite/me")
            .then((r) => active && setMicrosite(r.data))
            .catch((e) => {
                if (e?.response?.status === 403) {
                    toast.error(
                        "Tu cuenta debe estar aprobada para editar el microsite.",
                    );
                    navigate("/dashboard", { replace: true });
                    return;
                }
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [navigate]);

    const pushUpdate = (partial) => {
        // Optimistic local update + debounced PUT.
        setMicrosite((prev) => deepMerge(prev, partial));
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            try {
                setSaving(true);
                const { data } = await api.put("/microsite/me", partial);
                setMicrosite(data);
            } catch (e) {
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            } finally {
                setSaving(false);
            }
        }, 300);
    };

    const uploadAsset = async (file, asset_type) => {
        if (!file) return;
        setUploadingAsset(asset_type);
        try {
            const fd = new FormData();
            fd.append("asset_type", asset_type);
            fd.append("file", file);
            const { data } = await api.post("/microsite/me/assets", fd);
            // Refresh microsite (server set logo_url / banner_url on us)
            const fresh = await api.get("/microsite/me");
            setMicrosite(fresh.data);
            toast.success(
                asset_type === "logo" ? "Logo subido" : asset_type === "banner" ? "Banner subido" : "Imagen subida",
            );
        } catch (e) {
            const status = e?.response?.status;
            const msg = formatApiError(e?.response?.data?.detail) || e.message;
            toast.error(status ? `Error ${status}: ${msg}` : msg);
        } finally {
            setUploadingAsset(null);
        }
    };

    const togglePublish = async () => {
        if (!microsite) return;
        const endpoint = microsite.published ? "/microsite/me/unpublish" : "/microsite/me/publish";
        try {
            await api.post(endpoint);
            const fresh = await api.get("/microsite/me");
            setMicrosite(fresh.data);
            toast.success(fresh.data.published ? "Microsite publicado" : "Microsite despublicado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const publicUrl = useMemo(() => {
        if (!organizer?.slug) return "";
        const origin = window.location.origin;
        return `${origin}${previewMicrositePath(organizer.slug)}`;
    }, [organizer?.slug]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!microsite) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                No se pudo cargar el microsite.
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="microsite-editor">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Microsite</h1>
                    <p className="text-sm text-muted-foreground">
                        {microsite.published ? (
                            <>
                                Publicado en{" "}
                                <code className="bg-secondary px-1.5 py-0.5 rounded">
                                    {organizer.slug}.{PUBLIC_DOMAIN}
                                </code>
                            </>
                        ) : (
                            "Aún no publicado."
                        )}
                        {saving && (
                            <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Guardando…
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        asChild
                        data-testid="editor-open-public"
                    >
                        <Link to={previewMicrositePath(organizer.slug)} target="_blank">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Ver público
                        </Link>
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setShareOpen(true)}
                        data-testid="editor-share-btn"
                    >
                        <Share2 className="h-4 w-4 mr-2" />
                        Compartir
                    </Button>
                    <Button
                        onClick={togglePublish}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        data-testid="editor-publish-btn"
                    >
                        {microsite.published ? "Despublicar" : "Publicar"}
                    </Button>
                </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
                {/* PANEL LEFT */}
                <Card className="lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto">
                    <CardContent className="pt-6">
                        <Tabs defaultValue="template" className="w-full">
                            <TabsList
                                className="grid grid-cols-3 gap-1 mb-4 w-full h-auto p-1"
                                data-testid="editor-tabs"
                            >
                                <TabsTrigger value="template" data-testid="tab-template" className="text-xs">Plantilla</TabsTrigger>
                                <TabsTrigger value="branding" data-testid="tab-branding" className="text-xs">Branding</TabsTrigger>
                                <TabsTrigger value="content" data-testid="tab-content" className="text-xs">Contenido</TabsTrigger>
                                <TabsTrigger value="social" data-testid="tab-social" className="text-xs">Redes</TabsTrigger>
                                <TabsTrigger value="sections" data-testid="tab-sections" className="text-xs">Secciones</TabsTrigger>
                                <TabsTrigger value="publish" data-testid="tab-publish" className="text-xs">Publicar</TabsTrigger>
                            </TabsList>

                            <TabsContent value="template" className="space-y-3">
                                {TEMPLATE_OPTIONS.map((t) => {
                                    const active = microsite.template === t.code;
                                    return (
                                        <button
                                            key={t.code}
                                            type="button"
                                            onClick={() => pushUpdate({ template: t.code })}
                                            className={`w-full text-left p-4 rounded-xl border transition ${
                                                active
                                                    ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                                                    : "border-border hover:border-primary/50"
                                            }`}
                                            data-testid={`template-${t.code}`}
                                        >
                                            <div className="font-semibold">{t.name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {t.description}
                                            </div>
                                        </button>
                                    );
                                })}
                            </TabsContent>

                            <TabsContent value="branding" className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label>Color primario</Label>
                                        <input
                                            type="color"
                                            value={microsite.branding.primary_color}
                                            onChange={(e) =>
                                                pushUpdate({
                                                    branding: { primary_color: e.target.value },
                                                })
                                            }
                                            className="h-10 w-full rounded border"
                                            data-testid="color-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Color secundario</Label>
                                        <input
                                            type="color"
                                            value={microsite.branding.secondary_color}
                                            onChange={(e) =>
                                                pushUpdate({
                                                    branding: { secondary_color: e.target.value },
                                                })
                                            }
                                            className="h-10 w-full rounded border"
                                            data-testid="color-secondary"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipografía</Label>
                                    <Select
                                        value={microsite.branding.font_family}
                                        onValueChange={(v) =>
                                            pushUpdate({ branding: { font_family: v } })
                                        }
                                    >
                                        <SelectTrigger data-testid="font-select">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FONT_OPTIONS.map((f) => (
                                                <SelectItem
                                                    key={f.value}
                                                    value={f.value}
                                                    data-testid={`font-opt-${f.value}`}
                                                >
                                                    {f.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <AssetField
                                    label="Logo"
                                    currentUrl={assetUrl(microsite.branding.logo_url)}
                                    onUpload={(f) => uploadAsset(f, "logo")}
                                    uploading={uploadingAsset === "logo"}
                                    shape="circle"
                                    testid="upload-logo"
                                />
                                <AssetField
                                    label="Banner del hero"
                                    currentUrl={assetUrl(microsite.branding.banner_url)}
                                    onUpload={(f) => uploadAsset(f, "banner")}
                                    uploading={uploadingAsset === "banner"}
                                    shape="rect"
                                    testid="upload-banner"
                                />
                            </TabsContent>

                            <TabsContent value="content" className="space-y-4">
                                {[
                                    ["hero_title", "Título del hero"],
                                    ["hero_subtitle", "Subtítulo del hero", true],
                                    ["hero_cta_text", "Texto del botón principal"],
                                    ["about_title", "Título 'Sobre nosotros'"],
                                    ["about_body", "Cuerpo 'Sobre nosotros'", true],
                                    ["contact_email", "Email de contacto"],
                                    ["contact_phone", "Teléfono de contacto"],
                                    ["address", "Dirección"],
                                ].map(([key, label, textarea]) => (
                                    <ContentField
                                        key={key}
                                        label={label}
                                        value={microsite.content[key] || ""}
                                        textarea={textarea}
                                        maxLength={TEXT_LIMITS[key]}
                                        onChange={(v) => pushUpdate({ content: { [key]: v } })}
                                        testid={`content-${key}`}
                                    />
                                ))}
                            </TabsContent>

                            <TabsContent value="social" className="space-y-3">
                                {Object.entries(microsite.social_links).map(([k, v]) => (
                                    <div key={k} className="space-y-2">
                                        <Label className="capitalize">{k}</Label>
                                        <Input
                                            value={v || ""}
                                            placeholder={k === "whatsapp" ? "+593..." : "https://..."}
                                            onChange={(e) =>
                                                pushUpdate({ social_links: { [k]: e.target.value } })
                                            }
                                            data-testid={`social-${k}`}
                                        />
                                    </div>
                                ))}
                            </TabsContent>

                            <TabsContent value="sections" className="space-y-3">
                                {Object.entries(microsite.sections_enabled).map(([k, v]) => (
                                    <div
                                        key={k}
                                        className="flex items-center justify-between rounded-lg border p-3"
                                    >
                                        <Label className="capitalize cursor-pointer">{k}</Label>
                                        <Switch
                                            checked={v}
                                            onCheckedChange={(c) =>
                                                pushUpdate({ sections_enabled: { [k]: c } })
                                            }
                                            data-testid={`section-${k}`}
                                        />
                                    </div>
                                ))}
                            </TabsContent>

                            <TabsContent value="publish" className="space-y-4">
                                <div className="flex items-center justify-between rounded-lg border p-3">
                                    <Label htmlFor="published-switch">
                                        Microsite publicado
                                    </Label>
                                    <Switch
                                        id="published-switch"
                                        checked={microsite.published}
                                        onCheckedChange={togglePublish}
                                        data-testid="publish-switch"
                                    />
                                </div>
                                {microsite.published && organizer?.slug && (
                                    <div className="rounded-lg border bg-secondary/30 p-4 space-y-2">
                                        <p className="text-sm">URL pública:</p>
                                        <code className="block text-sm bg-background px-2 py-1.5 rounded border">
                                            {organizer.slug}.{PUBLIC_DOMAIN}
                                        </code>
                                        <p className="text-xs text-muted-foreground">
                                            Próximamente con DNS de producción. En preview:{" "}
                                            <Link
                                                to={previewMicrositePath(organizer.slug)}
                                                className="underline"
                                            >
                                                /o/{organizer.slug}
                                            </Link>
                                        </p>
                                        <Button
                                            onClick={() => setShareOpen(true)}
                                            variant="outline"
                                            size="sm"
                                            data-testid="publish-share-btn"
                                        >
                                            <Share2 className="h-3.5 w-3.5 mr-1.5" />
                                            Compartir link + QR
                                        </Button>
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>

                {/* PREVIEW RIGHT */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">
                            Vista previa en vivo
                        </p>
                        <div className="flex gap-1 border rounded-full p-1 bg-secondary/40">
                            <button
                                onClick={() => setPreviewMode("desktop")}
                                className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 ${
                                    previewMode === "desktop" ? "bg-background shadow" : ""
                                }`}
                                data-testid="preview-desktop-btn"
                            >
                                <Monitor className="h-3.5 w-3.5" /> Desktop
                            </button>
                            <button
                                onClick={() => setPreviewMode("mobile")}
                                className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 ${
                                    previewMode === "mobile" ? "bg-background shadow" : ""
                                }`}
                                data-testid="preview-mobile-btn"
                            >
                                <Smartphone className="h-3.5 w-3.5" /> Mobile
                            </button>
                        </div>
                    </div>
                    <div
                        className={`rounded-2xl border bg-background overflow-hidden shadow-sm transition-all mx-auto ${
                            previewMode === "mobile" ? "w-[380px]" : "w-full"
                        }`}
                        data-testid="preview-frame"
                    >
                        <div className="lg:max-h-[calc(100vh-200px)] overflow-y-auto">
                            <MicrositeRenderer microsite={microsite} />
                        </div>
                    </div>
                </div>
            </div>

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={publicUrl}
                companyName={organizer?.company_name || organizer?.slug}
                heroSubtitle={microsite?.content?.hero_subtitle || ""}
            />
        </div>
    );
}

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
                            e.target.value = ""; // allow same file re-upload
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

function deepMerge(target, patch) {
    if (!patch || typeof patch !== "object") return patch;
    const out = { ...(target || {}) };
    for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
            out[k] = deepMerge(target?.[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}
