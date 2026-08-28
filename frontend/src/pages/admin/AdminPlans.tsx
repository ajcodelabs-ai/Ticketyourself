import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import api, { formatApiError } from "@/lib/api";
import { centsToDollars, dollarsToCents } from "@/lib/money";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleHelp, Loader2, Pencil, Plus } from "lucide-react";

const EMPTY_FORM = {
    code: "",
    name: "",
    description: "",
    price_dollars: "0.00",
    currency: "usd",
    billing_period: "monthly",
    features_text: "",
    max_events: -1,
    max_events_year: -1,
    max_tickets_per_event: -1,
    max_venues: 1,
    max_gallery_images: 10,
    includes_numbered: false,
    includes_ai_design: false,
    includes_custom_domain: false,
    includes_marketing: false,
    allows_paid_events: true,
    allows_free_events: true,
    multi_function_events: false,
    verified_lists: false,
    access_codes: false,
    microsite_custom_css: false,
    promo_codes: false,
    advanced_discounts: false,
    presale_discount: true,
    disability_discount: true,
    senior_discount: true,
    access_types: [],
    verification_fee_dollars: "10.00",
    event_fee_enabled: false,
    event_fee_per_ticket_dollars: "0.00",
    event_fee_percent_bps: 0,
    active: true,
};

/** Mirrors backend PLAN_OVERRIDES for flags that live in feature_flags, not columns. */
const PLAN_RUNTIME_DEFAULTS = {
    evento_unico: { max_venues: 1, max_gallery_images: 10 },
    basico: { max_venues: 1, max_gallery_images: 10 },
    profesional: {
        max_venues: 5,
        max_gallery_images: 20,
        microsite_custom_css: true,
        promo_codes: true,
        advanced_discounts: true,
    },
    enterprise: {
        max_venues: -1,
        max_gallery_images: 50,
        microsite_custom_css: true,
        promo_codes: true,
        advanced_discounts: true,
        multi_function_events: true,
        verified_lists: true,
        access_codes: true,
    },
};

function runtimeDefault(code, key, fallback) {
    const row = PLAN_RUNTIME_DEFAULTS[code] || {};
    return row[key] ?? fallback;
}

function planToForm(p) {
    const flags = p.feature_flags || {};
    const code = p.code;
    return {
        code,
        name: p.name,
        description: p.description,
        price_dollars: centsToDollars(p.price_cents),
        currency: p.currency || "usd",
        billing_period: p.billing_period,
        features_text: (p.features || []).join("\n"),
        max_events: p.max_events ?? -1,
        max_events_year: p.max_events_year ?? -1,
        max_tickets_per_event: p.max_tickets_per_event ?? -1,
        max_venues: Number(flags.max_venues ?? runtimeDefault(code, "max_venues", 1)),
        max_gallery_images: Number(
            flags.max_gallery_images ?? runtimeDefault(code, "max_gallery_images", 10),
        ),
        includes_numbered: Boolean(p.includes_numbered),
        includes_ai_design: Boolean(p.includes_ai_design),
        includes_custom_domain: Boolean(p.includes_custom_domain),
        includes_marketing: Boolean(p.includes_marketing),
        allows_paid_events: p.allows_paid_events !== false,
        allows_free_events: p.allows_free_events !== false,
        multi_function_events: Boolean(
            flags.multi_function_events ?? runtimeDefault(code, "multi_function_events", false),
        ),
        verified_lists: Boolean(
            flags.verified_lists ?? runtimeDefault(code, "verified_lists", false),
        ),
        access_codes: Boolean(
            flags.access_codes ?? runtimeDefault(code, "access_codes", false),
        ),
        microsite_custom_css: Boolean(
            flags.microsite_custom_css ?? runtimeDefault(code, "microsite_custom_css", false),
        ),
        promo_codes: Boolean(
            flags.promo_codes ?? runtimeDefault(code, "promo_codes", Boolean(p.includes_marketing)),
        ),
        advanced_discounts: Boolean(
            flags.advanced_discounts
                ?? runtimeDefault(code, "advanced_discounts", Boolean(p.includes_marketing)),
        ),
        presale_discount: flags.presale_discount !== false,
        disability_discount: flags.disability_discount !== false,
        senior_discount: flags.senior_discount !== false,
        access_types: Array.isArray(p.access_types) ? p.access_types : [],
        verification_fee_dollars: centsToDollars(p.verification_fee_cents ?? 0),
        event_fee_enabled: Boolean(p.event_fee_enabled),
        event_fee_per_ticket_dollars: centsToDollars(p.event_fee_per_ticket_cents ?? 0),
        event_fee_percent_bps: p.event_fee_percent_bps ?? 0,
        active: Boolean(p.active),
    };
}

function formToPayload(form, { includeCode } = { includeCode: false }) {
    const features = form.features_text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    const price_cents = dollarsToCents(form.price_dollars);
    const verification_fee_cents = dollarsToCents(form.verification_fee_dollars);
    const event_fee_per_ticket_cents = dollarsToCents(form.event_fee_per_ticket_dollars);
    if (price_cents === null || verification_fee_cents === null || event_fee_per_ticket_cents === null) {
        throw new Error("Monto inválido: usá formato 20.00");
    }
    const payload: Record<string, any> = {
        name: form.name,
        description: form.description,
        price_cents,
        currency: form.currency,
        billing_period: form.billing_period,
        features,
        max_events: Number(form.max_events),
        max_events_year: Number(form.max_events_year),
        max_tickets_per_event: Number(form.max_tickets_per_event),
        includes_numbered: form.includes_numbered,
        includes_ai_design: form.includes_ai_design,
        includes_custom_domain: form.includes_custom_domain,
        includes_marketing: form.includes_marketing,
        allows_paid_events: form.allows_paid_events,
        allows_free_events: form.allows_free_events,
        access_types: Array.isArray(form.access_types) ? form.access_types : [],
        verification_fee_cents,
        event_fee_enabled: form.event_fee_enabled,
        event_fee_per_ticket_cents,
        event_fee_percent_bps: Number(form.event_fee_percent_bps) || 0,
        active: form.active,
        feature_flags: {
            promo_codes: Boolean(form.promo_codes),
            advanced_discounts: Boolean(form.advanced_discounts),
            presale_discount: Boolean(form.presale_discount),
            disability_discount: Boolean(form.disability_discount),
            senior_discount: Boolean(form.senior_discount),
            multi_function_events: Boolean(form.multi_function_events),
            verified_lists: Boolean(form.verified_lists),
            access_codes: Boolean(form.access_codes),
            microsite_custom_css: Boolean(form.microsite_custom_css),
            max_venues: Number(form.max_venues),
            max_gallery_images: Number(form.max_gallery_images),
        },
    };
    if (includeCode) payload.code = form.code.trim().toLowerCase();
    return payload;
}

function FieldHint({ label, tip, htmlFor }: { label: string; tip: string; htmlFor?: string }) {
    return (
        <Label htmlFor={htmlFor} className="inline-flex items-center gap-1.5">
            <span>{label}</span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label={`Ayuda: ${label}`}
                        onClick={(e) => e.preventDefault()}
                    >
                        <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                    {tip}
                </TooltipContent>
            </Tooltip>
        </Label>
    );
}

const MODULE_HINTS = {
    includes_numbered:
        "Permite localidades numeradas (el comprador elige butaca). El escenario / mapa está disponible en todos los planes; sin este flag solo se pueden crear localidades no numeradas.",
    includes_marketing:
        "Desbloquea el módulo de marketing premium. Sin esto, esas opciones aparecen bloqueadas.",
    includes_ai_design:
        "Habilita el diseñador de tickets con IA en el panel del evento.",
    includes_custom_domain:
        "Permite dominio propio en tu página (ej. entradas.suempresa.com).",
    microsite_custom_css:
        "Permite CSS personalizado en el editor de tu página.",
    allows_paid_events:
        "Si está off, el organizador no puede crear eventos Pagado ni Por Donación.",
    allows_free_events:
        "Si está off, el organizador no puede crear eventos Gratuitos.",
    multi_function_events:
        "Permite eventos multifunción y con subeventos (varias fechas o experiencias hijas).",
    verified_lists:
        "Permite restringir la compra a una lista de invitados (email o cédula).",
    access_codes:
        "Permite exigir un código de acceso para comprar.",
    promo_codes:
        "Permite códigos promocionales múltiples (cupo global / por comprador) en el paso Descuentos del wizard.",
    advanced_discounts:
        "Permite reglas automáticas: valor fijo, NxM (2x1), por forma de pago y por cantidad mínima.",
    presale_discount:
        "Permite el toggle Preventa (% hasta una fecha) en el wizard.",
    disability_discount:
        "Permite el descuento por ley de discapacidad (Ecuador) con verificación documental en checkout.",
    senior_discount:
        "Permite el descuento por tercera edad con verificación documental en checkout.",
};

export default function AdminPlans() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editingCode, setEditingCode] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [preEventFeeRequired, setPreEventFeeRequired] = useState(false);
    const [savingPlatform, setSavingPlatform] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data }, platformResp] = await Promise.all([
                api.get("/admin/plans"),
                api.get("/admin/settings/platform").catch(() => ({ data: {} })),
            ]);
            setPlans(data || []);
            setPreEventFeeRequired(Boolean(platformResp.data?.pre_event_fee_required));
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const openCreate = () => {
        setEditingCode(null);
        setForm({ ...EMPTY_FORM });
        setOpen(true);
    };

    const openEdit = (p) => {
        setEditingCode(p.code);
        setForm(planToForm(p));
        setOpen(true);
    };

    const save = async () => {
        if (!form.name.trim() || form.description.trim().length < 2) {
            toast.error("Nombre y descripción son obligatorios");
            return;
        }
        if (!editingCode && form.code.trim().length < 2) {
            toast.error("Código de plan requerido");
            return;
        }
        setSaving(true);
        try {
            const payload = formToPayload(form, { includeCode: !editingCode });
            if (editingCode) {
                await api.patch(`/admin/plans/${editingCode}`, payload);
                toast.success("Plan actualizado");
            } else {
                await api.post("/admin/plans", payload);
                toast.success("Plan creado");
            }
            setOpen(false);
            await load();
        } catch (err) {
            toast.error(
                err?.message?.includes("Monto inválido")
                    ? err.message
                    : formatApiError(err?.response?.data?.detail) || err.message,
            );
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (plan) => {
        try {
            await api.patch(`/admin/plans/${plan.code}`, { active: !plan.active });
            toast.success(`Plan ${plan.code} ${!plan.active ? "activado" : "desactivado"}`);
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
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

    const setField = (key) => (e) => {
        const val = e?.target?.type === "checkbox" ? e.target.checked : e?.target?.value ?? e;
        setForm((f) => ({ ...f, [key]: val }));
    };

    return (
        <div data-testid="admin-plans-page" className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <Badge variant="secondary" className="text-primary">
                        Admin · Planes
                    </Badge>
                    <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                        Precio, cupos y qué funciones están activas para el organizador
                        (wizard, localidades, página). Si un módulo está off, la UI lo
                        muestra bloqueado con el plan que lo desbloquea.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" asChild>
                        <Link to="/admin/comisiones">Comisión por venta</Link>
                    </Button>
                    <Button onClick={openCreate} data-testid="admin-plan-create-btn">
                        <Plus className="h-4 w-4 mr-1" />
                        Nuevo plan
                    </Button>
                </div>
            </header>

            <Card className="border-border/70" data-testid="platform-pre-event-fee-card">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Exigir cargo de plataforma al publicar</CardTitle>
                    <CardDescription>
                        Interruptor global. Apagado: se publica sin este pago. Prendido: solo
                        los planes con “Cobro pre-evento” habilitado lo cobran (montos abajo
                        al editar cada plan).
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4 pt-0">
                    <p className="text-sm text-muted-foreground">
                        {preEventFeeRequired ? "Activo" : "Desactivado"}
                    </p>
                    <Switch
                        checked={preEventFeeRequired}
                        disabled={loading || savingPlatform}
                        onCheckedChange={savePlatformFee}
                        data-testid="platform-pre-event-fee-switch"
                    />
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardContent className="pt-6">
                    <Table data-testid="admin-plans-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Precio</TableHead>
                                <TableHead>Verificación</TableHead>
                                <TableHead>Fee evento</TableHead>
                                <TableHead>Activo</TableHead>
                                <TableHead>Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && plans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        Cargando…
                                    </TableCell>
                                </TableRow>
                            ) : (
                                plans.map((p) => (
                                    <TableRow key={p.id} data-testid={`admin-plan-row-${p.code}`}>
                                        <TableCell className="font-mono text-xs">{p.code}</TableCell>
                                        <TableCell className="font-medium">{p.name}</TableCell>
                                        <TableCell>
                                            ${(p.price_cents / 100).toFixed(2)}
                                            <span className="text-xs text-muted-foreground ml-1">
                                                / {p.billing_period}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            ${((p.verification_fee_cents || 0) / 100).toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {p.event_fee_enabled
                                                ? `$${((p.event_fee_per_ticket_cents || 0) / 100).toFixed(2)}/tkt + ${(p.event_fee_percent_bps || 0) / 100}%`
                                                : "—"}
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={p.active}
                                                onCheckedChange={() => toggleActive(p)}
                                                data-testid={`admin-plan-switch-${p.code}`}
                                            />
                                        </TableCell>
                                        <TableCell className="space-x-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => openEdit(p)}
                                                data-testid={`admin-plan-edit-${p.code}`}
                                            >
                                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                                Editar
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                data-testid={`admin-plan-delete-${p.code}`}
                                                onClick={async () => {
                                                    try {
                                                        await api.delete(`/admin/plans/${p.code}`);
                                                        toast.success("Plan eliminado");
                                                        load();
                                                    } catch (err) {
                                                        toast.error(
                                                            formatApiError(err?.response?.data?.detail) ||
                                                                err.message,
                                                        );
                                                    }
                                                }}
                                            >
                                                Borrar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingCode ? `Editar plan ${editingCode}` : "Nuevo plan"}
                        </DialogTitle>
                    </DialogHeader>
                    <TooltipProvider delayDuration={200}>
                    <div className="grid sm:grid-cols-2 gap-3 py-2">
                        {!editingCode && (
                            <div className="space-y-1.5">
                                <FieldHint
                                    label="Código"
                                    tip="Identificador interno único (slug). No lo ve el público como título; se usa en facturación, seeds y APIs. Ej: basico, profesional. No se puede cambiar después de crear."
                                />
                                <Input value={form.code} onChange={setField("code")} placeholder="basico" />
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Nombre"
                                tip="Nombre comercial del plan. Sale en /registro (cards de planes), onboarding al pagar y en Configuración → Plan del organizador."
                            />
                            <Input value={form.name} onChange={setField("name")} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <FieldHint
                                label="Descripción"
                                tip="Texto corto bajo el nombre en el showcase de planes del registro. Explicá para quién es el plan (1–2 frases)."
                            />
                            <Textarea value={form.description} onChange={setField("description")} rows={2} />
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Precio (USD)"
                                tip="Monto de la membresía en dólares con decimales. Ej: 20.00. Se cobra vía Stripe / Nuvei / DeUna al activar el plan. Internamente se guarda en centavos."
                            />
                            <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    $
                                </span>
                                <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    className="pl-7"
                                    value={form.price_dollars}
                                    onChange={setField("price_dollars")}
                                    placeholder="20.00"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Periodo"
                                tip="Cómo se factura: pago único (evento_unico), mensual o anual. Define el modo de checkout (subscription vs payment) y el texto ‘/ mes’ en las cards."
                            />
                            <Select
                                value={form.billing_period}
                                onValueChange={(v) => setForm((f) => ({ ...f, billing_period: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="one_time">Pago único</SelectItem>
                                    <SelectItem value="monthly">Mensual</SelectItem>
                                    <SelectItem value="annual">Anual</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Eventos / mes (-1 ∞)"
                                tip="Tope de eventos que puede crear por mes calendario. -1 = ilimitado. Se valida en el panel al crear eventos; si se excede, pide upgrade de plan."
                            />
                            <Input type="number" value={form.max_events} onChange={setField("max_events")} />
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Eventos / año (-1 ∞)"
                                tip="Tope anual adicional (útil en planes anuales). -1 = sin límite anual. Complementa el cupo mensual."
                            />
                            <Input
                                type="number"
                                value={form.max_events_year}
                                onChange={setField("max_events_year")}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Aforo máx / evento (-1 ∞)"
                                tip="Máximo de boletos/asientos por evento. -1 = sin tope. Afecta tipos de ticket y capacidad del venue en el wizard."
                            />
                            <Input
                                type="number"
                                value={form.max_tickets_per_event}
                                onChange={setField("max_tickets_per_event")}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Venues / mapas (-1 ∞)"
                                tip="Tope de mapas activos. Se valida al crear o clonar un venue. -1 = ilimitado."
                            />
                            <Input
                                type="number"
                                value={form.max_venues}
                                onChange={setField("max_venues")}
                                data-testid="admin-plan-max-venues"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <FieldHint
                                label="Imágenes galería / evento (-1 ∞)"
                                tip="Tope de fotos en la galería del evento. -1 = ilimitado."
                            />
                            <Input
                                type="number"
                                value={form.max_gallery_images}
                                onChange={setField("max_gallery_images")}
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <FieldHint
                                label="Features marketing (1 por línea)"
                                tip="Viñetas que se muestran en la card del plan en /registro y landing. No activan funciones técnicas: son copy comercial. Ej: ‘Soporte prioritario’."
                            />
                            <Textarea
                                value={form.features_text}
                                onChange={setField("features_text")}
                                rows={3}
                            />
                        </div>

                        <Card className="sm:col-span-2 border-border/60">
                            <CardHeader className="py-3">
                                <CardTitle className="text-base inline-flex items-center gap-1.5">
                                    Módulos
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" className="text-muted-foreground" onClick={(e) => e.preventDefault()}>
                                                <CircleHelp className="h-3.5 w-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-xs">
                                            Flags que desbloquean funciones reales en el panel del organizador (wizard, página, tickets). Si está off, la UI muestra bloqueo o upgrade.
                                        </TooltipContent>
                                    </Tooltip>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="grid sm:grid-cols-2 gap-2 pb-4">
                                {[
                                    ["includes_numbered", "Localidades numeradas"],
                                    ["allows_paid_events", "Pagado / Donación"],
                                    ["allows_free_events", "Gratuito"],
                                    ["multi_function_events", "Multifunción / subeventos"],
                                    ["verified_lists", "Lista de invitados"],
                                    ["access_codes", "Código de acceso"],
                                    ["includes_ai_design", "Diseño IA tickets"],
                                    ["includes_custom_domain", "Dominio custom"],
                                    ["microsite_custom_css", "CSS de tu página"],
                                    ["includes_marketing", "Módulo marketing"],
                                ].map(([key, label]) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <Checkbox
                                            id={key}
                                            checked={Boolean(form[key])}
                                            onCheckedChange={(v) =>
                                                setForm((f) => ({ ...f, [key]: Boolean(v) }))
                                            }
                                            data-testid={`admin-plan-flag-${key}`}
                                        />
                                        <FieldHint label={label} tip={MODULE_HINTS[key]} htmlFor={key} />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="sm:col-span-2 border-border/60" data-testid="admin-plan-discounts">
                            <CardHeader className="py-3">
                                <CardTitle className="text-base inline-flex items-center gap-1.5">
                                    Descuentos (§4.2.7)
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" className="text-muted-foreground" onClick={(e) => e.preventDefault()}>
                                                <CircleHelp className="h-3.5 w-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-xs">
                                            Flags que el organizador ve en el paso Descuentos del wizard. Se guardan en feature_flags del plan.
                                        </TooltipContent>
                                    </Tooltip>
                                </CardTitle>
                                <CardDescription>
                                    Preventa, ley (discapacidad / tercera edad), códigos y reglas avanzadas.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="grid sm:grid-cols-2 gap-2 pb-4">
                                {[
                                    ["presale_discount", "Preventa"],
                                    ["disability_discount", "Ley discapacidad"],
                                    ["senior_discount", "Tercera edad"],
                                    ["promo_codes", "Códigos promocionales"],
                                    ["advanced_discounts", "Reglas avanzadas (NxM / fijo / pago)"],
                                ].map(([key, label]) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <Checkbox
                                            id={key}
                                            checked={Boolean(form[key])}
                                            onCheckedChange={(v) =>
                                                setForm((f) => ({ ...f, [key]: Boolean(v) }))
                                            }
                                        />
                                        <FieldHint label={label} tip={MODULE_HINTS[key]} htmlFor={key} />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="sm:col-span-2 border-border/60">
                            <CardHeader className="py-3">
                                <CardTitle className="text-base inline-flex items-center gap-1.5">
                                    Fee verificación (anticipado)
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" className="text-muted-foreground" onClick={(e) => e.preventDefault()}>
                                                <CircleHelp className="h-3.5 w-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-xs">
                                            Cobro único al aprobar la cuenta (antes de publicar). Se asigna según el plan elegido en el registro. Con 0.00 el organizador queda ‘waived’ y no ve este paso. Escribí dólares con decimales (ej. 10.00).
                                        </TooltipContent>
                                    </Tooltip>
                                </CardTitle>
                                <CardDescription>
                                    Cobro al aprobar la cuenta. Poné 0.00 para omitirlo (ej. plan Básico).
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pb-4 space-y-1.5">
                                <FieldHint
                                    label="Monto (USD)"
                                    tip="Ejemplos: 0.00 = sin fee (Básico); 10.00 = diez dólares. El organizador lo ve en onboarding / gates de publicación como ‘pago de verificación’."
                                />
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                        $
                                    </span>
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        className="pl-7"
                                        value={form.verification_fee_dollars}
                                        onChange={setField("verification_fee_dollars")}
                                        placeholder="10.00"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="sm:col-span-2 border-border/60">
                            <CardHeader className="py-3">
                                <CardTitle className="text-base inline-flex items-center gap-1.5">
                                    Cobro pre-evento
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" className="text-muted-foreground" onClick={(e) => e.preventDefault()}>
                                                <CircleHelp className="h-3.5 w-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-xs">
                                            Cargo de plataforma que se calcula al intentar publicar un evento. Fórmula: (aforo × centavos/entrada) + (% del GMV estimado). Hasta pagarlo, publicar responde 402.
                                        </TooltipContent>
                                    </Tooltip>
                                </CardTitle>
                                <CardDescription>
                                    Montos de este plan. Solo se cobran si el interruptor global
                                    “Exigir cargo de plataforma” está activo. Apagado en el plan:
                                    este plan publica sin cargo aunque el global esté prendido.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pb-4">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={form.event_fee_enabled}
                                        onCheckedChange={(v) =>
                                            setForm((f) => ({ ...f, event_fee_enabled: v }))
                                        }
                                    />
                                        <FieldHint
                                        label="Habilitado en este plan"
                                        tip="Si está off, los eventos de este plan no pagan cargo pre-evento aunque el interruptor global esté activo."
                                    />
                                </div>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <FieldHint
                                            label="USD por entrada"
                                            tip="Monto fijo por cada boleto de aforo estimado. Ej: 0.10 = diez centavos por entrada. Se suma al % de GMV."
                                        />
                                        <div className="relative">
                                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                                $
                                            </span>
                                            <Input
                                                type="number"
                                                inputMode="decimal"
                                                step="0.01"
                                                min="0"
                                                className="pl-7"
                                                value={form.event_fee_per_ticket_dollars}
                                                onChange={setField("event_fee_per_ticket_dollars")}
                                                disabled={!form.event_fee_enabled}
                                                placeholder="0.10"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <FieldHint
                                            label="% GMV (bps, 100 = 1%)"
                                            tip="Porcentaje del valor facturado estimado (aforo × precio) en basis points. 100 = 1%, 50 = 0.5%. El organizador ve el total al publicar."
                                        />
                                        <Input
                                            type="number"
                                            value={form.event_fee_percent_bps}
                                            onChange={setField("event_fee_percent_bps")}
                                            disabled={!form.event_fee_enabled}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            = {((Number(form.event_fee_percent_bps) || 0) / 100).toFixed(2)}%
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                    </TooltipProvider>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={save} disabled={saving} data-testid="admin-plan-save-btn">
                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
