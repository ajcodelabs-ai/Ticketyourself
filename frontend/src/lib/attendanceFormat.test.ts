import { describe, expect, it } from "vitest";
import {
    inferAttendanceFormat,
    inferAttendanceFormatFromLocalities,
    layoutHasNumberedSeats,
    layoutHasUnnumberedZones,
    elementMatchesSeatingType,
    normalizeLocalitySeatingType,
    coerceLocalitySeatingType,
    planLayoutSeatingConflict,
} from "./attendanceFormat";

describe("attendanceFormat", () => {
    it("detects plan vs numbered layout conflict", () => {
        expect(planLayoutSeatingConflict([{ kind: "seat_individual" }], true)).toBe("none");
        expect(planLayoutSeatingConflict([{ kind: "unnumbered_zone" }], false)).toBe("none");
        expect(
            planLayoutSeatingConflict(
                [{ kind: "seat_individual" }, { kind: "unnumbered_zone" }],
                false,
            ),
        ).toBe("numbered_unused");
        expect(planLayoutSeatingConflict([{ kind: "seat_row_straight" }], false)).toBe(
            "numbered_only_blocked",
        );
    });

    it("detects numbered seats vs unnumbered zones on a layout", () => {
        const elements = [
            { kind: "seat_row_straight" },
            { kind: "unnumbered_zone" },
        ];
        expect(layoutHasNumberedSeats(elements)).toBe(true);
        expect(layoutHasUnnumberedZones(elements)).toBe(true);
    });

    it("infers general without venue", () => {
        expect(inferAttendanceFormat({ venue_id: null })).toBe("general");
        expect(
            inferAttendanceFormat({
                venue_id: null,
                access_params: { attendance_format: "numbered" },
            }),
        ).toBe("numbered");
    });

    it("infers mixed from layout (seats + zones), not from a saved event flag", () => {
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                venue: {
                    elements: [
                        { kind: "seat_individual" },
                        { kind: "unnumbered_zone" },
                    ],
                },
            }),
        ).toBe("mixed");
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                access_params: { attendance_format: "mixed" },
                venue: { elements: [{ kind: "seat_individual" }] },
            }),
        ).toBe("numbered");
    });

    it("infers numbered for seat-only venues", () => {
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                venue_layout: { elements: [{ kind: "seat_row_curved" }] },
            }),
        ).toBe("numbered");
    });

    it("infers general when the venue only has unnumbered zones", () => {
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                venue_layout: { elements: [{ kind: "unnumbered_zone" }] },
            }),
        ).toBe("general");
    });

    it("infers format from locality seating_type when present", () => {
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                venue_layout: {
                    localities: [
                        { seating_type: "numbered" },
                        { seating_type: "unnumbered" },
                    ],
                    elements: [{ kind: "seat_individual" }],
                },
            }),
        ).toBe("mixed");
        expect(
            inferAttendanceFormatFromLocalities([
                { seating_type: "unnumbered" },
                { seating_type: "unnumbered" },
            ]),
        ).toBe("general");
        expect(
            inferAttendanceFormatFromLocalities([{ seating_type: "mixed" }]),
        ).toBe("mixed");
    });

    it("normalizes and coerces locality seating types", () => {
        expect(normalizeLocalitySeatingType("mixed")).toBe("numbered");
        expect(normalizeLocalitySeatingType("unnumbered")).toBe("unnumbered");
        expect(coerceLocalitySeatingType("mixed", ["unnumbered_zone"])).toBe("unnumbered");
        expect(coerceLocalitySeatingType("mixed", ["seat_individual", "unnumbered_zone"])).toBe(
            "numbered",
        );
    });

    it("matches map elements to locality seating type", () => {
        expect(elementMatchesSeatingType("unnumbered_zone", "unnumbered")).toBe(true);
        expect(elementMatchesSeatingType("seat_row_straight", "unnumbered")).toBe(false);
        expect(elementMatchesSeatingType("unnumbered_zone", "numbered")).toBe(false);
        expect(elementMatchesSeatingType("seat_individual", "mixed")).toBe(true);
        expect(elementMatchesSeatingType("unnumbered_zone", "mixed")).toBe(false);
        expect(elementMatchesSeatingType("stage", "numbered")).toBe(false);
    });
});
