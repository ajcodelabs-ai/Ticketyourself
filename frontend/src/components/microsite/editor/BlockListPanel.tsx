/**
 * Sortable block list for the microsite page builder (left panel).
 */
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
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    BLOCK_CATALOG,
    SINGLETON_BLOCK_TYPES,
    blockLabel,
    createBlock,
    type BlockType,
    type MicrositeBlock,
} from "@/lib/micrositeBlocks";

function SortableBlockRow({
    block,
    selected,
    onSelect,
    onToggle,
    onRemove,
}: {
    block: MicrositeBlock;
    selected: boolean;
    onSelect: () => void;
    onToggle: () => void;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: block.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const meta = BLOCK_CATALOG.find((b) => b.type === block.type);

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 rounded-lg border p-2 transition ${
                selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border"
            } ${!block.enabled ? "opacity-50" : ""}`}
            data-testid={`block-list-item-${block.id}`}
        >
            <button
                type="button"
                className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
                {...attributes}
                {...listeners}
                aria-label="Arrastrar"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={onSelect}
                className="flex-1 text-left min-w-0"
            >
                <div className="text-sm font-medium truncate">
                    {meta?.icon} {blockLabel(block.type)}
                </div>
            </button>
            <button
                type="button"
                onClick={onToggle}
                className="p-1 text-muted-foreground hover:text-foreground"
                title={block.enabled ? "Ocultar" : "Mostrar"}
                data-testid={`block-toggle-${block.id}`}
            >
                {block.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            <button
                type="button"
                onClick={onRemove}
                className="p-1 text-muted-foreground hover:text-destructive"
                title="Eliminar bloque"
                data-testid={`block-remove-${block.id}`}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

export default function BlockListPanel({
    blocks,
    selectedBlockId,
    onSelectBlock,
    onReorder,
    onUpdateBlock,
    onRemoveBlock,
    onAddBlock,
}: {
    blocks: MicrositeBlock[];
    selectedBlockId: string | null;
    onSelectBlock: (id: string | null) => void;
    onReorder: (blocks: MicrositeBlock[]) => void;
    onUpdateBlock: (id: string, patch: Partial<MicrositeBlock>) => void;
    onRemoveBlock: (id: string) => void;
    onAddBlock: (type: BlockType) => void;
}) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = blocks.findIndex((b) => b.id === active.id);
        const newIndex = blocks.findIndex((b) => b.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorder(arrayMove(blocks, oldIndex, newIndex));
    };

    const existingTypes = new Set(blocks.map((b) => b.type));
    const addable = BLOCK_CATALOG.filter(
        (b) => !SINGLETON_BLOCK_TYPES.includes(b.type) || !existingTypes.has(b.type),
    );

    return (
        <div className="space-y-3" data-testid="block-list-panel">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Secciones</h3>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" data-testid="add-block-btn">
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Añadir
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {addable.map((b) => (
                            <DropdownMenuItem
                                key={b.type}
                                onClick={() => onAddBlock(b.type)}
                                data-testid={`add-block-${b.type}`}
                            >
                                <span className="mr-2">{b.icon}</span>
                                <div>
                                    <div className="font-medium">{b.label}</div>
                                    <div className="text-xs text-muted-foreground">{b.description}</div>
                                </div>
                            </DropdownMenuItem>
                        ))}
                        {addable.length === 0 && (
                            <DropdownMenuItem disabled>Todos los bloques añadidos</DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {blocks.map((block) => (
                            <SortableBlockRow
                                key={block.id}
                                block={block}
                                selected={selectedBlockId === block.id}
                                onSelect={() => onSelectBlock(block.id)}
                                onToggle={() =>
                                    onUpdateBlock(block.id, { enabled: !block.enabled })
                                }
                                onRemove={() => onRemoveBlock(block.id)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            {blocks.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                    Añadí bloques para construir tu página.
                </p>
            )}
        </div>
    );
}

// Re-export for convenience in editor when adding blocks
export { createBlock };
