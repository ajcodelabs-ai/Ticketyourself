/**
 * /admin/comisiones — matrix of per-ticket TYS fees
 * (plan × event pricing type × ticket price range).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Percent, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import {
    PRICING_TYPE_LABELS,
    bpsToPercent,
    centsToDollars,
    dollarsToCents,
    formatFeeFormula,
    formatPriceRange,
    formatQuoteLabel,
    percentToBps,
} from "@/lib/salesFees";

const EMPTY = {
    plan_code: "",
    pricing_type: "paid",
    min_dollars: "0.00",
    max_dollars: "",
    fee_mode: "percent",
    fee_fixed_dollars: "0.00",
    fee_percent: "0.00",
    active: true,
};

function ruleToForm(r) {
    return {
        plan_code: r.plan_code,
        pricing_type: r.pricing_type,
        min_dollars: centsToDollars(r.min_price_cents),
        max_dollars: r.max_price_cents == null ? "" : centsToDollars(r.max_price_cents),
        fee_mode: r.fee_mode || (r.fee_percent_bps > 0 ? "percent" : "fixed"),
        fee_fixed_dollars: centsToDollars(r.fee_fixed_cents),
        fee_percent: bpsToPercent(r.fee_percent_bps),
        active: r.active !== false,
    };
}

function formToPayload(form) {
    const min_price_cents = dollarsToCents(form.min_dollars);
    const maxRaw = String(form.max_dollars || "").trim();
    const max_price_cents = maxRaw === "" ? null : dollarsToCents(maxRaw);
    const fee_fixed_cents = dollarsToCents(form.fee_fixed_dollars);
    const fee_percent_bps = percentToBps(form.fee_percent);
    if (
        min_price_cents == null ||
        (maxRaw !== "" && max_price_cents == null) ||
        fee_fixed_cents == null ||
        fee_percent_bps == null
    ) {
        return null;
    }
    const fee_mode = form.fee_mode === "fixed" ? "fixed" : "percent";
    return {
        plan_code: form.plan_code,
        pricing_type: form.pricing_type,
        min_price_cents,
        max_price_cents,
        fee_mode,
        fee_fixed_cents: fee_mode === "fixed" ? fee_fixed_cents : 0,
        fee_percent_bps: fee_mode === "percent" ? fee_percent_bps : 0,
        active: Boolean(form.active),
    };
}

export default function AdminSalesFees() {
    const [rules, setRules] = useState([]);
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [sampleDollars, setSampleDollars] = useState("25.00");
    const [preview, setPreview] = useState(null);

    const planName = useMemo(() => {
        const map = {};
        for (const p of plans) map[p.code] = p.name;
        return map;
    }, [plans]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rulesResp, plansResp] = await Promise.all([
                api.get("/admin/sales-fee-rules"),
                api.get("/admin/plans"),
            ]);
            setRules(rulesResp.data || []);
            setPlans(plansResp.data || []);
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudieron cargar las comisiones.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!open || !form.plan_code) {
            setPreview(null);
            return undefined;
        }
        const cents = dollarsToCents(sampleDollars);
        if (cents == null) return undefined;
        const t = setTimeout(() => {
            api.get("/sales-fees/quote", {
                params: {
                    pricing_type: form.pricing_type,
                    price_cents: cents,
                    plan_code: form.plan_code,
                },
            })
                .then((r) => setPreview(r.data))
                .catch(() => setPreview(null));
        }, 250);
        return () => clearTimeout(t);
    }, [open, form.plan_code, form.pricing_type, sampleDollars]);

    const openCreate = () => {
        setEditingId(null);
        setForm({
            ...EMPTY,
            plan_code: plans[0]?.code || "",
        });
        setOpen(true);
    };

    const openEdit = (r) => {
        setEditingId(r.id);
        setForm(ruleToForm(r));
        setOpen(true);
    };

    const save = async () => {
        const payload = formToPayload(form);
        if (!payload) {
            toast.error("Revisá los montos. Usá números (ej. 10.00).");
            return;
        }
        if (!payload.plan_code) {
            toast.error("Elegí un plan.");
            return;
        }
        setSaving(true);
        try {
            if (editingId) {
                await api.patch(`/admin/sales-fee-rules/${editingId}`, payload);
                toast.success("Combinación actualizada");
            } else {
                await api.post("/admin/sales-fee-rules", payload);
                toast.success("Combinación creada");
            }
            setOpen(false);
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (r) => {
        if (!window.confirm(`¿Eliminar la comisión de ${planName[r.plan_code] || r.plan_code}?`)) {
            return;
        }
        try {
            await api.delete(`/admin/sales-fee-rules/${r.id}`);
            toast.success("Combinación eliminada");
            await load();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo eliminar.");
        }
    };

    return (
        <div className="space-y-6" data-testid="admin-sales-fees">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Comisión por venta</h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                        Cada fila es una combinación de plan, tipo de recaudación y rango de
                        precio de la entrada. La comisión es un monto fijo por boleto o un
                        porcentaje sobre la entrada — no los dos a la vez.
                        El organizador lo ve al crear localidades y elige si lo absorbe o se lo cobra al comprador.
                    </p>
                </div>
                <Button onClick={openCreate} data-testid="admin-sales-fee-add">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Nueva combinación
                </Button>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base inline-flex items-center gap-2">
                        <Percent className="h-4 w-4" />
                        Combinaciones
                    </CardTitle>
                    <CardDescription>
                        Si dos rangos del mismo plan y tipo se solapan, el sistema no deja guardar.
                        Sin coincidencia en eventos pagados se usa la tarifa general de la plataforma (env).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : rules.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                            Todavía no hay combinaciones. Creá la primera para dejar de usar el % general.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Plan</TableHead>
                                    <TableHead>Tipo de evento</TableHead>
                                    <TableHead>Valor de la entrada</TableHead>
                                    <TableHead>Comisión</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="w-24" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rules.map((r) => (
                                    <TableRow key={r.id} data-testid={`sales-fee-row-${r.id}`}>
                                        <TableCell className="font-medium">
                                            {planName[r.plan_code] || r.plan_code}
                                            <div className="text-[11px] text-muted-foreground font-normal">
                                                {r.plan_code}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {PRICING_TYPE_LABELS[r.pricing_type] || r.pricing_type}
                                        </TableCell>
                                        <TableCell className="tabular-nums">
                                            {formatPriceRange(r)}
                                        </TableCell>
                                        <TableCell className="tabular-nums">
                                            {formatFeeFormula(r)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={r.active ? "default" : "secondary"}>
                                                {r.active ? "Activa" : "Off"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => openEdit(r)}
                                                data-testid={`sales-fee-edit-${r.id}`}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => remove(r)}
                                                data-testid={`sales-fee-delete-${r.id}`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg" data-testid="admin-sales-fee-dialog">
                    <DialogHeader>
                        <DialogTitle>
                            {editingId ? "Editar combinación" : "Nueva combinación"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-1">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Plan</Label>
                                <Select
                                    value={form.plan_code}
                                    onValueChange={(v) => setForm((f) => ({ ...f, plan_code: v }))}
                                >
                                    <SelectTrigger data-testid="sales-fee-plan">
                                        <SelectValue placeholder="Elegí un plan" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {plans.map((p) => (
                                            <SelectItem key={p.code} value={p.code}>
                                                {p.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Tipo de evento</Label>
                                <Select
                                    value={form.pricing_type}
                                    onValueChange={(v) => setForm((f) => ({ ...f, pricing_type: v }))}
                                >
                                    <SelectTrigger data-testid="sales-fee-pricing-type">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(PRICING_TYPE_LABELS).map(([value, label]) => (
                                            <SelectItem key={value} value={value}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Precio desde (USD)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.min_dollars}
                                    onChange={(e) => setForm((f) => ({ ...f, min_dollars: e.target.value }))}
                                    data-testid="sales-fee-min"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Precio hasta (vacío = sin tope)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Sin tope"
                                    value={form.max_dollars}
                                    onChange={(e) => setForm((f) => ({ ...f, max_dollars: e.target.value }))}
                                    data-testid="sales-fee-max"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Cómo se cobra</Label>
                            <RadioGroup
                                value={form.fee_mode}
                                onValueChange={(v) => setForm((f) => ({ ...f, fee_mode: v }))}
                                className="grid sm:grid-cols-2 gap-2"
                            >
                                <label
                                    className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${
                                        form.fee_mode === "fixed" ? "border-primary bg-primary/5" : ""
                                    }`}
                                >
                                    <RadioGroupItem value="fixed" id="fee-mode-fixed" className="mt-0.5" />
                                    <div>
                                        <div className="text-sm font-medium">Monto fijo</div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Un USD por cada boleto, sin importar el precio.
                                        </p>
                                    </div>
                                </label>
                                <label
                                    className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${
                                        form.fee_mode === "percent" ? "border-primary bg-primary/5" : ""
                                    }`}
                                >
                                    <RadioGroupItem value="percent" id="fee-mode-percent" className="mt-0.5" />
                                    <div>
                                        <div className="text-sm font-medium">Porcentaje</div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Un % del precio de la entrada.
                                        </p>
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>
                        {form.fee_mode === "fixed" ? (
                            <div className="space-y-1.5">
                                <Label>Monto fijo por boleto (USD)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.fee_fixed_dollars}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, fee_fixed_dollars: e.target.value }))
                                    }
                                    data-testid="sales-fee-fixed"
                                />
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <Label>Porcentaje sobre la entrada</Label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="pr-8"
                                        value={form.fee_percent}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, fee_percent: e.target.value }))
                                        }
                                        data-testid="sales-fee-percent"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                        %
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={form.active}
                                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                            />
                            <Label>Combinación activa</Label>
                        </div>
                        <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                            <Label className="text-xs">Vista previa con una entrada de</Label>
                            <div className="flex items-center gap-2">
                                <div className="relative w-28">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        $
                                    </span>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="pl-6 h-8"
                                        value={sampleDollars}
                                        onChange={(e) => setSampleDollars(e.target.value)}
                                    />
                                </div>
                                <p className="text-sm" data-testid="sales-fee-preview">
                                    {preview
                                        ? `Comisión: ${formatQuoteLabel(preview)}`
                                        : "—"}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={save} disabled={saving} data-testid="sales-fee-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
