import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useEventsList(filters: { status?: string; search?: string } = {}) {
    const status = filters.status && filters.status !== "all" ? filters.status : undefined;
    const search = filters.search?.trim() || undefined;

    return useQuery({
        queryKey: queryKeys.events.list({ status, search }),
        queryFn: async () => {
            const params: Record<string, string> = {};
            if (status) params.status = status;
            if (search) params.search = search;
            const { data } = await api.get("/events/me", { params });
            return data.items || [];
        },
    });
}
