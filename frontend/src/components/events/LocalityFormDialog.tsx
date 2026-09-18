/**
 * Create/edit a locality: name, color, description, seating type, price.
 *
 * Assigning it to map elements is a separate step ("Mapa completo") — this
 * dialog only defines the locality itself, matching the reference app's
 * two-phase flow (define first, assign after) instead of bundling both in
 * one place with an embedded mini-map.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HexColorPicker } from "react-colorful";
import { Info, MapPinned, Users, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { LOCALITY_PALETTE, newId } from "@/lib/venues";
import {
    LOCALITY_SEATING_TYPES,
    coerceLocalitySeatingType,
} from "@/lib/attendanceFormat";
import { PlanLockBadge, UpgradePlanButton } from "@/components/plans/PlanGate";
import api from "@/lib/api";
import { centsToInput, centsToDollars, dollarsToCents } from "@/lib/money";
import { formatQuoteLabel } from "@/lib/salesFees";

function FieldTip({ text }: { text: string }) {
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label="Más información"
                        onClick={(e) => e.preventDefault()}
                    >
                        <Info className="h-3.5 w-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                    {text}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

const FIELD_TIPS = {
    color: "Color con el que se pintan en el mapa los asientos o zonas de esta localidad.",
    name: "Nombre que ve el comprador al elegir asientos (ej. Platea, VIP, General).",
    description: "Texto opcional para aclarar qué incluye o dónde queda esta localidad.",
    seating:
        "La localidad define si el comprador elige butaca (numerada) o cantidad (no numerada). Un evento mixto se arma combinando ambos tipos de localidad.",
    price: "Precio base de la entrada. La comisión TYS se calcula sobre este monto (fijo o %, según la regla del admin).",
    service:
        "Cargo de servicio configurable por ticket. Se suma al total del comprador.",
    admin:
        "TicketSeguro: cobertura / seguro por ticket. Deja $0 si no aplica.",
    vxs: "Impuestos (IVA u otros) por ticket.",
    wallet: "Billetera Virtual: cargo o recarga asociada al ticket.",
    reservedQuota:
        "Cupos apartados para auspiciantes, producción, staff o familiares. Se restan del aforo total del evento — no garantiza que queden libres específicamente en esta localidad.",
};

const emptyDraftMoney = { price: "", vxs: "", service: "", admin: "", wallet: "" };

const OPTIONAL_SERVICES = [
    { key: "service", label: "Cargo de servicio", tipKey: "service", testid: "locality-form-service", centsKey: "service_fee_cents" },
    { key: "admin", label: "TicketSeguro", tipKey: "admin", testid: "locality-form-admin", centsKey: "admin_fee_cents" },
    { key: "vxs", label: "Impuestos", tipKey: "vxs", testid: "locality-form-vxs", centsKey: "vxs_cents" },
    { key: "wallet", label: "Billetera Virtual", tipKey: "wallet", testid: "locality-form-wallet", centsKey: "wallet_fee_cents" },
] as const;

export function servicesWithAmount(initial) {
    if (!initial) return [];
    return OPTIONAL_SERVICES.filter((s) => (Number(initial[s.centsKey]) || 0) > 0).map((s) => s.key);
}

// Comparable snapshot of the editable fields, for dirty-checking against the
// last-saved values (TI-152). addedServices is sorted so toggling an item
// off and back on doesn't read as "changed" just because the array order
// shifted.
function snapshotOf({ name, color, description, seatingType, money, addedServices, reservedQuota }) {
    return JSON.stringify({
        name,
        color,
        description,
        seatingType,
        money,
        addedServices: [...addedServices].sort(),
        // Numeric compare, not string: the field itself renders "" for a
        // saved value of 0 (see setReservedQuota above), so typing "0" back
        // in must read as "unchanged", not as a pending edit.
        reservedQuota: Number(reservedQuota) || 0,
    });
}

/** A Gratuito event can't charge anything (TI-121) — zero every money field
 * regardless of what's in the form, not just disable the inputs. */
export function moneyPayload(pricingType, money) {
    const isFree = pricingType === "free";
    return {
        price_cents: isFree ? 0 : (dollarsToCents(money.price) ?? 0),
        vxs_cents: isFree ? 0 : (dollarsToCents(money.vxs) ?? 0),
        service_fee_cents: isFree ? 0 : (dollarsToCents(money.service) ?? 0),
        admin_fee_cents: isFree ? 0 : (dollarsToCents(money.admin) ?? 0),
        wallet_fee_cents: isFree ? 0 : (dollarsToCents(money.wallet) ?? 0),
    };
}

export function localityBuyerBreakdown({
    money,
    addedServices = [],
    feeQuote = null,
    feeBearer = "buyer",
}) {
    const priceCents = dollarsToCents(money?.price) ?? 0;
    const lines = [{ key: "price", label: "Precio entrada", cents: priceCents }];
    for (const s of OPTIONAL_SERVICES) {
        if (!addedServices.includes(s.key)) continue;
        lines.push({
            key: s.key,
            label: s.label,
            cents: dollarsToCents(money?.[s.key]) ?? 0,
        });
    }
    const tysCents = Number(feeQuote?.fee_cents || 0);
    const tysOnBuyer = feeBearer !== "organizer" && tysCents > 0;
    if (tysOnBuyer) {
        lines.push({ key: "tys", label: "Comisión TYS", cents: tysCents });
    }
    return {
        lines,
        tysCents,
        tysOnBuyer,
        tysAbsorbed: feeBearer === "organizer" && tysCents > 0,
        totalCents: lines.reduce((sum, line) => sum + line.cents, 0),
    };
}

const SEATING_CARDS = [
    { ...LOCALITY_SEATING_TYPES.numbered, icon: MapPinned },
    { ...LOCALITY_SEATING_TYPES.unnumbered, icon: Users },
];

function MoneyField({
    label,
    tip,
    value,
    onChange,
    testid,
    required,
    disabled,
    onRemove,
}: {
    label: string;
    tip?: string;
    value: string;
    onChange: (v: string) => void;
    testid: string;
    required?: boolean;
    disabled?: boolean;
    onRemove?: () => void;
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 min-h-4">
                <Label className="text-[11px] text-muted-foreground font-normal inline-flex items-center gap-1">
                    {label}
                    {required ? <span className="text-destructive">*</span> : null}
                    {tip ? <FieldTip text={tip} /> : null}
                </Label>
                {onRemove ? (
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={onRemove}
                        aria-label={`Quitar ${label}`}
                        data-testid={`${testid}-remove`}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                ) : null}
            </div>
            <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-6 h-9"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    data-testid={testid}
                />
            </div>
        </div>
    );
}

export default function LocalityFormDialog({
    open,
    onClose,
    onSubmit,
    initial,
    saving,
    // Kept only so an existing locality's legacy "mixed" seating_type (pre
    // dating the explicit numbered/unnumbered field) can still be coerced
    // from whatever it's currently assigned to — see coerceLocalitySeatingType
    // below. Not used to render or interact with the map anymore.
    elements = [],
    allowNumbered = true,
    pricingType = "paid",
    feeBearer = "buyer",
    defaultSeatingType = "numbered",
}) {
    const [name, setName] = useState("");
    const [color, setColor] = useState(LOCALITY_PALETTE[0]);
    const [description, setDescription] = useState("");
    const [money, setMoney] = useState(emptyDraftMoney);
    const [reservedQuota, setReservedQuota] = useState("");
    const [addedServices, setAddedServices] = useState([]);
    const [seatingType, setSeatingType] = useState("numbered");
    const [draftId, setDraftId] = useState("");
    const [feeQuote, setFeeQuote] = useState(null);
    const [savedSnapshot, setSavedSnapshot] = useState(null);

    // Layout effect, not a passive one: the dialog stays mounted between
    // opens, so savedSnapshot would otherwise still hold the previous
    // session's value for one paint — a real flash of the wrong Guardar
    // disabled-state right when the dialog opens.
    useLayoutEffect(() => {
        if (!open) return;
        const id = initial?.id || newId();
        setDraftId(id);
        if (initial) {
            setName(initial.name || "");
            setColor(initial.color || LOCALITY_PALETTE[0]);
            setDescription(initial.description || "");
            const assignedKinds = (elements || [])
                .filter((e) => e.locality_id === initial.id)
                .map((e) => e.kind);
            let nextType = coerceLocalitySeatingType(initial.seating_type, assignedKinds);
            if (!allowNumbered) nextType = "unnumbered";
            setSeatingType(nextType);
            const nextMoney = {
                price: centsToInput(initial.price_cents) || "",
                vxs: centsToInput(initial.vxs_cents) || "",
                service: centsToInput(initial.service_fee_cents) || "",
                admin: centsToInput(initial.admin_fee_cents) || "",
                wallet: centsToInput(initial.wallet_fee_cents) || "",
            };
            const nextServices = servicesWithAmount(initial);
            const nextQuota = initial.reserved_quota ? String(initial.reserved_quota) : "";
            setMoney(nextMoney);
            setAddedServices(nextServices);
            setReservedQuota(nextQuota);
            setSavedSnapshot(
                snapshotOf({
                    name: initial.name || "",
                    color: initial.color || LOCALITY_PALETTE[0],
                    description: initial.description || "",
                    seatingType: nextType,
                    money: nextMoney,
                    addedServices: nextServices,
                    reservedQuota: nextQuota,
                }),
            );
        } else {
            setName("");
            setColor(LOCALITY_PALETTE[0]);
            setDescription("");
            setSeatingType(allowNumbered ? defaultSeatingType : "unnumbered");
            setMoney(emptyDraftMoney);
            setAddedServices([]);
            setReservedQuota("");
            // No "saved" state to diff against when creating — Guardar/Crear
            // should stay enabled the whole time, same as before this change.
            setSavedSnapshot(null);
        }
    }, [open, initial, elements, allowNumbered, defaultSeatingType]);

    useEffect(() => {
        if (!open) {
            setFeeQuote(null);
            return undefined;
        }
        const cents = dollarsToCents(money.price);
        const t = setTimeout(() => {
            api.get("/sales-fees/quote", {
                params: { pricing_type: pricingType || "paid", price_cents: cents },
            })
                .then((r) => setFeeQuote(r.data))
                .catch(() => setFeeQuote(null));
        }, 280);
        return () => clearTimeout(t);
    }, [open, money.price, pricingType]);

    const handleSeatingChange = (next: string) => {
        if (next !== "unnumbered" && !allowNumbered) {
            toast.error("Tu plan no incluye asientos numerados.");
            return;
        }
        setSeatingType(next);
    };

    // Only meaningful in edit mode (savedSnapshot is null while creating) —
    // Guardar stays disabled until something actually differs from what was
    // last persisted, so its state tells the organizer whether there's
    // anything to save (TI-152).
    const isDirty = useMemo(
        () =>
            savedSnapshot == null ||
            snapshotOf({ name, color, description, seatingType, money, addedServices, reservedQuota }) !==
                savedSnapshot,
        [savedSnapshot, name, color, description, seatingType, money, addedServices, reservedQuota],
    );

    const buyerBreakdown = useMemo(
        () =>
            localityBuyerBreakdown({
                money,
                addedServices,
                feeQuote,
                feeBearer,
            }),
        [money, addedServices, feeQuote, feeBearer],
    );

    const handleSubmit = () => {
        if (!name.trim()) {
            toast.error("Pon un nombre a la localidad");
            return;
        }
        if (pricingType !== "free") {
            if (String(money.price).trim() === "") {
                toast.error("Pon el precio de la entrada");
                return;
            }
            if (dollarsToCents(money.price) == null) {
                toast.error("El precio de la entrada no es válido");
                return;
            }
        }
        onSubmit({
            id: draftId,
            name: name.trim(),
            color,
            description: description.trim() || null,
            seating_type: seatingType,
            reserved_quota: Math.max(0, parseInt(reservedQuota, 10) || 0),
            ...moneyPayload(pricingType, money),
        });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="max-w-2xl max-h-[90vh] overflow-y-auto"
                data-testid="locality-form-dialog"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>{initial ? "Editar localidad" : "Nueva localidad"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-1">
                    <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
                        <div className="space-y-1">
                            <Label className="text-xs inline-flex items-center gap-1">
                                Color
                                <FieldTip text={FIELD_TIPS.color} />
                            </Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="h-9 w-9 rounded-md ring-1 ring-border"
                                        style={{ background: color }}
                                        aria-label="Elegir color"
                                        data-testid="locality-form-color"
                                    />
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2">
                                    <HexColorPicker color={color} onChange={setColor} />
                                    <div className="flex gap-1 mt-2 flex-wrap">
                                        {LOCALITY_PALETTE.map((c) => (
                                            <button
                                                key={c}
                                                type="button"
                                                className="h-5 w-5 rounded ring-1 ring-border"
                                                style={{ background: c }}
                                                onClick={() => setColor(c)}
                                            />
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs inline-flex items-center gap-1">
                                Nombre
                                <FieldTip text={FIELD_TIPS.name} />
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="VIP, Platea, General…"
                                autoFocus
                                data-testid="locality-form-name"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center gap-1">
                            Descripción
                            <FieldTip text={FIELD_TIPS.description} />
                        </Label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Opcional"
                            data-testid="locality-form-description"
                        />
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center gap-1">
                            Cupos reservados
                            <FieldTip text={FIELD_TIPS.reservedQuota} />
                        </Label>
                        <Input
                            type="number"
                            min="0"
                            value={reservedQuota}
                            onChange={(e) => setReservedQuota(e.target.value)}
                            placeholder="0"
                            className="max-w-[140px]"
                            data-testid="locality-form-reserved-quota"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs inline-flex items-center gap-1">
                            Tipo de localidad
                            <FieldTip text={FIELD_TIPS.seating} />
                        </Label>
                        <div className="grid sm:grid-cols-2 gap-2" data-testid="locality-seating-type">
                            {SEATING_CARDS.map((opt) => {
                                const Icon = opt.icon;
                                const selected = seatingType === opt.value;
                                const blocked = opt.value !== "unnumbered" && !allowNumbered;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        disabled={blocked}
                                        onClick={() => handleSeatingChange(opt.value)}
                                        data-testid={`locality-seating-${opt.value}`}
                                        className={`rounded-xl border p-3 text-left transition ${
                                            selected
                                                ? "border-foreground/30 ring-1 ring-foreground/10 bg-card"
                                                : "border-border hover:border-foreground/20 bg-card"
                                        } ${blocked ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${selected ? "text-teal-800" : "text-muted-foreground"}`} />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <div className="text-sm font-medium">{opt.title}</div>
                                                    {blocked ? <PlanLockBadge feature="numbered_seating" /> : null}
                                                </div>
                                                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                                    {opt.description}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {!allowNumbered && (
                            <UpgradePlanButton feature="numbered_seating" />
                        )}
                    </div>

                    <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <MoneyField
                                label="Precio Entrada"
                                tip={FIELD_TIPS.price}
                                value={pricingType === "free" ? "0" : money.price}
                                onChange={(v) => setMoney((m) => ({ ...m, price: v }))}
                                testid="locality-form-price"
                                required={pricingType !== "free"}
                                disabled={pricingType === "free"}
                            />
                            {OPTIONAL_SERVICES.filter((s) => addedServices.includes(s.key)).map((s) => (
                                <MoneyField
                                    key={s.key}
                                    label={s.label}
                                    tip={FIELD_TIPS[s.tipKey]}
                                    value={pricingType === "free" ? "0" : money[s.key]}
                                    onChange={(v) => setMoney((m) => ({ ...m, [s.key]: v }))}
                                    testid={s.testid}
                                    disabled={pricingType === "free"}
                                    onRemove={() => {
                                        setAddedServices((prev) => prev.filter((k) => k !== s.key));
                                        setMoney((m) => ({ ...m, [s.key]: "" }));
                                    }}
                                />
                            ))}
                        </div>
                        {OPTIONAL_SERVICES.some((s) => !addedServices.includes(s.key)) ? (
                            <div className="space-y-1.5">
                                <p className="text-[11px] text-muted-foreground">
                                    Cargo de servicio, TicketSeguro, impuestos y billetera son opcionales.
                                </p>
                                <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            data-testid="locality-add-service"
                                        >
                                            <Plus className="h-4 w-4 mr-1.5" />
                                            Agregar servicio
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        {OPTIONAL_SERVICES.filter((s) => !addedServices.includes(s.key)).map((s) => (
                                            <DropdownMenuItem
                                                key={s.key}
                                                onSelect={() => setAddedServices((prev) => [...prev, s.key])}
                                                data-testid={`locality-add-service-${s.key}`}
                                            >
                                                {s.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        ) : null}
                    </div>

                    {buyerBreakdown.totalCents > 0 || buyerBreakdown.tysAbsorbed || String(money.price).trim() !== "" ? (
                        <div
                            className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm space-y-1.5"
                            data-testid="locality-buyer-total"
                        >
                            <div className="font-medium">Costo final por entrada</div>
                            <dl className="space-y-1 text-xs">
                                {buyerBreakdown.lines.map((line) => (
                                    <div key={line.key} className="flex justify-between gap-3 tabular-nums">
                                        <dt className="text-muted-foreground">{line.label}</dt>
                                        <dd>${centsToDollars(line.cents)}</dd>
                                    </div>
                                ))}
                                {buyerBreakdown.tysAbsorbed ? (
                                    <div className="flex justify-between gap-3 tabular-nums text-muted-foreground">
                                        <dt>Comisión TYS (la absorbe el organizador)</dt>
                                        <dd>${centsToDollars(buyerBreakdown.tysCents)}</dd>
                                    </div>
                                ) : null}
                            </dl>
                            <div className="flex justify-between gap-3 pt-1.5 border-t font-semibold tabular-nums">
                                <span>Total comprador</span>
                                <span data-testid="locality-buyer-total-amount">
                                    ${centsToDollars(buyerBreakdown.totalCents)}
                                </span>
                            </div>
                            {buyerBreakdown.tysOnBuyer ? (
                                <p className="text-[11px] text-muted-foreground">
                                    Incluye la comisión TYS ({formatQuoteLabel(feeQuote)}).
                                </p>
                            ) : buyerBreakdown.tysAbsorbed ? (
                                <p className="text-[11px] text-muted-foreground">
                                    La comisión TYS no se suma al total del comprador.
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div
                        className="rounded-lg border bg-secondary/30 px-3 py-2.5 text-[11px] text-muted-foreground"
                        data-testid="locality-assign-hint"
                    >
                        {initial
                            ? "Para cambiar qué asientos, mesas o zonas tiene asignados esta localidad, usa \"Mapa completo\"."
                            : "Después de guardar, asignala a asientos, mesas o zonas del mapa desde \"Mapa completo\"."}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={saving || !isDirty}
                        data-testid="locality-form-submit"
                    >
                        {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                        {initial ? "Guardar" : "Crear localidad"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
