import { Plus, Trash2, CalendarClock, FileText, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
                        Condiciones de asistencia, reembolsos y normas del evento.
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
