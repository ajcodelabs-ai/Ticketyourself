import { afterEach, describe, expect, it } from "vitest";
import { logoutPathForSession } from "./authRedirect";

function setHostname(hostname: string) {
    Object.defineProperty(window, "location", {
        value: { hostname },
        writable: true,
        configurable: true,
    });
}

describe("logoutPathForSession", () => {
    afterEach(() => setHostname("localhost"));

    it("sends buyers back to the organizer microsite they were viewing", () => {
        setHostname("localhost");
        expect(logoutPathForSession({ role: "buyer", tenantSlug: "demo-org" })).toBe(
            "/o/demo-org",
        );
    });

    it("sends buyers to / when already on that organizer's subdomain", () => {
        setHostname("demo-org.ajcodelabs.ai");
        expect(logoutPathForSession({ role: "buyer", tenantSlug: "demo-org" })).toBe("/");
    });

    it("keeps admin and organizer destinations", () => {
        expect(logoutPathForSession({ role: "super_admin" })).toBe("/admin/login");
        expect(logoutPathForSession({ role: "organizer", tenantSlug: "demo-org" })).toBe(
            "/login",
        );
    });
});
