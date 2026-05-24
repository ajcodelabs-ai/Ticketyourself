/**
 * /app/venues/:id/editor — main editor page.
 * Wires together canvas, toolbar, properties + localities sidebars,
 * tool placement modals, undo/redo, autosave, publish.
 */
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Save, Eye, Send, AlertCircle, Lock, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import EditorToolbar from "@/components/venues/EditorToolbar";
import EditorCanvas from "@/components/venues/EditorCanvas";
import PropertiesPanel from "@/components/venues/PropertiesPanel";
import LocalitiesPanel from "@/components/venues/LocalitiesPanel";
import ZoneConfigDialog from "@/components/venues/ZoneConfigDialog";
import RowConfigDialog from "@/components/venues/RowConfigDialog";
import {
    venuesApi, makeStage, makeZone, makeRow, computeCapacity,
    elementAcceptsLocality, STATUS_LABEL,
} from "@/lib/venues";

const AUTO_SAVE_MS = 30_000;

function nextRowLabel(elements) {
    const used = new Set(
        elements
            .filter((e) => e.kind === "seat_row_straight" && e.row_label)
            .map((e) => e.row_label.toUpperCase()),
    );
    for (let c = 65; c <= 90; c += 1) {
        const lbl = String.fromCharCode(c);
        if (!used.has(lbl)) return lbl;
    }
    return "A";
}

export default function VenueEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [venue, setVenue] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tool, setTool] = useState("select");
    const [selection, setSelection] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState([]);
    const [future, setFuture] = useState([]);
    const [pendingZone, setPendingZone] = useState(null);
    const [pendingRow, setPendingRow] = useState(null);

    const dirtyRef = useRef(false);
    const saveLockRef = useRef(false);

    // ── Load
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const v = await venuesApi.get(id);
                if (!mounted) return;
                setVenue(v);
            } catch (e) {
                toast.error("No pudimos cargar el venue.");
                navigate("/app/venues");
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [id, navigate]);

    // Prompt before unload
    useEffect(() => {
        const handler = (e) => {
            if (!dirtyRef.current) return;
            e.preventDefault();
            e.returnValue = "Tenés cambios sin guardar.";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    // ── Helpers
    const elements = venue?.elements || [];
    const localities = useMemo(() => venue?.localities || [], [venue]);
    const localitiesById = useMemo(
        () => Object.fromEntries(localities.map((l) => [l.id, l])),
        [localities],
    );
    const locked = venue?.lock_status?.locked || false;
    const activeEvents = venue?.lock_status?.active_events || [];

    const markDirty = () => {
        dirtyRef.current = true;
        setDirty(true);
    };

    const pushHistory = (snapshot) => {
        setHistory((h) => [...h, snapshot].slice(-30));
        setFuture([]);
    };

    const mutateVenue = (mutator) => {
        setVenue((prev) => {
            if (!prev) return prev;
            const snap = JSON.stringify({ elements: prev.elements, localities: prev.localities });
            pushHistory(snap);
            const next = mutator(prev);
            return { ...next, capacity_calculated: computeCapacity(next.elements) };
        });
        markDirty();
    };

    // ── Tool-driven placement
    const handleCanvasClick = (tk, { x, y }) => {
        if (tk === "stage") {
            mutateVenue((v) => ({ ...v, elements: [...v.elements, makeStage(x, y)] }));
            setTool("select");
        } else if (tk === "zone") {
            setPendingZone({ x, y });
        } else if (tk === "row_straight") {
            setPendingRow({ x, y });
        }
    };

    const confirmZone = ({ label, capacity, locality_id }) => {
        const { x, y } = pendingZone;
        mutateVenue((v) => ({
            ...v,
            elements: [...v.elements, makeZone({
                x, y, width: 200, height: 100, label, capacity, locality_id,
            })],
        }));
        setPendingZone(null);
        setTool("select");
    };

    const confirmRow = (cfg) => {
        const { x, y } = pendingRow;
        mutateVenue((v) => ({
            ...v,
            elements: [...v.elements, makeRow({ x, y, ...cfg })],
        }));
        setPendingRow(null);
        setTool("select");
    };

    // ── Selection
    const handleSelect = (ids, { additive } = {}) => {
        setSelection((prev) => {
            if (!additive) return ids;
            const set = new Set(prev);
            ids.forEach((id_) => {
                if (set.has(id_)) set.delete(id_); else set.add(id_);
            });
            return Array.from(set);
        });
    };

    // ── Element updates (drag, properties, locality assignment)
    const updateElement = (elemId, patch) => {
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => (e.id === elemId ? { ...e, ...patch } : e)),
        }));
    };

    const deleteElement = (elemId) => {
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.filter((e) => e.id !== elemId),
        }));
        setSelection((s) => s.filter((x) => x !== elemId));
    };

    // ── Localities
    const addLocality = (loc) => {
        mutateVenue((v) => ({ ...v, localities: [...(v.localities || []), loc] }));
    };
    const updateLocality = (locId, patch) => {
        mutateVenue((v) => ({
            ...v,
            localities: (v.localities || []).map((l) =>
                l.id === locId ? { ...l, ...patch } : l,
            ),
        }));
    };
    const deleteLocality = (locId) => {
        const inUse = elements.some((e) => e.locality_id === locId);
        if (inUse) {
            toast.error("Esta localidad tiene elementos asignados. Reasignalos antes.");
            return;
        }
        mutateVenue((v) => ({
            ...v,
            localities: (v.localities || []).filter((l) => l.id !== locId),
        }));
    };
    const assignLocalityToSelection = (locId) => {
        const affected = elements.filter(
            (e) => selection.includes(e.id) && elementAcceptsLocality(e.kind),
        );
        if (affected.length === 0) {
            toast.error("Seleccioná zonas o filas para asignar.");
            return;
        }
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) =>
                selection.includes(e.id) && elementAcceptsLocality(e.kind)
                    ? { ...e, locality_id: locId }
                    : e,
            ),
        }));
        toast.success(`Localidad asignada a ${affected.length} elemento(s).`);
    };

    // ── Save / Publish
    const persist = useCallback(async ({ silent = false } = {}) => {
        if (!venue || saveLockRef.current) return;
        saveLockRef.current = true;
        setSaving(true);
        try {
            const body = {
                name: venue.name,
                type: venue.type,
                description: venue.description,
                canvas: venue.canvas,
                elements: venue.elements,
                localities: venue.localities || [],
            };
            const updated = await venuesApi.update(venue.id, body);
            setVenue(updated);
            dirtyRef.current = false;
            setDirty(false);
            if (!silent) toast.success("Venue guardado");
        } catch (e) {
            const detail = e?.response?.data?.detail;
            if (e?.response?.status === 409) {
                toast.error(
                    typeof detail === "object"
                        ? "Venue bloqueado: hay eventos con ventas activas."
                        : detail || "Conflicto guardando.",
                );
            } else if (typeof detail === "string") {
                toast.error(detail);
            } else {
                toast.error("No se pudo guardar.");
            }
        } finally {
            saveLockRef.current = false;
            setSaving(false);
        }
    }, [venue]);

    // Auto-save loop
    useEffect(() => {
        const t = setInterval(() => {
            if (dirtyRef.current && !saveLockRef.current) {
                persist({ silent: true });
            }
        }, AUTO_SAVE_MS);
        return () => clearInterval(t);
    }, [persist]);

    const publish = async () => {
        if (dirty) {
            await persist({ silent: true });
        }
        try {
            await venuesApi.publish(venue.id);
            toast.success("Venue publicado");
            const v = await venuesApi.get(venue.id);
            setVenue(v);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo publicar.");
        }
    };

    // ── Undo / Redo
    const undo = () => {
        if (history.length === 0 || !venue) return;
        const last = history[history.length - 1];
        setHistory((h) => h.slice(0, -1));
        setFuture((f) => [...f, JSON.stringify({ elements: venue.elements, localities: venue.localities })]);
        const snap = JSON.parse(last);
        setVenue((v) => ({
            ...v,
            elements: snap.elements,
            localities: snap.localities,
            capacity_calculated: computeCapacity(snap.elements),
        }));
        markDirty();
    };
    const redo = () => {
        if (future.length === 0 || !venue) return;
        const next = future[future.length - 1];
        setFuture((f) => f.slice(0, -1));
        setHistory((h) => [...h, JSON.stringify({ elements: venue.elements, localities: venue.localities })]);
        const snap = JSON.parse(next);
        setVenue((v) => ({
            ...v,
            elements: snap.elements,
            localities: snap.localities,
            capacity_calculated: computeCapacity(snap.elements),
        }));
        markDirty();
    };

    // ── Keyboard
    useEffect(() => {
        const onKey = (e) => {
            const target = e.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
                return;
            }
            if ((e.key === "Delete" || e.key === "Backspace") && selection.length > 0) {
                e.preventDefault();
                selection.forEach((id_) => deleteElement(id_));
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
            } else if (e.key === "Escape") {
                setSelection([]);
                setTool("select");
            } else if (selection.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                selection.forEach((id_) => {
                    const el = elements.find((x) => x.id === id_);
                    if (el) updateElement(id_, { x: el.x + dx, y: el.y + dy });
                });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (loading || !venue) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando editor…
            </div>
        );
    }

    const capacity = computeCapacity(elements);

    return (
        <div className="space-y-3" data-testid="venue-editor-page">
            {/* Top header */}
            <header className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                    <Button asChild variant="ghost" size="icon">
                        <Link to="/app/venues" aria-label="Volver">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <Input
                        value={venue.name}
                        onChange={(e) => {
                            setVenue((v) => ({ ...v, name: e.target.value }));
                            markDirty();
                        }}
                        className="h-9 font-semibold text-lg w-[300px] max-w-full"
                        data-testid="venue-name-input"
                    />
                    <Badge variant="secondary">{STATUS_LABEL[venue.status]}</Badge>
                    {locked && (
                        <Badge className="bg-amber-100 text-amber-900 border-amber-200">
                            <Lock className="h-3 w-3 mr-1" /> Bloqueado
                        </Badge>
                    )}
                    {dirty && !saving && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                            ● Sin guardar
                        </Badge>
                    )}
                    {saving && (
                        <Badge variant="outline" className="text-slate-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Guardando…
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {venue.status === "published" && (
                        <Button asChild variant="outline" size="sm">
                            <a
                                href={`/o/${venue.tenant_slug}/venues/${venue.slug}/preview`}
                                target="_blank"
                                rel="noreferrer"
                                data-testid="venue-preview-link"
                            >
                                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                Preview público
                            </a>
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => persist()}
                        disabled={saving}
                        data-testid="venue-save-btn"
                    >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        Guardar
                    </Button>
                    {venue.status !== "published" && (
                        <Button
                            size="sm"
                            onClick={publish}
                            disabled={saving || elements.length === 0}
                            data-testid="venue-publish-btn"
                        >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Publicar
                        </Button>
                    )}
                </div>
            </header>

            {locked && (
                <Card className="border-amber-200 bg-amber-50/60">
                    <CardContent className="pt-4 flex items-start gap-2 text-sm">
                        <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-amber-900">
                                Este venue está bloqueado para cambios estructurales
                            </p>
                            <p className="text-amber-800 text-xs">
                                Hay {activeEvents.length} evento(s) usándolo con ventas activas. Podés
                                editar nombre, descripción y colores, pero no agregar/eliminar elementos.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Toolbar */}
            <EditorToolbar
                tool={tool}
                onTool={setTool}
                onUndo={undo}
                onRedo={redo}
                canUndo={history.length > 0}
                canRedo={future.length > 0}
            />

            {/* Main canvas + sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
                <div>
                    <EditorCanvas
                        canvas={venue.canvas}
                        elements={elements}
                        localitiesById={localitiesById}
                        selection={selection}
                        onSelect={handleSelect}
                        onUpdate={updateElement}
                        tool={tool}
                        onCanvasClick={handleCanvasClick}
                        readOnly={locked}
                        height={600}
                    />
                    <div className="mt-2 text-xs text-muted-foreground flex justify-between">
                        <span>
                            Canvas {venue.canvas.width} × {venue.canvas.height}px
                            {" · "}Snap a {venue.canvas.grid_size}px
                        </span>
                        <span>
                            <strong>{capacity}</strong> capacidad total
                            {" · "}<strong>{elements.length}</strong> elementos
                        </span>
                    </div>
                </div>

                <aside className="space-y-4">
                    <Card>
                        <CardContent className="pt-4 space-y-4">
                            <PropertiesPanel
                                selection={selection}
                                elements={elements}
                                localities={localities}
                                onUpdate={updateElement}
                                onDelete={deleteElement}
                                readOnly={locked}
                            />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-4">
                            <LocalitiesPanel
                                localities={localities}
                                elements={elements}
                                selection={selection}
                                onAdd={addLocality}
                                onUpdate={updateLocality}
                                onDelete={deleteLocality}
                                onAssign={assignLocalityToSelection}
                                readOnly={locked}
                            />
                        </CardContent>
                    </Card>
                </aside>
            </div>

            <ZoneConfigDialog
                open={!!pendingZone}
                onClose={() => { setPendingZone(null); setTool("select"); }}
                onConfirm={confirmZone}
                localities={localities}
            />
            <RowConfigDialog
                open={!!pendingRow}
                onClose={() => { setPendingRow(null); setTool("select"); }}
                onConfirm={confirmRow}
                localities={localities}
                nextRowLabel={nextRowLabel(elements)}
            />
        </div>
    );
}
