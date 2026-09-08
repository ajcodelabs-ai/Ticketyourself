import { describe, expect, it } from "vitest";
import {
    documentReviewEnabled,
    groupDocumentsByType,
    previousVersionLabel,
} from "./organizerDocuments";

const idCardOld = {
    id: "old",
    doc_type: "id_card",
    status: "needs_correction",
    uploaded_at: "2026-09-08T10:00:00Z",
};
const idCardNew = {
    id: "new",
    doc_type: "id_card",
    status: "pending",
    uploaded_at: "2026-09-08T12:00:00Z",
};
const bank = {
    id: "bank",
    doc_type: "bank_cert",
    status: "approved",
    uploaded_at: "2026-09-08T11:00:00Z",
};

describe("groupDocumentsByType", () => {
    it("nests the older c?dula under the correction upload", () => {
        const groups = groupDocumentsByType([idCardOld, bank, idCardNew]);
        expect(groups.map((g) => g.docType)).toEqual(["id_card", "bank_cert"]);
        expect(groups[0].current.id).toBe("new");
        expect(groups[0].isCorrectionUpload).toBe(true);
        expect(groups[0].previous.map((d) => d.id)).toEqual(["old"]);
        expect(groups[1].current.id).toBe("bank");
        expect(groups[1].isCorrectionUpload).toBe(false);
    });

    it("marks a re-upload after rejection as a correction too", () => {
        const groups = groupDocumentsByType([
            { ...idCardOld, status: "rejected" },
            idCardNew,
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].isCorrectionUpload).toBe(true);
        expect(groups[0].current.id).toBe("new");
    });

    it("does not treat a second upload after approval as a correction", () => {
        const groups = groupDocumentsByType([
            { ...idCardOld, status: "approved" },
            idCardNew,
        ]);
        expect(groups[0].isCorrectionUpload).toBe(false);
    });
});

describe("documentReviewEnabled", () => {
    it("only pending files can be reviewed", () => {
        expect(documentReviewEnabled("pending")).toBe(true);
        expect(documentReviewEnabled("approved")).toBe(false);
        expect(documentReviewEnabled("needs_correction")).toBe(false);
        expect(documentReviewEnabled("rejected")).toBe(false);
    });
});

describe("previousVersionLabel", () => {
    it("explains why an older file is nested", () => {
        expect(previousVersionLabel("needs_correction")).toMatch(/correcci/);
        expect(previousVersionLabel("rejected")).toMatch(/Rechazado/);
    });
});
