/**
 * /app/staff — organizer staff management (Phase 8).
 *
 * CRUD for staff members. Staff log in at /staff/login with their own credentials
 * and can only see events assigned to them.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Plus,
    Pencil,
    Trash2,
    Loader2,
    Users,
    CheckCircle2,
    XCircle,
    Eye,
    EyeOff,
    ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Card,
    CardContent,
    CardHeader,
} from "@/components/ui/card";
import api, { formatApiError } from "@/lib/api";

const ROLE_META: Record<string, { label: string; color: string }> = {
    scanner: { label: "Escáner", color: "secondary" },
    cajero: { label: "Cajero", color: "secondary" },
    admin_evento: { label: "Admin evento", color: "default" },
};

interface StaffMember {
    id: string;
    name: string;
    email: string;
    roles: string[];
    active: boolean;
    event_ids: string[];
    last_login?: string;
    created_at?: string;
}

interface EventOption {
    id: string;
    title: string;
    starts_at?: string;
}

const ALL_ROLES = ["scanner", "cajero", "admin_evento"];

const BLANK_FORM = {
    name: "",
    email: "",
    password: "",
    roles: [] as string[],
    event_ids: [] as string[],
    active: true,
};

export default function Staff() {
    const [members, setMembers] = useState<StaffMember[]>([]);
    const [events, setEvents] = useState<EventOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<StaffMember | null>(null);
    const [form, setForm] = useState({ ...BLANK_FORM });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [staffRes, eventsRes] = await Promise.all([
                api.get("/staff"),
                api.get("/events/me?status=published&limit=100"),
            ]);
            setMembers(staffRes.data || []);
            setEvents(eventsRes.data?.items || eventsRes.data || []);
        } catch {
            toast.error("No se pudo cargar el staff");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const upd = (key: string, val: unknown) =>
        setForm((prev) => ({ ...prev, [key]: val }));

    const toggleRole = (role: string) => {
        setForm((prev) => ({
            ...prev,
            roles: prev.roles.includes(role)
                ? prev.roles.filter((r) => r !== role)
                : [...prev.roles, role],
        }));
    };

    const toggleEvent = (id: string) => {
        setForm((prev) => ({
            ...prev,
            event_ids: prev.event_ids.includes(id)
                ? prev.event_ids.filter((e) => e !== id)
                : [...prev.event_ids, id],
        }));
    };

    const openCreate = () => {
        setEditing(null);
        setForm({ ...BLANK_FORM });
        setShowPassword(false);
        setOpen(true);
    };

    const openEdit = (m: StaffMember) => {
        setEditing(m);
        setForm({
            name: m.name,
            email: m.email,
            password: "",
            roles: [...(m.roles || [])],
            event_ids: [...(m.event_ids || [])],
            active: m.active,
        });
        setShowPassword(false);
        setOpen(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error("El nombre es requerido"); return; }
        if (!form.email.trim()) { toast.error("El email es requerido"); return; }
        if (!editing && !form.password) { toast.error("La contraseña es requerida"); return; }
        if (form.password && form.password.length < 6) {
            toast.error("La contraseña debe tener al menos 6 caracteres");
            return;
        }
        if (form.roles.length === 0) { toast.error("Asignale al menos un rol"); return; }

        setSaving(true);
        try {
            const payload: any = {
                name: form.name.trim(),
                roles: form.roles,
                event_ids: form.event_ids,
                active: form.active,
            };
            if (editing) {
                if (form.password) payload.new_password = form.password;
                await api.put(`/staff/${editing.id}`, payload);
                toast.success("Staff actualizado");
            } else {
                payload.email = form.email.trim().toLowerCase();
                payload.password = form.password;
                await api.post("/staff", payload);
                toast.success("Staff creado");
            }
            setOpen(false);
            await load();
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || "Error al guardar");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (m: StaffMember) => {
        if (!confirm(`¿Eliminar a ${m.name}? Esta acción no se puede deshacer.`)) return;
        setDeleting(m.id);
        try {
            await api.delete(`/staff/${m.id}`);
            toast.success("Staff eliminado");
            await load();
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || "Error al eliminar");
        } finally {
            setDeleting(null);
        }
    };

    const handleToggleActive = async (m: StaffMember) => {
        try {
            await api.put(`/staff/${m.id}`, { active: !m.active });
            toast.success(m.active ? "Staff desactivado" : "Staff activado");
            await load();
        } catch {
            toast.error("No se pudo actualizar");
        }
    };

    return (
        <div className="space-y-5" data-testid="staff-page">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Staff</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Gestiona escáneres, cajeros y admins de evento.
                    </p>
                </div>
                <Button onClick={openCreate} data-testid="add-staff">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Agregar staff
                </Button>
            </div>

            {/* Login info */}
            <Card className="border-blue-100 bg-blue-50/50">
                <CardContent className="p-4 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-blue-900">Acceso del staff</p>
                        <p className="text-blue-700 text-xs mt-0.5">
                            El staff inicia sesión en{" "}
                            <code className="bg-white/70 rounded px-1">/staff/login</code> con su
                            email y contraseña. Solo ven los eventos que les asignes.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : members.length === 0 ? (
                <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Aún no tienes staff registrado</p>
                    <p className="text-sm mt-1">
                        Agrega escáneres, cajeros y admins para tus eventos.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {members.map((m) => (
                        <StaffRow
                            key={m.id}
                            member={m}
                            events={events}
                            onEdit={() => openEdit(m)}
                            onDelete={() => handleDelete(m)}
                            onToggleActive={() => handleToggleActive(m)}
                            deleting={deleting === m.id}
                        />
                    ))}
                </div>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? `Editar: ${editing.name}` : "Nuevo miembro de staff"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>Nombre completo *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => upd("name", e.target.value)}
                                placeholder="Ana García"
                                data-testid="staff-name"
                            />
                        </div>

                        {!editing && (
                            <div className="space-y-1.5">
                                <Label>Email *</Label>
                                <Input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => upd("email", e.target.value)}
                                    placeholder="ana@tuempresa.com"
                                    data-testid="staff-email"
                                />
                            </div>
                        )}

                        {/* Password field — required on create, optional on edit */}
                        <div className="space-y-1.5">
                            <Label>
                                {editing ? "Nueva contraseña" : "Contraseña *"}
                            </Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={form.password}
                                    onChange={(e) => upd("password", e.target.value)}
                                    placeholder={
                                        editing
                                            ? "Dejar vacío para no cambiarla"
                                            : "Mínimo 6 caracteres"
                                    }
                                    data-testid="staff-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((p) => !p)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                            {editing && (
                                <p className="text-xs text-muted-foreground">
                                    Solo se actualiza si ingresas una nueva contraseña.
                                </p>
                            )}
                        </div>

                        {/* Roles */}
                        <div className="space-y-2">
                            <Label>Roles *</Label>
                            <div className="flex flex-wrap gap-2">
                                {ALL_ROLES.map((role) => {
                                    const meta = ROLE_META[role];
                                    const selected = form.roles.includes(role);
                                    return (
                                        <button
                                            key={role}
                                            type="button"
                                            onClick={() => toggleRole(role)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                                                selected
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "border-border hover:bg-secondary"
                                            }`}
                                            data-testid={`role-${role}`}
                                        >
                                            {meta.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Puedes asignar más de un rol a la vez.
                            </p>
                        </div>

                        {/* Event assignments */}
                        {events.length > 0 && (
                            <div className="space-y-2">
                                <Label>Eventos asignados</Label>
                                <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border p-2">
                                    {events.map((ev) => (
                                        <label
                                            key={ev.id}
                                            className="flex items-center gap-2 p-2 rounded-md hover:bg-secondary/50 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={form.event_ids.includes(ev.id)}
                                                onChange={() => toggleEvent(ev.id)}
                                                className="rounded"
                                                data-testid={`ev-check-${ev.id}`}
                                            />
                                            <span className="text-sm">{ev.title}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Active toggle (edit only) */}
                        {editing && (
                            <div className="flex items-center justify-between p-3 rounded-lg border">
                                <div>
                                    <div className="text-sm font-medium">Cuenta activa</div>
                                    <div className="text-xs text-muted-foreground">
                                        Desactivar impide el login sin borrar el staff
                                    </div>
                                </div>
                                <Switch
                                    checked={form.active}
                                    onCheckedChange={(v) => upd("active", v)}
                                    data-testid="staff-active"
                                />
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={saving} data-testid="staff-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Guardar cambios" : "Crear staff"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StaffRow({
    member,
    events,
    onEdit,
    onDelete,
    onToggleActive,
    deleting,
}: {
    member: StaffMember;
    events: EventOption[];
    onEdit: () => void;
    onDelete: () => void;
    onToggleActive: () => void;
    deleting: boolean;
}) {
    const assignedEvents = events.filter((e) => member.event_ids?.includes(e.id));

    return (
        <Card className={!member.active ? "opacity-60" : ""}>
            <CardContent className="p-4 flex items-start gap-4">
                {/* Avatar initial */}
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-lg shrink-0">
                    {member.name.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{member.name}</span>
                        {!member.active && (
                            <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">{member.email}</p>

                    {/* Roles */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {(member.roles || []).map((r) => (
                            <Badge key={r} variant="outline" className="text-xs">
                                {ROLE_META[r]?.label || r}
                            </Badge>
                        ))}
                    </div>

                    {/* Assigned events */}
                    {assignedEvents.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                            Eventos:{" "}
                            {assignedEvents.map((e) => e.title).join(", ")}
                        </p>
                    )}
                    {assignedEvents.length === 0 && (
                        <p className="text-xs text-muted-foreground/60 mt-1.5 italic">
                            Sin eventos asignados
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={onToggleActive}
                        title={member.active ? "Desactivar" : "Activar"}
                        data-testid={`staff-toggle-${member.id}`}
                    >
                        {member.active ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={onEdit}
                        data-testid={`staff-edit-${member.id}`}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={onDelete}
                        disabled={deleting}
                        data-testid={`staff-delete-${member.id}`}
                    >
                        {deleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
