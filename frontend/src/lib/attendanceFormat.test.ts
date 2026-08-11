import { describe, expect, it } from "vitest";
import {
    inferAttendanceFormat,
    layoutHasNumberedSeats,
    layoutHasUnnumberedZones,
} from "./attendanceFormat";

describe("attendanceFormat", () => {
    it("detects seats and unnumbered zones", () => {
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

    it("infers mixed from layout or saved flag", () => {
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
        ).toBe("mixed");
    });

    it("infers numbered for seat-only venues", () => {
        expect(
            inferAttendanceFormat({
                venue_id: "v1",
                venue_layout: { elements: [{ kind: "seat_row_curved" }] },
            }),
        ).toBe("numbered");
    });
});
