/**
 * Defensive cleanup of any third-party platform branding that may be
 * injected post-build (e.g. "Made with X" badges added by the host platform
 * after our bundle is served). Phase 9.6 — the user reported they still saw
 * "Made with Emergent" after we cleaned `public/index.html`, which can only
 * happen via runtime injection from outside the bundle.
 *
 * Strategy:
 *  • Sweep the DOM on mount for any element matching known badge selectors
 *    and remove it.
 *  • Observe `<body>` for added subtrees and re-sweep, since the injector
 *    might run after our React render or react to navigation events.
 *  • Disconnect on unmount (we only mount once at <App/> root, so this is
 *    effectively permanent for the session).
 */
const SELECTORS = [
    'a[href*="emergent.sh"]',
    'a[href*="emergent.dev"]',
    'a[href*="emergent.com"]',
    '[id^="emergent"]',
    '[id*="-emergent-"]',
    '[class*="emergent-badge"]',
    '[class*="madewithemergent"]',
    'iframe[src*="emergent"]',
    '[data-emergent]',
];

function sweep() {
    if (typeof document === "undefined") return;
    const seen = new Set();
    for (const sel of SELECTORS) {
        for (const el of document.querySelectorAll(sel)) {
            if (seen.has(el)) continue;
            seen.add(el);
            el.remove();
        }
    }
}

let observer = null;

export function startBadgeSweeper() {
    if (typeof window === "undefined") return;
    if (observer) return; // already running
    sweep();
    // Throttle: batch mutations in one tick to avoid hot loops.
    let pending = false;
    observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(() => {
            pending = false;
            sweep();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopBadgeSweeper() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}
