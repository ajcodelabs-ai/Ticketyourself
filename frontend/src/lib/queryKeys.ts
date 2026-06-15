/** Centralized React Query keys. */
export const queryKeys = {
    dashboard: {
        me: ["dashboard", "me"] as const,
    },
    events: {
        list: (filters: { status?: string; search?: string }) =>
            ["events", "me", filters] as const,
        detail: (id: string) => ["events", "me", id] as const,
    },
    admin: {
        organizers: (filters: Record<string, string>) =>
            ["admin", "organizers", filters] as const,
    },
};
