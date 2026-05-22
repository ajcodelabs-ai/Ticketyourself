import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTenant } from "@/contexts/TenantContext";
import {
    CreditCard,
    Ticket as TicketIcon,
    Receipt,
    ShieldCheck,
    ArrowRight,
} from "lucide-react";

export default function Home() {
    const { tenant, tenantSlug } = useTenant();

    return (
        <div data-testid="home-page" className="space-y-12">
            {/* Hero */}
            <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card tys-soft-shadow">
                <div className="absolute inset-0 tys-grid-bg opacity-60 pointer-events-none" />
                <div className="relative px-8 sm:px-12 py-14 sm:py-20 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
                    <div className="space-y-6">
                        <Badge
                            data-testid="phase-badge"
                            variant="secondary"
                            className="text-primary bg-secondary border border-primary/15"
                        >
                            Fase 0 · POC de integraciones
                        </Badge>
                        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
                            Ticket Yourself
                            <span className="block text-primary">
                                ticketing multi-tenant.
                            </span>
                        </h1>
                        <p className="text-base sm:text-lg text-muted-foreground max-w-xl">
                            Estamos validando dos integraciones críticas antes
                            de invertir en el resto: <b>Stripe end-to-end</b> y
                            la <b>resolución de tenant</b> por subdominio /
                            path. Usá los botones para probar.
                        </p>

                        <div className="flex flex-wrap gap-3 pt-2">
                            <Button
                                asChild
                                size="lg"
                                data-testid="cta-subscribe"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                <Link to="/poc/subscribe">
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    Probar suscripción de organizador
                                </Link>
                            </Button>
                            <Button
                                asChild
                                size="lg"
                                variant="outline"
                                data-testid="cta-ticket"
                            >
                                <Link to="/poc/ticket">
                                    <TicketIcon className="h-4 w-4 mr-2" />
                                    Probar compra de ticket
                                </Link>
                            </Button>
                        </div>

                        <div className="pt-4 text-sm text-muted-foreground">
                            Tenant activo:{" "}
                            <code
                                data-testid="home-tenant-slug"
                                className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-xs"
                            >
                                {tenantSlug || "—"}
                            </code>{" "}
                            {tenant && (
                                <span>
                                    ({tenant.name},{" "}
                                    <span className="text-emerald-700">
                                        {tenant.status}
                                    </span>
                                    )
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="hidden lg:flex justify-end">
                        <div className="relative w-[320px] h-[320px]">
                            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />
                            <div className="absolute top-6 left-6 right-6 bottom-6 bg-card rounded-2xl border border-border/70 tys-soft-shadow p-5 flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Checkout
                                    </span>
                                    <Badge variant="secondary">test mode</Badge>
                                </div>
                                <div className="flex-1 flex flex-col justify-center space-y-3">
                                    <div className="h-2 rounded bg-muted w-3/4" />
                                    <div className="h-2 rounded bg-muted w-1/2" />
                                    <div className="h-12 rounded-lg bg-primary/90 text-primary-foreground grid place-items-center text-sm font-medium">
                                        Pagar $20.00
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Tarjeta test 4242 4242 4242 4242
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Feature row */}
            <section className="grid md:grid-cols-3 gap-5">
                <FeatureCard
                    icon={<CreditCard className="h-5 w-5" />}
                    title="Stripe Checkout"
                    desc="Sesión de checkout en modo test, suscripción y ticket único."
                    to="/poc/subscribe"
                    cta="Probar suscripción"
                    testid="feature-stripe"
                />
                <FeatureCard
                    icon={<TicketIcon className="h-5 w-5" />}
                    title="Compra de ticket"
                    desc="Monto variable con tarjeta de prueba 4242."
                    to="/poc/ticket"
                    cta="Comprar ticket"
                    testid="feature-ticket"
                />
                <FeatureCard
                    icon={<Receipt className="h-5 w-5" />}
                    title="Pagos POC"
                    desc="Verificar estado pending → paid tras el webhook / polling."
                    to="/poc/payments"
                    cta="Ver pagos"
                    testid="feature-payments"
                />
            </section>
        </div>
    );
}

function FeatureCard({ icon, title, desc, to, cta, testid }) {
    return (
        <Card data-testid={testid} className="border-border/70 tys-soft-shadow">
            <CardHeader className="pb-3">
                <div className="h-10 w-10 rounded-lg bg-secondary text-primary grid place-items-center">
                    {icon}
                </div>
                <CardTitle className="text-lg pt-3">{title}</CardTitle>
                <CardDescription className="text-sm">{desc}</CardDescription>
            </CardHeader>
            <CardContent>
                <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="px-0 text-primary hover:text-primary hover:bg-transparent"
                >
                    <Link to={to} data-testid={`${testid}-link`}>
                        {cta} <ArrowRight className="h-4 w-4 ml-1" />
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}
