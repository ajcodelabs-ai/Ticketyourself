import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Assign page modules to named chunks for route-based code splitting. */
function pageChunk(id: string): string | undefined {
    if (!id.includes("/src/pages/")) return undefined;
    if (id.includes("/pages/marketing/")) return "pages-marketing";
    if (id.includes("/pages/public/")) return "pages-public";
    if (id.includes("/pages/organizer/")) return "pages-organizer";
    if (id.includes("/pages/admin/")) return "pages-admin";
    if (id.includes("/pages/legacy/")) return "pages-legacy";
    return undefined;
}

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    server: {
        port: 3000,
        host: true,
        watch: {
            usePolling: true,
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    const page = pageChunk(id);
                    if (page) return page;

                    if (id.includes("node_modules/konva") || id.includes("node_modules/react-konva")) {
                        return "vendor-konva";
                    }
                    if (id.includes("node_modules/recharts")) {
                        return "vendor-recharts";
                    }
                    if (id.includes("node_modules/html5-qrcode")) {
                        return "vendor-qrcode";
                    }
                },
            },
        },
    },
});
