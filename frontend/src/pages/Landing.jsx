import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";
import {
    Ticket,
    Globe,
    ShieldCheck,
    BarChart3,
    Sparkles,
    ArrowRight,
    Check,
} from "lucide-react";

const FEATURES = [
    {
        icon: Globe,
        title: "Microsite propio",
        desc: "Cada organizador tiene su URL única (slug.ticketyourself.com) con branding e info de sus eventos.",
    },
    {
        icon: Ticket,
        title: "Venta de tickets",
        desc: "Cobros con Stripe, tickets digitales con QR, asignación numerada opcional.",
    },
    {
        icon: ShieldCheck,
        title: "Control de acceso",
        desc: "Validación del QR en puerta, reportes por evento, evita reventa con tickets únicos.",
    },
    {
        icon: BarChart3,
        title: "Reportes",
        desc: "Ventas en tiempo real, fuentes de tráfico, métricas por tipo de ticket.",
    },
];

export default function Landing() {
    const [plans, setPlans] = useState([]);
    const [loadingPlans, setLoadingPlans] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/plans");
                setPlans(data || []);
            } catch {
                setPlans([]);
            } finally {
                setLoadingPlans(false);
            }
        })();
    }, []);

    return (
        <div data-testid="landing-page" className="bg-background">
            {/* Hero */}
            <section className="relative overflow-hidden">
                <div className="absolute inset-0 tys-grid-bg opacity-40 pointer-events-none" />
                <div className="relative mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-[1.3fr_1fr] gap-12 items-center">
                    <div className="space-y-7">
                        <Badge
                            data-testid="hero-badge"
                            variant="secondary"
                            className="text-primary border border-primary/15"
                        >
                            <Sparkles className="h-3 w-3 mr-1" />
                            Versión 1.0 · disponible en Ecuador
                        </Badge>
                        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
                            La plataforma de ticketing
                            <span className="block text-primary">
                                más simple para tus eventos.
                            </span>
                        </h1>
                        <p className="text-base sm:text-lg text-muted-foreground max-w-xl">
                            Ticket Yourself te da microsite propio, cobros con Stripe,
                            tickets con QR y reportes — listo en minutos. Sin código.
                        </p>
                        <div className="flex flex-wrap gap-3 pt-2">
                            <Button
                                asChild
                                size="lg"
                                data-testid="cta-register"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                <Link to="/registro">
                                    Soy organizador, quiero empezar
                                    <ArrowRight className="h-4 w-4 ml-2" />
                                </Link>
                            </Button>
                            <Button asChild size="lg" variant="outline" data-testid="cta-login">
                                <Link to="/login">Ya tengo cuenta</Link>
                            </Button>
                        </div>
                    </div>
                    <div className="hidden lg:flex justify-end">
                        <div className="relative w-full max-w-sm aspect-square">
                            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />
                            <div className="absolute top-6 left-6 right-6 bottom-6 bg-card rounded-2xl border border-border/70 tys-soft-shadow p-6 flex flex-col justify-between">
                                <div>
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                        Festival 2026
                                    </div>
                                    <div className="text-xl font-semibold mt-1">
                                        Quito · Mayo
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="h-12 w-12 rounded-lg bg-secondary grid place-items-center text-primary">
                                        <Ticket className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">
                                            Ticket VIP
                                        </div>
                                        <div className="font-medium">$45.00</div>
                                    </div>
                                </div>
                                <div className="h-10 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-medium">
                                    Comprar ahora
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="mx-auto max-w-6xl px-5 sm:px-8 py-16 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
                {FEATURES.map((f) => (
                    <Card key={f.title} className="border-border/70 tys-soft-shadow">
                        <CardContent className="pt-6 space-y-3">
                            <div className="h-10 w-10 rounded-lg bg-secondary text-primary grid place-items-center">
                                <f.icon className="h-5 w-5" />
                            </div>
                            <h3 className="font-semibold text-base">{f.title}</h3>
                            <p className="text-sm text-muted-foreground">{f.desc}</p>
                        </CardContent>
                    </Card>
                ))}
            </section>

            {/* Plans */}
            <section className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
                <div className="text-center space-y-3 mb-10">
                    <Badge variant="secondary" className="text-primary">
                        Planes
                    </Badge>
                    <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                        Elegí el plan que se adapta a vos
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Cambialo cuando quieras. Sin compromisos largos.
                    </p>
                </div>

                <div data-testid="plans-grid" className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {loadingPlans
                        ? Array.from({ length: 4 }).map((_, i) => (
                              <Card key={i} className="border-border/70 animate-pulse">
                                  <CardContent className="pt-6 h-60" />
                              </Card>
                          ))
                        : plans.map((p) => (
                              <Card
                                  key={p.id}
                                  data-testid={`plan-card-${p.code}`}
                                  className={`border-border/70 ${
                                      p.code === "profesional"
                                          ? "ring-2 ring-primary/40"
                                          : ""
                                  }`}
                              >
                                  <CardContent className="pt-6 space-y-4">
                                      <div className="flex items-center justify-between">
                                          <h3 className="font-semibold text-lg">{p.name}</h3>
                                          {p.code === "profesional" && (
                                              <Badge className="bg-primary text-primary-foreground">
                                                  Recomendado
                                              </Badge>
                                          )}
                                      </div>
                                      <div className="flex items-baseline gap-1">
                                          <span className="text-3xl font-semibold">
                                              ${(p.price_cents / 100).toFixed(0)}
                                          </span>
                                          <span className="text-sm text-muted-foreground">
                                              {p.billing_period === "monthly"
                                                  ? "/mes"
                                                  : " único"}
                                          </span>
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                          {p.description}
                                      </p>
                                      <ul className="space-y-1.5 text-sm">
                                          {p.features.slice(0, 4).map((f) => (
                                              <li
                                                  key={f}
                                                  className="flex gap-2 text-foreground/80"
                                              >
                                                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                                  {f}
                                              </li>
                                          ))}
                                      </ul>
                                      <Button
                                          asChild
                                          variant={
                                              p.code === "profesional"
                                                  ? "default"
                                                  : "outline"
                                          }
                                          className="w-full"
                                          data-testid={`plan-cta-${p.code}`}
                                      >
                                          <Link to="/registro">Elegir plan</Link>
                                      </Button>
                                  </CardContent>
                              </Card>
                          ))}
                </div>
            </section>

            {/* CTA */}
            <section className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
                <div className="rounded-3xl border border-border/70 bg-card tys-soft-shadow p-10 sm:p-14 text-center space-y-5">
                    <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                        Tu próximo evento te está esperando.
                    </h2>
                    <p className="text-muted-foreground max-w-xl mx-auto">
                        Registrate, subí tus documentos, elegí un plan y empezá a vender en minutos.
                    </p>
                    <Button
                        asChild
                        size="lg"
                        data-testid="cta-bottom"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        <Link to="/registro">
                            Soy organizador, quiero empezar
                            <ArrowRight className="h-4 w-4 ml-2" />
                        </Link>
                    </Button>
                </div>
            </section>
        </div>
    );
}
