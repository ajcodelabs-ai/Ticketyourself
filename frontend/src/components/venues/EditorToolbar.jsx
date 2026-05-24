/**
 * Top toolbar for the venue editor.
 * Tools (active in 6a): select, stage, zone, row_straight.
 * Disabled (placeholder for 6b): row_curve, table, individual seat.
 */
import { MousePointer, Theater, Square, Armchair, UtensilsCrossed, Spline, CircleDot, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const ACTIVE_TOOLS = [
    { id: "select", label: "Seleccionar", icon: MousePointer },
    { id: "stage", label: "Escenario", icon: Theater },
    { id: "zone", label: "Zona no numerada", icon: Square },
    { id: "row_straight", label: "Fila recta de asientos", icon: Armchair },
];

const DISABLED_TOOLS = [
    { id: "row_curve", label: "Fila curva (Fase 6b)", icon: Spline },
    { id: "table", label: "Mesas (Fase 6b)", icon: UtensilsCrossed },
    { id: "seat", label: "Asientos individuales (Fase 6b)", icon: CircleDot },
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
                {ACTIVE_TOOLS.map(({ id, label, icon: Icon }) => {
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
                                    <span className="ml-1.5 hidden md:inline text-xs">
                                        {label.replace(" no numerada", "").replace(" recta de asientos", "")}
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    );
                })}
                <span className="w-px h-7 bg-slate-200 mx-0.5" />
                {DISABLED_TOOLS.map(({ id, label, icon: Icon }) => (
                    <Tooltip key={id}>
                        <TooltipTrigger asChild>
                            <span tabIndex={0}>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled
                                    className="h-9 opacity-40"
                                    data-testid={`tool-${id}-disabled`}
                                >
                                    <Icon className="h-4 w-4" />
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                ))}
                <span className="w-px h-7 bg-slate-200 mx-0.5" />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={onUndo}
                                disabled={!canUndo}
                                className="h-9"
                                data-testid="tool-undo"
                            >
                                <Undo2 className="h-4 w-4" />
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>Deshacer (Ctrl+Z)</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={onRedo}
                                disabled={!canRedo}
                                className="h-9"
                                data-testid="tool-redo"
                            >
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
