import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { LazyPage } from "@/routes/LazyPage";
import { AdminArea, Dashboard, OrgArea, Public } from "@/routes/layouts";
import * as Pages from "@/routes/lazyPages";

function RedirectEvent() {
    const { event_id } = useParams();
    return <Navigate to={`/app/eventos/${event_id}`} replace />;
}

function RedirectEventEdit() {
    const { event_id } = useParams();
    return <Navigate to={`/app/eventos/${event_id}/editar`} replace />;
}

export default function AppRoutes() {
    return (
        <Routes>
            {/* ── Marketing ─────────────────────────────────────────────── */}
            <Route path="/" element={<Public><LazyPage page={Pages.Landing} /></Public>} />
            <Route path="/login" element={<Public><LazyPage page={Pages.Login} /></Public>} />
            <Route path="/registro" element={<Public><LazyPage page={Pages.Register} /></Public>} />

            {/* ── Público del tenant (/o/:slug/*) ───────────────────────── */}
            <Route path="/o/:slug" element={<LazyPage page={Pages.MicrositePublic} />} />
            <Route path="/o/:slug/e/:event_slug" element={<LazyPage page={Pages.EventPublic} />} />
            <Route
                path="/o/:tenantSlug/venues/:venueSlug/preview"
                element={<LazyPage page={Pages.VenuePreview} />}
            />
            <Route path="/o/:slug/orden/:order_number" element={<LazyPage page={Pages.OrderSuccess} />} />
            <Route path="/orden/:token" element={<LazyPage page={Pages.OrderByToken} />} />
            <Route path="/staff/login" element={<Public><LazyPage page={Pages.StaffLogin} /></Public>} />
            <Route path="/staff/scanner" element={<LazyPage page={Pages.StaffScanner} />} />
            <Route
                path="/o/:slug/orden/:order_number/cancelado"
                element={<LazyPage page={Pages.OrderCancel} />}
            />
            <Route
                path="/o/:slug/orden/:order_number/instrucciones"
                element={<LazyPage page={Pages.PaymentInstructions} />}
            />

            {/* ── Panel organizador (/app/*) ────────────────────────────── */}
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/dashboard" element={<Dashboard><LazyPage page={Pages.DashboardHome} /></Dashboard>} />
            <Route path="/app/venues" element={<Dashboard><LazyPage page={Pages.Venues} /></Dashboard>} />
            <Route path="/app/venues/:id/editor" element={<Dashboard><LazyPage page={Pages.VenueEditor} /></Dashboard>} />
            <Route path="/app/microsite" element={<Dashboard><LazyPage page={Pages.MicrositeEditor} /></Dashboard>} />
            <Route path="/app/eventos" element={<Dashboard><LazyPage page={Pages.EventsList} /></Dashboard>} />
            <Route path="/app/eventos/nuevo" element={<Dashboard><LazyPage page={Pages.EventNew} /></Dashboard>} />
            <Route path="/app/eventos/:event_id" element={<Dashboard><LazyPage page={Pages.EventDetail} /></Dashboard>} />
            <Route path="/app/eventos/:event_id/editar" element={<Dashboard><LazyPage page={Pages.EventEdit} /></Dashboard>} />
            <Route path="/app/eventos/:id/validacion" element={<Dashboard><LazyPage page={Pages.EventValidation} /></Dashboard>} />
            <Route path="/app/staff" element={<Dashboard><LazyPage page={Pages.StaffPage} /></Dashboard>} />
            <Route path="/app/configuracion" element={<Dashboard><LazyPage page={Pages.Configuracion} /></Dashboard>} />

            <Route path="/onboarding" element={<OrgArea><LazyPage page={Pages.Onboarding} /></OrgArea>} />
            <Route path="/billing/success" element={<OrgArea><LazyPage page={Pages.BillingSuccess} /></OrgArea>} />
            <Route path="/billing/cancel" element={<OrgArea><LazyPage page={Pages.BillingCancel} /></OrgArea>} />

            {/* ── Redirects legacy ──────────────────────────────────────── */}
            <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/eventos" element={<Navigate to="/app/eventos" replace />} />
            <Route path="/eventos/nuevo" element={<Navigate to="/app/eventos/nuevo" replace />} />
            <Route path="/eventos/:event_id" element={<RedirectEvent />} />
            <Route path="/eventos/:event_id/editar" element={<RedirectEventEdit />} />
            <Route path="/microsite/editor" element={<Navigate to="/app/microsite" replace />} />
            <Route path="/configuracion" element={<Navigate to="/app/configuracion" replace />} />

            {/* ── Super admin (/admin/*) ────────────────────────────────── */}
            <Route path="/admin" element={<AdminArea><LazyPage page={Pages.AdminDashboard} /></AdminArea>} />
            <Route path="/admin/organizadores" element={<AdminArea><LazyPage page={Pages.AdminOrganizers} /></AdminArea>} />
            <Route path="/admin/organizadores/:id" element={<AdminArea><LazyPage page={Pages.AdminOrganizerDetail} /></AdminArea>} />
            <Route path="/admin/planes" element={<AdminArea><LazyPage page={Pages.AdminPlans} /></AdminArea>} />
            <Route path="/admin/configuracion" element={<AdminArea><LazyPage page={Pages.AdminConfiguracion} /></AdminArea>} />
            <Route path="/admin/funnel" element={<AdminArea><LazyPage page={Pages.AdminFunnel} /></AdminArea>} />
            <Route path="/admin/eventos" element={<AdminArea><LazyPage page={Pages.AdminEvents} /></AdminArea>} />
            <Route path="/admin/auditoria" element={<AdminArea><LazyPage page={Pages.AdminAuditLog} /></AdminArea>} />
            <Route path="/admin/reportes" element={<AdminArea><LazyPage page={Pages.AdminReports} /></AdminArea>} />
            <Route path="/admin/venue-templates" element={<AdminArea><LazyPage page={Pages.AdminVenueTemplates} /></AdminArea>} />
            <Route
                path="/admin/venue-templates/:id/editor"
                element={<AdminArea><LazyPage page={Pages.AdminVenueTemplateEditor} /></AdminArea>}
            />

            {/* ── Legacy POC (/poc/*) ───────────────────────────────────── */}
            <Route path="/poc" element={<Public><LazyPage page={Pages.PocHome} /></Public>} />
            <Route path="/poc/subscribe" element={<Public><LazyPage page={Pages.PocSubscribe} /></Public>} />
            <Route path="/poc/ticket" element={<Public><LazyPage page={Pages.PocTicket} /></Public>} />
            <Route path="/poc/success" element={<Public><LazyPage page={Pages.PocSuccess} /></Public>} />
            <Route path="/poc/cancel" element={<Public><LazyPage page={Pages.PocCancel} /></Public>} />
            <Route path="/poc/payments" element={<Public><LazyPage page={Pages.PocPayments} /></Public>} />

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
