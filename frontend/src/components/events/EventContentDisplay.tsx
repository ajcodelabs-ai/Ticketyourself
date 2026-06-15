import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { CalendarClock, FileText, HelpCircle } from "lucide-react";

function hasHtmlContent(html) {
    if (!html) return false;
    const text = html.replace(/<[^>]+>/g, "").trim();
    return text.length > 0;
}

/**
 * Public-facing event content: policies, agenda, FAQ.
 */
export default function EventContentDisplay({ content }) {
    if (!content) return null;

    const { policies_html, agenda = [], faq = [] } = content;
    const hasPolicies = hasHtmlContent(policies_html);
    const hasAgenda = agenda.some((a) => a.title || a.time || a.description);
    const hasFaq = faq.some((f) => f.question);

    if (!hasPolicies && !hasAgenda && !hasFaq) return null;

    return (
        <div className="space-y-8" data-testid="event-content-display">
            {hasAgenda && (
                <section>
                    <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                        <CalendarClock className="h-5 w-5 text-amber-600" />
                        Agenda
                    </h2>
                    <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
                        {agenda.map((item, i) => (
                            <li key={item.id || i} className="relative">
                                <div className="font-medium">
                                    {item.time && (
                                        <span className="text-primary mr-2">{item.time}</span>
                                    )}
                                    {item.title}
                                </div>
                                {item.description && (
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                        {item.description}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {hasPolicies && (
                <section>
                    <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                        <FileText className="h-5 w-5 text-indigo-600" />
                        Reglas y políticas
                    </h2>
                    <div
                        className="prose prose-sm max-w-none text-muted-foreground"
                        dangerouslySetInnerHTML={{ __html: policies_html }}
                    />
                </section>
            )}

            {hasFaq && (
                <section>
                    <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                        <HelpCircle className="h-5 w-5 text-sky-600" />
                        Preguntas frecuentes
                    </h2>
                    <Accordion type="single" collapsible className="w-full">
                        {faq.map(
                            (item, i) =>
                                item.question && (
                                    <AccordionItem key={item.id || i} value={`faq-${i}`}>
                                        <AccordionTrigger>{item.question}</AccordionTrigger>
                                        <AccordionContent>
                                            <div
                                                className="prose prose-sm max-w-none text-muted-foreground"
                                                dangerouslySetInnerHTML={{
                                                    __html: item.answer_html || "",
                                                }}
                                            />
                                        </AccordionContent>
                                    </AccordionItem>
                                ),
                        )}
                    </Accordion>
                </section>
            )}
        </div>
    );
}
