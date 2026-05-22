/**
 * Plan card + showcase used across the SaaS onboarding surface area:
 * - Landing page pricing section
 * - Register page (expandable "see plans" panel)
 * - Onboarding step 2 (interactive selection)
 *
 * Single source of truth for plan visual semantics (badge "Más popular" on
 * profesional, checkmarks list, CTA labels).
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, CreditCard } from "lucide-react";
import api from "@/lib/api";

const POPULAR_PLAN_CODE = "profesional";

function formatPrice(plan) {
    const dollars = plan.price_cents / 100;
    const display = Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2);
    return `$${display}`;
}

function periodLabel(plan) {
    if (plan.billing_period === "monthly") return "/ mes";
    if (plan.billing_period === "one_time") return "pago único";
    return "";
}

export function PlanCard({ plan, ctaLabel, onSelect, selected = false, compact = false }) {
    const isPopular = plan.code === POPULAR_PLAN_CODE;
    return (
        <div
            data-testid={`plan-card-${plan.code}`}
            className={[
                "relative rounded-2xl border bg-card flex flex-col transition-all",
                compact ? "p-4" : "p-6",
                selected
                    ? "border-primary ring-2 ring-primary/30 shadow-lg"
                    : "border-border/70 hover:border-primary/40 hover:shadow-md",
            ].join(" ")}
        >
            {isPopular && (
                <Badge
                    className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground whitespace-nowrap"
                    data-testid={`plan-card-${plan.code}-badge`}
                >
                    <Sparkles className="h-3 w-3 mr-1" />
                    Más popular
                </Badge>
            )}

            <div className="space-y-1">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="text-xs text-muted-foreground min-h-[2lh]">
                    {plan.description}
                </p>
            </div>

            <div className="my-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">{formatPrice(plan)}</span>
                <span className="text-sm text-muted-foreground">{periodLabel(plan)}</span>
            </div>

            <ul className="space-y-2 text-sm mb-5 flex-1">
                {(plan.features || []).map((f) => (
                    <li key={f} className="flex gap-2 items-start">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            {onSelect && (
                <Button
                    onClick={() => onSelect(plan)}
                    data-testid={`plan-card-${plan.code}-cta`}
                    className={
                        isPopular
                            ? "w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                            : "w-full"
                    }
                    variant={isPopular ? "default" : "outline"}
                >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {ctaLabel || "Elegir"}
                </Button>
            )}
        </div>
    );
}

/** Fetches /api/plans and renders the 4 cards. */
export default function PlansShowcase({
    onSelect,
    ctaLabel = "Elegir plan",
    columns = 4,
    compact = false,
}) {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        api.get("/plans")
            .then((r) => {
                if (active) setPlans(r.data || []);
            })
            .catch(() => {
                if (active) setPlans([]);
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, []);

    if (loading) {
        return (
            <p
                className="text-sm text-muted-foreground"
                data-testid="plans-showcase-loading"
            >
                Cargando planes…
            </p>
        );
    }

    if (plans.length === 0) {
        return (
            <p
                className="text-sm text-muted-foreground"
                data-testid="plans-showcase-empty"
            >
                No hay planes disponibles por ahora.
            </p>
        );
    }

    // Order: cheapest monthly first, one-time last.
    const ordered = [...plans].sort((a, b) => {
        if (a.billing_period === "one_time" && b.billing_period !== "one_time") return 1;
        if (b.billing_period === "one_time" && a.billing_period !== "one_time") return -1;
        return a.price_cents - b.price_cents;
    });

    const colsCls = {
        2: "md:grid-cols-2",
        3: "md:grid-cols-3",
        4: "md:grid-cols-2 lg:grid-cols-4",
    }[columns] || "md:grid-cols-2 lg:grid-cols-4";

    return (
        <div
            className={`grid gap-4 sm:gap-6 ${colsCls}`}
            data-testid="plans-showcase"
        >
            {ordered.map((p) => (
                <PlanCard
                    key={p.code}
                    plan={p}
                    onSelect={onSelect}
                    ctaLabel={ctaLabel}
                    compact={compact}
                />
            ))}
        </div>
    );
}
