import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import api, { formatApiError } from "@/lib/api";
import { Loader2, Plus } from "lucide-react";

const ORG_TYPES = [
    { value: "individual", label: "Persona natural" },
    { value: "company", label: "Empresa" },
];

const GLOBAL = "*";

export default function AdminConfiguracion() {
    const [docTypes, setDocTypes] = useState([]);
    const [countries, setCountries] = useState([]);
    const [selectedCountry, setSelectedCountry] = useState(GLOBAL);
    const [required, setRequired] = useState({ individual: [], company: [] });
    const [countryDraft, setCountryDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingCountry, setSavingCountry] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [creating, setCreating] = useState(false);
    const [newCountry, setNewCountry] = useState({ code: "", name: "" });
    const [preEventFeeRequired, setPreEventFeeRequired] = useState(false);
    const [savingPlatform, setSavingPlatform] = useState(false);

    const countryOptions = useMemo(() => {
        return [
            { code: GLOBAL, name: "Global (fallback)" },
            ...countries.map((c) => ({ code: c.code, name: c.name })),
        ];
    }, [countries]);

    const loadCountries = useCallback(async () => {
        const { data } = await api.get("/admin/settings/registration-countries");
        setCountries(data || []);
        return data || [];
    }, []);

    const loadRequired = useCallback(async (countryCode) => {
        const { data } = await api.get("/admin/settings/required-documents", {
            params: { country: countryCode },
        });
        setRequired({
            individual: data.individual || [],
            company: data.company || [],
        });
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [typesResp, list, platformResp] = await Promise.all([
                api.get("/admin/settings/document-types"),
                loadCountries(),
                api.get("/admin/settings/platform").catch(() => ({ data: {} })),
            ]);
            setDocTypes(typesResp.data || []);
            setPreEventFeeRequired(Boolean(platformResp.data?.pre_event_fee_required));
            await loadRequired(selectedCountry);
            if (selectedCountry !== GLOBAL) {
                const row = list.find((c) => c.code === selectedCountry);
                setCountryDraft(
                    row
                        ? {
                              ...row,
                              compliance_schema_json: JSON.stringify(
                                  row.compliance_schema || {},
                                  null,
                                  2,
                              ),
                          }
                        : null,
                );
            } else {
                setCountryDraft(null);
            }
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, [loadCountries, loadRequired, selectedCountry]);

    useEffect(() => {
        load();
    }, [load]);

    const onSelectCountry = async (code) => {
        setSelectedCountry(code);
        setLoading(true);
        try {
            await loadRequired(code);
            if (code === GLOBAL) {
                setCountryDraft(null);
            } else {
                const row = countries.find((c) => c.code === code);
                setCountryDraft(
                    row
                        ? {
                              ...row,
                              compliance_schema_json: JSON.stringify(
                                  row.compliance_schema || {},
                                  null,
                                  2,
                              ),
                          }
                        : null,
                );
            }
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    };

    const toggle = (orgType, docType) => {
        setRequired((prev) => {
            const current = prev[orgType];
            const next = current.includes(docType)
                ? current.filter((d) => d !== docType)
                : [...current, docType];
            return { ...prev, [orgType]: next };
        });
    };

    const savePlatformFee = async (enabled) => {
        setSavingPlatform(true);
        const previous = preEventFeeRequired;
        setPreEventFeeRequired(enabled);
        try {
            const { data } = await api.put("/admin/settings/platform", {
                pre_event_fee_required: enabled,
            });
            setPreEventFeeRequired(Boolean(data.pre_event_fee_required));
            toast.success(
                enabled
                    ? "El cargo de plataforma quedó activo: hay que pagarlo para publicar."
                    : "El cargo de plataforma quedó desactivado: se publica sin ese pago.",
            );
        } catch (err) {
            setPreEventFeeRequired(previous);
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSavingPlatform(false);
        }
    };

    const saveDocs = async () => {
        setSaving(true);
        try {
            const { data } = await api.put("/admin/settings/required-documents", {
                country_code: selectedCountry,
                individual: required.individual,
                company: required.company,
            });
            setRequired({
                individual: data.individual || [],
                company: data.company || [],
            });
            toast.success("Documentos requeridos guardados");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSaving(false);
        }
    };

    const saveCountry = async () => {
        if (!countryDraft) return;
        setSavingCountry(true);
        try {
            let compliance_schema = countryDraft.compliance_schema;
            try {
                compliance_schema = JSON.parse(countryDraft.compliance_schema_json || "{}");
            } catch {
                toast.error("JSON de compliance inválido");
                setSavingCountry(false);
                return;
            }
            const { data } = await api.put(
                `/admin/settings/registration-countries/${countryDraft.code}`,
                {
                    name: countryDraft.name,
                    is_active: countryDraft.is_active,
                    requires_compliance: countryDraft.requires_compliance,
                    legal_id_label: countryDraft.legal_id_label,
                    legal_id_pattern: countryDraft.legal_id_pattern,
                    compliance_schema,
                    sort_order: countryDraft.sort_order,
                },
            );
            setCountries((prev) =>
                prev.map((c) => (c.code === data.code ? data : c)),
            );
            setCountryDraft({
                ...data,
                compliance_schema_json: JSON.stringify(data.compliance_schema || {}, null, 2),
            });
            toast.success("País actualizado");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSavingCountry(false);
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

    const createCountry = async (e) => {
        e.preventDefault();
        const code = newCountry.code.trim().toUpperCase();
        const name = newCountry.name.trim();
        if (code.length !== 2 || name.length < 2) {
            toast.error("Código ISO-2 y nombre requeridos");
            return;
        }
        try {
            await api.post("/admin/settings/registration-countries", {
                code,
                name,
                is_active: true,
                requires_compliance: false,
            });
            setNewCountry({ code: "", name: "" });
            toast.success("País creado");
            const list = await loadCountries();
            setSelectedCountry(code);
            const row = list.find((c) => c.code === code);
            if (row) {
                setCountryDraft({
                    ...row,
                    compliance_schema_json: JSON.stringify(row.compliance_schema || {}, null, 2),
                });
            }
            await loadRequired(code);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
    };

    return (
        <div data-testid="admin-configuracion-page" className="space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Admin · Configuración
                </Badge>
                <h1 className="text-3xl font-semibold tracking-tight">
                    Registro y documentos
                </h1>
                <p className="text-sm text-muted-foreground">
                    Configurá países de registro, compliance (UAFE/PEP), documentos
                    obligatorios y el cargo de plataforma al publicar eventos.
                </p>
            </header>

            <Card className="border-border/70" data-testid="platform-pre-event-fee-card">
                <CardHeader>
                    <CardTitle className="text-lg">Cargo de plataforma al publicar</CardTitle>
                    <CardDescription>
                        Interruptor global. Apagado: cualquier organizador publica sin pagar
                        este cargo. Prendido: los planes que lo tengan habilitado lo cobran
                        antes de publicar (montos en Admin → Planes).
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <div>
                        <Label htmlFor="pre-event-fee-required" className="text-sm font-medium">
                            Exigir pago antes de publicar
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                            {preEventFeeRequired
                                ? "Activo: el organizador ve el diálogo de pago si su plan cobra el cargo."
                                : "Desactivado: se publica el evento sin este cobro."}
                        </p>
                    </div>
                    <Switch
                        id="pre-event-fee-required"
                        checked={preEventFeeRequired}
                        disabled={loading || savingPlatform}
                        onCheckedChange={savePlatformFee}
                        data-testid="platform-pre-event-fee-switch"
                    />
                </CardContent>
            </Card>

            <Card className="border-border/70" data-testid="document-type-create-card">
                <CardHeader>
                    <CardTitle className="text-lg">Tipos de documento</CardTitle>
                    <CardDescription>
                        Catálogo disponible para subida y para la matriz de requisitos.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={createDocType} className="flex flex-wrap gap-2 items-end">
                        <Input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Ej: Certificación bancaria"
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

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg">País</CardTitle>
                    <CardDescription>
                        Elegí un país para editar su configuración y su matriz de documentos.
                        &quot;Global&quot; es el fallback cuando un país no tiene reglas propias.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="space-y-1.5 min-w-[220px]">
                            <Label>Seleccionar</Label>
                            <Select value={selectedCountry} onValueChange={onSelectCountry}>
                                <SelectTrigger data-testid="admin-country-select">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {countryOptions.map((c) => (
                                        <SelectItem key={c.code} value={c.code}>
                                            {c.name} ({c.code})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <form onSubmit={createCountry} className="flex flex-wrap gap-2 items-end">
                            <Input
                                value={newCountry.code}
                                onChange={(e) =>
                                    setNewCountry((f) => ({
                                        ...f,
                                        code: e.target.value.toUpperCase().slice(0, 2),
                                    }))
                                }
                                placeholder="ISO"
                                className="w-20"
                                maxLength={2}
                            />
                            <Input
                                value={newCountry.name}
                                onChange={(e) =>
                                    setNewCountry((f) => ({ ...f, name: e.target.value }))
                                }
                                placeholder="Nombre del país"
                                className="max-w-xs"
                            />
                            <Button type="submit" variant="outline" size="sm">
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Nuevo país
                            </Button>
                        </form>
                    </div>

                    {countryDraft && (
                        <div className="space-y-4 rounded-md border border-border/70 p-4">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Nombre</Label>
                                    <Input
                                        value={countryDraft.name || ""}
                                        onChange={(e) =>
                                            setCountryDraft((d) => ({
                                                ...d,
                                                name: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Label ID fiscal</Label>
                                    <Input
                                        value={countryDraft.legal_id_label || ""}
                                        onChange={(e) =>
                                            setCountryDraft((d) => ({
                                                ...d,
                                                legal_id_label: e.target.value,
                                            }))
                                        }
                                        placeholder="RUC / Cédula"
                                    />
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>Patrón ID fiscal (regex)</Label>
                                    <Input
                                        value={countryDraft.legal_id_pattern || ""}
                                        onChange={(e) =>
                                            setCountryDraft((d) => ({
                                                ...d,
                                                legal_id_pattern: e.target.value,
                                            }))
                                        }
                                        placeholder="^(\\d{10}|\\d{13})$"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-6">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={Boolean(countryDraft.is_active)}
                                        onCheckedChange={(v) =>
                                            setCountryDraft((d) => ({ ...d, is_active: v }))
                                        }
                                    />
                                    <Label>Activo en registro</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={Boolean(countryDraft.requires_compliance)}
                                        onCheckedChange={(v) =>
                                            setCountryDraft((d) => ({
                                                ...d,
                                                requires_compliance: v,
                                            }))
                                        }
                                    />
                                    <Label>Requiere compliance (UAFE/PEP/refs)</Label>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Schema compliance (JSON)</Label>
                                <Textarea
                                    className="font-mono text-xs min-h-[160px]"
                                    value={countryDraft.compliance_schema_json || ""}
                                    onChange={(e) =>
                                        setCountryDraft((d) => ({
                                            ...d,
                                            compliance_schema_json: e.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <Button
                                onClick={saveCountry}
                                disabled={savingCountry}
                                data-testid="admin-country-save-btn"
                            >
                                {savingCountry && (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                )}
                                Guardar país
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {loading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
                <div className="grid sm:grid-cols-2 gap-5">
                    {ORG_TYPES.map((ot) => (
                        <Card
                            key={ot.value}
                            className="border-border/70"
                            data-testid={`required-docs-card-${ot.value}`}
                        >
                            <CardHeader>
                                <CardTitle className="text-lg">{ot.label}</CardTitle>
                                <CardDescription>
                                    Documentos obligatorios para {ot.label} en{" "}
                                    {selectedCountry === GLOBAL
                                        ? "fallback global"
                                        : selectedCountry}
                                    .
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
                                        <Label
                                            htmlFor={`${ot.value}-${dt.code}`}
                                            className="cursor-pointer"
                                        >
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
                onClick={saveDocs}
                disabled={loading || saving}
                data-testid="required-docs-save-btn"
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar documentos
            </Button>
        </div>
    );
}
