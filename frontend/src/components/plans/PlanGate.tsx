/**
 * Locked-feature UI: which plan unlocks it + a CTA to billing.
 * Used wherever a control is gated by the organizer's subscription.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlanFeatures } from "@/hooks/queries/usePlanFeatures";
import {
    planLockLabel,
    planUnlock,
    upgradePlanHref,
    type PlanFeatures,
} from "@/lib/planUnlock";

export function usePlanUnlock(feature: string) {
    const { data } = usePlanFeatures();
    const features = data as PlanFeatures | undefined;
    return {
        features,
        unlock: planUnlock(features, feature),
        label: planLockLabel(features, feature),
        href: upgradePlanHref(feature, planUnlock(features, feature)),
    };
}

export function PlanLockBadge({
    feature,
    className = "",
}: {
    feature: string;
    className?: string;
}) {
    const { label } = usePlanUnlock(feature);
    return (
        <Badge
            variant="outline"
            className={`text-[10px] font-normal border-amber-300 text-amber-950 bg-amber-50 ${className}`}
            data-testid={`plan-lock-badge-${feature}`}
        >
            {label}
        </Badge>
    );
}

export function UpgradePlanButton({
    feature,
    size = "sm",
    className = "",
    label,
}: {
    feature: string;
    size?: "sm" | "default";
    className?: string;
    label?: string;
}) {
    const { unlock, href } = usePlanUnlock(feature);
    const text = label || (unlock?.name ? `Mejorar a ${unlock.name}` : "Mejorar plan");
    return (
        <Button
            asChild
            size={size}
            variant="outline"
            className={`shrink-0 border-amber-400 bg-white hover:bg-amber-50 ${className}`}
            data-testid={`upgrade-plan-${feature}`}
        >
            <Link to={href}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {text}
            </Link>
        </Button>
    );
}

export function PlanGateHint({
    feature,
    children,
    className = "",
}: {
    feature: string;
    children?: ReactNode;
    className?: string;
}) {
    const { label } = usePlanUnlock(feature);
    return (
        <div
            className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2 justify-between ${className}`}
            data-testid={`plan-gate-${feature}`}
        >
            <p className="text-[11px] leading-snug text-amber-950 flex gap-2 min-w-0">
                <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{children || `${label}. Mejorá el plan para usar esta función.`}</span>
            </p>
            <UpgradePlanButton feature={feature} />
        </div>
    );
}
