import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export type AdminOrganizersFilters = {
    status?: string;
    subscription_status?: string;
    activity?: string;
    search?: string;
    sort?: string;
    direction?: string;
};

export function useAdminOrganizers(filters: AdminOrganizersFilters) {
    return useQuery({
        queryKey: queryKeys.admin.organizers(filters as Record<string, string>),
        queryFn: async () => {
            const params = new URLSearchParams({
                sort: filters.sort || "revenue",
                direction: filters.direction || "desc",
                page: "1",
                limit: "100",
            });
            if (filters.status && filters.status !== "__all") params.set("status", filters.status);
            if (filters.subscription_status && filters.subscription_status !== "__all") {
                params.set("subscription_status", filters.subscription_status);
            }
            if (filters.activity && filters.activity !== "__all") {
                params.set("activity", filters.activity);
            }
            if (filters.search) params.set("search", filters.search);
            const { data } = await api.get(`/admin/organizers-rich?${params.toString()}`);
            return { items: data.items || [], total: data.total ?? 0 };
        },
    });
}
