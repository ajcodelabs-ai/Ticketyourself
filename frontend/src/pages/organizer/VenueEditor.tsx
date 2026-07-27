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
import { useParams, useNavigate, useSearchParams, Link, useLocation } from "react-router-dom";
import {
    ArrowLeft, Save, Send, AlertCircle, Lock, ExternalLink, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import VenueEmptyCanvasOverlay from "@/components/venues/VenueEmptyCanvasOverlay";
import { useAuth } from "@/contexts/AuthContext";
import {
    venuesApi, adminVenueTemplatesApi, eventVenueLayoutApi, makeStage, makeZone, makeRow, makeCurvedRow, makeSeat,
    makeTableRound, makeTableRect, computeCapacity, newId, bumpLabel,
    elementAcceptsLocality, elementBBox, STATUS_LABEL, explodeRowToSeats, isSeatRowKind, GRID,
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
    const { id, eventId: eventIdParam } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const { organizer } = useAuth();
    const isAdminTemplate = location.pathname.startsWith("/admin/venue-templates/");
    const isEventScope = Boolean(eventIdParam) || /\/app\/eventos\/[^/]+\/mapa/.test(location.pathname);
    const eventId = eventIdParam || null;
    const venueApi = isAdminTemplate ? adminVenueTemplatesApi : venuesApi;
    const listPath = isEventScope
        ? (searchParams.get("return_to") || (eventId ? `/app/eventos/${eventId}/editar?tab=localidades` : "/app/eventos"))
        : (isAdminTemplate ? "/admin/venue-templates" : "/app/venues");
    // When the user landed here from the event wizard, the URL carries
    // `?return_to=` and we send them back automatically right after publishing.
    const returnTo = searchParams.get("return_to");
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
    const [emptyOverlayDismissed, setEmptyOverlayDismissed] = useState(false);
    const clipboardRef = useRef([]);

    const dirtyRef = useRef(false);
    const saveLockRef = useRef(false);
    const historyRef = useRef([]);
    const futureRef = useRef([]);
    const venueRef = useRef(null);
    const selectionRef = useRef([]);

    // Keep refs in sync for keyboard handlers (avoid stale closures).
    useEffect(() => { venueRef.current = venue; }, [venue]);
    useEffect(() => { selectionRef.current = selection; }, [selection]);
    useEffect(() => { historyRef.current = history; }, [history]);
    useEffect(() => { futureRef.current = future; }, [future]);

    // Load
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                if (isEventScope && eventId) {
                    const layout = await eventVenueLayoutApi.get(eventId);
                    if (!mounted) return;
                    setVenue({
                        id: layout.venue_id || eventId,
                        name: layout.venue_name || "Mapa del evento",
                        slug: layout.venue_slug,
                        status: "published",
                        canvas: layout.canvas || { width: 1000, height: 600 },
                        elements: layout.elements || [],
                        localities: layout.localities || [],
                        capacity_calculated: layout.capacity_calculated || 0,
                        lock_status: layout.lock_status || { locked: false },
                        is_event_snapshot: true,
                        source_venue_id: layout.source_venue_id,
                        source_venue_name: layout.venue_name,
                    });
                    historyRef.current = [];
                    futureRef.current = [];
                    setHistory([]);
                    setFuture([]);
                    setEmptyOverlayDismissed(true);
                } else {
                    const v = await venueApi.get(id);
                    if (mounted) {
                        setVenue(v);
                        historyRef.current = [];
                        futureRef.current = [];
                        setHistory([]);
                        setFuture([]);
                        // The venue list already asked "plantilla o en blanco?" before
                        // creating this venue — don't ask again here.
                        setEmptyOverlayDismissed(searchParams.get("blank") === "1");
                    }
                }
            } catch (e) {
                toast.error(
                    isEventScope
                        ? "No pudimos cargar el mapa del evento."
                        : (isAdminTemplate ? "No pudimos cargar la plantilla." : "No pudimos cargar el venue."),
                );
                navigate(listPath);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [id, eventId, isEventScope, navigate, venueApi, listPath, isAdminTemplate]);

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

    const mutateVenue = (mutator) => {
        const prev = venueRef.current;
        if (!prev) return;
        const snap = JSON.stringify({ elements: prev.elements, localities: prev.localities });
        const nextHistory = [...historyRef.current, snap].slice(-30);
        historyRef.current = nextHistory;
        futureRef.current = [];
        setHistory(nextHistory);
        setFuture([]);
        const mutated = mutator(prev);
        const next = {
            ...mutated,
            capacity_calculated: computeCapacity(mutated.elements),
        };
        venueRef.current = next;
        setVenue(next);
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
    const handleSelect = (ids: string[], { additive, replace }: { additive?: boolean; replace?: boolean } = {}) => {
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
    const updateElementsBatch = (patches) => {
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.map((e) => (
                patches[e.id] ? { ...e, ...patches[e.id] } : e
            )),
        }));
    };
    const deleteElement = (elemIdOrIds) => {
        const ids = Array.isArray(elemIdOrIds) ? elemIdOrIds : [elemIdOrIds];
        deleteElements(ids);
    };
    const deleteElements = (ids) => {
        if (!ids?.length) return;
        const idSet = new Set(ids);
        mutateVenue((v) => ({
            ...v,
            elements: v.elements.filter((e) => !idSet.has(e.id)),
        }));
        setSelection((s) => s.filter((x) => !idSet.has(x)));
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

    const explodeRows = (ids) => {
        const targetIds = ids?.length ? ids : selection;
        const rows = elements.filter((e) => targetIds.includes(e.id) && isSeatRowKind(e.kind));
        if (rows.length === 0) {
            toast.message("Seleccioná una fila (recta o curva) para convertir.");
            return;
        }
        const newIds = [];
        mutateVenue((v) => {
            let next = [...v.elements];
            for (const row of rows) {
                const seats = explodeRowToSeats(row);
                next = next.filter((e) => e.id !== row.id).concat(seats);
                newIds.push(...seats.map((s) => s.id));
            }
            return { ...v, elements: next };
        });
        setSelection(newIds);
        toast.success(
            rows.length === 1
                ? `Fila convertida en ${newIds.length} asientos. Ahora podés seleccionarlos por separado.`
                : `${rows.length} filas → ${newIds.length} asientos individuales.`,
        );
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
            if (isEventScope && eventId) {
                const updated = await eventVenueLayoutApi.put(eventId, {
                    canvas: venue.canvas,
                    elements: venue.elements,
                    localities: venue.localities || [],
                });
                setVenue((prev) => ({
                    ...prev,
                    canvas: updated.canvas,
                    elements: updated.elements,
                    localities: updated.localities,
                    capacity_calculated: updated.capacity_calculated,
                    lock_status: updated.lock_status || prev.lock_status,
                }));
                dirtyRef.current = false;
                setDirty(false);
                if (!silent) {
                    toast.success("Mapa del evento guardado");
                    if (returnTo) {
                        navigate(returnTo, { replace: true });
                    }
                }
            } else {
                const body = {
                    name: venue.name,
                    type: venue.type,
                    description: venue.description,
                    canvas: venue.canvas,
                    elements: venue.elements,
                    localities: venue.localities || [],
                };
                const updated = await venueApi.update(venue.id, body);
                setVenue(updated);
                dirtyRef.current = false;
                setDirty(false);
                if (!silent) toast.success(isAdminTemplate ? "Plantilla guardada" : "Venue guardado");
            }
        } catch (e) {
            const detail = e?.response?.data?.detail;
            if (e?.response?.status === 409) {
                toast.error(
                    isEventScope
                        ? (typeof detail === "string" ? detail : "Mapa bloqueado: hay tickets vendidos.")
                        : "Venue bloqueado: hay eventos con ventas activas.",
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
    };
    useEffect(() => {
        const t = setInterval(() => {
            if (dirtyRef.current && !saveLockRef.current) persist({ silent: true });
        }, AUTO_SAVE_MS);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [venue]);

    const applyTemplateLayout = async ({ elements: els, localities: locs, capacity_calculated }) => {
        if (!venue || locked) return;
        const next = {
            ...venue,
            elements: JSON.parse(JSON.stringify(els || [])),
            localities: JSON.parse(JSON.stringify(locs || [])),
            capacity_calculated: capacity_calculated ?? computeCapacity(els || []),
        };
        setVenue(next);
        dirtyRef.current = true;
        setDirty(true);
        saveLockRef.current = true;
        setSaving(true);
        try {
            const body = {
                name: next.name,
                type: next.type,
                description: next.description,
                canvas: next.canvas,
                elements: next.elements,
                localities: next.localities || [],
            };
            const updated = await venueApi.update(venue.id, body);
            setVenue(updated);
            dirtyRef.current = false;
            setDirty(false);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo guardar el layout.");
        } finally {
            saveLockRef.current = false;
            setSaving(false);
        }
    };

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
            // Came here from the event wizard → bounce back to the linked tab.
            if (returnTo) {
                toast.success("Volvemos a tu evento para vincular este venue");
                navigate(returnTo, { replace: true });
            }
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
        const hist = historyRef.current;
        const current = venueRef.current;
        if (hist.length === 0 || !current) return;
        const last = hist[hist.length - 1];
        const nextHistory = hist.slice(0, -1);
        const nextFuture = [
            ...futureRef.current,
            JSON.stringify({ elements: current.elements, localities: current.localities }),
        ];
        historyRef.current = nextHistory;
        futureRef.current = nextFuture;
        setHistory(nextHistory);
        setFuture(nextFuture);
        const snap = JSON.parse(last);
        const next = {
            ...current,
            elements: snap.elements,
            localities: snap.localities,
            capacity_calculated: computeCapacity(snap.elements),
        };
        venueRef.current = next;
        setVenue(next);
        setSelection([]);
        markDirty();
    };
    const redo = () => {
        const fut = futureRef.current;
        const current = venueRef.current;
        if (fut.length === 0 || !current) return;
        const nextSnap = fut[fut.length - 1];
        const nextFuture = fut.slice(0, -1);
        const nextHistory = [
            ...historyRef.current,
            JSON.stringify({ elements: current.elements, localities: current.localities }),
        ];
        historyRef.current = nextHistory;
        futureRef.current = nextFuture;
        setHistory(nextHistory);
        setFuture(nextFuture);
        const snap = JSON.parse(nextSnap);
        const next = {
            ...current,
            elements: snap.elements,
            localities: snap.localities,
            capacity_calculated: computeCapacity(snap.elements),
        };
        venueRef.current = next;
        setVenue(next);
        setSelection([]);
        markDirty();
    };

    // ── Keyboard ───────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            const target = e.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            const ctrl = e.ctrlKey || e.metaKey;
            const sel = selectionRef.current;
            const current = venueRef.current;
            const els = current?.elements || [];

            if ((e.key === "Delete" || e.key === "Backspace") && sel.length > 0) {
                e.preventDefault();
                deleteElements(sel);
            } else if (ctrl && e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if (ctrl && e.key.toLowerCase() === "y") {
                e.preventDefault();
                redo();
            } else if (ctrl && e.key.toLowerCase() === "a") {
                e.preventDefault();
                setSelection(els.map((el) => el.id));
            } else if (ctrl && e.key.toLowerCase() === "c") {
                e.preventDefault();
                clipboardRef.current = els.filter((el) => sel.includes(el.id));
                if (clipboardRef.current.length) {
                    toast.message(`${clipboardRef.current.length} elemento(s) copiado(s)`);
                }
            } else if (ctrl && e.key.toLowerCase() === "v") {
                e.preventDefault();
                if (clipboardRef.current.length === 0) return;
                const newIds = [];
                mutateVenue((v) => {
                    const pastes = clipboardRef.current.map((el) => {
                        const nid = newId();
                        newIds.push(nid);
                        return { ...el, id: nid, x: el.x + 20, y: el.y + 20 };
                    });
                    return { ...v, elements: [...v.elements, ...pastes] };
                });
                setSelection(newIds);
            } else if (ctrl && e.key.toLowerCase() === "d") {
                e.preventDefault();
                duplicateSelection();
            } else if (e.key === "Escape") {
                setSelection([]);
                setTool("select");
                setContextMenu(null);
            } else if (sel.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : GRID;
                const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                const patches = {};
                sel.forEach((id_) => {
                    const el = els.find((x) => x.id === id_);
                    if (el) patches[id_] = { x: el.x + dx, y: el.y + dy };
                });
                if (Object.keys(patches).length) updateElementsBatch(patches);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // Handlers read from refs; stable listener is intentional.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Context menu actions ───────────────────────────────────────────
    const handleContextAction = (action) => {
        if (!contextMenu) return;
        const elId = contextMenu.elementId;
        if (action === "edit") {
            // No-op — sidebar already focused via selection
            toast.message("Editá las propiedades en el panel derecho.");
        } else if (action === "duplicate") {
            duplicateSelection();
        } else if (action === "explode") {
            explodeRows([elId]);
        } else if (action === "delete") {
            deleteElements(selectionRef.current.length ? selectionRef.current : [elId]);
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
            <header className="space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <Button asChild variant="ghost" size="icon">
                            <Link to={listPath} aria-label="Volver">
                                <ArrowLeft className="h-4 w-4" />
                            </Link>
                        </Button>
                        {isEventScope ? (
                            <div className="min-w-0">
                                <div className="font-semibold text-lg truncate" data-testid="event-map-title">
                                    {venue.name}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Copia del evento · origen {venue.source_venue_name || venue.name}
                                    {" · "}
                                    <strong className="text-foreground">{capacity}</strong> cap.
                                    {" · "}
                                    <strong className="text-foreground">{elements.length}</strong> elementos
                                </p>
                            </div>
                        ) : (
                            <div className="min-w-0 space-y-0.5">
                                <Input
                                    value={venue.name}
                                    onChange={(e) => {
                                        setVenue((v) => {
                                            const next = { ...v, name: e.target.value };
                                            venueRef.current = next;
                                            return next;
                                        });
                                        markDirty();
                                    }}
                                    className="h-9 font-semibold text-lg w-[300px] max-w-full"
                                    data-testid="venue-name-input"
                                />
                                <p className="text-xs text-muted-foreground pl-0.5">
                                    <strong className="text-foreground">{capacity}</strong> capacidad
                                    {" · "}
                                    <strong className="text-foreground">{elements.length}</strong> elementos
                                </p>
                            </div>
                        )}
                        <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
                            {isEventScope
                                ? "Mapa del evento"
                                : (isAdminTemplate ? "Plantilla" : STATUS_LABEL[venue.status])}
                        </Badge>
                        {locked && (
                            <Badge className="bg-amber-100 text-amber-900 border-amber-200 text-[10px] font-normal">
                                <Lock className="h-3 w-3 mr-1" /> Bloqueado
                            </Badge>
                        )}
                        {dirty && !saving && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px] font-normal">
                                ● Sin guardar
                            </Badge>
                        )}
                        {saving && (
                            <Badge variant="outline" className="text-muted-foreground text-[10px] font-normal">
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Guardando…
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {!isEventScope && !isAdminTemplate && venue.status === "published" && (
                            <Button asChild variant="outline" size="sm">
                                <a href={`/o/${venue.tenant_slug}/venues/${venue.slug}/preview`} target="_blank"
                                   rel="noreferrer" data-testid="venue-preview-link">
                                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Preview
                                </a>
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => persist()}
                                disabled={saving} data-testid="venue-save-btn">
                            <Save className="h-3.5 w-3.5 mr-1" /> Guardar
                        </Button>
                        {!isEventScope && !isAdminTemplate && venue.status !== "published" && (
                            <Button size="sm" onClick={publish}
                                    disabled={saving || elements.length === 0}
                                    data-testid="venue-publish-btn">
                                <Send className="h-3.5 w-3.5 mr-1" /> Publicar
                            </Button>
                        )}
                        {isEventScope && returnTo && (
                            <Button
                                size="sm"
                                onClick={async () => {
                                    if (dirty) await persist({ silent: true });
                                    navigate(returnTo, { replace: true });
                                }}
                                disabled={saving}
                                data-testid="event-map-done-btn"
                            >
                                Listo
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            {!isEventScope && !isAdminTemplate && returnTo && elements.length > 0 && venue.status !== "published" && (
                <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <p>
                        Cuando termines, hacé clic en <strong className="text-foreground">Publicar</strong> para
                        volver a tu evento y vincular este venue.
                    </p>
                </div>
            )}

            {isEventScope && (
                <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <p>
                        Estás editando la <strong className="text-foreground">copia del mapa de este evento</strong>.
                        Los cambios no afectan el venue maestro ni otros eventos.
                    </p>
                </div>
            )}

            {locked && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 flex items-start gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium text-amber-900">
                            {isEventScope
                                ? "Mapa bloqueado para cambios estructurales"
                                : "Venue bloqueado para cambios estructurales"}
                        </p>
                        <p className="text-amber-800 text-xs mt-0.5">
                            {isEventScope
                                ? "Hay tickets vendidos en este evento. Podés editar colores y etiquetas no estructurales."
                                : `${activeEvents.length} evento(s) con ventas activas. Podés editar nombre, descripción y colores.`}
                        </p>
                    </div>
                </div>
            )}

            <EditorToolbar
                tool={tool}
                onTool={setTool}
                onUndo={undo}
                onRedo={redo}
                canUndo={history.length > 0}
                canRedo={future.length > 0}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3">
                <div className="min-w-0 max-w-full overflow-hidden">
                    <div className="relative min-w-0 max-w-full">
                        <EditorCanvas
                            canvas={venue.canvas}
                            elements={elements}
                            localitiesById={localitiesById}
                            selection={selection}
                            onSelect={handleSelect}
                            onUpdate={updateElement}
                            onBatchUpdate={updateElementsBatch}
                            onTransform={onTransform}
                            onContextMenu={(info) => setContextMenu(info)}
                            tool={tool}
                            onCanvasClick={handleCanvasClick}
                            readOnly={locked}
                            height={600}
                            autoFitKey={venue.id}
                        />
                        {!isAdminTemplate && elements.length === 0 && !locked && !emptyOverlayDismissed && (
                            <VenueEmptyCanvasOverlay
                                disabled={saving}
                                onApplied={applyTemplateLayout}
                                onDismiss={() => setEmptyOverlayDismissed(true)}
                            />
                        )}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
                        <span>
                            Canvas {venue.canvas.width} × {venue.canvas.height}px · Snap {venue.canvas.grid_size}px
                        </span>
                        <span className="text-right">
                            Ctrl+Z deshacer · Ctrl+click multi · click derecho menú
                        </span>
                    </div>
                </div>

                <aside className="space-y-3 lg:sticky lg:top-3 lg:self-start lg:max-h-[min(720px,calc(100vh-8rem))] lg:overflow-y-auto">
                    <div className="rounded-xl border bg-card p-4 space-y-4">
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
                            onExplodeRows={explodeRows}
                            readOnly={locked}
                        />
                    </div>
                    <div className="rounded-xl border bg-card p-4 flex flex-col min-h-0">
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
                    </div>
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
                canExplode={isSeatRowKind(
                    elements.find((e) => e.id === contextMenu?.elementId)?.kind,
                )}
            />
            <PublishPendingDialog
                open={publishPendingOpen}
                onOpenChange={setPublishPendingOpen}
                resource="venue"
            />
        </div>
    );
}
