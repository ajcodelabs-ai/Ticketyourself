/**
 * Top toolbar for the venue editor.
 * Tools grouped: select | stage/zone | rows/seat | tables | undo/redo.
 */
import {
    MousePointer, Hand, Theater, Square, Armchair, UtensilsCrossed,
    Spline, CircleDot, Undo2, Redo2, Save, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const TOOL_GROUPS = [
    {
        id: "select",
        tools: [
            { id: "select", label: "Seleccionar (V)", short: "Sel", icon: MousePointer },
            {
                id: "pan",
                label: "Mover mapa — arrastra para desplazarte sin modificar elementos",
                short: "Mover",
                icon: Hand,
            },
        ],
    },
    {
        id: "space",
        tools: [
            { id: "stage", label: "Escenario", short: "Escenario", icon: Theater },
            {
                id: "zone",
                label: "Zona no numerada — aforo de pie/general, sin asientos individuales",
                short: "Zona",
                icon: Square,
            },
        ],
    },
    {
        id: "seats",
        tools: [
            // Named "Asientos" (not "Fila") to match the reference app's
            // toolbar exactly — this is the button that creates rows of
            // seats there too, just under that name.
            { id: "row_straight", label: "Asientos — fila recta", short: "Asientos", icon: Armchair },
            { id: "row_curved", label: "Fila curva", short: "Curva", icon: Spline },
            { id: "seat", label: "Asiento suelto (individual, fuera de una fila)", short: "Suelto", icon: CircleDot },
        ],
    },
    {
        id: "tables",
        tools: [
            { id: "table_round", label: "Mesa redonda", short: "Mesa ⚬", icon: UtensilsCrossed },
            { id: "table_rect", label: "Mesa rectangular", short: "Mesa ▭", icon: UtensilsCrossed },
        ],
    },
];

const PILL_BASE =
    "h-9 text-white hover:text-white border border-white/20 bg-white/10 hover:bg-white/20 hover:border-white/35 " +
    "hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0";
const PILL_ACTIVE = "bg-white/25 border-white/40 hover:bg-white/30";

function ToolBtn({ id, label, short, icon: Icon, isActive, onTool }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onTool(id)}
                    data-testid={`tool-${id}`}
                    className={`${PILL_BASE} ${isActive ? PILL_ACTIVE : ""}`}
                >
                    <Icon className="h-4 w-4" />
                    <span className="ml-1.5 hidden sm:inline text-xs">{short}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export default function EditorToolbar({
    tool, onTool, onUndo, onRedo, canUndo, canRedo, hideCreateTools = false,
    onSave, saving = false, dirty = false,
}) {
    const groups = hideCreateTools
        ? TOOL_GROUPS.filter((g) => g.id === "select")
        : TOOL_GROUPS;
    return (
        <TooltipProvider delayDuration={150}>
            <div
                className="venue-brand-gradient rounded-xl shadow-sm p-1.5 flex items-center gap-1 flex-wrap"
                data-testid="venue-toolbar"
            >
                {groups.map((group, gi) => (
                    <div key={group.id} className="flex items-center gap-0.5">
                        {gi > 0 && <span className="w-px h-7 bg-white/20 mx-1" aria-hidden />}
                        {group.tools.map((t) => (
                            <ToolBtn
                                key={t.id}
                                {...t}
                                isActive={tool === t.id}
                                onTool={onTool}
                            />
                        ))}
                    </div>
                ))}
                <span className="w-px h-7 bg-white/20 mx-1" aria-hidden />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button type="button" size="sm" variant="ghost"
                                    onClick={onUndo} disabled={!canUndo}
                                    className={PILL_BASE} data-testid="tool-undo">
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
                                    className={PILL_BASE} data-testid="tool-redo">
                                <Redo2 className="h-4 w-4" />
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>Rehacer (Ctrl+Shift+Z)</TooltipContent>
                </Tooltip>
                {onSave && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span tabIndex={0} className="ml-auto">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={onSave}
                                    disabled={saving || !dirty}
                                    className={`${PILL_BASE} ${saving ? "opacity-70 cursor-wait" : ""} ${
                                        dirty && !saving
                                            ? "bg-emerald-400/30 border-emerald-300/50 hover:bg-emerald-400/40"
                                            : ""
                                    }`}
                                    data-testid="tool-save"
                                >
                                    {saving
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Save className="h-4 w-4" />}
                                    <span className="ml-1.5 hidden sm:inline text-xs">
                                        {saving ? "Guardando..." : "Guardar"}
                                    </span>
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>Guardar diseño</TooltipContent>
                    </Tooltip>
                )}
            </div>
        </TooltipProvider>
    );
}
