/**
 * Super-admin document review: group versions of the same type so a
 * re-upload after "needs correction" reads as a reply, not a duplicate.
 */

function uploadedAtMs(doc) {
    const t = Date.parse(doc?.uploaded_at || "");
    return Number.isFinite(t) ? t : 0;
}

export function documentReviewEnabled(status) {
    return status === "pending";
}

/**
 * @param {Array<{ id?: string, doc_type?: string, status?: string, uploaded_at?: string }>} docs
 */
export function groupDocumentsByType(docs) {
    const list = Array.isArray(docs) ? docs : [];
    const byType = new Map();
    for (const doc of list) {
        const key = doc?.doc_type || "_unknown";
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key).push(doc);
    }

    const groups = [];
    for (const [docType, versions] of byType) {
        versions.sort((a, b) => uploadedAtMs(b) - uploadedAtMs(a));
        const current = versions[0];
        const previous = versions.slice(1);
        const predecessor = previous[0] || null;
        const predecessorAskedFix =
            predecessor &&
            (predecessor.status === "needs_correction" || predecessor.status === "rejected");
        groups.push({
            docType,
            current,
            previous,
            isCorrectionUpload: Boolean(current && predecessorAskedFix),
        });
    }

    const rank = (status) => {
        if (status === "pending") return 0;
        if (status === "needs_correction") return 1;
        if (status === "rejected") return 2;
        return 3;
    };
    groups.sort((a, b) => {
        const byStatus = rank(a.current?.status) - rank(b.current?.status);
        if (byStatus !== 0) return byStatus;
        return uploadedAtMs(b.current) - uploadedAtMs(a.current);
    });
    return groups;
}

export function previousVersionLabel(status) {
    if (status === "needs_correction") return "Se pidió corrección de este archivo";
    if (status === "rejected") return "Rechazado — el organizador subió otro";
    return "Versión anterior";
}
