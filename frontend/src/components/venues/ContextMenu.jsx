/**
 * Floating right-click context menu for canvas elements.
 *
 * Pure controlled component: parent stores `{x, y, elementId}` and toggles
 * visibility. Renders a small absolutely-positioned card with actions.
 */
import { useEffect, useRef } from "react";
import {
    Copy, Trash2, ArrowUpToLine, ArrowDownToLine, Palette, Pencil,
} from "lucide-react";

export default function ContextMenu({
    open, x, y, onClose, onAction, hasLocality = true,
}) {
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("contextmenu", handler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("contextmenu", handler);
        };
    }, [open, onClose]);

    if (!open) return null;

    const items = [
        { id: "edit", label: "Editar propiedades", icon: Pencil },
        { id: "duplicate", label: "Duplicar (Ctrl+D)", icon: Copy },
        hasLocality && { id: "locality", label: "Asignar localidad…", icon: Palette },
        { id: "bring-front", label: "Traer al frente", icon: ArrowUpToLine },
        { id: "send-back", label: "Enviar al fondo", icon: ArrowDownToLine },
        { id: "delete", label: "Eliminar (Del)", icon: Trash2, danger: true },
    ].filter(Boolean);

    return (
        <div
            ref={ref}
            className="fixed z-50 bg-white border rounded-md shadow-lg py-1 min-w-[200px]"
            style={{ left: x, top: y }}
            data-testid="canvas-context-menu"
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map(({ id, label, icon: Icon, danger }) => (
                <button
                    key={id}
                    onClick={() => { onAction(id); onClose(); }}
                    data-testid={`context-${id}`}
                    className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-slate-100 ${
                        danger ? "text-red-600 hover:bg-red-50" : ""
                    }`}
                >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                </button>
            ))}
        </div>
    );
}
