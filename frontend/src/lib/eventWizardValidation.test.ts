import { describe, expect, it } from "vitest";
import { collectEventWizardIssues } from "@/lib/eventWizardValidation";
import { defaultPaymentMethods } from "@/lib/paymentMethods";

function baseForm(overrides = {}) {
    return {
        title: "Concierto demo",
        starts_at: "2026-09-01T20:00",
        duration_preset: "2h",
        duration_minutes_custom: 0,
        sales_window_preset_start: "immediate",
        sales_window_preset_end: "at_start",
        sales_start_custom: "",
        sales_end_custom: "",
        no_seating_mode: true,
        venue_name: "Teatro",
        pricing_type: "free",
        base_price_dollars: "0",
        payment_methods: defaultPaymentMethods(),
        ...overrides,
    };
}

describe("collectEventWizardIssues", () => {
    it("blocks draft without title (dates not required to draft)", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ title: "", starts_at: "" }),
            poster: null,
            currentEvent: null,
            mode: "draft",
        });
        expect(issues.map((i) => i.code)).toContain("title");
        expect(issues.map((i) => i.code)).not.toContain("starts_at");
    });

    it("allows draft with title and no schedule yet", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ title: "Concierto", starts_at: "", venue_name: "" }),
            poster: null,
            currentEvent: null,
            mode: "draft",
        });
        expect(issues).toHaveLength(0);
    });

    it("allows draft with title + schedule only", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ venue_name: "", no_seating_mode: true }),
            poster: null,
            currentEvent: null,
            mode: "draft",
        });
        expect(issues).toHaveLength(0);
    });

    it("blocks publish when plan cannot sell a seat-only map", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ venue_id: "v1" }),
            poster: "/x.jpg",
            currentEvent: {
                venue_id: "v1",
                venue_layout: { elements: [{ kind: "seat_row_straight" }] },
                locality_pricing: [],
            },
            mode: "publish",
            organizerStatus: "approved",
            allowNumbered: false,
        });
        expect(issues.map((i) => i.code)).toContain("plan_numbered_blocked");
    });

    it("does not block a mixed map when the plan has no numbered seating", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ venue_id: "v1" }),
            poster: "/x.jpg",
            currentEvent: {
                venue_id: "v1",
                venue_layout: {
                    elements: [
                        { kind: "seat_row_straight" },
                        { kind: "unnumbered_zone" },
                    ],
                },
                locality_pricing: [{ locality_id: "l1", price_cents: 0 }],
            },
            mode: "publish",
            organizerStatus: "approved",
            allowNumbered: false,
        });
        expect(issues.map((i) => i.code)).not.toContain("plan_numbered_blocked");
    });

    it("requires poster and escenario to publish", () => {
        const issues = collectEventWizardIssues({
            form: baseForm({ venue_name: "" }),
            poster: null,
            currentEvent: null,
            mode: "publish",
            organizerStatus: "approved",
        });
        expect(issues.map((i) => i.code)).toEqual(
            expect.arrayContaining(["poster", "venue"]),
        );
    });

    it("flags pending organizer on publish", () => {
        const issues = collectEventWizardIssues({
            form: baseForm(),
            poster: "/x.jpg",
            currentEvent: { poster_url: "/x.jpg" },
            mode: "publish",
            organizerStatus: "pending",
        });
        expect(issues.some((i) => i.code === "organizer_pending")).toBe(true);
    });

    it("requires payment method when paid", () => {
        const pm = defaultPaymentMethods();
        Object.keys(pm).forEach((k) => {
            if (pm[k] && typeof pm[k] === "object") pm[k].enabled = false;
        });
        if (Array.isArray(pm.enabled_codes)) pm.enabled_codes = [];
        const issues = collectEventWizardIssues({
            form: baseForm({
                pricing_type: "paid",
                base_price_dollars: "10",
                payment_methods: pm,
            }),
            poster: "/x.jpg",
            currentEvent: { poster_url: "/x.jpg" },
            mode: "publish",
            organizerStatus: "approved",
        });
        expect(issues.some((i) => i.code === "payment_methods")).toBe(true);
    });
});
