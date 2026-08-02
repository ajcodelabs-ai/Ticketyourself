/**
 * DiscountRulesPanel — TicketShow-style cards + inline form for event discount rules.
 * Mutates `form.discounts.rules` via the wizard; no direct API calls.
 *
 * UI modalidades map to existing backend types:
 *  - percent/fixed + code  → promo_code
 *  - percent/fixed no code → auto
 *  - Lleva Y / Paga X      → buy_n_get_m
 */
import { useState } from "react";
import {
    Plus,
    Trash2,
    Pencil,
    Check,
    Calendar as CalendarIcon,
    Ticket,
    CreditCard,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const PAYMENT_METHOD_LABELS = {
    nuvei: "Nuvei",
    deuna: "DeUna",
    transfer: "Transferencia",
    cash: "Efectivo",
    stripe: "Tarjeta (Stripe)",
};

/** UI modality (not the same as backend `type`). */
const MODALITY = {
    percent: "percent",
    fixed: "fixed",
    nxm: "nxm",
};

function newDraft() {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        code: "",
        enabled: true,
        modality: MODALITY.percent,
        discount_value: 10,
        lleva_y: 2,
        paga_x: 1,
        max_uses: null,
        uses_count: 0,
        min_quantity: null,
        influencer_name: "",
        channel: "",
        conditions: {
            locality_ids: [],
            max_per_buyer: null,
            valid_from: null,
            valid_until: null,
            payment_methods: [],
        },
        _isNew: true,
    };
}

function modalityOf(rule) {
    if (rule.type === "buy_n_get_m") return MODALITY.nxm;
    if (rule.discount?.type === "fixed") return MODALITY.fixed;
    return MODALITY.percent;
}

function ruleToDraft(rule) {
    const buy = rule.buy_quantity ?? 1;
    const free = rule.free_quantity ?? 1;
    return {
        id: rule.id,
        name: rule.name || "",
        code: rule.code || "",
        enabled: rule.enabled !== false,
        modality: modalityOf(rule),
        discount_value: rule.discount?.value ?? 10,
        // UI: Lleva Y / Paga X  →  Y = buy+free, X = buy
        lleva_y: buy + free,
        paga_x: buy,
        max_uses: rule.max_uses ?? null,
        uses_count: rule.uses_count ?? 0,
        min_quantity: rule.min_quantity ?? null,
        influencer_name: rule.influencer_name || "",
        channel: rule.channel || "",
        conditions: {
            locality_ids: [...(rule.conditions?.locality_ids || [])],
            max_per_buyer: rule.conditions?.max_per_buyer ?? null,
            valid_from: rule.conditions?.valid_from ?? null,
            valid_until: rule.conditions?.valid_until ?? null,
            payment_methods: [...(rule.conditions?.payment_methods || [])],
        },
        _isNew: false,
        _legacyType: rule.type,
    };
}

function draftToRule(draft) {
    const code = (draft.code || "").trim().toUpperCase();
    const hasCode = code.length > 0;
    const modality = draft.modality;

    let type;
    if (modality === MODALITY.nxm) {
        type = "buy_n_get_m";
    } else if (hasCode) {
        type = "promo_code";
    } else {
        type = "auto";
    }

    const lleva = Number(draft.lleva_y) || 0;
    const paga = Number(draft.paga_x) || 0;
    const buy_quantity = modality === MODALITY.nxm ? paga : null;
    const free_quantity =
        modality === MODALITY.nxm ? Math.max(0, lleva - paga) : null;

    return {
        id: draft.id,
        name: (draft.name || "").trim(),
        type,
        enabled: !!draft.enabled,
        code: hasCode ? code : null,
        max_uses: draft.max_uses || null,
        uses_count: draft.uses_count || 0,
        min_quantity: draft.min_quantity || null,
        buy_quantity,
        free_quantity,
        influencer_name: draft.influencer_name || null,
        channel: draft.channel || null,
        conditions: {
            locality_ids: draft.conditions?.locality_ids || [],
            max_per_buyer: draft.conditions?.max_per_buyer || null,
            valid_from: draft.conditions?.valid_from || null,
            valid_until: draft.conditions?.valid_until || null,
            payment_methods: draft.conditions?.payment_methods || [],
        },
        discount:
            modality === MODALITY.nxm
                ? null
                : {
                      type: modality === MODALITY.fixed ? "fixed" : "percent",
                      value: Number(draft.discount_value) || 0,
                  },
    };
}

function modalityBadge(rule) {
    if (rule.type === "buy_n_get_m") return "Promo";
    if (rule.type === "quantity") return "Cantidad";
    if (rule.discount?.type === "fixed") return "Valor fijo";
    if (rule.type === "promo_code") return "Porcentaje";
    if (rule.type === "auto") return "Porcentaje";
    return "Descuento";
}

function valueHeadline(rule) {
    if (rule.type === "buy_n_get_m") {
        const buy = Number(rule.buy_quantity) || 0;
        const free = Number(rule.free_quantity) || 0;
        const lleva = buy + free;
        return buy > 0 ? `${lleva}x${buy}` : "—";
    }
    if (rule.discount?.type === "fixed") return `$${rule.discount.value}`;
    if (rule.discount?.value != null) return `${rule.discount.value}%`;
    return "—";
}

function formatShortDate(iso) {
    if (!iso) return null;
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
    } catch {
        return null;
    }
}

function isoToInput(v) {
    if (!v) return "";
    try {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return "";
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return "";
    }
}

function inputToISO(v) {
    if (!v) return null;
    try {
        return new Date(v).toISOString();
    } catch {
        return null;
    }
}

export default function DiscountRulesPanel({
    rules,
    onChange,
    localities = [],
    enabledPaymentMethods = Object.keys(PAYMENT_METHOD_LABELS),
}) {
    const [draft, setDraft] = useState(null); // null = list mode

    const openNew = () => setDraft(newDraft());
    const openEdit = (rule) => setDraft(ruleToDraft(rule));
    const close = () => setDraft(null);

    const save = () => {
        if (!draft) return;
        const name = (draft.name || "").trim();
        if (name.length < 2) {
            toast.error("El nombre debe tener al menos 2 caracteres.");
            return;
        }
        if (draft.modality === MODALITY.nxm) {
            const lleva = Number(draft.lleva_y) || 0;
            const paga = Number(draft.paga_x) || 0;
            if (lleva < 2) {
                toast.error("Lleva (Y) debe ser al menos 2.");
                return;
            }
            if (paga < 1 || paga >= lleva) {
                toast.error("Paga (X) debe ser menor que Lleva (Y).");
                return;
            }
        } else {
            const val = Number(draft.discount_value) || 0;
            if (val <= 0) {
                toast.error("Indicá un valor de descuento válido.");
                return;
            }
            if (draft.modality === MODALITY.percent && val > 100) {
                toast.error("El porcentaje no puede superar 100.");
                return;
            }
        }

        const rule = draftToRule(draft);
        const exists = rules.find((r) => r.id === rule.id);
        const next = exists
            ? rules.map((r) => (r.id === rule.id ? rule : r))
            : [...rules, rule];
        onChange(next);
        close();
        toast.success(exists ? "Descuento actualizado." : "Descuento creado.");
    };

    const remove = (id) => {
        if (!window.confirm("¿Eliminar este descuento?")) return;
        onChange(rules.filter((r) => r.id !== id));
    };

    const toggle = (id, enabled) =>
        onChange(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));

    if (draft) {
        return (
            <InlineDiscountForm
                draft={draft}
                setDraft={setDraft}
                localities={localities}
                enabledPaymentMethods={enabledPaymentMethods}
                onCancel={close}
                onSave={save}
            />
        );
    }

    return (
        <div className="space-y-4" data-testid="discount-rules-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-xs text-muted-foreground max-w-md space-y-1">
                    <p>Configura descuentos por porcentaje, valor fijo o promociones 2x1.</p>
                    <p>
                        Stacking máximo:{" "}
                        <strong className="text-foreground">1 código + 1 automático/cantidad</strong>.
                    </p>
                </div>
                <Button size="sm" onClick={openNew} data-testid="disc-rule-add">
                    <Plus className="h-4 w-4 mr-1.5" /> Nuevo descuento
                </Button>
            </div>

            {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 text-center space-y-2 bg-card">
                    <p className="text-sm font-medium">Sin descuentos todavía</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Creá un porcentaje, un monto fijo o una promo Lleva Y / Paga X.
                    </p>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={openNew}
                        className="mt-1"
                        data-testid="disc-rule-add-empty"
                    >
                        <Plus className="h-4 w-4 mr-1.5" /> Nuevo descuento
                    </Button>
                </div>
            ) : (
                <div
                    className="grid sm:grid-cols-2 gap-3"
                    data-testid="disc-rules-list"
                >
                    {rules.map((r) => (
                        <DiscountCard
                            key={r.id}
                            rule={r}
                            onEdit={() => openEdit(r)}
                            onRemove={() => remove(r.id)}
                            onToggle={(v) => toggle(r.id, v)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function DiscountCard({ rule, onEdit, onRemove, onToggle }) {
    const from = formatShortDate(rule.conditions?.valid_from);
    const until = formatShortDate(rule.conditions?.valid_until);
    const dateRange =
        from || until ? `${from || "…"} - ${until || "…"}` : null;
    const locN = rule.conditions?.locality_ids?.length || 0;
    const pmN = rule.conditions?.payment_methods?.length || 0;
    const usesLabel = rule.max_uses
        ? `${rule.uses_count || 0}/${rule.max_uses}`
        : `${rule.uses_count || 0}/∞`;

    return (
        <div
            className={`rounded-xl border bg-card p-4 space-y-3 transition ${
                rule.enabled ? "" : "opacity-60"
            }`}
            data-testid={`disc-rule-${rule.id}`}
        >
            <div className="flex items-start justify-between gap-2">
                <Badge variant="secondary" className="text-[10px] font-medium">
                    {modalityBadge(rule)}
                </Badge>
                <div className="flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => onToggle(!rule.enabled)}
                        className={`h-8 w-8 rounded-md flex items-center justify-center ${
                            rule.enabled
                                ? "text-emerald-600 hover:bg-emerald-50"
                                : "text-muted-foreground hover:bg-secondary"
                        }`}
                        title={rule.enabled ? "Activo" : "Inactivo"}
                        data-testid={`disc-rule-${rule.id}-toggle`}
                        aria-label={rule.enabled ? "Desactivar" : "Activar"}
                    >
                        <Check className="h-4 w-4" />
                    </button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onEdit}
                        aria-label="Editar"
                        data-testid={`disc-rule-${rule.id}-edit`}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onRemove}
                        className="text-red-600 hover:bg-red-50"
                        aria-label="Eliminar"
                        data-testid={`disc-rule-${rule.id}-delete`}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="text-3xl font-semibold tracking-tight leading-none">
                {valueHeadline(rule)}
            </div>
            <div className="font-medium text-sm">{rule.name}</div>
            {rule.type === "promo_code" && rule.code && (
                <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                    {rule.code}
                </code>
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                    <Ticket className="h-3 w-3" />
                    {usesLabel}
                </span>
                {dateRange && (
                    <span className="inline-flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {dateRange}
                    </span>
                )}
                {locN > 0 && (
                    <span>
                        {locN} local.
                    </span>
                )}
                {pmN > 0 && (
                    <span className="inline-flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {pmN} F.P.
                    </span>
                )}
            </div>
        </div>
    );
}

function InlineDiscountForm({
    draft,
    setDraft,
    localities,
    enabledPaymentMethods,
    onCancel,
    onSave,
}) {
    const upd = (patch) => setDraft((d) => ({ ...d, ...patch }));
    const updCond = (patch) =>
        setDraft((d) => ({
            ...d,
            conditions: { ...d.conditions, ...patch },
        }));

    const locIds = draft.conditions.locality_ids || [];
    const pmIds = draft.conditions.payment_methods || [];
    const paymentOptions = Array.from(
        new Set([...enabledPaymentMethods, ...pmIds]),
    );

    const setModality = (modality) => {
        upd({
            modality,
            discount_value: draft.discount_value || 10,
            lleva_y: draft.lleva_y || 2,
            paga_x: draft.paga_x || 1,
        });
    };

    const toggleLoc = (id) => {
        const set = new Set(locIds);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        updCond({ locality_ids: Array.from(set) });
    };

    const togglePm = (key) => {
        const set = new Set(pmIds);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        updCond({ payment_methods: Array.from(set) });
    };

    const isNew = !!draft._isNew;

    return (
        <div
            className="rounded-xl border bg-card p-4 space-y-5"
            data-testid="disc-rule-form"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-semibold text-sm">
                    {isNew ? "+ Nuevo descuento" : "Editar descuento"}
                </h4>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCancel}
                        data-testid="rule-cancel"
                    >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={onSave}
                        data-testid="rule-save"
                    >
                        {isNew ? "Crear descuento" : "Guardar descuento"}
                    </Button>
                </div>
            </div>

            {/* Definición + Vigencia */}
            <div className="grid lg:grid-cols-2 gap-6">
                <section className="space-y-3">
                    <h5 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                        Definición
                    </h5>
                    <Field label="Nombre *">
                        <Input
                            value={draft.name}
                            onChange={(e) => upd({ name: e.target.value })}
                            placeholder="Ej: Early Bird 20%"
                            data-testid="rule-name"
                        />
                    </Field>
                    <Field label="Código">
                        <Input
                            value={draft.code || ""}
                            onChange={(e) =>
                                upd({ code: e.target.value.toUpperCase() })
                            }
                            placeholder="Ej: EARLY20"
                            maxLength={40}
                            data-testid="rule-code"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Opcional. Si lo dejás vacío, el descuento se aplica
                            automáticamente en checkout.
                        </p>
                    </Field>
                    <Field label="Estado">
                        <Select
                            value={draft.enabled ? "active" : "inactive"}
                            onValueChange={(v) =>
                                upd({ enabled: v === "active" })
                            }
                        >
                            <SelectTrigger data-testid="rule-status">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Activo</SelectItem>
                                <SelectItem value="inactive">Inactivo</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="Modalidad *">
                        <Select
                            value={draft.modality}
                            onValueChange={setModality}
                        >
                            <SelectTrigger data-testid="rule-modality">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={MODALITY.percent}>
                                    Porcentaje (%)
                                </SelectItem>
                                <SelectItem value={MODALITY.fixed}>
                                    Valor fijo (USD)
                                </SelectItem>
                                <SelectItem value={MODALITY.nxm}>
                                    Lleva Y / Paga X (2x1)
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    {draft.modality === MODALITY.nxm ? (
                        <Field label="Lleva Y / Paga X *">
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    min="2"
                                    className="w-20"
                                    value={draft.lleva_y ?? ""}
                                    onChange={(e) =>
                                        upd({
                                            lleva_y: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : null,
                                        })
                                    }
                                    data-testid="rule-buy-qty"
                                />
                                <span className="text-muted-foreground text-sm">/</span>
                                <Input
                                    type="number"
                                    min="1"
                                    className="w-20"
                                    value={draft.paga_x ?? ""}
                                    onChange={(e) =>
                                        upd({
                                            paga_x: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : null,
                                        })
                                    }
                                    data-testid="rule-free-qty"
                                />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                                Ej: 2 / 1 = promo 2x1 (pagás 1, llevás 2).
                            </p>
                        </Field>
                    ) : (
                        <Field
                            label={
                                draft.modality === MODALITY.fixed
                                    ? "Monto (USD) *"
                                    : "Porcentaje *"
                            }
                        >
                            <div className="relative">
                                <Input
                                    type="number"
                                    min="1"
                                    max={
                                        draft.modality === MODALITY.percent
                                            ? 100
                                            : undefined
                                    }
                                    value={draft.discount_value || ""}
                                    onChange={(e) =>
                                        upd({
                                            discount_value: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : 0,
                                        })
                                    }
                                    data-testid="rule-discount-value"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    {draft.modality === MODALITY.fixed ? "USD" : "%"}
                                </span>
                            </div>
                        </Field>
                    )}
                </section>

                <section className="space-y-3">
                    <h5 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                        Vigencia y cupos
                    </h5>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Fecha inicio">
                            <Input
                                type="datetime-local"
                                value={isoToInput(draft.conditions.valid_from)}
                                onChange={(e) =>
                                    updCond({
                                        valid_from: inputToISO(e.target.value),
                                    })
                                }
                                data-testid="rule-valid-from"
                            />
                        </Field>
                        <Field label="Fecha fin">
                            <Input
                                type="datetime-local"
                                value={isoToInput(draft.conditions.valid_until)}
                                onChange={(e) =>
                                    updCond({
                                        valid_until: inputToISO(e.target.value),
                                    })
                                }
                                data-testid="rule-valid-until"
                            />
                        </Field>
                    </div>
                    <Field label="Cupo total">
                        <Input
                            type="number"
                            min="1"
                            value={draft.max_uses ?? ""}
                            onChange={(e) =>
                                upd({
                                    max_uses: e.target.value
                                        ? parseInt(e.target.value, 10)
                                        : null,
                                })
                            }
                            placeholder="Ej: 100"
                            data-testid="rule-max-uses"
                        />
                    </Field>
                    <Field label="Cupo / usuario">
                        <Input
                            type="number"
                            min="1"
                            value={draft.conditions.max_per_buyer ?? ""}
                            onChange={(e) =>
                                updCond({
                                    max_per_buyer: e.target.value
                                        ? parseInt(e.target.value, 10)
                                        : null,
                                })
                            }
                            placeholder="Ej: 2"
                            data-testid="rule-max-buyer"
                        />
                    </Field>
                </section>
            </div>

            {/* Localidades */}
            {localities.length > 0 && (
                <section className="space-y-2" data-testid="rule-localities">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-sm">
                            Localidades{" "}
                            <span className="text-muted-foreground font-normal">
                                {locIds.length}/{localities.length} seleccionadas
                            </span>
                        </Label>
                        <div className="flex gap-1.5">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                    updCond({
                                        locality_ids: localities.map((l) => l.id),
                                    })
                                }
                                data-testid="rule-loc-all"
                            >
                                Todas
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => updCond({ locality_ids: [] })}
                                data-testid="rule-loc-clear"
                            >
                                Limpiar
                            </Button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {localities.map((loc) => {
                            const on = locIds.includes(loc.id);
                            return (
                                <button
                                    key={loc.id}
                                    type="button"
                                    onClick={() => toggleLoc(loc.id)}
                                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition ${
                                        on
                                            ? "border-primary bg-primary/10"
                                            : "border-border hover:bg-secondary"
                                    }`}
                                    data-testid={`rule-loc-${loc.id}`}
                                >
                                    <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ background: loc.color || "#888" }}
                                    />
                                    {loc.name}
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Vacío = aplica a todas las localidades.
                    </p>
                </section>
            )}

            {/* Formas de pago */}
            <section className="space-y-2" data-testid="rule-payment-methods">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm">
                        Formas de pago{" "}
                        <span className="text-muted-foreground font-normal">
                            {pmIds.length}/{paymentOptions.length || 0}{" "}
                            seleccionadas
                        </span>
                    </Label>
                    <div className="flex gap-1.5">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                                updCond({
                                    payment_methods: [...enabledPaymentMethods],
                                })
                            }
                            disabled={enabledPaymentMethods.length === 0}
                            data-testid="rule-pm-all"
                        >
                            Todas
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updCond({ payment_methods: [] })}
                            data-testid="rule-pm-clear"
                        >
                            Limpiar
                        </Button>
                    </div>
                </div>
                {paymentOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Activá al menos una forma de pago en el paso anterior.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {paymentOptions.map((key) => {
                            const on = pmIds.includes(key);
                            const enabled = enabledPaymentMethods.includes(key);
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => togglePm(key)}
                                    title={
                                        enabled
                                            ? undefined
                                            : "Ya no está habilitado en Formas de pago"
                                    }
                                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
                                        on
                                            ? enabled
                                                ? "border-primary bg-primary/10"
                                                : "border-amber-400 bg-amber-50 text-amber-800"
                                            : "border-border hover:bg-secondary"
                                    }`}
                                    data-testid={`rule-pm-${key}`}
                                >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    {PAYMENT_METHOD_LABELS[key] || key}
                                    {!enabled && " ⚠"}
                                </button>
                            );
                        })}
                    </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                    Vacío = aplica con cualquier forma de pago.
                </p>
            </section>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-sm">{label}</Label>
            {children}
        </div>
    );
}
