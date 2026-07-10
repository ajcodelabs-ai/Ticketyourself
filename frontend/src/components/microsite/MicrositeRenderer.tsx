/**
 * MicrositeRenderer: shared between editor preview and public microsite view.
 */
import { fontStackFor } from "@/lib/microsite";
import { resolveBlocks } from "@/lib/micrositeBlocks";
import { renderBlock, type BlockEditorCtx } from "@/components/microsite/MicrositeBlocks";

export default function MicrositeRenderer({
    microsite,
    tenantSlug = undefined,
    editorMode = false,
    selectedBlockId = undefined,
    selectedLayerId = undefined,
    showGrid = false,
    onSelectBlock = undefined,
    onSelectLayer = undefined,
    onUpdateContent = undefined,
    onUpdateBlockProps = undefined,
    onUploadGallery = undefined,
    uploadingGallery = false,
}) {
    if (!microsite) return null;
    const slug = tenantSlug || microsite.tenant_slug || microsite.slug;
    const blocks = resolveBlocks(microsite);
    const branding = microsite.branding || {};
    const customCss = branding.custom_css ? String(branding.custom_css).trim() : "";

    const ctx: BlockEditorCtx = {
        microsite,
        tenantSlug: slug,
        selectedBlockId,
        selectedLayerId,
        editorMode,
        showGrid,
        onSelectBlock,
        onSelectLayer,
        onUpdateContent,
        onUpdateBlockProps,
        onUploadGallery,
        uploadingGallery,
    };

    return (
        <>
            {customCss ? (
                <style data-testid="microsite-custom-css">{customCss}</style>
            ) : null}
            <div
                data-testid="microsite-root"
                className="microsite-root"
                style={{
                    fontFamily: fontStackFor(branding.font_family),
                    ...({
                        "--ms-primary": branding.primary_color,
                        "--ms-secondary": branding.secondary_color,
                    } as Record<string, string>),
                }}
                onClick={editorMode ? () => onSelectBlock?.(null) : undefined}
            >
                {blocks.map((block) => renderBlock(block, ctx))}
            </div>
        </>
    );
}
