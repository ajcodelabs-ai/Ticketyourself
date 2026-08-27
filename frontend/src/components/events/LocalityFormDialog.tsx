/**
 * Create/edit a locality with seating type + in-dialog map assignment.
 *
 * Numbered / unnumbered lives on the locality. Event mixed is inferred when
 * both types exist. Clicking map elements (filtered by that type) assigns
 * them in the same save as name and prices.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HexColorPicker } from "react-colorful";
import { Info, MapPinned, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { LOCALITY_PALETTE, elementAcceptsLocality, newId } from "@/lib/venues";
import {
    LOCALITY_SEATING_TYPES,
    elementMatchesSeatingType,
    coerceLocalitySeatingType,
} from "@/lib/attendanceFormat";
import EditorCanvas from "@/components/venues/EditorCanvas";
import { PlanLockBadge, UpgradePlanButton } from "@/components/plans/PlanGate";
import api from "@/lib/api";
import { centsToInput, dollarsToCents } from "@/lib/money";
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
        "TicketSeguro: cobertura / seguro por ticket. Dejá $0 si no aplica.",
    vxs: "Impuestos (IVA u otros) por ticket.",
    wallet: "Billetera Virtual: cargo o recarga asociada al ticket.",
};

const emptyDraftMoney = { price: "", vxs: "", service: "", admin: "", wallet: "" };

const SEATING_CARDS = [
    { ...LOCALITY_SEATING_TYPES.numbered, icon: MapPinned },
    { ...LOCALITY_SEATING_TYPES.unnumbered, icon: Users },
];

function MoneyField({ label, tip, value, onChange, testid }) {
    return (
        <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-normal inline-flex items-center gap-1">
                {label}
                {tip ? <FieldTip text={tip} /> : null}
            </Label>
            <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-6 h-9"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
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
    canvas,
    elements = [],
    localitiesById = {},
    allowNumbered = true,
    pricingType = "paid",
    feeBearer = "buyer",
}) {
    const [name, setName] = useState("");
    const [color, setColor] = useState(LOCALITY_PALETTE[0]);
    const [description, setDescription] = useState("");
    const [money, setMoney] = useState(emptyDraftMoney);
    const [seatingType, setSeatingType] = useState("numbered");
    const [draftId, setDraftId] = useState("");
    const [assignedIds, setAssignedIds] = useState([]);
    const [feeQuote, setFeeQuote] = useState(null);

    useEffect(() => {
        if (!open) return;
        const id = initial?.id || newId();
        setDraftId(id);
        if (initial) {
            setName(initial.name || "");
            setColor(initial.color || LOCALITY_PALETTE[0]);
            setDescription(initial.description || "");
            const assigned = (elements || []).filter((e) => e.locality_id === initial.id);
            let nextType = coerceLocalitySeatingType(
                initial.seating_type,
                assigned.map((e) => e.kind),
            );
            if (!allowNumbered) nextType = "unnumbered";
            const nextAssigned = assigned
                .filter((e) => elementMatchesSeatingType(e.kind, nextType))
                .map((e) => e.id);
            if (
                initial.seating_type === "mixed" &&
                nextAssigned.length !== assigned.length
            ) {
                toast.message(
                    nextType === "numbered"
                        ? "Esta localidad era mixta. Ahora es numerada; las zonas de aforo se desasignaron. Creá otra localidad no numerada para ellas."
                        : "Esta localidad era mixta. Ahora es no numerada (solo zonas de aforo).",
                );
            }
            setSeatingType(nextType);
            setMoney({
                price: centsToInput(initial.price_cents) || "",
                vxs: centsToInput(initial.vxs_cents) || "",
                service: centsToInput(initial.service_fee_cents) || "",
                admin: centsToInput(initial.admin_fee_cents) || "",
                wallet: centsToInput(initial.wallet_fee_cents) || "",
            });
            setAssignedIds(nextAssigned);
        } else {
            setName("");
            setColor(LOCALITY_PALETTE[0]);
            setDescription("");
            setSeatingType(allowNumbered ? "numbered" : "unnumbered");
            setMoney(emptyDraftMoney);
            setAssignedIds([]);
        }
    }, [open, initial, elements, allowNumbered]);

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
        const kept = assignedIds.filter((id) => {
            const el = elements.find((e) => e.id === id);
            return el && elementMatchesSeatingType(el.kind, next);
        });
        if (kept.length !== assignedIds.length) {
            toast.message("Se quitaron del mapa elementos que no coinciden con este tipo.");
        }
        setAssignedIds(kept);
    };

    const previewLocalitiesById = useMemo(
        () => ({
            ...localitiesById,
            [draftId]: { id: draftId, name: name || "Nueva", color },
        }),
        [localitiesById, draftId, name, color],
    );

    const previewElements = useMemo(
        () =>
            (elements || []).map((e) => {
                if (assignedIds.includes(e.id)) return { ...e, locality_id: draftId };
                if (e.locality_id === draftId) return { ...e, locality_id: null };
                return e;
            }),
        [elements, assignedIds, draftId],
    );

    const onCanvasSelect = (ids) => {
        const id = ids?.[0];
        if (!id) return;
        const el = elements.find((e) => e.id === id);
        if (!el || !elementAcceptsLocality(el.kind)) {
            toast.error("Ese elemento no se puede asignar a una localidad.");
            return;
        }
        if (!elementMatchesSeatingType(el.kind, seatingType)) {
            const hint =
                seatingType === "unnumbered"
                    ? "En una localidad no numerada solo podés asignar zonas de aforo."
                    : seatingType === "numbered"
                      ? "En una localidad numerada asigná filas, asientos o mesas."
                      : "Ese elemento no es asignable.";
            toast.error(hint);
            return;
        }
        setAssignedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    };

    const handleSubmit = () => {
        if (!name.trim()) {
            toast.error("Poné un nombre a la localidad");
            return;
        }
        onSubmit({
            id: draftId,
            name: name.trim(),
            color,
            description: description.trim() || null,
            seating_type: seatingType,
            assigned_element_ids: assignedIds,
            price_cents: dollarsToCents(money.price) ?? 0,
            vxs_cents: dollarsToCents(money.vxs) ?? 0,
            service_fee_cents: dollarsToCents(money.service) ?? 0,
            admin_fee_cents: dollarsToCents(money.admin) ?? 0,
            wallet_fee_cents: dollarsToCents(money.wallet) ?? 0,
        });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="max-w-4xl max-h-[90vh] overflow-y-auto"
                data-testid="locality-form-dialog"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onWheel={(e) => {
                    if ((e.target as HTMLElement)?.closest?.("[data-testid='venue-canvas-wrap']")) {
                        e.stopPropagation();
                    }
                }}
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

                    <div className="grid grid-cols-2 gap-3">
                        <MoneyField
                            label="Precio Entrada"
                            tip={FIELD_TIPS.price}
                            value={money.price}
                            onChange={(v) => setMoney((m) => ({ ...m, price: v }))}
                            testid="locality-form-price"
                        />
                        <MoneyField
                            label="Cargo de servicio"
                            tip={FIELD_TIPS.service}
                            value={money.service}
                            onChange={(v) => setMoney((m) => ({ ...m, service: v }))}
                            testid="locality-form-service"
                        />
                        <MoneyField
                            label="TicketSeguro"
                            tip={FIELD_TIPS.admin}
                            value={money.admin}
                            onChange={(v) => setMoney((m) => ({ ...m, admin: v }))}
                            testid="locality-form-admin"
                        />
                        <MoneyField
                            label="Impuestos"
                            tip={FIELD_TIPS.vxs}
                            value={money.vxs}
                            onChange={(v) => setMoney((m) => ({ ...m, vxs: v }))}
                            testid="locality-form-vxs"
                        />
                        <MoneyField
                            label="Billetera Virtual"
                            tip={FIELD_TIPS.wallet}
                            value={money.wallet}
                            onChange={(v) => setMoney((m) => ({ ...m, wallet: v }))}
                            testid="locality-form-wallet"
                        />
                    </div>

                    {feeQuote && (feeQuote.fee_cents > 0 || feeQuote.matched) ? (
                        <div
                            className="rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                            data-testid="locality-platform-fee"
                        >
                            <div className="font-medium">Comisión TYS por entrada</div>
                            <p className="text-muted-foreground text-xs mt-0.5">
                                {formatQuoteLabel(feeQuote)}
                                {feeBearer === "organizer"
                                    ? " · La absorbe el organizador (el comprador no la ve)."
                                    : " · Se suma al total del comprador."}
                            </p>
                        </div>
                    ) : null}

                    <div className="space-y-2">
                        <div>
                            <Label className="text-xs">Asignar en el mapa</Label>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Tocá{" "}
                                {seatingType === "unnumbered"
                                    ? "zonas de aforo"
                                    : "filas, asientos o mesas"}{" "}
                                para asignarlas a esta localidad.
                                {assignedIds.length > 0
                                    ? ` ${assignedIds.length} elemento${assignedIds.length !== 1 ? "s" : ""} seleccionado${assignedIds.length !== 1 ? "s" : ""}.`
                                    : " Todavía no hay elementos asignados."}
                            </p>
                        </div>
                        <div
                            className="rounded-lg border overflow-hidden"
                            data-testid="locality-assign-map"
                        >
                            <EditorCanvas
                                canvas={canvas || { width: 1000, height: 600 }}
                                elements={previewElements}
                                localitiesById={previewLocalitiesById}
                                selection={assignedIds}
                                onSelect={onCanvasSelect}
                                onUpdate={() => {}}
                                onTransform={() => {}}
                                onContextMenu={() => {}}
                                tool="select"
                                readOnly
                                height={280}
                                autoFitKey={open ? `loc-assign:${draftId}` : undefined}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving} data-testid="locality-form-submit">
                        {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                        {initial ? "Guardar" : "Crear localidad"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
