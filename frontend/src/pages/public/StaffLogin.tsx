/**
 * /staff/login — staff member login page (Phase 8).
 *
 * Staff have separate credentials from organizers.
 * After login, if staff has multiple assigned events, an event selector appears.
 * The selected event_id is stored in sessionStorage for the scanning session.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, ScanLine, CalendarRange, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api, { formatApiError } from "@/lib/api";

const STAFF_TOKEN_KEY = "tys_staff_token";
const STAFF_EVENT_KEY = "tys_staff_event_id";

interface EventOption {
    id: string;
    title: string;
    starts_at?: string;
    venue_name?: string;
}

function fmtDate(iso?: string): string {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleDateString("es", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    } catch {
        return iso;
    }
}

export default function StaffLogin() {
    const navigate = useNavigate();
    const [step, setStep] = useState<"login" | "select_event">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [staffToken, setStaffToken] = useState("");
    const [assignedEvents, setAssignedEvents] = useState<EventOption[]>([]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password) {
            toast.error("Ingresa tu email y contraseña");
            return;
        }
        setSubmitting(true);
        try {
            const { data } = await api.post("/auth/staff-login", {
                email: email.trim().toLowerCase(),
                password,
            });
            setStaffToken(data.access_token);
            sessionStorage.setItem(STAFF_TOKEN_KEY, data.access_token);

            if (!data.event_ids?.length) {
                toast.error("No tienes eventos asignados. Contacta al organizador.");
                return;
            }

            // Fetch the assigned events to display them for selection
            const evRes = await api.get("/staff/me/events", {
                headers: { Authorization: `Bearer ${data.access_token}` },
            });
            const events: EventOption[] = evRes.data || [];

            if (events.length === 1) {
                // Only one event — auto-select it
                sessionStorage.setItem(STAFF_EVENT_KEY, events[0].id);
                toast.success(`Bienvenido. Evento: ${events[0].title}`);
                navigate("/staff/scanner");
                return;
            }

            setAssignedEvents(events);
            setStep("select_event");
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || "Credenciales incorrectas");
        } finally {
            setSubmitting(false);
        }
    };

    const handleSelectEvent = (event: EventOption) => {
        sessionStorage.setItem(STAFF_EVENT_KEY, event.id);
        sessionStorage.setItem(STAFF_TOKEN_KEY, staffToken);
        toast.success(`Evento seleccionado: ${event.title}`);
        navigate("/staff/scanner");
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-6">
            <div className="w-full max-w-sm space-y-6">
                {/* Logo / brand */}
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-primary-foreground mx-auto">
                        <ScanLine className="h-6 w-6" />
                    </div>
                    <h1 className="text-2xl font-bold">Staff · TYS</h1>
                    <p className="text-sm text-muted-foreground">
                        Acceso exclusivo para el equipo del evento
                    </p>
                </div>

                {step === "login" ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Inicia sesión</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleLogin} className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="tu@email.com"
                                        autoComplete="email"
                                        data-testid="staff-login-email"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="password">Contraseña</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        data-testid="staff-login-password"
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={submitting}
                                    data-testid="staff-login-submit"
                                >
                                    {submitting ? (
                                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                    ) : (
                                        <ScanLine className="h-4 w-4 mr-1.5" />
                                    )}
                                    Entrar
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <CalendarRange className="h-5 w-5" />
                                Selecciona el evento
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {assignedEvents.map((ev) => (
                                <button
                                    key={ev.id}
                                    type="button"
                                    onClick={() => handleSelectEvent(ev)}
                                    className="w-full text-left rounded-lg border p-3 hover:bg-secondary/50 transition flex items-center gap-3"
                                    data-testid={`select-event-${ev.id}`}
                                >
                                    <CheckCircle2 className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                                    <div>
                                        <p className="font-medium text-sm">{ev.title}</p>
                                        {ev.starts_at && (
                                            <p className="text-xs text-muted-foreground">
                                                {fmtDate(ev.starts_at)}
                                                {ev.venue_name ? ` · ${ev.venue_name}` : ""}
                                            </p>
                                        )}
                                    </div>
                                </button>
                            ))}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full mt-2"
                                onClick={() => {
                                    setStep("login");
                                    sessionStorage.removeItem(STAFF_TOKEN_KEY);
                                }}
                            >
                                Volver
                            </Button>
                        </CardContent>
                    </Card>
                )}

                <p className="text-center text-xs text-muted-foreground">
                    ¿Eres organizador?{" "}
                    <a href="/login" className="underline">
                        Inicia sesión aquí
                    </a>
                </p>
            </div>
        </div>
    );
}
