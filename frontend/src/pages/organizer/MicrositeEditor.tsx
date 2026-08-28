/**
 * Microsite editor — plantillas listas + ajustes mínimos (modo simple).
 * Modo avanzado: page builder (secciones, tema, SEO).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import HeroLayerRibbon from "@/components/microsite/editor/HeroLayerRibbon";
import MicrositeRenderer from "@/components/microsite/MicrositeRenderer";
import BlockListPanel from "@/components/microsite/editor/BlockListPanel";
import {
    BlockPropertiesPanel,
    ThemePanel,
    PublishPanel,
} from "@/components/microsite/editor/BlockPropertiesPanel";
import { SeoPanel, RevisionsPanel } from "@/components/microsite/editor/SeoAndHistoryPanel";
import MicrositeHead from "@/components/microsite/MicrositeHead";
import ShareModal from "@/components/microsite/ShareModal";
import PublishPendingDialog from "@/components/PublishPendingDialog";
import TemplateGallery from "@/components/microsite/editor/TemplateGallery";
import QuickSetupPanel from "@/components/microsite/editor/QuickSetupPanel";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { publicMicrositeUrl, PUBLIC_DOMAIN } from "@/lib/config";
import {
    createBlock,
    resolveBlocks,
    sectionsFromBlocks,
    type BlockType,
    type MicrositeBlock,
} from "@/lib/micrositeBlocks";
import { buildTemplateUpdate, getTemplatePreset } from "@/lib/micrositeTemplates";
import {
    ExternalLink,
    Monitor,
    Smartphone,
    Share2,
    Loader2,
    Maximize2,
    Palette,
    Settings2,
    Globe,
    Search,
    History,
    Grid3x3,
    LayoutTemplate,
    Wrench,
} from "lucide-react";

const SETUP_DONE_KEY = "tys.microsite_setup_done";
const EDITOR_MODE_KEY = "tys.microsite_editor_mode";

type SidePanel = "blocks" | "theme" | "seo" | "history" | "publish";
type WorkspaceMode = "simple" | "advanced";

export default function MicrositeEditor() {
    const { organizer } = useAuth();
    const navigate = useNavigate();
    const [microsite, setMicrosite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [previewMode, setPreviewMode] = useState("desktop");
    const [shareOpen, setShareOpen] = useState(false);
    const [uploadingAsset, setUploadingAsset] = useState(null);
    const [publishPendingOpen, setPublishPendingOpen] = useState(false);
    const [previewWidth, setPreviewWidth] = useState(0);
    const [fullscreenOpen, setFullscreenOpen] = useState(false);
    const [selectedBlockId, setSelectedBlockId] = useState(null);
    const [selectedLayerId, setSelectedLayerId] = useState(null);
    const [showGrid, setShowGrid] = useState(false);
    const [sidePanel, setSidePanel] = useState("blocks");
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [workspace, setWorkspace] = useState<WorkspaceMode>(() => {
        if (typeof window === "undefined") return "simple";
        return window.localStorage.getItem(EDITOR_MODE_KEY) === "advanced" ? "advanced" : "simple";
    });
    const previewRef = useRef(null);
    const saveTimer = useRef(null);
    const pendingPartial = useRef<any>({});
    const galleryPrompted = useRef(false);

    useEffect(() => {
        if (!previewRef.current || typeof ResizeObserver === "undefined") return;
        const el = previewRef.current;
        const update = () => setPreviewWidth(Math.round(el.getBoundingClientRect().width));
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        window.addEventListener("resize", update);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [microsite, previewMode]);

    useEffect(() => {
        let active = true;
        api.get("/microsite/me")
            .then((r) => {
                if (!active) return;
                const data = r.data;
                if (!data.blocks?.length) {
                    data.blocks = resolveBlocks(data);
                }
                setMicrosite(data);
            })
            .catch((e) => {
                if (e?.response?.status === 403) {
                    toast.error("Tu cuenta debe estar aprobada para editar tu página.");
                    navigate("/app/dashboard", { replace: true });
                    return;
                }
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [navigate]);

    useEffect(() => {
        if (loading || !microsite || galleryPrompted.current) return;
        if (microsite.published) return;
        if (typeof window === "undefined") return;
        if (window.localStorage.getItem(SETUP_DONE_KEY)) return;
        galleryPrompted.current = true;
        setGalleryOpen(true);
    }, [loading, microsite]);

    const pushUpdate = (partial) => {
        setMicrosite((prev) => {
            const merged = deepMerge(prev, partial);
            if (partial.blocks) {
                merged.sections_enabled = sectionsFromBlocks(partial.blocks);
            }
            return merged;
        });
        pendingPartial.current = deepMerge(pendingPartial.current, partial);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            const payload = pendingPartial.current;
            pendingPartial.current = {};
            try {
                setSaving(true);
                if (payload.blocks) {
                    payload.sections_enabled = sectionsFromBlocks(payload.blocks);
                }
                const { data } = await api.put("/microsite/me", payload);
                if (!data.blocks?.length) data.blocks = resolveBlocks(data);
                setMicrosite(data);
            } catch (e) {
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            } finally {
                setSaving(false);
            }
        }, 300);
    };

    const blocks: MicrositeBlock[] = useMemo(
        () => (microsite ? resolveBlocks(microsite) : []),
        [microsite],
    );

    const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

    const updateBlocks = (nextBlocks: MicrositeBlock[]) => {
        pushUpdate({ blocks: nextBlocks });
    };

    const updateBlock = (id: string, patch: Partial<MicrositeBlock>) => {
        updateBlocks(
            blocks.map((b) => (b.id === id ? { ...b, ...patch, props: { ...b.props, ...(patch.props || {}) } } : b)),
        );
    };

    const removeBlock = (id: string) => {
        updateBlocks(blocks.filter((b) => b.id !== id));
        if (selectedBlockId === id) setSelectedBlockId(null);
    };

    const addBlock = (type: BlockType) => {
        const next = [...blocks, createBlock(type)];
        updateBlocks(next);
        setSelectedBlockId(next[next.length - 1].id);
        setSidePanel("blocks");
    };

    const applyTemplate = (code: string) => {
        const companyName = organizer?.company_name || organizer?.slug || "";
        const payload = buildTemplateUpdate(code, microsite, companyName);
        pushUpdate(payload);
        setSelectedBlockId(null);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(SETUP_DONE_KEY, "1");
        }
        toast.success(`Plantilla «${getTemplatePreset(code).name}» aplicada. Logo y título se mantienen.`);
    };

    const setWorkspaceMode = (mode: WorkspaceMode) => {
        setWorkspace(mode);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(EDITOR_MODE_KEY, mode);
        }
        if (mode === "simple") setShowGrid(false);
    };

    const uploadAsset = async (file, asset_type) => {
        if (!file) return;
        setUploadingAsset(asset_type);
        try {
            const fd = new FormData();
            fd.append("asset_type", asset_type);
            fd.append("file", file);
            await api.post("/microsite/me/assets", fd);
            const fresh = await api.get("/microsite/me");
            const data = fresh.data;
            if (!data.blocks?.length) data.blocks = resolveBlocks(data);
            setMicrosite(data);
            toast.success(
                asset_type === "logo" ? "Logo subido" : asset_type === "banner" ? "Banner subido" : "Imagen subida",
            );
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setUploadingAsset(null);
        }
    };

    const uploadGalleryAsset = async (file: File): Promise<string | null> => {
        if (!file) return null;
        setUploadingAsset("gallery");
        try {
            const fd = new FormData();
            fd.append("asset_type", "gallery");
            fd.append("file", file);
            const { data } = await api.post("/microsite/me/assets", fd);
            toast.success("Imagen subida");
            return data.url as string;
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            return null;
        } finally {
            setUploadingAsset(null);
        }
    };

    const togglePublish = async () => {
        if (!microsite) return;
        if (!microsite.published && organizer?.status === "pending") {
            setPublishPendingOpen(true);
            return;
        }
        const endpoint = microsite.published ? "/microsite/me/unpublish" : "/microsite/me/publish";
        try {
            await api.post(endpoint);
            const fresh = await api.get("/microsite/me");
            const data = fresh.data;
            if (!data.blocks?.length) data.blocks = resolveBlocks(data);
            setMicrosite(data);
            toast.success(data.published ? "Página publicada" : "Página despublicada");
        } catch (e) {
            const code = e?.response?.data?.detail?.error;
            if (code === "organizer_pending_review") {
                setPublishPendingOpen(true);
                return;
            }
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        }
    };

    const publicUrl = useMemo(() => {
        if (!organizer?.slug) return "";
        return publicMicrositeUrl(organizer.slug);
    }, [organizer?.slug]);

    const handleSelectBlock = (id: string | null) => {
        setSelectedBlockId(id);
        setSelectedLayerId(null);
        if (id) setSidePanel("blocks");
    };

    const handleUpdateBlockProps = (blockId: string, props: Record<string, unknown>) => {
        updateBlock(blockId, { props });
    };

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
        <div className="flex flex-col gap-3 min-h-[calc(100vh-7rem)]" data-testid="microsite-editor">
            {/* Header compacto */}
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                    <h1 className="text-xl sm:text-2xl font-semibold">Tu página</h1>
                    <p className="text-sm text-muted-foreground">
                        {workspace === "simple"
                            ? "Elegí una plantilla y ajustá logo, textos y color."
                            : microsite.published
                              ? (
                            <>
                                Publicado en{" "}
                                <code className="bg-secondary px-1.5 py-0.5 rounded">
                                    {organizer.slug}.{PUBLIC_DOMAIN}
                                </code>
                              </>
                              )
                              : "Modo avanzado — secciones, tema y SEO."}
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
                        onClick={() => setWorkspaceMode(workspace === "simple" ? "advanced" : "simple")}
                        data-testid="toggle-workspace-mode"
                    >
                        {workspace === "simple" ? (
                            <>
                                <Wrench className="h-4 w-4 mr-2" />
                                Personalizar a fondo
                            </>
                        ) : (
                            <>
                                <LayoutTemplate className="h-4 w-4 mr-2" />
                                Vista simple
                            </>
                        )}
                    </Button>
                    <Button variant="outline" asChild data-testid="editor-open-public">
                        <a href={publicMicrositeUrl(organizer.slug)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Ver público
                        </a>
                    </Button>
                    <Button variant="outline" onClick={() => setShareOpen(true)} data-testid="editor-share-btn">
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

            {/* Builder: simple = ajustes | preview ; advanced = 3 columnas */}
            <div
                className={`grid flex-1 min-h-0 gap-3 lg:grid-rows-1 ${
                    workspace === "simple"
                        ? "lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"
                        : "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(260px,300px)]"
                }`}
            >
                {/* LEFT */}
                <Card className="flex flex-col min-h-0 lg:max-h-[calc(100vh-9.5rem)] lg:overflow-hidden">
                    <CardContent className="pt-4 space-y-4 flex-1 overflow-y-auto">
                        {workspace === "simple" ? (
                            <QuickSetupPanel
                                microsite={microsite}
                                onOpenGallery={() => setGalleryOpen(true)}
                                onUpdateContent={(patch) => pushUpdate({ content: patch })}
                                onUpdateBranding={(patch) => pushUpdate({ branding: patch })}
                                onUpdateSocial={(patch) => pushUpdate({ social_links: patch })}
                                uploadAsset={uploadAsset}
                                uploadingAsset={uploadingAsset}
                            />
                        ) : (
                            <>
                        <div className="flex gap-1 border rounded-lg p-1 bg-secondary/40 flex-wrap">
                            {(
                                [
                                    ["blocks", Settings2, "Secciones"],
                                    ["theme", Palette, "Tema"],
                                    ["seo", Search, "SEO"],
                                    ["history", History, "Historial"],
                                    ["publish", Globe, "Publicar"],
                                ] as const
                            ).map(([key, Icon, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setSidePanel(key)}
                                    className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md text-[10px] font-medium transition ${
                                        sidePanel === key ? "bg-background shadow text-foreground" : "text-muted-foreground"
                                    }`}
                                    data-testid={`side-panel-${key}`}
                                >
                                    <Icon className="h-3.5 w-3.5" />
                                    {label}
                                </button>
                            ))}
                        </div>

                        {sidePanel === "blocks" && (
                            <BlockListPanel
                                blocks={blocks}
                                selectedBlockId={selectedBlockId}
                                onSelectBlock={handleSelectBlock}
                                onReorder={updateBlocks}
                                onUpdateBlock={updateBlock}
                                onRemoveBlock={removeBlock}
                                onAddBlock={addBlock}
                            />
                        )}
                        {sidePanel === "theme" && (
                            <ThemePanel
                                microsite={microsite}
                                onApplyTemplate={applyTemplate}
                                onUpdateBranding={(patch) => pushUpdate({ branding: patch })}
                                uploadAsset={uploadAsset}
                                uploadingAsset={uploadingAsset}
                                onOpenGallery={() => setGalleryOpen(true)}
                            />
                        )}
                        {sidePanel === "seo" && (
                            <SeoPanel
                                microsite={microsite}
                                onUpdateSeo={(patch) => pushUpdate({ seo: patch })}
                                onUpdateBranding={(patch) => pushUpdate({ branding: patch })}
                                uploadGalleryAsset={uploadGalleryAsset}
                                uploadingGallery={uploadingAsset === "gallery"}
                                planCode={organizer?.plan_code}
                            />
                        )}
                        {sidePanel === "history" && (
                            <RevisionsPanel
                                onRestored={(data) => {
                                    const next = { ...data };
                                    if (!Array.isArray(next.blocks) || !next.blocks.length) {
                                        next.blocks = resolveBlocks(next);
                                    }
                                    setMicrosite(next);
                                    setSelectedBlockId(null);
                                }}
                            />
                        )}
                        {sidePanel === "publish" && (
                            <PublishPanel
                                microsite={microsite}
                                organizer={organizer}
                                onTogglePublish={togglePublish}
                            />
                        )}
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* CENTER — live preview */}
                <div className="flex flex-col gap-2 min-w-0 min-h-0">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <p className="text-sm font-medium text-muted-foreground">Vista previa</p>
                            <span
                                className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-secondary/60 text-muted-foreground tabular-nums"
                                data-testid="preview-width-indicator"
                            >
                                {previewWidth ? `${previewWidth}px` : "—"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {workspace === "advanced" && (
                            <Button
                                variant={showGrid ? "default" : "outline"}
                                size="sm"
                                onClick={() => setShowGrid((v) => !v)}
                                data-testid="toggle-grid-btn"
                                title="Cuadrícula 12 columnas"
                            >
                                <Grid3x3 className="h-3.5 w-3.5 mr-1.5" />
                                Cuadrícula
                            </Button>
                            )}
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
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setFullscreenOpen(true)}
                                data-testid="preview-fullscreen-btn"
                            >
                                <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
                                Vista grande
                            </Button>
                        </div>
                    </div>

                    {workspace === "advanced" && selectedBlock?.type === "hero" && microsite && (
                        <HeroLayerRibbon
                            block={selectedBlock}
                            microsite={microsite}
                            selectedLayerId={selectedLayerId}
                            onSelectLayer={setSelectedLayerId}
                            onUpdateLayers={(layers) =>
                                updateBlock(selectedBlock.id, {
                                    props: { ...selectedBlock.props, layers },
                                })
                            }
                            onUpdateContent={(patch) => pushUpdate({ content: patch })}
                            onUploadGallery={uploadGalleryAsset}
                            uploadingGallery={uploadingAsset === "gallery"}
                        />
                    )}

                    <div
                        ref={previewRef}
                        className={`rounded-xl border bg-background overflow-hidden shadow-sm transition-all flex-1 min-h-0 flex flex-col ${
                            previewMode === "mobile" ? "w-[380px] mx-auto" : "w-full"
                        }`}
                        data-testid="preview-frame"
                    >
                        <MicrositeHead
                            microsite={{ ...microsite, company_name: organizer?.company_name }}
                            publicUrl={publicUrl}
                        />
                        <div className="flex-1 min-h-0 overflow-y-auto lg:max-h-[calc(100vh-13rem)]">
                            <MicrositeRenderer
                                microsite={microsite}
                                tenantSlug={organizer?.slug || microsite?.slug}
                                editorMode
                                showGrid={workspace === "advanced" && showGrid}
                                selectedBlockId={selectedBlockId}
                                selectedLayerId={selectedLayerId}
                                onSelectBlock={handleSelectBlock}
                                onSelectLayer={setSelectedLayerId}
                                onUpdateContent={(patch) => pushUpdate({ content: patch })}
                                onUpdateBlockProps={handleUpdateBlockProps}
                                onUploadGallery={uploadGalleryAsset}
                                uploadingGallery={uploadingAsset === "gallery"}
                            />
                        </div>
                    </div>
                </div>

                {workspace === "advanced" && (
                <Card className="hidden lg:flex flex-col min-h-0 lg:max-h-[calc(100vh-9.5rem)] lg:overflow-hidden">
                    <CardContent className="pt-4 flex-1 overflow-y-auto">
                        {selectedBlock ? (
                            <BlockPropertiesPanel
                                block={selectedBlock}
                                microsite={microsite}
                                onUpdateProps={(props) =>
                                    updateBlock(selectedBlock.id, { props: { ...selectedBlock.props, ...props } })
                                }
                                onUpdateContent={(patch) => pushUpdate({ content: patch })}
                                onUpdateSocial={(patch) => pushUpdate({ social_links: patch })}
                                onUploadGallery={uploadGalleryAsset}
                                uploadingGallery={uploadingAsset === "gallery"}
                                selectedLayerId={selectedLayerId}
                                onSelectLayer={setSelectedLayerId}
                            />
                        ) : (
                            <div className="text-center py-8 text-muted-foreground space-y-2">
                                <Settings2 className="h-8 w-8 mx-auto opacity-40" />
                                <p className="text-sm">
                                    Seleccioná una sección en el preview o en la lista para editar sus propiedades.
                                </p>
                                <Button variant="outline" size="sm" onClick={() => setSidePanel("theme")}>
                                    <Palette className="h-3.5 w-3.5 mr-1.5" />
                                    Editar tema global
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
                )}
            </div>

            {/* Mobile/tablet: properties below when block selected */}
            {workspace === "advanced" && selectedBlock && (
                <Card className="lg:hidden shrink-0">
                    <CardContent className="pt-4">
                        <BlockPropertiesPanel
                            block={selectedBlock}
                            microsite={microsite}
                            onUpdateProps={(props) =>
                                updateBlock(selectedBlock.id, { props: { ...selectedBlock.props, ...props } })
                            }
                            onUpdateContent={(patch) => pushUpdate({ content: patch })}
                            onUpdateSocial={(patch) => pushUpdate({ social_links: patch })}
                            onUploadGallery={uploadGalleryAsset}
                            uploadingGallery={uploadingAsset === "gallery"}
                            selectedLayerId={selectedLayerId}
                            onSelectLayer={setSelectedLayerId}
                        />
                    </CardContent>
                </Card>
            )}

            <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
                <DialogContent
                    className="max-w-[min(1280px,96vw)] w-[min(1280px,96vw)] h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
                    data-testid="preview-fullscreen-dialog"
                >
                    <DialogHeader className="px-5 py-3 border-b shrink-0">
                        <DialogTitle className="text-base flex items-center gap-2">
                            <Maximize2 className="h-4 w-4 text-primary" />
                            Vista grande de tu página
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 bg-secondary/30 overflow-auto p-4">
                        <div
                            className="mx-auto bg-background rounded-xl border shadow-sm overflow-hidden"
                            style={{ maxWidth: "1200px" }}
                        >
                            <MicrositeRenderer
                                microsite={microsite}
                                tenantSlug={organizer?.slug || microsite?.slug}
                            />
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <TemplateGallery
                open={galleryOpen}
                onOpenChange={(open) => {
                    setGalleryOpen(open);
                    if (!open && typeof window !== "undefined") {
                        window.localStorage.setItem(SETUP_DONE_KEY, "1");
                    }
                }}
                activeCode={microsite.template}
                onApply={applyTemplate}
            />
            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={publicUrl}
                companyName={organizer?.company_name || organizer?.slug}
                heroSubtitle={microsite?.content?.hero_subtitle || ""}
            />
            <PublishPendingDialog
                open={publishPendingOpen}
                onOpenChange={setPublishPendingOpen}
                resource="microsite"
            />
        </div>
    );
}

function deepMerge(target, patch) {
    if (!patch || typeof patch !== "object") return patch;
    const out = { ...(target || {}) };
    for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (Array.isArray(v)) {
            out[k] = v;
        } else if (v && typeof v === "object") {
            out[k] = deepMerge(target?.[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}
