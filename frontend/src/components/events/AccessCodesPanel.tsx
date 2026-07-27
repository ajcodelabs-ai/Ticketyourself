import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, AlertCircle, KeyRound, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import api from "@/lib/api";

interface AccessCode {
    id: string;
    code: string;
    max_uses: number | null;
    uses_count: number;
    max_tickets_per_redemption: number | null;
    active: boolean;
}

interface Props {
    eventId: string | null;
    /** When true, omit outer card chrome (parent already provides it). */
    embedded?: boolean;
}

export default function AccessCodesPanel({ eventId, embedded = false }: Props) {
    const [codes, setCodes] = useState<AccessCode[]>([]);
    const [loading, setLoading] = useState(false);
    const [customCode, setCustomCode] = useState("");
    const [singleUse, setSingleUse] = useState(true);
    const [maxUses, setMaxUses] = useState("10");
    const [maxTicketsPerRedemption, setMaxTicketsPerRedemption] = useState("");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const load = async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const r = await api.get(`/events/me/${eventId}/access-codes`);
            setCodes(r.data || []);
        } catch {
            toast.error("No se pudieron cargar los códigos de acceso");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId]);

    const handleCreate = async () => {
        if (!eventId) return;
        setSaving(true);
        try {
            await api.post(`/events/me/${eventId}/access-codes`, {
                code: customCode.trim() || null,
                max_uses: singleUse ? 1 : Number(maxUses) || 1,
                max_tickets_per_redemption: maxTicketsPerRedemption
                    ? Number(maxTicketsPerRedemption) || null
                    : null,
                active: true,
            });
            setCustomCode("");
            setMaxTicketsPerRedemption("");
            toast.success("Código creado");
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al crear el código");
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (code: AccessCode) => {
        try {
            await api.put(`/events/me/${eventId}/access-codes/${code.id}`, {
                active: !code.active,
            });
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al actualizar");
        }
    };

    const handleDelete = async (code: AccessCode) => {
        if (!confirm(`¿Eliminar el código "${code.code}"?`)) return;
        setDeleting(code.id);
        try {
            await api.delete(`/events/me/${eventId}/access-codes/${code.id}`);
            toast.success("Código eliminado");
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al eliminar");
        } finally {
            setDeleting(null);
        }
    };

    const copyCode = (code: string) => {
        navigator.clipboard?.writeText(code);
        toast.success("Código copiado");
    };

    if (!eventId) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground p-4 rounded-xl border border-dashed">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                    Guardá primero la información general del evento para gestionar códigos de acceso.
                </span>
            </div>
        );
    }

    return (
        <div
            className={embedded ? "space-y-4" : "space-y-4 rounded-xl border p-4"}
            data-testid="access-codes-panel"
        >
            {!embedded && (
                <div>
                    <h4 className="font-medium text-sm flex items-center gap-1.5">
                        <KeyRound className="h-4 w-4" /> Códigos de acceso
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        El comprador debe ingresar uno de estos códigos para poder comprar.
                    </p>
                </div>
            )}
            {embedded && (
                <p className="text-xs text-muted-foreground">
                    El comprador debe ingresar uno de estos códigos para poder comprar.
                </p>
            )}

            <div className="grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-end">
                <Input
                    placeholder="Código (vacío = autogenerar)"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    data-testid="access-code-input"
                />
                <div className="flex items-center gap-2 text-sm whitespace-nowrap px-2">
                    <Switch
                        checked={!singleUse}
                        onCheckedChange={(v) => setSingleUse(!v)}
                        data-testid="access-code-multiuse-switch"
                    />
                    Multiuso
                </div>
                {!singleUse && (
                    <Input
                        type="number"
                        min="1"
                        className="w-20"
                        title="Máx. usos"
                        value={maxUses}
                        onChange={(e) => setMaxUses(e.target.value)}
                        data-testid="access-code-max-uses-input"
                    />
                )}
                <Input
                    type="number"
                    min="1"
                    className="w-24"
                    placeholder="Tickets/compra"
                    title="Máx. tickets por redención"
                    value={maxTicketsPerRedemption}
                    onChange={(e) => setMaxTicketsPerRedemption(e.target.value)}
                    data-testid="access-code-max-tickets-input"
                />
                <Button size="sm" onClick={handleCreate} disabled={saving} data-testid="access-code-create-btn">
                    <Plus className="h-4 w-4 mr-1" /> Nuevo
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : codes.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Todavía no hay códigos de acceso.
                </div>
            ) : (
                <div className="space-y-1.5">
                    {codes.map((c) => (
                        <div
                            key={c.id}
                            className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                        >
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <code className="font-mono font-semibold">{c.code}</code>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => copyCode(c.code)}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                                <Badge variant="secondary" className="text-xs">
                                    {c.uses_count} / {c.max_uses ?? "∞"} usos
                                </Badge>
                                {c.max_tickets_per_redemption != null && (
                                    <Badge variant="outline" className="text-xs">
                                        ≤ {c.max_tickets_per_redemption} tickets/compra
                                    </Badge>
                                )}
                                {!c.active && (
                                    <Badge variant="outline" className="text-xs">Inactivo</Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <Switch
                                    checked={c.active}
                                    onCheckedChange={() => handleToggleActive(c)}
                                    data-testid={`access-code-active-${c.id}`}
                                />
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={deleting === c.id}
                                    onClick={() => handleDelete(c)}
                                    data-testid={`access-code-delete-${c.id}`}
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
