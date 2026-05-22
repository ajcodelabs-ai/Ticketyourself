import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import PublicLayout from "@/components/PublicLayout";
import OrganizerLayout from "@/components/OrganizerLayout";
import AdminLayout from "@/components/AdminLayout";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import BillingSuccess from "@/pages/BillingSuccess";
import BillingCancel from "@/pages/BillingCancel";
import Settings from "@/pages/Settings";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminOrganizers from "@/pages/admin/AdminOrganizers";
import AdminOrganizerDetail from "@/pages/admin/AdminOrganizerDetail";
import AdminPlans from "@/pages/admin/AdminPlans";
import AdminFunnel from "@/pages/admin/AdminFunnel";

import MicrositeEditor from "@/pages/MicrositeEditor";
import MicrositePublic from "@/pages/MicrositePublic";

import EventsList from "@/pages/events/EventsList";
import EventNew from "@/pages/events/EventNew";
import EventDetail from "@/pages/events/EventDetail";
import EventEdit from "@/pages/events/EventEdit";
import EventPublic from "@/pages/events/EventPublic";

import OrderSuccess from "@/pages/orders/OrderSuccess";
import OrderCancel from "@/pages/orders/OrderCancel";

// Legacy POC pages
import Home from "@/pages/Home";
import Subscribe from "@/pages/Subscribe";
import Ticket from "@/pages/Ticket";
import Success from "@/pages/Success";
import Cancel from "@/pages/Cancel";
import Payments from "@/pages/Payments";

function Public({ children }) {
    return <PublicLayout>{children}</PublicLayout>;
}

function OrgArea({ children }) {
    return (
        <ProtectedRoute role="organizer">
            <OrganizerLayout>{children}</OrganizerLayout>
        </ProtectedRoute>
    );
}

function AdminArea({ children }) {
    return (
        <ProtectedRoute role="super_admin">
            <AdminLayout>{children}</AdminLayout>
        </ProtectedRoute>
    );
}

function App() {
    return (
        <div className="App">
            <BrowserRouter>
                <AuthProvider>
                    <TenantProvider>
                        <Routes>
                            {/* Public */}
                            <Route path="/" element={<Public><Landing /></Public>} />
                            <Route path="/login" element={<Public><Login /></Public>} />
                            <Route path="/registro" element={<Public><Register /></Public>} />
                            <Route path="/o/:slug" element={<MicrositePublic />} />
                            <Route path="/o/:slug/e/:event_slug" element={<EventPublic />} />
                            <Route path="/o/:slug/orden/:order_number" element={<OrderSuccess />} />
                            <Route
                                path="/o/:slug/orden/:order_number/cancelado"
                                element={<OrderCancel />}
                            />

                            {/* Organizer */}
                            <Route path="/dashboard" element={<OrgArea><Dashboard /></OrgArea>} />
                            <Route path="/onboarding" element={<OrgArea><Onboarding /></OrgArea>} />
                            <Route path="/microsite/editor" element={<OrgArea><MicrositeEditor /></OrgArea>} />
                            <Route path="/eventos" element={<OrgArea><EventsList /></OrgArea>} />
                            <Route path="/eventos/nuevo" element={<OrgArea><EventNew /></OrgArea>} />
                            <Route path="/eventos/:event_id" element={<OrgArea><EventDetail /></OrgArea>} />
                            <Route path="/eventos/:event_id/editar" element={<OrgArea><EventEdit /></OrgArea>} />
                            <Route path="/configuracion" element={<OrgArea><Settings /></OrgArea>} />
                            <Route
                                path="/billing/success"
                                element={<OrgArea><BillingSuccess /></OrgArea>}
                            />
                            <Route
                                path="/billing/cancel"
                                element={<OrgArea><BillingCancel /></OrgArea>}
                            />

                            {/* Admin */}
                            <Route path="/admin" element={<AdminArea><AdminDashboard /></AdminArea>} />
                            <Route
                                path="/admin/organizadores"
                                element={<AdminArea><AdminOrganizers /></AdminArea>}
                            />
                            <Route
                                path="/admin/organizadores/:id"
                                element={<AdminArea><AdminOrganizerDetail /></AdminArea>}
                            />
                            <Route
                                path="/admin/planes"
                                element={<AdminArea><AdminPlans /></AdminArea>}
                            />
                            <Route
                                path="/admin/funnel"
                                element={<AdminArea><AdminFunnel /></AdminArea>}
                            />

                            {/* Legacy POC */}
                            <Route path="/poc" element={<Public><Home /></Public>} />
                            <Route path="/poc/subscribe" element={<Public><Subscribe /></Public>} />
                            <Route path="/poc/ticket" element={<Public><Ticket /></Public>} />
                            <Route path="/poc/success" element={<Public><Success /></Public>} />
                            <Route path="/poc/cancel" element={<Public><Cancel /></Public>} />
                            <Route path="/poc/payments" element={<Public><Payments /></Public>} />

                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </TenantProvider>
                </AuthProvider>
                <Toaster richColors position="top-right" />
            </BrowserRouter>
        </div>
    );
}

export default App;
