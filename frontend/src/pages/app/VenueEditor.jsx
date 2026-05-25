/**
 * /app/venues/:id/editor — Phase 6b editor.
 *
 * Adds (vs 6a):
 *  - 4 new element kinds (curved row, individual seat, round/rect tables).
 *  - Konva Transformer attached to current selection (resize + rotate).
 *  - Multi-select state machine (Ctrl+click, marquee, group drag).
 *  - Right-click context menu with edit/duplicate/locality/z-index/delete.
 *  - Keyboard shortcuts: Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+D, +/-, etc.
 *  - Alignment + distribute helpers for multi-selection.
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
    ArrowLeft, Save, Send, AlertCircle, Lock, ExternalLink, Loader2,
} from "lucide-react";
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
import CurvedRowConfigDialog from "@/components/venues/CurvedRowConfigDialog";
import TableConfigDialog from "@/components/venues/TableConfigDialog";
import ContextMenu from "@/components/venues/ContextMenu";
import PublishPendingDialog from "@/components/PublishPendingDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
    venuesApi, makeStage, makeZone, makeRow, makeCurvedRow, makeSeat,
    makeTableRound, makeTableRect, computeCapacity, newId, bumpLabel,
    elementAcceptsLocality, elementBBox, STATUS_LABEL,
} from "@/lib/venues";

const AUTO_SAVE_MS = 30_000;

function nextRowLabel(elements) {
    const used = new Set(
        elements
            .filter((e) => (e.kind === "seat_row_straight" || e.kind === "seat_row_curved") && e.row_label)
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
    const { organizer } = useAuth();
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
    const [pendingCurved, setPendingCurved] = useState(null);
    const [pendingTable, setPendingTable] = useState(null); // {kind, x, y}
    const [contextMenu, setContextMenu] = useState(null);
    const [publishPendingOpen, setPublishPendingOpen] = useState(false);
    const clipboardRef = useRef([]);

    const dirtyRef = useRef(false);
    const saveLockRef = useRef(false);

    // Load
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const v = await venuesApi.get(id);
                if (mounted) setVenue(v);
            } catch (e) {
                toast.error("No pudimos cargar el venue.");
                navigate("/app/venues");
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [id, navigate]);

    useEffect(() => {
        const handler = (e) => {
            if (!dirtyRef.current) return;
            e.preventDefault();
            e.returnValue = "Tenés cambios sin guardar.";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

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

    // ── Tool placement ──────────────────────────────────────────────────
    const handleCanvasClick = (tk, { x, y }) => {
        if (tk === "stage") {
            mutateVenue((v) => ({ ...v, elements: [...v.elements, makeStage(x, y)] }));
            setTool("select");
        } else if (tk === "zone") {
            setPendingZone({ x, y });
        } else if (tk === "row_straight") {
            setPendingRow({ x, y });
        } else if (tk === "row_curved") {
            setPendingCurved({ x, y });
        } else if (tk === "seat") {
            // Place directly; auto-increment label.
            const lastSeat = [...elements].reverse().find((e) => e.kind === "seat_individual");
            const label = lastSeat ? bumpLabel(lastSeat.label) : "VIP-1";
            mutateVenue((v) => ({ ...v, elements: [...v.elements, makeSeat({ x, y, label })] }));
            // Stay on "seat" tool so the user can drop several seats; they'll Esc to stop.
        } else if (tk === "table_round" || tk === "table_rect") {
            setPendingTable({ kind: tk, x, y });
        }
    };

    const confirmZone = ({ label, capacity, locality_id }) => {
        const { x, y } = pendingZone;
        mutateVenue((v) => ({
            ...v,
            elements: [...v.elements, makeZone({ x, y, width: 200, height: 100, label, capacity, locality_id })],
        }));
        setPendingZone(null);
        setTool("select");
    };
    const confirmRow = (cfg) => {
        const { x, y } = pendingRow;
        mutateVenue((v) => ({ ...v, elements: [...v.elements, makeRow({ x, y, ...cfg })] }));
        setPendingRow(null);
        setTool("select");
    };
    const confirmCurved = (cfg) => {
        const { x, y } = pendingCurved;
        mutateVenue((v) => ({ ...v, elements: [...v.elements, makeCurvedRow({ x, y, ...cfg })] }));
        setPendingCurved(null);
        setTool("select");
    };
    const confirmTable = (cfg) => {
        const { x, y, kind } = pendingTable;
        const make = kind === "table_round" ? makeTableRound : makeTableRect;
        mutateVenue((v) => ({ ...v, elements: [...v.elements, make({ x, y, ...cfg })] }));
        setPendingTable(null);
        setTool("select");
    };

    // ── Selection ──────────────────────────────────────────────────────
    const handleSelect = (ids, { additive, replace } = {}) => {
        setSelection((prev) => {
            if (replace) return ids;
            if (!additive) return ids;
            const set = new Set(prev);
            ids.forEach((id_) => {
                if (set.has(id_)) set.delete(id_);
                else set.add(id_);
            });
            return Array.from(set);
        });
    };

    // ── Element mutation ───────────────────────────────────────────────
    const updateElement = (elemId, patch) => {
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => (e.id === elemId ? { ...e, ...patch } : e)),
        }));
    };
    const deleteElement = (elemId) => {
        mutateVenue((v) => ({ ...v, elements: v.elements.filter((e) => e.id !== elemId) }));
        setSelection((s) => s.filter((x) => x !== elemId));
    };
    const onTransform = (elemId, patch) => updateElement(elemId, patch);

    // ── Localities ─────────────────────────────────────────────────────
    const addLocality = (loc) => mutateVenue((v) => ({ ...v, localities: [...(v.localities || []), loc] }));
    const updateLocality = (locId, patch) => mutateVenue((v) => ({
        ...v,
        localities: (v.localities || []).map((l) => (l.id === locId ? { ...l, ...patch } : l)),
    }));
    const deleteLocality = (locId) => {
        if (elements.some((e) => e.locality_id === locId)) {
            toast.error("Esta localidad tiene elementos asignados. Reasignalos antes.");
            return;
        }
        mutateVenue((v) => ({ ...v, localities: (v.localities || []).filter((l) => l.id !== locId) }));
    };
    const assignLocalityToSelection = (locId) => {
        const affected = elements.filter((e) => selection.includes(e.id) && elementAcceptsLocality(e.kind));
        if (affected.length === 0) {
            toast.error("Seleccioná elementos asignables (zonas, asientos, mesas).");
            return;
        }
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) =>
                selection.includes(e.id) && elementAcceptsLocality(e.kind)
                    ? { ...e, locality_id: locId } : e,
            ),
        }));
        toast.success(`Localidad asignada a ${affected.length} elemento(s).`);
    };

    // ── Multi-select operations ────────────────────────────────────────
    const align = (axis) => {
        if (selection.length < 2) return;
        const sel = elements.filter((e) => selection.includes(e.id));
        const bboxes = sel.map(elementBBox);
        let target;
        if (axis === "left") target = Math.min(...bboxes.map((b) => b.minX));
        if (axis === "right") target = Math.max(...bboxes.map((b) => b.maxX));
        if (axis === "cx") target = bboxes.reduce((s, b) => s + b.cx, 0) / bboxes.length;
        if (axis === "top") target = Math.min(...bboxes.map((b) => b.minY));
        if (axis === "bottom") target = Math.max(...bboxes.map((b) => b.maxY));
        if (axis === "cy") target = bboxes.reduce((s, b) => s + b.cy, 0) / bboxes.length;

        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => {
                if (!selection.includes(e.id)) return e;
                const b = elementBBox(e);
                if (axis === "left") return { ...e, x: e.x + (target - b.minX) };
                if (axis === "right") return { ...e, x: e.x + (target - b.maxX) };
                if (axis === "cx") return { ...e, x: e.x + (target - b.cx) };
                if (axis === "top") return { ...e, y: e.y + (target - b.minY) };
                if (axis === "bottom") return { ...e, y: e.y + (target - b.maxY) };
                if (axis === "cy") return { ...e, y: e.y + (target - b.cy) };
                return e;
            }),
        }));
    };
    const distribute = (axis) => {
        if (selection.length < 3) {
            toast.message("Distribuir necesita 3 o más elementos.");
            return;
        }
        const sel = elements.filter((e) => selection.includes(e.id))
            .map((e) => ({ e, b: elementBBox(e) }))
            .sort((a, b) => (axis === "h" ? a.b.cx - b.b.cx : a.b.cy - b.b.cy));
        const first = sel[0].b;
        const last = sel[sel.length - 1].b;
        const start = axis === "h" ? first.cx : first.cy;
        const end = axis === "h" ? last.cx : last.cy;
        const step = (end - start) / (sel.length - 1);
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => {
                const idx = sel.findIndex((s) => s.e.id === e.id);
                if (idx <= 0 || idx === sel.length - 1) return e;
                const targetCenter = start + step * idx;
                const b = elementBBox(e);
                if (axis === "h") return { ...e, x: e.x + (targetCenter - b.cx) };
                return { ...e, y: e.y + (targetCenter - b.cy) };
            }),
        }));
    };
    const duplicateSelection = () => {
        if (selection.length === 0) return;
        const newIds = [];
        mutateVenue((v) => {
            const dups = v.elements
                .filter((e) => selection.includes(e.id))
                .map((e) => {
                    const nid = newId();
                    newIds.push(nid);
                    return { ...e, id: nid, x: e.x + 20, y: e.y + 20 };
                });
            return { ...v, elements: [...v.elements, ...dups] };
        });
        setSelection(newIds);
    };
    const copySelection = () => {
        if (selection.length === 0) return;
        clipboardRef.current = elements.filter((e) => selection.includes(e.id));
        toast.message(`${clipboardRef.current.length} elemento(s) copiado(s)`);
    };
    const paste = () => {
        if (clipboardRef.current.length === 0) return;
        const newIds = [];
        mutateVenue((v) => {
            const pastes = clipboardRef.current.map((e) => {
                const nid = newId();
                newIds.push(nid);
                return { ...e, id: nid, x: e.x + 20, y: e.y + 20 };
            });
            return { ...v, elements: [...v.elements, ...pastes] };
        });
        setSelection(newIds);
    };
    const selectAll = () => setSelection(elements.map((e) => e.id));
    const bringToFront = () => {
        if (selection.length === 0) return;
        const maxZ = elements.reduce((m, e) => Math.max(m, e.z_index || 0), 0);
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => (selection.includes(e.id) ? { ...e, z_index: maxZ + 1 } : e)),
        }));
    };
    const sendToBack = () => {
        if (selection.length === 0) return;
        const minZ = elements.reduce((m, e) => Math.min(m, e.z_index || 0), 0);
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => (selection.includes(e.id) ? { ...e, z_index: minZ - 1 } : e)),
        }));
    };

    // ── Save / Publish ─────────────────────────────────────────────────
    const persist = async ({ silent = false } = {}) => {
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
                toast.error("Venue bloqueado: hay eventos con ventas activas.");
            } else if (typeof detail === "string") {
                toast.error(detail);
            } else {
                toast.error("No se pudo guardar.");
            }
        } finally {
            saveLockRef.current = false;
            setSaving(false);
        }
    };
    useEffect(() => {
        const t = setInterval(() => {
            if (dirtyRef.current && !saveLockRef.current) persist({ silent: true });
        }, AUTO_SAVE_MS);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [venue]);

    const publish = async () => {
        if (dirty) await persist({ silent: true });
        if (organizer?.status === "pending") {
            setPublishPendingOpen(true);
            return;
        }
        try {
            await venuesApi.publish(venue.id);
            toast.success("Venue publicado");
            const v = await venuesApi.get(venue.id);
            setVenue(v);
        } catch (e) {
            const code = e?.response?.data?.detail?.error;
            if (code === "organizer_pending_review") {
                setPublishPendingOpen(true);
                return;
            }
            const detail = e?.response?.data?.detail;
            toast.error(typeof detail === "string" ? detail : "No se pudo publicar.");
        }
    };

    // ── Undo / Redo ────────────────────────────────────────────────────
    const undo = () => {
        if (history.length === 0 || !venue) return;
        const last = history[history.length - 1];
        setHistory((h) => h.slice(0, -1));
        setFuture((f) => [...f, JSON.stringify({ elements: venue.elements, localities: venue.localities })]);
        const snap = JSON.parse(last);
        setVenue((v) => ({
            ...v, elements: snap.elements, localities: snap.localities,
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
            ...v, elements: snap.elements, localities: snap.localities,
            capacity_calculated: computeCapacity(snap.elements),
        }));
        markDirty();
    };

    // ── Keyboard ───────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            const target = e.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            const ctrl = e.ctrlKey || e.metaKey;
            if ((e.key === "Delete" || e.key === "Backspace") && selection.length > 0) {
                e.preventDefault(); selection.forEach(deleteElement);
            } else if (ctrl && e.key.toLowerCase() === "z") {
                e.preventDefault(); if (e.shiftKey) redo(); else undo();
            } else if (ctrl && e.key.toLowerCase() === "a") {
                e.preventDefault(); selectAll();
            } else if (ctrl && e.key.toLowerCase() === "c") {
                e.preventDefault(); copySelection();
            } else if (ctrl && e.key.toLowerCase() === "v") {
                e.preventDefault(); paste();
            } else if (ctrl && e.key.toLowerCase() === "d") {
                e.preventDefault(); duplicateSelection();
            } else if (e.key === "Escape") {
                setSelection([]); setTool("select"); setContextMenu(null);
            } else if (e.key === "+" || e.key === "=") {
                // Handled in canvas via wheel; placeholder.
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

    // ── Context menu actions ───────────────────────────────────────────
    const handleContextAction = (action) => {
        if (!contextMenu) return;
        const elId = contextMenu.elementId;
        if (action === "edit") {
            // No-op — sidebar already focused via selection
            toast.message("Editá las propiedades en el panel derecho.");
        } else if (action === "duplicate") {
            duplicateSelection();
        } else if (action === "delete") {
            selection.forEach(deleteElement);
        } else if (action === "bring-front") {
            bringToFront();
        } else if (action === "send-back") {
            sendToBack();
        } else if (action === "locality") {
            toast.message("Usá el panel de Localidades para asignar.");
        }
    };

    if (loading || !venue) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando editor…
            </div>
        );
    }

    const capacity = computeCapacity(elements);

    return (
        <div className="space-y-3" data-testid="venue-editor-page">
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
                        <Badge variant="outline" className="text-amber-700 border-amber-300">● Sin guardar</Badge>
                    )}
                    {saving && (
                        <Badge variant="outline" className="text-slate-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Guardando…
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {venue.status === "published" && (
                        <Button asChild variant="outline" size="sm">
                            <a href={`/o/${venue.tenant_slug}/venues/${venue.slug}/preview`} target="_blank"
                               rel="noreferrer" data-testid="venue-preview-link">
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Preview público
                            </a>
                        </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => persist()}
                            disabled={saving} data-testid="venue-save-btn">
                        <Save className="h-3.5 w-3.5 mr-1" /> Guardar
                    </Button>
                    {venue.status !== "published" && (
                        <Button size="sm" onClick={publish}
                                disabled={saving || elements.length === 0}
                                data-testid="venue-publish-btn">
                            <Send className="h-3.5 w-3.5 mr-1" /> Publicar
                        </Button>
                    )}
                </div>
            </header>

            {locked && (
                <Card className="border-amber-200 bg-amber-50/60">
                    <CardContent className="pt-4 flex items-start gap-2 text-sm">
                        <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-amber-900">Venue bloqueado para cambios estructurales</p>
                            <p className="text-amber-800 text-xs">
                                {activeEvents.length} evento(s) con ventas activas. Podés editar nombre, descripción y colores.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            <EditorToolbar
                tool={tool}
                onTool={setTool}
                onUndo={undo}
                onRedo={redo}
                canUndo={history.length > 0}
                canRedo={future.length > 0}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
                <div>
                    <EditorCanvas
                        canvas={venue.canvas}
                        elements={elements}
                        localitiesById={localitiesById}
                        selection={selection}
                        onSelect={handleSelect}
                        onUpdate={updateElement}
                        onTransform={onTransform}
                        onContextMenu={(info) => setContextMenu(info)}
                        tool={tool}
                        onCanvasClick={handleCanvasClick}
                        readOnly={locked}
                        height={600}
                    />
                    <div className="mt-2 text-xs text-muted-foreground flex justify-between">
                        <span>Canvas {venue.canvas.width} × {venue.canvas.height}px · Snap {venue.canvas.grid_size}px</span>
                        <span><strong>{capacity}</strong> capacidad · <strong>{elements.length}</strong> elementos</span>
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
                                onAlign={align}
                                onDistribute={distribute}
                                onBringFront={bringToFront}
                                onSendBack={sendToBack}
                                onDuplicate={duplicateSelection}
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

            <ZoneConfigDialog open={!!pendingZone} onClose={() => { setPendingZone(null); setTool("select"); }}
                              onConfirm={confirmZone} localities={localities} />
            <RowConfigDialog open={!!pendingRow} onClose={() => { setPendingRow(null); setTool("select"); }}
                             onConfirm={confirmRow} localities={localities}
                             nextRowLabel={nextRowLabel(elements)} />
            <CurvedRowConfigDialog open={!!pendingCurved} onClose={() => { setPendingCurved(null); setTool("select"); }}
                                    onConfirm={confirmCurved} localities={localities}
                                    nextRowLabel={nextRowLabel(elements)} />
            <TableConfigDialog open={!!pendingTable} kind={pendingTable?.kind}
                                onClose={() => { setPendingTable(null); setTool("select"); }}
                                onConfirm={confirmTable} localities={localities} />

            <ContextMenu
                open={!!contextMenu}
                x={contextMenu?.screenX || 0}
                y={contextMenu?.screenY || 0}
                onClose={() => setContextMenu(null)}
                onAction={handleContextAction}
                hasLocality={!!elements.find((e) => e.id === contextMenu?.elementId && e.kind !== "stage")}
            />
            <PublishPendingDialog
                open={publishPendingOpen}
                onOpenChange={setPublishPendingOpen}
                resource="venue"
            />
        </div>
    );
}
