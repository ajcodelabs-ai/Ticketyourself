import { afterEach, describe, expect, it } from "vitest";
import { previewMicrositeSubpath } from "./config";

function setHostname(hostname: string) {
    Object.defineProperty(window, "location", {
        value: { hostname },
        writable: true,
        configurable: true,
    });
}

describe("previewMicrositeSubpath", () => {
    afterEach(() => setHostname("localhost"));

    it("doesn't double the slash when already on the tenant's own subdomain", () => {
        setHostname("demo-org.ajcodelabs.ai");
        expect(previewMicrositeSubpath("demo-org", "/e/my-event")).toBe("/e/my-event");
    });

    it("prefixes /o/<slug> off the tenant's subdomain", () => {
        setHostname("tys-staging.ajcodelabs.ai");
        expect(previewMicrositeSubpath("demo-org", "/e/my-event")).toBe(
            "/o/demo-org/e/my-event",
        );
    });
});
