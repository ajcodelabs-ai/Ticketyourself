import { Navigate } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import PublicLayout from "@/components/PublicLayout";
import OrganizerLayout from "@/components/OrganizerLayout";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/contexts/AuthContext";

export function Public({ children }) {
    return <PublicLayout>{children}</PublicLayout>;
}

export function OrgArea({ children }) {
    return (
        <ProtectedRoute role="organizer">
            <OrganizerLayout>{children}</OrganizerLayout>
        </ProtectedRoute>
    );
}

// Blocks the real dashboard until the organizer finished onboarding: approved
// by an admin AND paid for the selected plan. Anyone else gets bounced to
// /onboarding, which renders the right step for their current status.
function RequireActiveOrganizer({ children }) {
    const { loading, organizer } = useAuth();

    if (loading) {
        return (
            <div
                data-testid="auth-loading"
                className="min-h-screen grid place-items-center text-sm text-muted-foreground"
            >
                Cargando…
            </div>
        );
    }
    const isActive = organizer?.status === "approved" && organizer?.subscription_status !== "none";
    if (!isActive) {
        return <Navigate to="/onboarding" replace />;
    }
    return children;
}

export function Dashboard({ children }) {
    return (
        <ProtectedRoute role="organizer">
            <RequireActiveOrganizer>
                <OrganizerLayout>{children}</OrganizerLayout>
            </RequireActiveOrganizer>
        </ProtectedRoute>
    );
}

export function AdminArea({ children }) {
    return (
        <ProtectedRoute role="super_admin">
            <AdminLayout>{children}</AdminLayout>
        </ProtectedRoute>
    );
}
