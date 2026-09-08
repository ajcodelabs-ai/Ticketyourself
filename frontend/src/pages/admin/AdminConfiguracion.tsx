import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
    ArrowUpRight,
    FileText,
    IdCard,
    Loader2,
    Percent,
    Plus,
    Receipt,
    ShieldCheck,
    Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import api, { formatApiError } from "@/lib/api";
import {
    DEFAULT_COMPLIANCE_SCHEMA,
    countryToDraft,
    describeLegalIdPattern,
    draftToCountryPayload,
    exampleLegalId,
    legalIdFormatForKind,
    parseComplianceForm,
} from "@/lib/countryAdminForm";
import { cn } from "@/lib/utils";

const ORG_TYPES = [
    { value: "individual", label: "Persona natural" },
    { value: "company", label: "Empresa" },
];

const GLOBAL = "*";

function DigitCountField({ id, label, value, onChange, max = 40 }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type="number"
                min={1}
                max={max}
                inputMode="numeric"
                value={value ?? ""}
                onChange={(e) => {
                    const n = Number(e.target.value);
                    onChange(Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : 1);
                }}
                className="w-28"
                data-testid={id}
            />
        </div>
    );
}

function StatusPill({ ok, warn, children }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                ok && "bg-emerald-50 text-emerald-800",
                warn && "bg-amber-50 text-amber-800",
                !ok && !warn && "bg-slate-100 text-slate-600",
            )}
        >
            <span
                className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    ok && "bg-emerald-500",
                    warn && "bg-amber-500",
                    !ok && !warn && "bg-slate-400",
                )}
            />
            {children}
        </span>
    );
}

function integrationStatus(row) {
    if (!row) return { ok: false, warn: false, label: "Sin datos" };
    if (row.mock) return { ok: false, warn: true, label: "Simulado en local" };
    if (row.configured) return { ok: true, warn: false, label: "Conectado" };
    return { ok: false, warn: false, label: "Sin API key" };
}

function CountryDraftForm({ draft, onChange, isEcuador }) {
    const format = draft.legalIdFormat || { kind: "none" };
    const compliance = draft.complianceForm || parseComplianceForm(null);
    const preview = describeLegalIdPattern(
        format.kind === "custom" ? format.customPattern : draftToCountryPayload(draft).legal_id_pattern,
    );
    const example = exampleLegalId(format);

    const patch = (partial) => onChange({ ...draft, ...partial });
    const patchLegal = (legalIdFormat) => patch({ legalIdFormat });
    const patchCompliance = (partial) =>
        patch({ complianceForm: { ...compliance, ...partial } });

    return (
        <div className="space-y-8">
            <section className="space-y-4">
                <div>
                    <h3 className="text-sm font-semibold tracking-tight">Identidad</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Cómo se llama el documento y cuántos números aceptamos en el registro.
                    </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="country-name">Nombre del país</Label>
                        <Input
                            id="country-name"
                            value={draft.name || ""}
                            onChange={(e) => patch({ name: e.target.value })}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="country-legal-label">Nombre del documento</Label>
                        <Input
                            id="country-legal-label"
                            value={draft.legal_id_label || ""}
                            onChange={(e) => patch({ legal_id_label: e.target.value })}
                            placeholder="RUC / Cédula"
                        />
                        <p className="text-xs text-muted-foreground">
                            Así aparece el campo cuando alguien se registra.
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label>Formato que aceptamos</Label>
                        <Select
                            value={format.kind}
                            onValueChange={(kind) =>
                                patchLegal(legalIdFormatForKind(format, kind))
                            }
                        >
                            <SelectTrigger data-testid="admin-legal-id-format">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">
                                    Sin formato — acepta cualquier texto
                                </SelectItem>
                                <SelectItem value="digits_exact">
                                    Exactamente una cantidad de números
                                </SelectItem>
                                <SelectItem value="digits_range">
                                    Entre un mínimo y un máximo de números
                                </SelectItem>
                                <SelectItem value="digits_either">
                                    Una de dos cantidades (ej. cédula o RUC)
                                </SelectItem>
                                {format.kind === "custom" && (
                                    <SelectItem value="custom">
                                        Formato especial (ya configurado)
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {format.kind === "digits_exact" && (
                        <DigitCountField
                            id="legal-id-digits"
                            label="Cantidad de números"
                            value={format.digits}
                            onChange={(digits) => patchLegal({ ...format, digits })}
                        />
                    )}
                    {format.kind === "digits_range" && (
                        <div className="flex flex-wrap gap-3">
                            <DigitCountField
                                id="legal-id-min"
                                label="Mínimo"
                                value={format.minDigits}
                                onChange={(minDigits) => patchLegal({ ...format, minDigits })}
                            />
                            <DigitCountField
                                id="legal-id-max"
                                label="Máximo"
                                value={format.maxDigits}
                                onChange={(maxDigits) => patchLegal({ ...format, maxDigits })}
                            />
                        </div>
                    )}
                    {format.kind === "digits_either" && (
                        <div className="flex flex-wrap gap-3">
                            <DigitCountField
                                id="legal-id-either-a"
                                label="Primera opción"
                                value={format.eitherA}
                                onChange={(eitherA) => patchLegal({ ...format, eitherA })}
                            />
                            <DigitCountField
                                id="legal-id-either-b"
                                label="Segunda opción"
                                value={format.eitherB}
                                onChange={(eitherB) => patchLegal({ ...format, eitherB })}
                            />
                        </div>
                    )}
                    {format.kind === "custom" && (
                        <p className="text-xs text-muted-foreground">
                            Este país ya tiene un formato especial. Podés dejarlo o elegir
                            otra opción de la lista para reemplazarlo.
                        </p>
                    )}

                    <div
                        className="rounded-md bg-slate-50 px-3 py-2 text-sm"
                        data-testid="admin-legal-id-preview"
                    >
                        <p>{preview}</p>
                        {example && format.kind !== "custom" && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Ejemplo válido: {example}
                            </p>
                        )}
                    </div>
                    {isEcuador && (
                        <p className="text-xs text-muted-foreground">
                            En Ecuador, además del largo, TYS valida el dígito verificador de
                            la cédula (persona natural). Verificante consulta esa cédula al
                            registrarse; el resultado se ve en Organizadores y no reemplaza
                            los archivos de abajo.
                        </p>
                    )}
                </div>

                <div className="flex items-start gap-3 pt-1">
                    <Switch
                        id="country-active"
                        checked={Boolean(draft.is_active)}
                        onCheckedChange={(v) => patch({ is_active: v })}
                    />
                    <div>
                        <Label htmlFor="country-active">Mostrar en el registro</Label>
                        <p className="text-xs text-muted-foreground">
                            Si está apagado, el organizador no puede elegir este país.
                        </p>
                    </div>
                </div>
            </section>

            <section className="space-y-4 border-t border-border/60 pt-6">
                <div>
                    <h3 className="text-sm font-semibold tracking-tight">Declaraciones extra</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Preguntas de compliance al crear la cuenta. En Ecuador cubren PEP y
                        UAFE.
                    </p>
                </div>

                <div className="flex items-start gap-3">
                    <Switch
                        id="country-compliance"
                        checked={Boolean(draft.requires_compliance)}
                        onCheckedChange={(v) => {
                            const anyOn =
                                compliance.pepEnabled ||
                                compliance.uafeEnabled ||
                                compliance.refsEnabled;
                            patch({
                                requires_compliance: v,
                                ...(v && !anyOn
                                    ? {
                                          complianceForm: parseComplianceForm(
                                              DEFAULT_COMPLIANCE_SCHEMA,
                                          ),
                                      }
                                    : {}),
                            });
                        }}
                    />
                    <div>
                        <Label htmlFor="country-compliance">
                            Pedir declaraciones extra al registrarse
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            PEP, origen de fondos y referencias.
                        </p>
                    </div>
                </div>

                {draft.requires_compliance && (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-border/60 p-3 space-y-2">
                            <div className="flex items-start gap-3">
                                <Switch
                                    id="compliance-pep"
                                    checked={Boolean(compliance.pepEnabled)}
                                    onCheckedChange={(v) => patchCompliance({ pepEnabled: v })}
                                />
                                <div>
                                    <Label htmlFor="compliance-pep">
                                        Persona políticamente expuesta (PEP)
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Cargo público propio o de un familiar cercano.
                                    </p>
                                </div>
                            </div>
                            {compliance.pepEnabled && (
                                <div className="flex items-start gap-2 pl-11">
                                    <Checkbox
                                        id="compliance-pep-details"
                                        checked={Boolean(compliance.pepRequireDetails)}
                                        onCheckedChange={(v) =>
                                            patchCompliance({ pepRequireDetails: Boolean(v) })
                                        }
                                    />
                                    <Label
                                        htmlFor="compliance-pep-details"
                                        className="font-normal cursor-pointer"
                                    >
                                        Si responde que sí, pedir cargo, institución y periodo
                                    </Label>
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-border/60 p-3">
                            <div className="flex items-start gap-3">
                                <Switch
                                    id="compliance-uafe"
                                    checked={Boolean(compliance.uafeEnabled)}
                                    onCheckedChange={(v) => patchCompliance({ uafeEnabled: v })}
                                />
                                <div>
                                    <Label htmlFor="compliance-uafe">
                                        Declaración de origen de fondos
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Confirmar que el dinero es lícito y aceptar las
                                        obligaciones de prevención (UAFE).
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/60 p-3 space-y-3">
                            <div className="flex items-start gap-3">
                                <Switch
                                    id="compliance-refs"
                                    checked={Boolean(compliance.refsEnabled)}
                                    onCheckedChange={(v) => patchCompliance({ refsEnabled: v })}
                                />
                                <div>
                                    <Label htmlFor="compliance-refs">Referencias</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Nombre, teléfono y relación de contactos.
                                    </p>
                                </div>
                            </div>
                            {compliance.refsEnabled && (
                                <div className="flex flex-wrap gap-3 pl-11">
                                    <DigitCountField
                                        id="refs-min"
                                        label="Mínimo"
                                        max={5}
                                        value={compliance.refsMin}
                                        onChange={(refsMin) =>
                                            patchCompliance({
                                                refsMin: Math.max(1, Math.min(5, refsMin)),
                                            })
                                        }
                                    />
                                    <DigitCountField
                                        id="refs-max"
                                        label="Máximo"
                                        max={5}
                                        value={compliance.refsMax}
                                        onChange={(refsMax) =>
                                            patchCompliance({
                                                refsMax: Math.max(1, Math.min(5, refsMax)),
                                            })
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function IntegrationCard({ icon: Icon, title, description, status = null, href = null, testid }) {
    const inner = (
        <>
            <div className="flex items-start justify-between gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-orange-50 text-orange-700">
                    <Icon className="h-4 w-4" />
                </div>
                {href ? (
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                    status
                )}
            </div>
            <div className="mt-4 space-y-1">
                <p className="text-sm font-semibold tracking-tight">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            </div>
            {href && status ? <div className="mt-3">{status}</div> : null}
        </>
    );

    const className =
        "block rounded-xl border border-border/70 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] h-full";

    if (href) {
        return (
            <Link to={href} className={cn(className, "hover:border-orange-300/80 transition-colors")} data-testid={testid}>
                {inner}
            </Link>
        );
    }
    return (
        <div className={className} data-testid={testid}>
            {inner}
        </div>
    );
}

export default function AdminConfiguracion() {
    const [docTypes, setDocTypes] = useState([]);
    const [countries, setCountries] = useState([]);
    const [selectedCountry, setSelectedCountry] = useState("EC");
    const [required, setRequired] = useState({ individual: [], company: [] });
    const [countryDraft, setCountryDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [creating, setCreating] = useState(false);
    const [newCountry, setNewCountry] = useState({ code: "", name: "" });
    const [countryDialog, setCountryDialog] = useState(false);
    const [integrations, setIntegrations] = useState(null);

    const selectedMeta = useMemo(() => {
        if (selectedCountry === GLOBAL) {
            return { code: GLOBAL, name: "Reglas por defecto" };
        }
        const row = countries.find((c) => c.code === selectedCountry);
        return row ? { code: row.code, name: row.name } : { code: selectedCountry, name: selectedCountry };
    }, [countries, selectedCountry]);

    const isEcuador = selectedCountry === "EC";

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

    const applyCountry = useCallback(
        (code, list) => {
            if (code === GLOBAL) {
                setCountryDraft(null);
                return;
            }
            const row = (list || countries).find((c) => c.code === code);
            setCountryDraft(countryToDraft(row));
        },
        [countries],
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [typesResp, list, integrationsResp] = await Promise.all([
                api.get("/admin/settings/document-types"),
                loadCountries(),
                api.get("/admin/integrations/status").catch(() => ({ data: null })),
            ]);
            setDocTypes(typesResp.data || []);
            setIntegrations(integrationsResp.data);
            const codes = new Set((list || []).map((c) => c.code));
            const nextCode = codes.has(selectedCountry)
                ? selectedCountry
                : codes.has("EC")
                  ? "EC"
                  : GLOBAL;
            if (nextCode !== selectedCountry) setSelectedCountry(nextCode);
            await loadRequired(nextCode);
            applyCountry(nextCode, list);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, [applyCountry, loadCountries, loadRequired, selectedCountry]);

    useEffect(() => {
        load();
        // First paint + when the selected country identity changes from outside load().
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load re-fetches the whole page; country chips use onSelectCountry.
    }, []);

    const onSelectCountry = async (code) => {
        setSelectedCountry(code);
        setLoading(true);
        try {
            await loadRequired(code);
            applyCountry(code, countries);
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

    const saveAll = async () => {
        setSaving(true);
        try {
            if (countryDraft) {
                const { data } = await api.put(
                    `/admin/settings/registration-countries/${countryDraft.code}`,
                    draftToCountryPayload(countryDraft),
                );
                setCountries((prev) => prev.map((c) => (c.code === data.code ? data : c)));
                setCountryDraft(countryToDraft(data));
            }
            const { data } = await api.put("/admin/settings/required-documents", {
                country_code: selectedCountry,
                individual: required.individual,
                company: required.company,
            });
            setRequired({
                individual: data.individual || [],
                company: data.company || [],
            });
            toast.success("Reglas guardadas");
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
            const { data } = await api.get("/admin/settings/document-types");
            setDocTypes(data || []);
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
            toast.error("Código de dos letras y nombre requeridos");
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
            setCountryDialog(false);
            toast.success("País creado");
            const list = await loadCountries();
            setSelectedCountry(code);
            applyCountry(code, list);
            await loadRequired(code);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
    };

    const verificante = integrationStatus(integrations?.verificante);
    const datil = integrationStatus(integrations?.datil);
    const datilAmbiente =
        integrations?.datil?.ambiente === 2 ? "producción" : "pruebas";

    return (
        <div data-testid="admin-configuracion-page" className="space-y-8">
            <header className="space-y-2 max-w-2xl">
                <Badge variant="secondary" className="text-orange-700 bg-orange-50 border-orange-100">
                    Super admin
                </Badge>
                <h1 className="text-3xl font-semibold tracking-tight">Configuración</h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Reglas de alta de organizadores por país. Las claves de Verificante y
                    Dátil viven en el servidor; las comisiones y el cargo al publicar, en
                    sus propias pantallas.
                </p>
            </header>

            <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Integraciones y dinero
                </h2>
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <IntegrationCard
                        icon={ShieldCheck}
                        title="Verificante"
                        description="Consulta la cédula de persona natural en Ecuador al registrarse. Es una señal de riesgo; no aprueba la cuenta ni reemplaza los archivos."
                        status={<StatusPill ok={verificante.ok} warn={verificante.warn}>{verificante.label}</StatusPill>}
                        testid="verificante-status-card"
                    />
                    <IntegrationCard
                        icon={Receipt}
                        title="Dátil / SRI"
                        description={`Factura electrónica con el RUC del organizador. Ambiente ${datilAmbiente}${integrations?.datil?.iva_percent != null ? ` · IVA ${integrations.datil.iva_percent}%` : ""}.`}
                        status={<StatusPill ok={datil.ok} warn={datil.warn}>{datil.label}</StatusPill>}
                        testid="datil-status-card"
                    />
                    <IntegrationCard
                        icon={Percent}
                        title="Comisiones"
                        description="Cuánto se queda TYS por cada entrada, según plan, tipo de evento y precio."
                        href="/admin/comisiones"
                        testid="config-link-comisiones"
                    />
                    <IntegrationCard
                        icon={Wallet}
                        title="Planes y cargo al publicar"
                        description="Precio de cada plan, fee de verificación y si hay que pagar para publicar un evento."
                        href="/admin/planes"
                        testid="config-link-planes"
                    />
                </div>
            </section>

            <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            País
                        </h2>
                        <p className="text-xs text-muted-foreground mt-1">
                            Elegí la jurisdicción. “Por defecto” se usa cuando un país no
                            tiene documentos propios.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCountryDialog(true)}
                    >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Nuevo país
                    </Button>
                </div>
                <div className="flex flex-wrap gap-2" data-testid="admin-country-select">
                    <button
                        type="button"
                        onClick={() => onSelectCountry(GLOBAL)}
                        className={cn(
                            "rounded-full border px-3 py-1.5 text-sm transition-colors",
                            selectedCountry === GLOBAL
                                ? "border-orange-500 bg-orange-500 text-white"
                                : "border-border bg-white text-slate-700 hover:border-orange-300",
                        )}
                    >
                        Por defecto
                    </button>
                    {countries.map((c) => (
                        <button
                            key={c.code}
                            type="button"
                            data-testid={`admin-country-chip-${c.code}`}
                            onClick={() => onSelectCountry(c.code)}
                            className={cn(
                                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                                selectedCountry === c.code
                                    ? "border-orange-500 bg-orange-500 text-white"
                                    : "border-border bg-white text-slate-700 hover:border-orange-300",
                            )}
                        >
                            {c.name}
                            <span
                                className={cn(
                                    "ml-1.5 font-mono text-[10px] tracking-wider",
                                    selectedCountry === c.code ? "text-orange-100" : "text-slate-400",
                                )}
                            >
                                {c.code}
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <div className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-4 border-b border-orange-100 bg-gradient-to-r from-orange-50/90 to-white px-5 py-5">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-700/80">
                            {selectedCountry === GLOBAL ? "Fallback" : "Jurisdicción"}
                        </p>
                        <h2 className="text-2xl font-semibold tracking-tight">
                            {selectedMeta.name}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {selectedCountry === GLOBAL
                                ? "Documentos que pedimos si el país no tiene una lista propia."
                                : "Qué pide TYS al organizador de este país, en el orden del registro."}
                        </p>
                    </div>
                    {selectedCountry !== GLOBAL && (
                        <div
                            className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border-2 border-orange-600/45 bg-white font-mono text-sm font-bold tracking-[0.22em] text-orange-800 -rotate-6 shadow-sm"
                            aria-hidden
                        >
                            {selectedMeta.code}
                        </div>
                    )}
                </div>

                <div className="p-5 space-y-8">
                    {loading && !countryDraft && selectedCountry !== GLOBAL ? (
                        <p className="text-sm text-muted-foreground">Cargando…</p>
                    ) : (
                        <>
                            {countryDraft && (
                                <CountryDraftForm
                                    draft={countryDraft}
                                    onChange={setCountryDraft}
                                    isEcuador={isEcuador}
                                />
                            )}

                            <section
                                className={cn(
                                    "space-y-4",
                                    countryDraft && "border-t border-border/60 pt-6",
                                )}
                                data-testid="document-type-create-card"
                            >
                                <div className="flex flex-wrap items-end justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-orange-600" />
                                            Archivos que debe subir
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Evidencia en onboarding. Independiente de Verificante.
                                        </p>
                                    </div>
                                    <form
                                        onSubmit={createDocType}
                                        className="flex flex-wrap gap-2 items-center"
                                    >
                                        <Input
                                            value={newLabel}
                                            onChange={(e) => setNewLabel(e.target.value)}
                                            placeholder="Nuevo tipo, ej. Certificación bancaria"
                                            data-testid="document-type-new-label"
                                            className="w-56 h-8 text-sm"
                                        />
                                        <Button
                                            type="submit"
                                            disabled={creating || newLabel.trim().length < 2}
                                            data-testid="document-type-create-btn"
                                            variant="outline"
                                            size="sm"
                                        >
                                            {creating ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <>
                                                    <Plus className="h-3.5 w-3.5 mr-1" />
                                                    Agregar tipo
                                                </>
                                            )}
                                        </Button>
                                    </form>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    {ORG_TYPES.map((ot) => (
                                        <div
                                            key={ot.value}
                                            className="rounded-lg border border-border/60 p-4 space-y-3"
                                            data-testid={`required-docs-card-${ot.value}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <IdCard className="h-4 w-4 text-slate-400" />
                                                <p className="text-sm font-medium">{ot.label}</p>
                                            </div>
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
                                                        className="cursor-pointer font-normal"
                                                    >
                                                        {dt.label}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <div className="flex justify-end">
                                <Button
                                    onClick={saveAll}
                                    disabled={loading || saving}
                                    data-testid="admin-country-save-btn"
                                    className="bg-orange-600 hover:bg-orange-700 text-white"
                                >
                                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Guardar reglas
                                </Button>
                                <button
                                    type="button"
                                    className="sr-only"
                                    data-testid="required-docs-save-btn"
                                    onClick={saveAll}
                                >
                                    Guardar documentos
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={countryDialog} onOpenChange={setCountryDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nuevo país</DialogTitle>
                        <DialogDescription>
                            Código de dos letras (ISO) y el nombre que verá el organizador.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createCountry} className="space-y-3">
                        <div className="flex gap-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="new-country-code">Código</Label>
                                <Input
                                    id="new-country-code"
                                    value={newCountry.code}
                                    onChange={(e) =>
                                        setNewCountry((f) => ({
                                            ...f,
                                            code: e.target.value.toUpperCase().slice(0, 2),
                                        }))
                                    }
                                    placeholder="CO"
                                    className="w-20 font-mono"
                                    maxLength={2}
                                />
                            </div>
                            <div className="space-y-1.5 flex-1">
                                <Label htmlFor="new-country-name">Nombre</Label>
                                <Input
                                    id="new-country-name"
                                    value={newCountry.name}
                                    onChange={(e) =>
                                        setNewCountry((f) => ({ ...f, name: e.target.value }))
                                    }
                                    placeholder="Colombia"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button type="submit">Crear país</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
