import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { startBadgeSweeper } from "@/lib/badgeSweeper";

// Defensive: strip any third-party branding badges that the host platform
// might inject post-build (Phase 9.6 hardening). Started before React renders
// so we catch elements injected during initial DOM bootstrap.
startBadgeSweeper();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
