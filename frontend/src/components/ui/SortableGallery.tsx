import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import ImageDropzone from "@/components/ui/ImageDropzone";

function SortableGalleryItem({ id, url, index, assetUrl, onDelete }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="relative rounded-lg overflow-hidden border group bg-secondary"
            data-testid={`gallery-item-${index}`}
        >
            <img
                src={assetUrl(url)}
                alt={`gallery-${index + 1}`}
                className="w-full aspect-square object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-start justify-between p-1.5">
                <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 bg-white/90 rounded p-1 cursor-grab active:cursor-grabbing"
                    {...attributes}
                    {...listeners}
                    data-testid={`gallery-drag-${index}`}
                    title="Arrastrar para reordenar"
                >
                    <GripVertical className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 bg-red-600 text-white rounded p-1"
                    onClick={() => onDelete(index)}
                    data-testid={`gallery-delete-${index}`}
                    title="Eliminar"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

/**
 * Drag-and-drop sortable gallery grid (@dnd-kit).
 */
export default function SortableGallery({
    gallery,
    assetUrl,
    uploadingKind,
    onUpload,
    onDelete,
    onReorder,
    maxItems = 10,
}) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const ids = gallery.map((url, i) => `${url}::${i}`);

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) return;
        const order = gallery.map((_, i) => i);
        const next = arrayMove(order, oldIndex, newIndex);
        onReorder(next);
    };

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={rectSortingStrategy}>
                <div
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
                    data-testid="wiz-gallery"
                >
                    {gallery.map((url, i) => (
                        <SortableGalleryItem
                            key={ids[i]}
                            id={ids[i]}
                            url={url}
                            index={i}
                            assetUrl={assetUrl}
                            onDelete={onDelete}
                        />
                    ))}
                    {gallery.length < maxItems && (
                        <ImageDropzone
                            label=""
                            currentUrl={null}
                            onUpload={(f) => onUpload(f, "gallery")}
                            uploading={uploadingKind === "gallery"}
                            testid="wiz-gallery-add"
                            aspect="square"
                            compact
                            multiple
                        />
                    )}
                </div>
            </SortableContext>
        </DndContext>
    );
}
