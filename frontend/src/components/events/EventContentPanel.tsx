import { Plus, Trash2, CalendarClock, FileText, HelpCircle, ExternalLink, ShieldCheck, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { newAgendaItem, newFaqItem } from "@/lib/eventContent";

/**
 * Event content tab: policies (TipTap), agenda blocks, FAQ items.
 */
export default function EventContentPanel({ content, update, disabled = false }) {
    const setContent = (patch) => update("content", { ...content, ...patch });

    const updateAgenda = (index, field, value) => {
        const agenda = content.agenda.map((item, i) =>
            i === index ? { ...item, [field]: value } : item,
        );
        setContent({ agenda });
    };

    const updateFaq = (index, field, value) => {
        const faq = content.faq.map((item, i) =>
            i === index ? { ...item, [field]: value } : item,
        );
        setContent({ faq });
    };

    return (
        <div className="space-y-6" data-testid="section-content">
            {/* Policies */}
            <section className="rounded-xl border p-5 bg-card space-y-3">
                <header>
                    <div className="flex items-center gap-2 font-semibold">
                        <FileText className="h-5 w-5 text-indigo-600" />
                        Reglas y políticas
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Condiciones de asistencia y normas del evento.
                    </p>
                </header>
                <RichTextEditor
                    value={content.policies_html}
                    onChange={(html) => setContent({ policies_html: html })}
                    disabled={disabled}
                    testid="content-policies"
                />
            </section>

            {/* Agenda */}
            <section className="rounded-xl border p-5 bg-card space-y-3">
                <header className="flex items-center justify-between gap-2">
                    <div>
                        <div className="flex items-center gap-2 font-semibold">
                            <CalendarClock className="h-5 w-5 text-amber-600" />
                            Agenda
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            Bloques de horario visibles en la página pública.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                            setContent({ agenda: [...content.agenda, newAgendaItem()] })
                        }
                        data-testid="content-agenda-add"
                    >
                        <Plus className="h-4 w-4 mr-1" />
                        Bloque
                    </Button>
                </header>
                {content.agenda.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                        Sin bloques de agenda. Agregá horarios si el evento tiene programa.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {content.agenda.map((item, i) => (
                            <div
                                key={item.id || i}
                                className="rounded-lg border p-3 space-y-2 bg-muted/30"
                                data-testid={`content-agenda-${i}`}
                            >
                                <div className="flex gap-2 items-start">
                                    <div className="flex-1 grid sm:grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">Hora</Label>
                                            <Input
                                                value={item.time || ""}
                                                placeholder="19:00"
                                                disabled={disabled}
                                                onChange={(e) =>
                                                    updateAgenda(i, "time", e.target.value)
                                                }
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Título</Label>
                                            <Input
                                                value={item.title || ""}
                                                placeholder="Apertura de puertas"
                                                disabled={disabled}
                                                onChange={(e) =>
                                                    updateAgenda(i, "title", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 text-destructive"
                                        disabled={disabled}
                                        onClick={() =>
                                            setContent({
                                                agenda: content.agenda.filter((_, j) => j !== i),
                                            })
                                        }
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div>
                                    <Label className="text-xs">Descripción</Label>
                                    <Textarea
                                        value={item.description || ""}
                                        rows={2}
                                        disabled={disabled}
                                        onChange={(e) =>
                                            updateAgenda(i, "description", e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ── TyC del organizador ──────────────────────────────────────────── */}
            <section className="rounded-xl border p-5 bg-card space-y-4" data-testid="section-tyc">
                <header>
                    <div className="flex items-center gap-2 font-semibold">
                        <ShieldCheck className="h-5 w-5 text-emerald-600" />
                        Términos y condiciones del organizador
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Si configurás una URL, el comprador verá un checkbox obligatorio antes de pagar.
                    </p>
                </header>
                <div className="space-y-3">
                    <div>
                        <Label className="text-xs" htmlFor="tyc-url">
                            URL del documento de TyC
                        </Label>
                        <div className="flex gap-2 items-center mt-1">
                            <Input
                                id="tyc-url"
                                type="url"
                                placeholder="https://mi-empresa.com/tyc.pdf"
                                value={content.tyc_url || ""}
                                disabled={disabled}
                                onChange={(e) => setContent({ tyc_url: e.target.value })}
                                data-testid="content-tyc-url"
                            />
                            {content.tyc_url && (
                                <a
                                    href={content.tyc_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Abrir enlace"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            )}
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs" htmlFor="tyc-label">
                            Texto del enlace (opcional)
                        </Label>
                        <Input
                            id="tyc-label"
                            placeholder="Términos y condiciones del organizador"
                            value={content.tyc_label || ""}
                            disabled={disabled}
                            onChange={(e) => setContent({ tyc_label: e.target.value })}
                            data-testid="content-tyc-label"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Si lo dejás vacío se mostrará "Términos y condiciones del organizador".
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Compra de grupo completo ──────────────────────────────────────── */}
            <section className="rounded-xl border p-5 bg-card space-y-3" data-testid="section-group-purchase">
                <header>
                    <div className="flex items-center gap-2 font-semibold">
                        <LayoutList className="h-5 w-5 text-violet-600" />
                        Compra de fila / mesa completa
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Permite al comprador seleccionar una fila o mesa entera desde la página del evento (sólo para eventos con mapa de asientos numerados).
                    </p>
                </header>
                <div className="flex items-center gap-3">
                    <Switch
                        id="allow-group-purchase"
                        checked={!!content.allow_full_group_purchase}
                        disabled={disabled}
                        onCheckedChange={(v) => setContent({ allow_full_group_purchase: v })}
                        data-testid="content-allow-group-purchase"
                    />
                    <Label htmlFor="allow-group-purchase" className="cursor-pointer">
                        {content.allow_full_group_purchase
                            ? "Activo — el comprador puede comprar filas/mesas completas"
                            : "Inactivo — selección individual de asientos"}
                    </Label>
                </div>
            </section>

            {/* FAQ */}
            <section className="rounded-xl border p-5 bg-card space-y-3">
                <header className="flex items-center justify-between gap-2">
                    <div>
                        <div className="flex items-center gap-2 font-semibold">
                            <HelpCircle className="h-5 w-5 text-sky-600" />
                            Preguntas frecuentes
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            Dudas comunes sobre este evento específico.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => setContent({ faq: [...content.faq, newFaqItem()] })}
                        data-testid="content-faq-add"
                    >
                        <Plus className="h-4 w-4 mr-1" />
                        Pregunta
                    </Button>
                </header>
                {content.faq.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                        Sin preguntas frecuentes todavía.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {content.faq.map((item, i) => (
                            <div
                                key={item.id || i}
                                className="rounded-lg border p-3 space-y-2 bg-muted/30"
                                data-testid={`content-faq-${i}`}
                            >
                                <div className="flex gap-2 items-start">
                                    <div className="flex-1">
                                        <Label className="text-xs">Pregunta</Label>
                                        <Input
                                            value={item.question || ""}
                                            disabled={disabled}
                                            onChange={(e) =>
                                                updateFaq(i, "question", e.target.value)
                                            }
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 text-destructive mt-5"
                                        disabled={disabled}
                                        onClick={() =>
                                            setContent({
                                                faq: content.faq.filter((_, j) => j !== i),
                                            })
                                        }
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div>
                                    <Label className="text-xs">Respuesta</Label>
                                    <RichTextEditor
                                        value={item.answer_html || ""}
                                        onChange={(html) => updateFaq(i, "answer_html", html)}
                                        disabled={disabled}
                                        testid={`content-faq-answer-${i}`}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
