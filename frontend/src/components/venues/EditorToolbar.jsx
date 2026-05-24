/**
 * Top toolbar for the venue editor.
 * Phase 6b: all element tools enabled (curved row, seat, tables).
 */
import {
    MousePointer, Theater, Square, Armchair, UtensilsCrossed,
    Spline, CircleDot, Undo2, Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const TOOLS = [
    { id: "select", label: "Seleccionar (V)", short: "Sel", icon: MousePointer },
    { id: "stage", label: "Escenario", short: "Escenario", icon: Theater },
    { id: "zone", label: "Zona no numerada", short: "Zona", icon: Square },
    { id: "row_straight", label: "Fila recta de asientos", short: "Fila", icon: Armchair },
    { id: "row_curved", label: "Fila curva", short: "Curva", icon: Spline },
    { id: "seat", label: "Asiento individual", short: "Asiento", icon: CircleDot },
    { id: "table_round", label: "Mesa redonda", short: "Mesa ⚬", icon: UtensilsCrossed },
    { id: "table_rect", label: "Mesa rectangular", short: "Mesa ▭", icon: UtensilsCrossed },
];

export default function EditorToolbar({
    tool, onTool, onUndo, onRedo, canUndo, canRedo,
}) {
    return (
        <TooltipProvider delayDuration={150}>
            <div
                className="bg-white border rounded-lg shadow-sm p-1.5 flex items-center gap-1 flex-wrap"
                data-testid="venue-toolbar"
            >
                {TOOLS.map(({ id, label, short, icon: Icon }) => {
                    const isActive = tool === id;
                    return (
                        <Tooltip key={id}>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={isActive ? "default" : "ghost"}
                                    onClick={() => onTool(id)}
                                    data-testid={`tool-${id}`}
                                    className="h-9"
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="ml-1.5 hidden md:inline text-xs">{short}</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    );
                })}
                <span className="w-px h-7 bg-slate-200 mx-0.5" />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button type="button" size="sm" variant="ghost"
                                    onClick={onUndo} disabled={!canUndo}
                                    className="h-9" data-testid="tool-undo">
                                <Undo2 className="h-4 w-4" />
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>Deshacer (Ctrl+Z)</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button type="button" size="sm" variant="ghost"
                                    onClick={onRedo} disabled={!canRedo}
                                    className="h-9" data-testid="tool-redo">
                                <Redo2 className="h-4 w-4" />
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>Rehacer (Ctrl+Shift+Z)</TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
}
