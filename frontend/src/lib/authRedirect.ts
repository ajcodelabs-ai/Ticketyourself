/** Only same-origin relative paths — blocks open redirects via `next` / state.from. */
export function safeInternalPath(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
        return null;
    }
    return trimmed;
}

export function pathFromLocationState(from) {
    if (!from) return null;
    if (typeof from === "string") return safeInternalPath(from);
    const path = `${from.pathname || ""}${from.search || ""}${from.hash || ""}`;
    return safeInternalPath(path);
}

export function defaultPathForRole(role) {
    if (role === "super_admin") return "/admin";
    if (role === "organizer") return "/app/dashboard";
    return "/cuenta";
}
