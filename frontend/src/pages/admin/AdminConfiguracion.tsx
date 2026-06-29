import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api, { formatApiError } from "@/lib/api";
import { Loader2, Plus } from "lucide-react";

const ORG_TYPES = [
    { value: "individual", label: "Individual" },
    { value: "company", label: "Empresa" },
];

export default function AdminConfiguracion() {
    const [docTypes, setDocTypes] = useState([]);
    const [required, setRequired] = useState({ individual: [], company: [] });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [requiredResp, typesResp] = await Promise.all([
                api.get("/admin/settings/required-documents"),
                api.get("/admin/settings/document-types"),
            ]);
            setRequired({
                individual: requiredResp.data.individual || [],
                company: requiredResp.data.company || [],
            });
            setDocTypes(typesResp.data || []);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggle = (orgType, docType) => {
        setRequired((prev) => {
            const current = prev[orgType];
            const next = current.includes(docType)
                ? current.filter((d) => d !== docType)
                : [...current, docType];
            return { ...prev, [orgType]: next };
        });
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await api.put("/admin/settings/required-documents", required);
            setRequired({ individual: data.individual || [], company: data.company || [] });
            toast.success("Configuración guardada");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSaving(false);
        }
    };

    const createDocType = async (e) => {
        e.preventDefault();
        if (newLabel.trim().length < 2) return;
        setCreating(true);
        try {
            await api.post("/admin/settings/document-types", { label: newLabel.trim() });
            setNewLabel("");
            toast.success("Tipo de documento creado");
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div data-testid="admin-configuracion-page" className="space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Admin · Configuración
                </Badge>
                <h1 className="text-3xl font-semibold tracking-tight">Documentos requeridos</h1>
                <p className="text-sm text-muted-foreground">
                    Agregá tipos de documento y elegí cuáles son obligatorios antes de que un
                    organizador pueda pasar a revisión, según su tipo de cuenta.
                </p>
            </header>

            <Card className="border-border/70" data-testid="document-type-create-card">
                <CardHeader>
                    <CardTitle className="text-lg">Tipos de documento</CardTitle>
                    <CardDescription>
                        Agregá un tipo nuevo (por ejemplo &quot;Pasaporte&quot;) — queda disponible al
                        instante en el selector de subida del organizador y abajo, para marcarlo como
                        obligatorio.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={createDocType} className="flex flex-wrap gap-2 items-end">
                        <Input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Ej: Pasaporte"
                            data-testid="document-type-new-label"
                            className="max-w-xs"
                        />
                        <Button
                            type="submit"
                            disabled={creating || newLabel.trim().length < 2}
                            data-testid="document-type-create-btn"
                            variant="outline"
                        >
                            {creating ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                                <Plus className="h-4 w-4 mr-1.5" />
                            )}
                            Agregar tipo
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {loading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
                <div className="grid sm:grid-cols-2 gap-5">
                    {ORG_TYPES.map((ot) => (
                        <Card key={ot.value} className="border-border/70" data-testid={`required-docs-card-${ot.value}`}>
                            <CardHeader>
                                <CardTitle className="text-lg">{ot.label}</CardTitle>
                                <CardDescription>
                                    Documentos obligatorios para organizadores tipo &quot;{ot.label}&quot;.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {docTypes.map((dt) => (
                                    <div key={dt.code} className="flex items-center gap-2">
                                        <Checkbox
                                            id={`${ot.value}-${dt.code}`}
                                            data-testid={`required-doc-${ot.value}-${dt.code}`}
                                            checked={required[ot.value].includes(dt.code)}
                                            onCheckedChange={() => toggle(ot.value, dt.code)}
                                        />
                                        <Label htmlFor={`${ot.value}-${dt.code}`} className="cursor-pointer">
                                            {dt.label}
                                        </Label>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Button
                onClick={save}
                disabled={loading || saving}
                data-testid="required-docs-save-btn"
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar
            </Button>
        </div>
    );
}
