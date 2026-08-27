/**
 * SEO settings + revision history panels for the microsite editor.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { History, RotateCcw, Save, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import api, { formatApiError } from "@/lib/api";
import { assetUrl } from "@/lib/microsite";
import { canUseCustomCss } from "@/lib/micrositeSeo";
import { PlanGateHint } from "@/components/plans/PlanGate";
import { usePlanFeatures } from "@/hooks/queries/usePlanFeatures";

export function SeoPanel({
    microsite,
    onUpdateSeo,
    onUpdateBranding,
    uploadGalleryAsset,
    uploadingGallery,
    planCode,
}: {
    microsite: Record<string, unknown>;
    onUpdateSeo: (patch: Record<string, string | null>) => void;
    onUpdateBranding: (patch: Record<string, string>) => void;
    uploadGalleryAsset: (file: File) => Promise<string | null>;
    uploadingGallery: boolean;
    planCode?: string;
}) {
    const seo = (microsite.seo || {}) as Record<string, string | null>;
    const branding = (microsite.branding || {}) as Record<string, string>;
    const { data: planFeatures } = usePlanFeatures();
    const customCssAllowed = planFeatures
        ? Boolean(planFeatures.microsite_custom_css)
        : canUseCustomCss(planCode);

    return (
        <div className="space-y-5" data-testid="seo-panel">
            <div>
                <h3 className="text-sm font-semibold">SEO y redes sociales</h3>
                <p className="text-xs text-muted-foreground">
                    Cómo aparece tu microsite en Google, WhatsApp y redes al compartir el link.
                </p>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between">
                    <Label>Título (meta title)</Label>
                    <span className="text-xs text-muted-foreground">
                        {(seo.meta_title || "").length}/70
                    </span>
                </div>
                <Input
                    value={seo.meta_title || ""}
                    onChange={(e) => onUpdateSeo({ meta_title: e.target.value })}
                    maxLength={70}
                    placeholder="Nombre de tu organización"
                    data-testid="seo-meta-title"
                />
            </div>

            <div className="space-y-2">
                <div className="flex justify-between">
                    <Label>Descripción (meta description)</Label>
                    <span className="text-xs text-muted-foreground">
                        {(seo.meta_description || "").length}/160
                    </span>
                </div>
                <Textarea
                    value={seo.meta_description || ""}
                    onChange={(e) => onUpdateSeo({ meta_description: e.target.value })}
                    maxLength={160}
                    rows={3}
                    placeholder="Breve descripción para buscadores y previews"
                    data-testid="seo-meta-description"
                />
            </div>

            <div className="space-y-2">
                <Label>Imagen Open Graph</Label>
                {seo.og_image_url ? (
                    <img
                        src={assetUrl(seo.og_image_url) || ""}
                        alt="OG preview"
                        className="w-full max-h-32 object-cover rounded-lg border"
                    />
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Si no subís una, se usa el banner o logo del tema.
                    </p>
                )}
                <div className="flex gap-2">
                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            data-testid="seo-og-upload"
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const url = await uploadGalleryAsset(f);
                                if (url) onUpdateSeo({ og_image_url: url });
                                e.target.value = "";
                            }}
                        />
                        <Button asChild variant="outline" size="sm" disabled={uploadingGallery}>
                            <span>
                                {uploadingGallery ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                    <Upload className="h-3.5 w-3.5 mr-1" />
                                )}
                                Subir imagen OG
                            </span>
                        </Button>
                    </label>
                    {seo.og_image_url && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onUpdateSeo({ og_image_url: null })}
                        >
                            Quitar
                        </Button>
                    )}
                </div>
            </div>

            <div className="pt-4 border-t space-y-2">
                <div className="flex items-center justify-between">
                    <Label>CSS personalizado</Label>
                    {!customCssAllowed && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-700">
                            Bloqueado
                        </span>
                    )}
                </div>
                <Textarea
                    value={branding.custom_css || ""}
                    onChange={(e) => onUpdateBranding({ custom_css: e.target.value })}
                    rows={6}
                    disabled={!customCssAllowed}
                    maxLength={8000}
                    placeholder={
                        customCssAllowed
                            ? "/* .ms-hero { ... } */"
                            : "Disponible en un plan superior"
                    }
                    className="font-mono text-xs"
                    data-testid="seo-custom-css"
                />
                {customCssAllowed ? (
                    <p className="text-xs text-muted-foreground">
                        Máx. 8000 caracteres. Sin scripts ni @import.
                    </p>
                ) : (
                    <PlanGateHint feature="microsite_custom_css">
                        CSS personalizado del microsite: disponible en Profesional o Enterprise.
                    </PlanGateHint>
                )}
            </div>
        </div>
    );
}

export function RevisionsPanel({
    onRestored,
}: {
    onRestored: (microsite: Record<string, unknown>) => void;
}) {
    const [revisions, setRevisions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get("/microsite/me/revisions");
            setRevisions(data || []);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const saveNow = async () => {
        setBusy("save");
        try {
            await api.post("/microsite/me/revisions", { label: "Guardado manual" });
            toast.success("Versión guardada");
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setBusy(null);
        }
    };

    const restore = async (id: string) => {
        if (!confirm("¿Restaurar esta versión? Se guardará un snapshot del estado actual.")) return;
        setBusy(id);
        try {
            const { data } = await api.post(`/microsite/me/revisions/${id}/restore`);
            onRestored(data);
            toast.success("Versión restaurada");
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-4" data-testid="revisions-panel">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <History className="h-4 w-4" />
                        Historial
                    </h3>
                    <p className="text-xs text-muted-foreground">Últimas 20 versiones guardadas</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={saveNow}
                    disabled={busy === "save"}
                    data-testid="revision-save-btn"
                >
                    {busy === "save" ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                        <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Guardar ahora
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                    Todavía no hay versiones. Se crea una automáticamente al publicar.
                </p>
            ) : (
                <ul className="space-y-2">
                    {revisions.map((rev) => (
                        <li
                            key={rev.id}
                            className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                            data-testid={`revision-${rev.id}`}
                        >
                            <div className="min-w-0">
                                <div className="font-medium truncate">{rev.label || "Versión"}</div>
                                <div className="text-xs text-muted-foreground">
                                    {rev.created_at
                                        ? format(new Date(rev.created_at), "d MMM yyyy, HH:mm", {
                                              locale: es,
                                          })
                                        : "—"}
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => restore(rev.id)}
                                disabled={busy === rev.id}
                                data-testid={`revision-restore-${rev.id}`}
                            >
                                {busy === rev.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                )}
                                Restaurar
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
