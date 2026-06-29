/**
 * /staff/scanner — QR scanner for staff (Phase 8).
 *
 * Staff authenticate at /staff/login. On success, tys_staff_token and
 * tys_staff_event_id are stored in sessionStorage. This page reads those,
 * fetches the assigned event's details, then opens the camera scanner.
 *
 * API calls use the staff Bearer token directly (not the organizer token
 * stored in localStorage). The backend's get_current_user short-circuits
 * for org_staff role tokens, so /tickets/validate and /events/me/:id/scan-stats
 * both work without a User DB row.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
    Camera, CameraOff, Volume2, VolumeX, ClipboardPaste,
    CheckCircle2, AlertTriangle, XCircle, Loader2, Users, LogOut, SwitchCamera,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import axios from "axios";
import { API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Dialog, DialogContent,
} from "@/components/ui/dialog";
import {
    Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";

const QR_REGION_ID = "staff-qr-reader";
const SCAN_COOLDOWN_MS = 1500;

function playBeep(type) {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        if (type === "valid") {
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
        } else if (type === "already_used") {
            osc.frequency.setValueAtTime(440, ctx.currentTime);
        } else {
            osc.frequency.setValueAtTime(180, ctx.currentTime);
        }
        gain.gain.setValueAtTime(0.16, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.debug("[staff-scanner] playBeep skipped:", (e as any)?.message || e);
    }
}

function fmtTime(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleTimeString("es-EC", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
    } catch { return iso; }
}

function StatBox({ label, value, accent = "" }: { label: string; value: any; accent?: string }) {
    const color = accent === "red" ? "text-red-600" : "text-primary";
    return (
        <Card>
            <CardContent className="py-3 px-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
            </CardContent>
        </Card>
    );
}

function ResultBody({ result, onClose }) {
    useEffect(() => {
        const t = setTimeout(onClose, 3000);
        return () => clearTimeout(t);
    }, [onClose]);

    const meta = {
        valid: { color: "bg-emerald-500 text-white", icon: <CheckCircle2 className="h-16 w-16" />, title: "VÁLIDO" },
        already_used: { color: "bg-amber-500 text-white", icon: <AlertTriangle className="h-16 w-16" />, title: "YA USADO" },
        revoked: { color: "bg-red-600 text-white", icon: <XCircle className="h-16 w-16" />, title: "REVOCADO" },
        invalid: { color: "bg-red-600 text-white", icon: <XCircle className="h-16 w-16" />, title: "INVÁLIDO" },
    };
    const { color, icon, title } = meta[result.kind] || meta.invalid;
    const holder = result.ticket?.holder || result.holder;
    const usedAt = result.used_at ? fmtTime(result.used_at) : null;

    return (
        <div className="flex flex-col items-center text-center gap-2">
            <div className={`w-full -mx-1 -mt-1 rounded-t-lg py-6 flex flex-col items-center gap-2 ${color}`}>
                {icon}
                <p className="text-2xl font-extrabold tracking-wide">{title}</p>
            </div>
            <div className="px-2 py-2 space-y-1 text-sm">
                {holder?.name && (
                    <p className="text-base font-semibold">{holder.name}</p>
                )}
                {result.ticket?.ticket_number && (
                    <p className="font-mono text-muted-foreground">#{result.ticket.ticket_number}</p>
                )}
                {result.ticket?.ticket_type && (
                    <p className="text-muted-foreground">{result.ticket.ticket_type}</p>
                )}
                {result.ticket?.seat_label && (
                    <Badge variant="outline">{result.ticket.seat_label}</Badge>
                )}
                {usedAt && (
                    <p className="text-xs text-amber-700">Escaneado a las {usedAt}</p>
                )}
                {result.reason === "not_found" && (
                    <p className="text-xs text-red-700">QR no reconocido</p>
                )}
                {result.reason === "wrong_event" && (
                    <p className="text-xs text-red-700">Ticket de otro evento</p>
                )}
                {result.network && (
                    <p className="text-xs text-red-700">Error de red — revisá la conexión</p>
                )}
            </div>
            <Button onClick={onClose} variant="outline" size="sm" className="mt-1 mb-2">
                Cerrar
            </Button>
        </div>
    );
}

export default function StaffScanner() {
    const navigate = useNavigate();

    // Read staff session from sessionStorage
    const staffToken = sessionStorage.getItem("tys_staff_token");
    const eventId = sessionStorage.getItem("tys_staff_event_id");

    // Axios instance using the staff Bearer token
    const staffApi = useMemo(() => axios.create({
        baseURL: API_BASE,
        headers: {
            "Content-Type": "application/json",
            ...(staffToken ? { Authorization: `Bearer ${staffToken}` } : {}),
        },
    }), [staffToken]);

    const [event, setEvent] = useState<any>(null);
    const [stats, setStats] = useState<any>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [scanning, setScanning] = useState(false);
    const [soundOn, setSoundOn] = useState(true);
    const [lastResult, setLastResult] = useState<any>(null);
    const [manualToken, setManualToken] = useState("");
    const [pendingValidate, setPendingValidate] = useState(false);
    const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>("");

    const html5QrRef = useRef<Html5Qrcode | null>(null);
    const lastScanRef = useRef<{ token: string | null; at: number }>({ token: null, at: 0 });

    // Guard: if no session, redirect to login
    useEffect(() => {
        if (!staffToken || !eventId) {
            navigate("/staff/login", { replace: true });
        }
    }, [staffToken, eventId, navigate]);

    // Enumerate available cameras on mount
    useEffect(() => {
        Html5Qrcode.getCameras()
            .then((devices) => {
                if (devices.length < 2) return; // 0 or 1 → no selector needed
                setCameras(devices);
                // Default to rear/environment camera if one is labelled as such
                const rear = devices.find((d) => /back|rear|trasera|environment/i.test(d.label));
                setSelectedCameraId((rear ?? devices[0]).id);
            })
            .catch(() => {
                // Permission denied or no MediaDevices API — fall back to facingMode:"environment"
            });
    }, []);

    const refreshStats = useCallback(async () => {
        if (!eventId) return;
        try {
            const r = await staffApi.get(`/events/me/${eventId}/scan-stats`);
            setStats(r.data);
        } catch (e) {
            console.debug("[staff-scanner] refreshStats failed:", (e as any)?.message || e);
        }
    }, [eventId, staffApi]);

    // Load event info via staff endpoint
    useEffect(() => {
        if (!eventId || !staffToken) return;
        let cancelled = false;
        (async () => {
            try {
                const r = await staffApi.get("/staff/me/events");
                if (!cancelled) {
                    const found = (r.data as any[]).find((e) => e.id === eventId);
                    setEvent(found || null);
                    if (!found) toast.error("Evento no encontrado en tus asignaciones.");
                    else refreshStats();
                }
            } catch {
                if (!cancelled) toast.error("No pudimos cargar el evento.");
            }
        })();
        return () => { cancelled = true; };
    }, [eventId, staffToken, staffApi, refreshStats]);

    const validateToken = useCallback(async (qrToken: string) => {
        if (pendingValidate) return;
        const now = Date.now();
        if (lastScanRef.current.token === qrToken
            && now - lastScanRef.current.at < SCAN_COOLDOWN_MS) {
            return;
        }
        lastScanRef.current = { token: qrToken, at: now };
        setPendingValidate(true);
        try {
            const r = await staffApi.post("/tickets/validate", { qr_token: qrToken });
            const data = r.data;
            let kind = "invalid";
            if (data.valid) kind = "valid";
            else if (data.reason === "already_used") kind = "already_used";
            else if (data.reason === "revoked") kind = "revoked";

            setLastResult({ kind, ...data });
            setHistory((prev) => [
                {
                    id: `${now}`,
                    at: new Date().toISOString(),
                    kind,
                    holder_name: (data.ticket?.holder || data.holder)?.name,
                    seat_label: data.ticket?.seat_label,
                    reason: data.reason,
                },
                ...prev,
            ].slice(0, 50));
            if (soundOn) playBeep(kind);
            if (kind === "valid") refreshStats();
        } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message;
            setLastResult({ kind: "invalid", reason: msg || "network_error", network: true });
            if (soundOn) playBeep("invalid");
        } finally {
            setPendingValidate(false);
        }
    }, [pendingValidate, soundOn, staffApi, refreshStats]);

    const startScanner = async () => {
        try {
            const inst = new Html5Qrcode(QR_REGION_ID, { verbose: false });
            html5QrRef.current = inst;
            // Use the selected deviceId when available; fall back to rear-facing constraint.
            const cameraConstraint: string | { facingMode: string } =
                selectedCameraId || { facingMode: "environment" };
            await inst.start(
                cameraConstraint,
                { fps: 12, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
                (decodedText) => validateToken(decodedText.trim()),
                () => {},
            );
            setScanning(true);
        } catch (e: any) {
            // AbortError fires when the browser aborts video.play() mid-init
            // (StrictMode double-mount, or the user moved away instantly). Harmless.
            if (e?.name === "AbortError" || e?.message?.includes("play()")) return;
            toast.error("No pudimos abrir la cámara: " + (e?.message || e));
        }
    };

    const stopScanner = async () => {
        const inst = html5QrRef.current;
        html5QrRef.current = null;
        if (inst) {
            try {
                await inst.stop();
                await inst.clear();
            } catch (e: any) {
                // html5-qrcode throws "scanner not running" / AbortError on double-stop — safe to ignore.
                console.debug("[staff-scanner] stopScanner cleanup:", e?.message || e);
            }
        }
        setScanning(false);
    };

    // Null out the ref before the async cleanup so any in-flight callbacks
    // from the scanner don't call validateToken after unmount.
    useEffect(() => () => { void stopScanner(); }, []);

    const handleLogout = () => {
        stopScanner();
        sessionStorage.removeItem("tys_staff_token");
        sessionStorage.removeItem("tys_staff_event_id");
        navigate("/staff/login", { replace: true });
    };

    if (!staffToken || !eventId) return null; // redirecting

    if (!event) {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground bg-slate-50">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando evento…
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
                {/* Header */}
                <header className="bg-white sticky top-0 z-20 -mx-4 px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-base font-semibold truncate">{event.title}</h1>
                        <p className="text-xs text-muted-foreground truncate">
                            {event.venue_name
                                ? `${event.venue_name} · `
                                : ""}
                            {new Date(event.starts_at).toLocaleString("es-EC")}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                            <Users className="h-3 w-3 mr-1" />
                            {stats?.scanned_count ?? 0} de {stats?.total_tickets ?? "?"} escaneados
                        </Badge>
                        <Button
                            variant="ghost" size="icon"
                            onClick={() => setSoundOn((s) => !s)}
                            title={soundOn ? "Silenciar" : "Activar sonido"}
                        >
                            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                        </Button>
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="sm">Historial</Button>
                            </SheetTrigger>
                            <SheetContent className="w-full max-w-md overflow-y-auto">
                                <SheetHeader>
                                    <SheetTitle>Últimos escaneos</SheetTitle>
                                </SheetHeader>
                                {history.length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic mt-4">
                                        Todavía no hay escaneos en esta sesión.
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5 mt-4">
                                        {history.map((h) => (
                                            <li key={h.id}
                                                className={`text-xs flex items-center gap-2 border-l-4 px-2 py-1 ${
                                                    h.kind === "valid" ? "border-emerald-500 bg-emerald-50"
                                                    : h.kind === "already_used" ? "border-amber-500 bg-amber-50"
                                                    : "border-red-500 bg-red-50"
                                                }`}>
                                                <span className="font-mono">{fmtTime(h.at)}</span>
                                                <span className="font-medium truncate flex-1">{h.holder_name || "—"}</span>
                                                {h.seat_label && <span className="text-muted-foreground">{h.seat_label}</span>}
                                                <Badge variant="outline" className="text-[10px]">
                                                    {h.kind === "valid" ? "OK" : h.kind === "already_used" ? "USADO" : "RECH"}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </SheetContent>
                        </Sheet>
                    </div>
                </header>

                {/* Stats strip */}
                {stats && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <StatBox label="Escaneados" value={stats.scanned_count} />
                        <StatBox label="Válidos" value={stats.valid_count} />
                        <StatBox label="Rechazados" value={stats.rejected_count} accent="red" />
                        <StatBox label="Ritmo (10min)" value={`${stats.scan_rate_per_minute}/min`} />
                    </div>
                )}

                {/* Camera card */}
                <Card>
                    <CardContent className="p-4 flex flex-col items-center gap-3">
                        {/* html5-qrcode injects <video>/<canvas> directly into this div.
                            React must NEVER render children inside it or removeChild will
                            crash when the virtual DOM diverges from the real DOM.
                            The placeholder is a sibling overlay instead. */}
                        <div className="relative w-full max-w-md" style={{ minHeight: 320 }}>
                            <div
                                id={QR_REGION_ID}
                                className="w-full aspect-square bg-slate-900 rounded-xl overflow-hidden"
                                style={{ minHeight: 320 }}
                            />
                            {!scanning && (
                                <div className="absolute inset-0 flex items-center justify-center text-white text-center p-6 pointer-events-none rounded-xl">
                                    <div>
                                        <Camera className="h-10 w-10 mx-auto mb-2 opacity-70" />
                                        <p className="text-sm opacity-90">Pulsá "Iniciar cámara" para empezar</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        {/* Camera selector — only shown when multiple cameras are available */}
                        {cameras.length > 1 && (
                            <div className="w-full max-w-md">
                                <Select
                                    value={selectedCameraId}
                                    onValueChange={setSelectedCameraId}
                                    disabled={scanning}
                                >
                                    <SelectTrigger className="h-9">
                                        <SwitchCamera className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
                                        <SelectValue placeholder="Seleccionar cámara" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {cameras.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.label || `Cámara ${c.id.slice(-4)}`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="flex gap-2 w-full max-w-md">
                            {!scanning ? (
                                <Button onClick={startScanner} className="flex-1">
                                    <Camera className="h-4 w-4 mr-1.5" /> Iniciar cámara
                                </Button>
                            ) : (
                                <Button onClick={stopScanner} variant="outline" className="flex-1">
                                    <CameraOff className="h-4 w-4 mr-1.5" /> Parar cámara
                                </Button>
                            )}
                        </div>

                        {/* Manual fallback */}
                        <div className="w-full max-w-md space-y-2 pt-2 border-t mt-2">
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <ClipboardPaste className="h-3.5 w-3.5" />
                                Si la cámara no funciona, pegá el JWT del QR:
                            </p>
                            <div className="flex gap-2">
                                <Input
                                    value={manualToken}
                                    onChange={(e) => setManualToken(e.target.value)}
                                    placeholder="eyJ..."
                                    className="h-9 font-mono text-xs"
                                />
                                <Button
                                    onClick={() => {
                                        if (manualToken.trim()) {
                                            validateToken(manualToken.trim());
                                            setManualToken("");
                                        }
                                    }}
                                    disabled={!manualToken.trim() || pendingValidate}
                                >
                                    Validar
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Logout */}
                <div className="flex justify-center pb-6">
                    <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground">
                        <LogOut className="h-3.5 w-3.5 mr-1.5" />
                        Cerrar sesión de staff
                    </Button>
                </div>
            </div>

            {/* Result modal */}
            <Dialog open={!!lastResult} onOpenChange={(o) => !o && setLastResult(null)}>
                <DialogContent className="max-w-md">
                    {lastResult && <ResultBody result={lastResult} onClose={() => setLastResult(null)} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}
