import ProtectedRoute from "@/components/ProtectedRoute";
import PublicLayout from "@/components/PublicLayout";
import OrganizerLayout from "@/components/OrganizerLayout";
import AdminLayout from "@/components/AdminLayout";

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

export function AdminArea({ children }) {
    return (
        <ProtectedRoute role="super_admin">
            <AdminLayout>{children}</AdminLayout>
        </ProtectedRoute>
    );
}
