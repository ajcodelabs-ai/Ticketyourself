import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, AlertCircle, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

interface GuestListEntry {
    id: string;
    email?: string;
    cedula?: string;
    name?: string;
    used_at?: string | null;
}

interface Props {
    eventId: string | null;
}

const BLANK = { email: "", cedula: "", name: "" };

export default function GuestListPanel({ eventId }: Props) {
    const [entries, setEntries] = useState<GuestListEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState(BLANK);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const r = await api.get(`/events/me/${eventId}/guest-list`);
            setEntries(r.data || []);
        } catch {
            toast.error("No se pudo cargar la lista de invitados");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId]);

    const handleAdd = async () => {
        if (!eventId) return;
        if (!form.email.trim() && !form.cedula.trim()) {
            toast.error("Indicá email o cédula");
            return;
        }
        setSaving(true);
        try {
            await api.post(`/events/me/${eventId}/guest-list`, {
                email: form.email.trim() || null,
                cedula: form.cedula.trim() || null,
                name: form.name.trim() || null,
            });
            setForm(BLANK);
            toast.success("Invitado agregado");
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al agregar invitado");
        } finally {
            setSaving(false);
        }
    };

    const handleImport = async (file: File) => {
        if (!eventId) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("file", file);
        try {
            const { data } = await api.post(`/events/me/${eventId}/guest-list/import`, fd);
            toast.success(`Importados ${data.inserted} · omitidos ${data.skipped}`);
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al importar el CSV");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const handleDelete = async (entry: GuestListEntry) => {
        if (!eventId) return;
        if (!confirm(`¿Eliminar a ${entry.name || entry.email || entry.cedula} de la lista?`)) return;
        setDeleting(entry.id);
        try {
            await api.delete(`/events/me/${eventId}/guest-list/${entry.id}`);
            toast.success("Invitado eliminado");
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al eliminar");
        } finally {
            setDeleting(null);
        }
    };

    if (!eventId) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground p-4 rounded-xl border">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                    Guarda primero la información general del evento para gestionar la lista de invitados.
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-4 rounded-xl border p-4" data-testid="guest-list-panel">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="font-medium text-sm flex items-center gap-1.5">
                        <Users className="h-4 w-4" /> Lista de invitados
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Solo quienes estén en esta lista (por email o cédula) podrán comprar.
                    </p>
                </div>
                <div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
                        data-testid="guest-list-csv-input"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                        data-testid="guest-list-import-btn"
                    >
                        {uploading ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                            <Upload className="h-4 w-4 mr-1.5" />
                        )}
                        Importar CSV
                    </Button>
                </div>
            </div>

            <div className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Input
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    data-testid="guest-list-email-input"
                />
                <Input
                    placeholder="Cédula"
                    value={form.cedula}
                    onChange={(e) => setForm((f) => ({ ...f, cedula: e.target.value }))}
                    data-testid="guest-list-cedula-input"
                />
                <Input
                    placeholder="Nombre (opcional)"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    data-testid="guest-list-name-input"
                />
                <Button size="sm" onClick={handleAdd} disabled={saving} data-testid="guest-list-add-btn">
                    <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                El CSV debe tener una columna <code>email</code> y/o <code>cedula</code> (opcional: <code>name</code>).
            </p>

            {loading ? (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : entries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Todavía no hay invitados en la lista.
                </div>
            ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {entries.map((e) => (
                        <div
                            key={e.id}
                            className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                        >
                            <div className="min-w-0">
                                <div className="font-medium truncate">
                                    {e.name || e.email || e.cedula}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                    {[e.email, e.cedula].filter(Boolean).join(" · ")}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {e.used_at && (
                                    <Badge variant="secondary" className="text-xs">Ya compró</Badge>
                                )}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={deleting === e.id}
                                    onClick={() => handleDelete(e)}
                                    data-testid={`guest-list-delete-${e.id}`}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
