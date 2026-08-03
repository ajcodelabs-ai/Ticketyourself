import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Feature flags + quotas for the current organizer's subscription plan. */
export function usePlanFeatures() {
    return useQuery({
        queryKey: queryKeys.plans.features,
        queryFn: async () => {
            const { data } = await api.get("/plans/me/features");
            return data as Record<string, unknown>;
        },
        staleTime: 5 * 60 * 1000,
    });
}
