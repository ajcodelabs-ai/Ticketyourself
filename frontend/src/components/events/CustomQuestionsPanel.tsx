/**
 * CustomQuestionsPanel — TicketShow-style Parámetros (video 10:45–11:52).
 * Cards + inline form; persists to `event.custom_questions`.
 *
 * Types UI → model: Texto→text · Número→number · Opciones→select
 * Localidades: chips Todas/Limpiar; vacío/null = todas en checkout.
 */
import { useState } from "react";
import {
    Plus,
    Trash2,
    Pencil,
    X,
    Type,
    Hash,
    List,
    MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const FIELD_TYPES = [
    {
        value: "text",
        title: "Texto",
        description: "Campo de texto libre",
        icon: Type,
        badge: "TEXTO",
        badgeClass: "bg-emerald-100 text-emerald-800",
    },
    {
        value: "number",
        title: "Número",
        description: "Campo numérico",
        icon: Hash,
        badge: "NÚMERO",
        badgeClass: "bg-amber-100 text-amber-800",
    },
    {
        value: "select",
        title: "Opciones",
        description: "Lista desplegable",
        icon: List,
        badge: "OPCIONES",
        badgeClass: "bg-violet-100 text-violet-800",
    },
];

function typeMeta(type) {
    return FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];
}

function newDraft(localities = []) {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: "",
        type: "text",
        required: true,
        options: [],
        // TicketShow defaults to all localities selected
        locality_ids: localities.map((l) => l.id),
        _isNew: true,
        _optionInput: "",
    };
}

function questionToDraft(q, localities = []) {
    const allIds = localities.map((l) => l.id);
    let locIds = Array.isArray(q.locality_ids) ? [...q.locality_ids] : null;
    // null/empty in model = applies to all → show all selected in the form
    if (!locIds || locIds.length === 0) locIds = [...allIds];
    return {
        id: q.id,
        label: q.label || "",
        type: q.type === "checkbox" ? "text" : q.type || "text",
        required: !!q.required,
        options: Array.isArray(q.options) ? [...q.options] : [],
        locality_ids: locIds,
        _isNew: false,
        _optionInput: "",
    };
}

function draftToQuestion(draft, localities = []) {
    const allIds = localities.map((l) => l.id);
    const selected = Array.isArray(draft.locality_ids) ? draft.locality_ids : [];
    // Persist null when all (or none of empty venue) → checkout treats as all
    const allSelected =
        allIds.length === 0
        || (selected.length === allIds.length
            && allIds.every((id) => selected.includes(id)));

    return {
        id: draft.id,
        label: (draft.label || "").trim(),
        type: draft.type || "text",
        required: !!draft.required,
        options: draft.type === "select" ? [...(draft.options || [])] : [],
        locality_ids: allSelected ? null : selected,
    };
}

export default function CustomQuestionsPanel({
    questions = [],
    onChange,
    venueLocalities = [],
}) {
    const [draft, setDraft] = useState(null);

    const openNew = () => setDraft(newDraft(venueLocalities));
    const openEdit = (q) => setDraft(questionToDraft(q, venueLocalities));
    const close = () => setDraft(null);

    const save = () => {
        const label = (draft.label || "").trim();
        if (label.length < 2) {
            toast.error("Indicá el nombre del campo (mín. 2 caracteres).");
            return;
        }
        if (draft.type === "select" && !(draft.options || []).length) {
            toast.error("Agregá al menos una opción a la lista.");
            return;
        }
        if (
            venueLocalities.length > 0
            && !(draft.locality_ids || []).length
        ) {
            toast.error("Seleccioná al menos una localidad.");
            return;
        }

        const question = draftToQuestion(draft, venueLocalities);
        const exists = questions.find((q) => q.id === question.id);
        const next = exists
            ? questions.map((q) => (q.id === question.id ? question : q))
            : [...questions, question];
        onChange(next);
        close();
        toast.success(exists ? "Parámetro actualizado." : "Parámetro creado.");
    };

    const remove = (id) => {
        if (!window.confirm("¿Eliminar este parámetro?")) return;
        onChange(questions.filter((q) => q.id !== id));
    };

    if (draft) {
        return (
            <InlineParamForm
                draft={draft}
                setDraft={setDraft}
                localities={venueLocalities}
                onCancel={close}
                onSave={save}
            />
        );
    }

    return (
        <div className="space-y-4" data-testid="custom-questions-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground max-w-lg">
                    Campos extra que se solicitarán al cliente durante la compra
                    (nombre, talla, etc.).
                </p>
                <Button size="sm" onClick={openNew} data-testid="cq-add" className="shrink-0">
                    <Plus className="h-4 w-4 mr-1.5" /> Nuevo parámetro
                </Button>
            </div>

            {questions.length === 0 ? (
                <div
                    className="rounded-xl border border-dashed py-10 text-center space-y-2 bg-card"
                    data-testid="cq-empty"
                >
                    <MessageSquareText className="h-8 w-8 mx-auto text-muted-foreground/60" />
                    <p className="text-sm font-medium">No hay parámetros configurados</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Agregá campos extra que se solicitarán al cliente durante la compra.
                    </p>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={openNew}
                        className="mt-1"
                        data-testid="cq-add-empty"
                    >
                        <Plus className="h-4 w-4 mr-1.5" /> Nuevo parámetro
                    </Button>
                </div>
            ) : (
                <div className="grid sm:grid-cols-2 gap-3" data-testid="cq-list">
                    {questions.map((q) => (
                        <ParamCard
                            key={q.id}
                            question={q}
                            localities={venueLocalities}
                            onEdit={() => openEdit(q)}
                            onRemove={() => remove(q.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ParamCard({ question, localities, onEdit, onRemove }) {
    const meta = typeMeta(question.type);
    const allIds = localities.map((l) => l.id);
    const locIds = Array.isArray(question.locality_ids) ? question.locality_ids : null;
    const shownLocs =
        !locIds || locIds.length === 0
            ? localities
            : localities.filter((l) => locIds.includes(l.id));

    return (
        <div
            className="rounded-xl border bg-card p-4 space-y-3 relative"
            data-testid={`cq-row-${question.id}`}
        >
            <div className="flex items-start justify-between gap-2">
                <span
                    className={`text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full ${meta.badgeClass}`}
                >
                    {meta.badge}
                </span>
                <div className="flex items-center gap-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={onEdit}
                        data-testid={`cq-edit-${question.id}`}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600 hover:bg-red-50"
                        onClick={onRemove}
                        data-testid={`cq-remove-${question.id}`}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            <div>
                <div className="font-medium text-sm" data-testid={`cq-label-${question.id}`}>
                    {question.label}
                </div>
                <div
                    className={`mt-1 text-xs flex items-center gap-1.5 ${
                        question.required ? "text-red-600" : "text-muted-foreground"
                    }`}
                >
                    {question.required ? "Campo obligatorio" : "Campo opcional"}
                </div>
            </div>

            {shownLocs.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {shownLocs.map((loc) => (
                        <span
                            key={loc.id}
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                            <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: loc.color || "#888" }}
                            />
                            {loc.name}
                        </span>
                    ))}
                    {allIds.length > 0 && shownLocs.length === allIds.length && (
                        <span className="sr-only">Todas las localidades</span>
                    )}
                </div>
            )}

            {question.type === "select" && (question.options || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {question.options.map((opt) => (
                        <span
                            key={opt}
                            className="text-[11px] px-2 py-0.5 rounded-full border bg-muted/40"
                        >
                            {opt}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function InlineParamForm({ draft, setDraft, localities, onCancel, onSave }) {
    const upd = (patch) => setDraft((d) => ({ ...d, ...patch }));
    const locIds = draft.locality_ids || [];
    const canCreate =
        (draft.label || "").trim().length >= 2
        && (draft.type !== "select" || (draft.options || []).length > 0)
        && (localities.length === 0 || locIds.length > 0);

    const addOption = () => {
        const raw = (draft._optionInput || "").trim();
        if (!raw) return;
        if ((draft.options || []).includes(raw)) {
            toast.error("Esa opción ya está en la lista.");
            return;
        }
        upd({
            options: [...(draft.options || []), raw],
            _optionInput: "",
        });
    };

    const removeOption = (opt) =>
        upd({ options: (draft.options || []).filter((o) => o !== opt) });

    const toggleLoc = (id) => {
        const set = new Set(locIds);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        upd({ locality_ids: Array.from(set) });
    };

    return (
        <div
            className="rounded-xl border bg-card p-4 sm:p-5 space-y-5"
            data-testid="cq-inline-form"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                    {draft._isNew ? "+ Nuevo parámetro" : "Editar parámetro"}
                </h4>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        data-testid="cq-cancel"
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={onSave}
                        disabled={!canCreate}
                        data-testid="cq-save"
                    >
                        {draft._isNew ? "Crear parámetro" : "Guardar"}
                    </Button>
                </div>
            </div>

            <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
                {/* Definición */}
                <section className="space-y-3">
                    <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Definición
                    </div>
                    <div className="space-y-1.5">
                        <Label>
                            Nombre del campo <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={draft.label}
                            onChange={(e) => upd({ label: e.target.value })}
                            placeholder="Ej. Nombre completo del asistente, Talla de camiseta..."
                            data-testid="cq-label-input"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Tipo de campo</Label>
                        <div className="grid sm:grid-cols-3 gap-2">
                            {FIELD_TYPES.map((t) => {
                                const Icon = t.icon;
                                const on = draft.type === t.value;
                                return (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => upd({ type: t.value })}
                                        className={`rounded-xl border p-3 text-left transition ${
                                            on
                                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                                : "hover:bg-secondary/50"
                                        }`}
                                        data-testid={`cq-type-${t.value}`}
                                    >
                                        <Icon className="h-4 w-4 mb-1.5 text-muted-foreground" />
                                        <div className="text-sm font-medium">{t.title}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {t.description}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {draft.type === "select" && (
                        <div className="space-y-2" data-testid="cq-options-editor">
                            <Label>
                                Opciones de la lista{" "}
                                <span className="text-destructive">*</span>
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    value={draft._optionInput || ""}
                                    onChange={(e) => upd({ _optionInput: e.target.value })}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            addOption();
                                        }
                                    }}
                                    placeholder="Escribe una opción y presiona Enter o +"
                                    data-testid="cq-option-input"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={addOption}
                                    data-testid="cq-option-add"
                                >
                                    <Plus className="h-4 w-4 mr-1" /> Agregar
                                </Button>
                            </div>
                            {(draft.options || []).length === 0 ? (
                                <p className="text-xs text-destructive">
                                    Agrega al menos una opción a la lista
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-1.5">
                                    {draft.options.map((opt) => (
                                        <span
                                            key={opt}
                                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-muted/40"
                                        >
                                            {opt}
                                            <button
                                                type="button"
                                                onClick={() => removeOption(opt)}
                                                className="text-muted-foreground hover:text-foreground"
                                                aria-label={`Quitar ${opt}`}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* Comportamiento */}
                <section className="space-y-3">
                    <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Comportamiento
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="text-sm min-w-0">
                            <div className="font-medium">
                                {draft.required ? "Campo obligatorio" : "Campo opcional"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {draft.required
                                    ? "El cliente debe completarlo para poder comprar"
                                    : "El cliente puede omitirlo sin problema"}
                            </div>
                        </div>
                        <Switch
                            checked={!draft.required}
                            onCheckedChange={(optional) => upd({ required: !optional })}
                            data-testid="cq-optional"
                        />
                    </div>
                </section>
            </div>

            {/* Localidades */}
            {localities.length > 0 && (
                <section className="space-y-2" data-testid="cq-localities">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-sm">
                            Localidades <span className="text-destructive">*</span>{" "}
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
                                    upd({ locality_ids: localities.map((l) => l.id) })
                                }
                                data-testid="cq-loc-all"
                            >
                                Todas
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => upd({ locality_ids: [] })}
                                data-testid="cq-loc-clear"
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
                                    data-testid={`cq-loc-${loc.id}`}
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
                </section>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    data-testid="cq-cancel-footer"
                >
                    Cancelar
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={onSave}
                    disabled={!canCreate}
                    data-testid="cq-save-footer"
                >
                    {draft._isNew ? "Crear parámetro" : "Guardar"}
                </Button>
            </div>
        </div>
    );
}
