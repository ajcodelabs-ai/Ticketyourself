/**
 * Specialized property editors for image, gallery, FAQ and testimonials blocks.
 */
import { Plus, Trash2, Upload, Loader2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { assetUrl } from "@/lib/microsite";
import {
    defaultFaqItem,
    defaultTestimonial,
    newBlockId,
    type FaqItem,
    type GalleryImage,
    type MicrositeBlock,
    type TestimonialItem,
} from "@/lib/micrositeBlocks";

export function ImageBlockEditor({
    block,
    onUpdateProps,
    onUploadGallery,
    uploading,
}: {
    block: MicrositeBlock;
    onUpdateProps: (props: Record<string, unknown>) => void;
    onUploadGallery: (file: File) => Promise<string | null>;
    uploading: boolean;
}) {
    const imageUrl = block.props.image_url as string | null;
    const caption = (block.props.caption as string) || "";
    const layout = (block.props.layout as string) || "contained";

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Layout</Label>
                <Select value={layout} onValueChange={(v) => onUpdateProps({ layout: v })}>
                    <SelectTrigger data-testid="prop-image-layout">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="contained">Contenido (con márgenes)</SelectItem>
                        <SelectItem value="full">Ancho completo</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label>Imagen</Label>
                {imageUrl ? (
                    <img
                        src={assetUrl(imageUrl) || ""}
                        alt="Preview"
                        className="w-full max-h-40 object-cover rounded-lg border"
                    />
                ) : (
                    <div className="h-32 rounded-lg border border-dashed grid place-items-center text-sm text-muted-foreground">
                        Sin imagen
                    </div>
                )}
                <label className="cursor-pointer inline-block">
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        data-testid="prop-image-upload"
                        onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await onUploadGallery(f);
                            if (url) onUpdateProps({ image_url: url });
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
                            Subir imagen
                        </span>
                    </Button>
                </label>
                {imageUrl && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => onUpdateProps({ image_url: null })}
                    >
                        Quitar imagen
                    </Button>
                )}
            </div>
            <div className="space-y-2">
                <Label>Pie de foto</Label>
                <Input
                    value={caption}
                    onChange={(e) => onUpdateProps({ caption: e.target.value })}
                    maxLength={200}
                    placeholder="Descripción opcional"
                    data-testid="prop-image-caption"
                />
            </div>
        </div>
    );
}

export function GalleryBlockEditor({
    block,
    onUpdateProps,
    onUploadGallery,
    uploading,
}: {
    block: MicrositeBlock;
    onUpdateProps: (props: Record<string, unknown>) => void;
    onUploadGallery: (file: File) => Promise<string | null>;
    uploading: boolean;
}) {
    const images = (block.props.images as GalleryImage[]) || [];
    const columns = (block.props.columns as number) || 3;

    const addImage = async (file: File) => {
        const url = await onUploadGallery(file);
        if (!url) return;
        const next: GalleryImage[] = [
            ...images,
            { id: newBlockId(), url, asset_id: undefined },
        ].slice(0, 12);
        onUpdateProps({ images: next });
    };

    const removeImage = (id: string) => {
        onUpdateProps({ images: images.filter((img) => img.id !== id) });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Columnas</Label>
                <Select
                    value={String(columns)}
                    onValueChange={(v) => onUpdateProps({ columns: Number(v) })}
                >
                    <SelectTrigger data-testid="prop-gallery-columns">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="2">2 columnas</SelectItem>
                        <SelectItem value="3">3 columnas</SelectItem>
                        <SelectItem value="4">4 columnas</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>Imágenes ({images.length}/12)</Label>
                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            data-testid="prop-gallery-upload"
                            disabled={images.length >= 12 || uploading}
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (f) await addImage(f);
                                e.target.value = "";
                            }}
                        />
                        <Button asChild variant="outline" size="sm" disabled={uploading || images.length >= 12}>
                            <span>
                                {uploading ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5 mr-1" />
                                )}
                                Añadir
                            </span>
                        </Button>
                    </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {images.map((img) => (
                        <div key={img.id} className="relative group rounded-md overflow-hidden border">
                            <img
                                src={assetUrl(img.url) || ""}
                                alt=""
                                className="w-full aspect-square object-cover"
                            />
                            <button
                                type="button"
                                className="absolute top-1 right-1 p-1 rounded bg-red-600 text-white opacity-0 group-hover:opacity-100 transition"
                                onClick={() => removeImage(img.id)}
                                data-testid={`gallery-remove-${img.id}`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function FaqBlockEditor({
    block,
    onUpdateProps,
}: {
    block: MicrositeBlock;
    onUpdateProps: (props: Record<string, unknown>) => void;
}) {
    const title = (block.props.title as string) || "Preguntas frecuentes";
    const items = (block.props.items as FaqItem[]) || [];

    const updateItem = (id: string, patch: Partial<FaqItem>) => {
        onUpdateProps({
            items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Título de la sección</Label>
                <Input
                    value={title}
                    onChange={(e) => onUpdateProps({ title: e.target.value })}
                    maxLength={80}
                    data-testid="prop-faq-title"
                />
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>Preguntas</Label>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            onUpdateProps({ items: [...items, defaultFaqItem()] })
                        }
                        data-testid="prop-faq-add"
                    >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Añadir
                    </Button>
                </div>
                {items.map((item, idx) => (
                    <div key={item.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <GripVertical className="h-3 w-3" /> #{idx + 1}
                            </span>
                            <button
                                type="button"
                                className="text-destructive p-1"
                                onClick={() =>
                                    onUpdateProps({ items: items.filter((it) => it.id !== item.id) })
                                }
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <Input
                            value={item.question}
                            onChange={(e) => updateItem(item.id, { question: e.target.value })}
                            placeholder="Pregunta"
                            maxLength={200}
                        />
                        <RichTextEditor
                            value={item.answer_html}
                            onChange={(html) => updateItem(item.id, { answer_html: html })}
                            placeholder="Respuesta…"
                            testid={`prop-faq-answer-${idx}`}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function TestimonialsBlockEditor({
    block,
    onUpdateProps,
    onUploadGallery,
    uploading,
}: {
    block: MicrositeBlock;
    onUpdateProps: (props: Record<string, unknown>) => void;
    onUploadGallery: (file: File) => Promise<string | null>;
    uploading: boolean;
}) {
    const title = (block.props.title as string) || "Testimonios";
    const items = (block.props.items as TestimonialItem[]) || [];

    const updateItem = (id: string, patch: Partial<TestimonialItem>) => {
        onUpdateProps({
            items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Título de la sección</Label>
                <Input
                    value={title}
                    onChange={(e) => onUpdateProps({ title: e.target.value })}
                    maxLength={80}
                    data-testid="prop-testimonials-title"
                />
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>Testimonios</Label>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            onUpdateProps({ items: [...items, defaultTestimonial()] })
                        }
                        data-testid="prop-testimonials-add"
                    >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Añadir
                    </Button>
                </div>
                {items.map((item, idx) => (
                    <div key={item.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                            <button
                                type="button"
                                className="text-destructive p-1"
                                onClick={() =>
                                    onUpdateProps({ items: items.filter((it) => it.id !== item.id) })
                                }
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="flex gap-2 items-center">
                            {item.avatar_url ? (
                                <img
                                    src={assetUrl(item.avatar_url) || ""}
                                    alt=""
                                    className="h-10 w-10 rounded-full object-cover"
                                />
                            ) : (
                                <div className="h-10 w-10 rounded-full bg-secondary border" />
                            )}
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const f = e.target.files?.[0];
                                        if (!f) return;
                                        const url = await onUploadGallery(f);
                                        if (url) updateItem(item.id, { avatar_url: url });
                                        e.target.value = "";
                                    }}
                                />
                                <Button asChild variant="ghost" size="sm" disabled={uploading}>
                                    <span className="text-xs">Foto</span>
                                </Button>
                            </label>
                        </div>
                        <Input
                            value={item.name}
                            onChange={(e) => updateItem(item.id, { name: e.target.value })}
                            placeholder="Nombre"
                            maxLength={60}
                        />
                        <Input
                            value={item.role}
                            onChange={(e) => updateItem(item.id, { role: e.target.value })}
                            placeholder="Rol / evento"
                            maxLength={80}
                        />
                        <Input
                            value={item.quote}
                            onChange={(e) => updateItem(item.id, { quote: e.target.value })}
                            placeholder="Testimonio"
                            maxLength={300}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
