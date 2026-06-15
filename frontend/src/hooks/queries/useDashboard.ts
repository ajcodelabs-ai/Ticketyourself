import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useDashboard() {
    return useQuery({
        queryKey: queryKeys.dashboard.me,
        queryFn: async () => {
            const { data } = await api.get("/dashboard/me");
            return data;
        },
    });
}
