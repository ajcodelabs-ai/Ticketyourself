import { lazy } from "react";

/**
 * Lazy-loaded page modules grouped by product zone.
 * Each group becomes a separate Vite chunk (see vite.config.ts manualChunks).
 */

// ── Marketing (landing, auth, registro) ─────────────────────────────────────
export const Landing = lazy(() => import("@/pages/marketing/Landing"));
export const Login = lazy(() => import("@/pages/marketing/Login"));
export const Register = lazy(() => import("@/pages/marketing/Register"));

// ── Público del tenant (microsite, evento, órdenes) ────────────────────────
export const MicrositePublic = lazy(() => import("@/pages/public/MicrositePublic"));
export const EventPublic = lazy(() => import("@/pages/public/EventPublic"));
export const VenuePreview = lazy(() => import("@/pages/public/VenuePreview"));
export const OrderSuccess = lazy(() => import("@/pages/public/orders/OrderSuccess"));
export const OrderCancel = lazy(() => import("@/pages/public/orders/OrderCancel"));
export const PaymentInstructions = lazy(() => import("@/pages/public/orders/PaymentInstructions"));
export const OrderByToken = lazy(() => import("@/pages/public/orders/OrderByToken"));
export const SeasonPassRedeem = lazy(() => import("@/pages/public/orders/SeasonPassRedeem"));
export const StaffLogin = lazy(() => import("@/pages/public/StaffLogin"));
export const StaffScanner = lazy(() => import("@/pages/staff/StaffScanner"));

// ── Panel organizador (/app/*) ─────────────────────────────────────────────
export const DashboardHome = lazy(() => import("@/pages/organizer/DashboardHome"));
export const Venues = lazy(() => import("@/pages/organizer/Venues"));
export const VenueEditor = lazy(() => import("@/pages/organizer/VenueEditor"));
export const MicrositeEditor = lazy(() => import("@/pages/organizer/MicrositeEditor"));
export const Configuracion = lazy(() => import("@/pages/organizer/Configuracion"));
export const Onboarding = lazy(() => import("@/pages/organizer/Onboarding"));
export const BillingSuccess = lazy(() => import("@/pages/organizer/BillingSuccess"));
export const BillingCancel = lazy(() => import("@/pages/organizer/BillingCancel"));
export const EventsList = lazy(() => import("@/pages/organizer/events/EventsList"));
export const EventNew = lazy(() => import("@/pages/organizer/events/EventNew"));
export const EventDetail = lazy(() => import("@/pages/organizer/events/EventDetail"));
export const EventEdit = lazy(() => import("@/pages/organizer/events/EventEdit"));
export const EventValidation = lazy(() => import("@/pages/organizer/EventValidation"));
export const StaffPage = lazy(() => import("@/pages/organizer/Staff"));

// ── Super admin (/admin/*) ─────────────────────────────────────────────────
export const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
export const AdminOrganizers = lazy(() => import("@/pages/admin/AdminOrganizers"));
export const AdminOrganizerDetail = lazy(() => import("@/pages/admin/AdminOrganizerDetail"));
export const AdminPlans = lazy(() => import("@/pages/admin/AdminPlans"));
export const AdminConfiguracion = lazy(() => import("@/pages/admin/AdminConfiguracion"));
export const AdminFunnel = lazy(() => import("@/pages/admin/AdminFunnel"));
export const AdminEvents = lazy(() => import("@/pages/admin/AdminEvents"));
export const AdminAuditLog = lazy(() => import("@/pages/admin/AdminAuditLog"));
export const AdminReports = lazy(() => import("@/pages/admin/AdminReports"));
export const AdminVenueTemplates = lazy(() => import("@/pages/admin/AdminVenueTemplates"));
export const AdminVenueTemplateEditor = lazy(() => import("@/pages/organizer/VenueEditor"));

// ── Legacy POC (/poc/*) ────────────────────────────────────────────────────
export const PocHome = lazy(() => import("@/pages/legacy/Home"));
export const PocSubscribe = lazy(() => import("@/pages/legacy/Subscribe"));
export const PocTicket = lazy(() => import("@/pages/legacy/Ticket"));
export const PocSuccess = lazy(() => import("@/pages/legacy/Success"));
export const PocCancel = lazy(() => import("@/pages/legacy/Cancel"));
export const PocPayments = lazy(() => import("@/pages/legacy/Payments"));
