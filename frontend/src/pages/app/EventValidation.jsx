/**
 * /app/eventos/:id/validacion — Phase 9 QR scanner & door validation.
 *
 * Uses html5-qrcode for camera capture. Each scan POSTs to /api/tickets/validate
 * which returns {valid, ticket, holder, reason?, used_at?}.
 * UI is optimized for mobile portrait (door staff use cases).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
    ArrowLeft, Camera, CameraOff, Volume2, VolumeX, ClipboardPaste, Download,
    CheckCircle2, AlertTriangle, XCircle, Loader2, Users,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import api from "@/lib/api";

const QR_REGION_ID = "qr-reader-region";
const SCAN_COOLDOWN_MS = 1500; // ignore the same JWT for 1.5s after a scan

// ── Audio helpers (Web Audio API) ────────────────────────────────────────
function playBeep(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
        // AudioContext can throw when no user gesture has happened yet on
        // Safari/iOS. We don't want to alert the staff for a missing beep —
        // log to dev console only.
        console.debug("[validation] playBeep skipped:", e?.message || e);
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

export default function EventValidation() {
    const { id: eventId } = useParams();
    const [event, setEvent] = useState(null);
    const [stats, setStats] = useState(null);
    const [history, setHistory] = useState([]); // session-local last 50
    const [scanning, setScanning] = useState(false);
    const [soundOn, setSoundOn] = useState(true);
    const [lastResult, setLastResult] = useState(null); // {kind, ticket, reason, ...}
    const [manualToken, setManualToken] = useState("");
    const [pendingValidate, setPendingValidate] = useState(false);

    const html5QrRef = useRef(null);
    const lastScanRef = useRef({ token: null, at: 0 });

    // Load event header info + stats
    const refreshStats = useCallback(async () => {
        try {
            const r = await api.get(`/events/me/${eventId}/scan-stats`);
            setStats(r.data);
        } catch (e) {
            // Stats are non-critical for the scanner UX; surface only to dev console.
            console.debug("[validation] refreshStats failed:", e?.message || e);
        }
    }, [eventId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await api.get(`/events/me/${eventId}`);
                if (!cancelled) setEvent(r.data);
                refreshStats();
            } catch {
                toast.error("No pudimos cargar el evento.");
            }
        })();
        return () => { cancelled = true; };
    }, [eventId, refreshStats]);

    // Validate a JWT token against the backend
    const validateToken = useCallback(async (qrToken) => {
        if (pendingValidate) return;
        const now = Date.now();
        if (lastScanRef.current.token === qrToken
            && now - lastScanRef.current.at < SCAN_COOLDOWN_MS) {
            return;
        }
        lastScanRef.current = { token: qrToken, at: now };
        setPendingValidate(true);
        try {
            const r = await api.post("/tickets/validate", { qr_token: qrToken });
            const data = r.data;
            let kind = "invalid";
            if (data.valid) kind = "valid";
            else if (data.reason === "already_used") kind = "already_used";
            else if (data.reason === "revoked") kind = "revoked";
            else kind = "invalid";

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
            playBeep(soundOn ? kind : null);
            if (kind === "valid") refreshStats();
        } catch (e) {
            // Network / unauthorized → soft warning
            const msg = e?.response?.data?.detail || e?.message;
            setLastResult({ kind: "invalid", reason: msg || "network_error", network: true });
            playBeep(soundOn ? "invalid" : null);
        } finally {
            setPendingValidate(false);
        }
    }, [pendingValidate, soundOn, refreshStats]);

    // Start / stop camera scanner
    const startScanner = async () => {
        try {
            const inst = new Html5Qrcode(QR_REGION_ID, { verbose: false });
            html5QrRef.current = inst;
            await inst.start(
                { facingMode: "environment" },
                {
                    fps: 12,
                    qrbox: { width: 260, height: 260 },
                    aspectRatio: 1.0,
                },
                (decodedText) => validateToken(decodedText.trim()),
                () => { /* per-frame errors are noisy; ignore */ },
            );
            setScanning(true);
        } catch (e) {
            toast.error("No pudimos abrir la cámara: " + (e?.message || e));
        }
    };
    const stopScanner = async () => {
        const inst = html5QrRef.current;
        if (inst) {
            try {
                await inst.stop();
                await inst.clear();
            } catch (e) {
                // html5-qrcode throws "scanner not running" if stopped twice
                // (e.g. unmount race). Log to dev console without alerting.
                console.debug("[validation] stopScanner cleanup:", e?.message || e);
            }
        }
        html5QrRef.current = null;
        setScanning(false);
    };
    useEffect(() => () => { stopScanner(); /* unmount cleanup */ }, []);

    const downloadCsv = async () => {
        try {
            const r = await api.get(`/events/me/${eventId}/scan-log.csv`, {
                responseType: "blob",
            });
            const url = URL.createObjectURL(r.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = `scan-log-${eventId}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            toast.error("No pudimos descargar el CSV.");
        }
    };

    if (!event) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="event-validation-page">
            {/* Sticky header */}
            <header className="bg-white sticky top-0 z-20 -mx-4 px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                    <Button asChild variant="ghost" size="icon">
                        <Link to={`/app/eventos/${eventId}`} aria-label="Salir">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div className="min-w-0">
                        <h1 className="text-base font-semibold truncate">{event.title}</h1>
                        <p className="text-xs text-muted-foreground truncate">
                            {event.venue_name} · {new Date(event.starts_at).toLocaleString("es-EC")}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" data-testid="scan-counter">
                        <Users className="h-3 w-3 mr-1" />
                        {stats?.scanned_count ?? 0} de {stats?.total_tickets ?? "?"} escaneados
                    </Badge>
                    <Button
                        variant="ghost" size="icon"
                        onClick={() => setSoundOn((s) => !s)}
                        title={soundOn ? "Silenciar" : "Activar sonido"}
                        data-testid="toggle-sound"
                    >
                        {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    </Button>
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm" data-testid="history-toggle">
                                Historial
                            </Button>
                        </SheetTrigger>
                        <SheetContent className="w-full max-w-md overflow-y-auto">
                            <SheetHeader>
                                <SheetTitle>Últimos escaneos</SheetTitle>
                            </SheetHeader>
                            <div className="mt-4 space-y-2 mb-4">
                                <Button onClick={downloadCsv} variant="outline" size="sm" className="w-full"
                                        data-testid="history-csv">
                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                    Exportar CSV completo
                                </Button>
                            </div>
                            {history.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic">
                                    Todavía no hay escaneos en esta sesión.
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {history.map((h) => (
                                        <li key={h.id}
                                            className={`text-xs flex items-center gap-2 border-l-4 px-2 py-1 ${
                                                h.kind === "valid" ? "border-emerald-500 bg-emerald-50"
                                                : h.kind === "already_used" ? "border-amber-500 bg-amber-50"
                                                : "border-red-500 bg-red-50"
                                            }`}
                                            data-testid={`history-row-${h.id}`}>
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

            {/* Camera */}
            <Card>
                <CardContent className="p-4 flex flex-col items-center gap-3">
                    <div
                        id={QR_REGION_ID}
                        className="w-full max-w-md aspect-square bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center"
                        style={{ minHeight: 320 }}
                        data-testid="qr-reader-region"
                    >
                        {!scanning && (
                            <div className="text-white text-center p-6">
                                <Camera className="h-10 w-10 mx-auto mb-2 opacity-70" />
                                <p className="text-sm opacity-90">Pulsá "Iniciar cámara" para empezar</p>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2 w-full max-w-md">
                        {!scanning ? (
                            <Button onClick={startScanner} className="flex-1" data-testid="start-camera">
                                <Camera className="h-4 w-4 mr-1.5" /> Iniciar cámara
                            </Button>
                        ) : (
                            <Button onClick={stopScanner} variant="outline" className="flex-1"
                                    data-testid="stop-camera">
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
                                data-testid="manual-token-input"
                            />
                            <Button
                                onClick={() => {
                                    if (manualToken.trim()) {
                                        validateToken(manualToken.trim());
                                        setManualToken("");
                                    }
                                }}
                                disabled={!manualToken.trim() || pendingValidate}
                                data-testid="manual-validate-btn"
                            >
                                Validar
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats strip */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <StatBox label="Escaneados" value={stats.scanned_count} />
                    <StatBox label="Válidos" value={stats.valid_count} />
                    <StatBox label="Rechazados" value={stats.rejected_count} accent="red" />
                    <StatBox label="Ritmo (últimos 10min)" value={`${stats.scan_rate_per_minute}/min`} />
                </div>
            )}

            {/* Result modal */}
            <Dialog open={!!lastResult} onOpenChange={(o) => !o && setLastResult(null)}>
                <DialogContent className="max-w-md">
                    {lastResult && <ResultBody result={lastResult} onClose={() => setLastResult(null)} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StatBox({ label, value, accent }) {
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
    // Auto-dismiss after 3s
    useEffect(() => {
        const t = setTimeout(onClose, 3000);
        return () => clearTimeout(t);
    }, [onClose]);

    const headerByKind = {
        valid: {
            color: "bg-emerald-500 text-white",
            icon: <CheckCircle2 className="h-16 w-16" />,
            title: "VÁLIDO",
        },
        already_used: {
            color: "bg-amber-500 text-white",
            icon: <AlertTriangle className="h-16 w-16" />,
            title: "YA USADO",
        },
        revoked: {
            color: "bg-red-600 text-white",
            icon: <XCircle className="h-16 w-16" />,
            title: "REVOCADO",
        },
        invalid: {
            color: "bg-red-600 text-white",
            icon: <XCircle className="h-16 w-16" />,
            title: "INVÁLIDO",
        },
    }[result.kind];

    const t = result.ticket || {};
    const h = t.holder || result.holder || {};

    return (
        <>
            <DialogHeader className={`-m-6 mb-2 px-6 py-6 ${headerByKind.color}`}>
                <div className="flex flex-col items-center gap-2">
                    {headerByKind.icon}
                    <DialogTitle className="text-3xl font-extrabold">{headerByKind.title}</DialogTitle>
                </div>
            </DialogHeader>
            <div className="pt-3 space-y-2 text-center" data-testid={`result-${result.kind}`}>
                {h.name && <p className="text-lg font-semibold">{h.name}</p>}
                {h.email && <p className="text-xs text-muted-foreground">{h.email}</p>}
                {t.seat_label && (
                    <p className="text-base font-bold text-primary">🎫 {t.seat_label}</p>
                )}
                {result.kind === "already_used" && (
                    <p className="text-sm text-muted-foreground">
                        Usado el {fmtTime(result.used_at)}
                    </p>
                )}
                {result.kind === "invalid" && (
                    <p className="text-xs text-red-700">
                        {result.network
                            ? "Sin conexión — no pudimos verificar contra el servidor."
                            : (result.detail || result.reason || "Token no válido")}
                    </p>
                )}
                <Button onClick={onClose} variant="outline" size="sm" className="mt-2"
                        data-testid="result-close">
                    Cerrar (o esperar 3s)
                </Button>
            </div>
        </>
    );
}
