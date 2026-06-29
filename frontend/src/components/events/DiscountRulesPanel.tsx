/**
 * DiscountRulesPanel — list + add/edit/delete UI for event discount rules
 * (promo code / auto / quantity). Plugged into the wizard's Descuentos tab
 * below the legacy disability/presale toggles.
 *
 * The panel does NOT save to the API directly; it mutates `form.discounts.rules`
 * via the wizard's `update` helper. The wizard then persists on Save Draft.
 */
import { useMemo, useState } from "react";
import {
    Plus,
    Tag,
    Trash2,
    Pencil,
    BadgeCheck,
    Hash,
    Zap,
    Gift,
    Megaphone,
    CreditCard,
    Calendar as CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

const TYPE_ICONS = {
    promo_code: Tag,
    auto: Zap,
    quantity: Hash,
    buy_n_get_m: Gift,
};

const TYPE_LABELS = {
    promo_code: "Código promocional",
    auto: "Automático",
    quantity: "Por cantidad",
    buy_n_get_m: "Compra y recibe gratis (NxM)",
};

const PAYMENT_METHOD_LABELS = {
    stripe: "Tarjeta (Stripe)",
    transfer: "Transferencia",
    cash: "Efectivo",
};

function newRule() {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        type: "promo_code",
        enabled: true,
        code: "",
        max_uses: null,
        uses_count: 0,
        min_quantity: null,
        buy_quantity: null,
        free_quantity: null,
        influencer_name: "",
        channel: "",
        conditions: {
            locality_ids: [],
            max_per_buyer: null,
            valid_from: null,
            valid_until: null,
            payment_methods: [],
        },
        discount: { type: "percent", value: 10 },
    };
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
    const [editing, setEditing] = useState(null); // null = closed; {} = new; full obj = edit

    const open = (rule) => setEditing(rule || newRule());
    const close = () => setEditing(null);

    const save = (rule) => {
        // Validation
        if (!rule.name || rule.name.trim().length < 2) return;
        if (rule.type === "promo_code" && !rule.code) return;
        if (rule.type === "quantity" && (!rule.min_quantity || rule.min_quantity < 1)) return;
        if (rule.type === "buy_n_get_m") {
            if (!rule.buy_quantity || rule.buy_quantity < 1) return;
            if (!rule.free_quantity || rule.free_quantity < 1) return;
        } else {
            if (!rule.discount.value || rule.discount.value <= 0) return;
            if (rule.discount.type === "percent" && rule.discount.value > 100) return;
        }

        const exists = rules.find((r) => r.id === rule.id);
        const next = exists
            ? rules.map((r) => (r.id === rule.id ? rule : r))
            : [...rules, rule];
        onChange(next);
        close();
    };

    const remove = (id) => {
        if (!window.confirm("¿Eliminar esta regla?")) return;
        onChange(rules.filter((r) => r.id !== id));
    };

    const toggle = (id, enabled) =>
        onChange(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));

    return (
        <div className="rounded-lg border p-4 bg-card space-y-3" data-testid="discount-rules-panel">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="font-medium">Reglas de descuento</div>
                    <div className="text-xs text-muted-foreground">
                        Códigos promocionales, descuentos automáticos o por cantidad. Stacking
                        máximo: <strong>1 código + 1 automático/por cantidad</strong>.
                    </div>
                </div>
                <Button size="sm" onClick={() => open(null)} data-testid="disc-rule-add">
                    <Plus className="h-4 w-4 mr-1.5" /> Agregar regla
                </Button>
            </div>

            {rules.length === 0 ? (
                <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                    Sin reglas todavía. Agregá una para ofrecer códigos promocionales o
                    descuentos automáticos.
                </div>
            ) : (
                <ul className="space-y-2" data-testid="disc-rules-list">
                    {rules.map((r) => (
                        <RuleCard
                            key={r.id}
                            rule={r}
                            localities={localities}
                            onEdit={() => open({ ...r })}
                            onRemove={() => remove(r.id)}
                            onToggle={(v) => toggle(r.id, v)}
                        />
                    ))}
                </ul>
            )}

            <RuleDialog
                open={!!editing}
                rule={editing}
                onChange={setEditing}
                onCancel={close}
                onSave={save}
                localities={localities}
                enabledPaymentMethods={enabledPaymentMethods}
            />
        </div>
    );
}

function RuleCard({ rule, localities, onEdit, onRemove, onToggle }) {
    const Icon = TYPE_ICONS[rule.type] || BadgeCheck;
    const benefit =
        rule.type === "buy_n_get_m"
            ? `${rule.buy_quantity}x${rule.free_quantity} gratis`
            : rule.discount.type === "percent"
              ? `${rule.discount.value}% off`
              : `–$${rule.discount.value} fijo`;
    const cond = rule.conditions || {};
    const condParts = [];
    if (cond.locality_ids?.length > 0) {
        const names = cond.locality_ids
            .map((id) => localities.find((l) => l.id === id)?.name || id)
            .join(", ");
        condParts.push(`Solo ${names}`);
    }
    if (cond.payment_methods?.length > 0) {
        condParts.push(
            `Solo ${cond.payment_methods.map((m) => PAYMENT_METHOD_LABELS[m] || m).join(", ")}`,
        );
    }
    if (cond.max_per_buyer) condParts.push(`Máx ${cond.max_per_buyer}/compra`);
    if (cond.valid_until)
        condParts.push(`Hasta ${new Date(cond.valid_until).toLocaleDateString("es-EC")}`);
    return (
        <li
            className="rounded-lg border p-3 flex items-start justify-between gap-3"
            data-testid={`disc-rule-${rule.id}`}
        >
            <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{rule.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                            {TYPE_LABELS[rule.type]}
                        </Badge>
                        <Badge className="bg-primary/15 text-primary border-primary/20">
                            {benefit}
                        </Badge>
                        {rule.type === "promo_code" && (
                            <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                                {rule.code}
                            </code>
                        )}
                        {rule.influencer_name && (
                            <Badge variant="outline" className="text-[10px]">
                                <Megaphone className="h-3 w-3 mr-1" />
                                {rule.influencer_name}
                                {rule.channel ? ` · ${rule.channel}` : ""}
                            </Badge>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {condParts.length > 0 ? condParts.join(" · ") : "Aplica a todo el evento"}
                        {rule.max_uses && (
                            <span className="ml-2">
                                · {rule.uses_count}/{rule.max_uses} usos
                            </span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-1.5">
                <Switch
                    checked={!!rule.enabled}
                    onCheckedChange={onToggle}
                    data-testid={`disc-rule-${rule.id}-toggle`}
                />
                <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRemove}
                    className="text-red-600 hover:bg-red-50"
                    aria-label="Eliminar"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </li>
    );
}

function RuleDialog({ open, rule, onChange, onCancel, onSave, localities, enabledPaymentMethods = Object.keys(PAYMENT_METHOD_LABELS) }) {
    const upd = (patch) => onChange({ ...rule, ...patch });
    const updCond = (patch) =>
        onChange({ ...rule, conditions: { ...rule.conditions, ...patch } });
    const updBenefit = (patch) =>
        onChange({ ...rule, discount: { ...rule.discount, ...patch } });

    const preview = useMemo(() => {
        if (!rule) return null;
        const sample = 2000; // $20.00 sample ticket
        if (rule.discount.type === "percent")
            return ((sample * (rule.discount.value || 0)) / 100 / 100).toFixed(2);
        return (rule.discount.value || 0).toFixed(2);
    }, [rule]);

    if (!rule) return null;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="disc-rule-dialog">
                <DialogHeader>
                    <DialogTitle>
                        {rules_isExisting(rule) ? "Editar regla" : "Nueva regla de descuento"}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Section 1 — basics */}
                    <section className="space-y-3">
                        <h4 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                            Datos básicos
                        </h4>
                        <div className="space-y-1.5">
                            <Label>Nombre interno *</Label>
                            <Input
                                value={rule.name}
                                onChange={(e) => upd({ name: e.target.value })}
                                placeholder="Ej: Descuento estudiante"
                                data-testid="rule-name"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Tipo *</Label>
                            <Select value={rule.type} onValueChange={(v) => upd({ type: v })}>
                                <SelectTrigger data-testid="rule-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="promo_code">Código promocional</SelectItem>
                                    <SelectItem value="auto">Automático</SelectItem>
                                    <SelectItem value="quantity">Por cantidad</SelectItem>
                                    <SelectItem value="buy_n_get_m">Compra N y recibe M gratis</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {rule.type === "promo_code" && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Código *</Label>
                                    <Input
                                        value={rule.code || ""}
                                        onChange={(e) =>
                                            upd({ code: e.target.value.toUpperCase() })
                                        }
                                        placeholder="ESTUDIANTE25"
                                        maxLength={40}
                                        data-testid="rule-code"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Máx. usos</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={rule.max_uses ?? ""}
                                        onChange={(e) =>
                                            upd({
                                                max_uses: e.target.value
                                                    ? parseInt(e.target.value, 10)
                                                    : null,
                                            })
                                        }
                                        placeholder="Sin límite"
                                        data-testid="rule-max-uses"
                                    />
                                </div>
                            </div>
                        )}
                        {rule.type === "promo_code" && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="flex items-center gap-1">
                                        <Megaphone className="h-3.5 w-3.5" /> Influencer (opcional)
                                    </Label>
                                    <Input
                                        value={rule.influencer_name || ""}
                                        onChange={(e) => upd({ influencer_name: e.target.value })}
                                        placeholder="Ej: @juanaperez"
                                        maxLength={80}
                                        data-testid="rule-influencer-name"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Canal</Label>
                                    <Input
                                        value={rule.channel || ""}
                                        onChange={(e) => upd({ channel: e.target.value })}
                                        placeholder="Instagram, TikTok…"
                                        maxLength={40}
                                        data-testid="rule-channel"
                                    />
                                </div>
                            </div>
                        )}
                        {rule.type === "quantity" && (
                            <div className="space-y-1.5">
                                <Label>Cantidad mínima de tickets *</Label>
                                <Input
                                    type="number"
                                    min="2"
                                    value={rule.min_quantity ?? ""}
                                    onChange={(e) =>
                                        upd({
                                            min_quantity: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : null,
                                        })
                                    }
                                    placeholder="Ej: 4"
                                    data-testid="rule-min-qty"
                                />
                            </div>
                        )}
                        {rule.type === "buy_n_get_m" && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Compra (N) *</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={rule.buy_quantity ?? ""}
                                        onChange={(e) =>
                                            upd({
                                                buy_quantity: e.target.value
                                                    ? parseInt(e.target.value, 10)
                                                    : null,
                                            })
                                        }
                                        placeholder="Ej: 2"
                                        data-testid="rule-buy-qty"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Recibe gratis (M) *</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={rule.free_quantity ?? ""}
                                        onChange={(e) =>
                                            upd({
                                                free_quantity: e.target.value
                                                    ? parseInt(e.target.value, 10)
                                                    : null,
                                            })
                                        }
                                        placeholder="Ej: 1"
                                        data-testid="rule-free-qty"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground col-span-2 bg-secondary/40 rounded p-2">
                                    Por cada grupo de{" "}
                                    <strong>{(rule.buy_quantity || 0) + (rule.free_quantity || 0)}</strong>{" "}
                                    tickets elegibles, los <strong>{rule.free_quantity || 0}</strong> más
                                    económicos del grupo van gratis.
                                </p>
                            </div>
                        )}
                    </section>

                    {/* Section 2 — conditions */}
                    <section className="space-y-3">
                        <h4 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                            Condiciones (opcionales)
                        </h4>
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1">
                                <CreditCard className="h-3.5 w-3.5" /> Formas de pago habilitadas
                            </Label>
                            <div className="flex flex-wrap gap-2">
                                {Array.from(
                                    new Set([
                                        ...enabledPaymentMethods,
                                        ...(rule.conditions.payment_methods || []),
                                    ]),
                                ).map((key) => {
                                    const label = PAYMENT_METHOD_LABELS[key] || key;
                                    const checked = (rule.conditions.payment_methods || []).includes(key);
                                    const isEnabled = enabledPaymentMethods.includes(key);
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            title={
                                                isEnabled
                                                    ? undefined
                                                    : "Este método no está habilitado en \"Formas de pago\""
                                            }
                                            onClick={() => {
                                                const list = new Set(rule.conditions.payment_methods || []);
                                                if (list.has(key)) list.delete(key);
                                                else list.add(key);
                                                updCond({ payment_methods: Array.from(list) });
                                            }}
                                            className={`text-xs px-2 py-1 rounded-md border transition ${
                                                checked
                                                    ? isEnabled
                                                        ? "border-primary bg-primary/10"
                                                        : "border-amber-400 bg-amber-50 text-amber-700"
                                                    : "border-border hover:bg-secondary"
                                            }`}
                                            data-testid={`rule-pm-${key}`}
                                        >
                                            {label}
                                            {!isEnabled && " ⚠"}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Vacío = aplica con cualquier forma de pago. Solo se muestran
                                los métodos habilitados en "Formas de pago"
                                {(rule.conditions.payment_methods || []).some(
                                    (m) => !enabledPaymentMethods.includes(m),
                                )
                                    ? " (⚠ = ya no está habilitado, el descuento nunca se aplicaría con ese método)."
                                    : "."}
                            </p>
                        </div>
                        {localities.length > 0 && (
                            <div className="space-y-1.5">
                                <Label>Localidades a las que aplica</Label>
                                <div className="flex flex-wrap gap-2">
                                    {localities.map((loc) => {
                                        const checked = (rule.conditions.locality_ids || []).includes(
                                            loc.id,
                                        );
                                        return (
                                            <button
                                                key={loc.id}
                                                type="button"
                                                onClick={() => {
                                                    const list = new Set(
                                                        rule.conditions.locality_ids || [],
                                                    );
                                                    if (list.has(loc.id)) list.delete(loc.id);
                                                    else list.add(loc.id);
                                                    updCond({ locality_ids: Array.from(list) });
                                                }}
                                                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition ${
                                                    checked
                                                        ? "border-primary bg-primary/10"
                                                        : "border-border hover:bg-secondary"
                                                }`}
                                                data-testid={`rule-loc-${loc.id}`}
                                            >
                                                <span
                                                    className="h-2.5 w-2.5 rounded-sm"
                                                    style={{ background: loc.color }}
                                                />
                                                {loc.name}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Vacío = aplica a todas las localidades del evento.
                                </p>
                            </div>
                        )}
                        <div className="grid sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label>Máx. por comprador</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={rule.conditions.max_per_buyer ?? ""}
                                    onChange={(e) =>
                                        updCond({
                                            max_per_buyer: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : null,
                                        })
                                    }
                                    placeholder="—"
                                    data-testid="rule-max-buyer"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1">
                                    <CalendarIcon className="h-3.5 w-3.5" /> Desde
                                </Label>
                                <Input
                                    type="datetime-local"
                                    value={isoToInput(rule.conditions.valid_from)}
                                    onChange={(e) =>
                                        updCond({ valid_from: inputToISO(e.target.value) })
                                    }
                                    data-testid="rule-valid-from"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1">
                                    <CalendarIcon className="h-3.5 w-3.5" /> Hasta
                                </Label>
                                <Input
                                    type="datetime-local"
                                    value={isoToInput(rule.conditions.valid_until)}
                                    onChange={(e) =>
                                        updCond({ valid_until: inputToISO(e.target.value) })
                                    }
                                    data-testid="rule-valid-until"
                                />
                            </div>
                        </div>
                    </section>

                    {/* Section 3 — benefit */}
                    {rule.type !== "buy_n_get_m" && (
                        <section className="space-y-3">
                            <h4 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                                Beneficio *
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Tipo</Label>
                                    <Select
                                        value={rule.discount.type}
                                        onValueChange={(v) => updBenefit({ type: v })}
                                    >
                                        <SelectTrigger data-testid="rule-discount-type">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="percent">Porcentaje</SelectItem>
                                            <SelectItem value="fixed">Monto fijo (USD)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{rule.discount.type === "percent" ? "%" : "USD"}</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max={rule.discount.type === "percent" ? "100" : undefined}
                                        value={rule.discount.value || ""}
                                        onChange={(e) =>
                                            updBenefit({
                                                value: e.target.value
                                                    ? parseInt(e.target.value, 10)
                                                    : 0,
                                            })
                                        }
                                        data-testid="rule-discount-value"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground bg-secondary/40 rounded p-2" data-testid="rule-preview">
                                En un ticket de <strong>$20.00</strong>: descuento <strong>${preview}</strong>{" "}
                                ({rule.discount.type === "percent" ? `${rule.discount.value || 0}%` : "fijo"})
                            </p>
                        </section>
                    )}

                    {/* Section 4 — enabled */}
                    <section className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <div className="font-medium text-sm">Regla activa</div>
                            <p className="text-xs text-muted-foreground">
                                Desactivá temporalmente sin borrar la configuración.
                            </p>
                        </div>
                        <Switch
                            checked={!!rule.enabled}
                            onCheckedChange={(v) => upd({ enabled: v })}
                            data-testid="rule-enabled"
                        />
                    </section>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancelar
                    </Button>
                    <Button onClick={() => onSave(rule)} data-testid="rule-save">
                        Guardar regla
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function rules_isExisting(rule) {
    return rule && typeof rule.uses_count === "number" && rule.uses_count > 0;
}
