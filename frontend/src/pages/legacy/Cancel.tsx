import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { XCircle } from "lucide-react";

export default function Cancel() {
    return (
        <div data-testid="cancel-page" className="space-y-6 max-w-xl">
            <Badge variant="secondary" className="text-primary">
                Pago cancelado
            </Badge>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Cancelaste el pago
            </h1>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <XCircle className="h-5 w-5 text-amber-600" />
                        No te cobramos
                    </CardTitle>
                    <CardDescription>
                        Podés volver a intentar cuando quieras. El registro en
                        la DB queda como <b>pending</b> y nunca se marca como
                        pagado.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 pt-0">
                    <Button
                        asChild
                        data-testid="cancel-retry-subscription"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        <Link to="/poc/subscribe">Reintentar suscripción</Link>
                    </Button>
                    <Button
                        asChild
                        variant="outline"
                        data-testid="cancel-retry-ticket"
                    >
                        <Link to="/poc/ticket">Reintentar ticket</Link>
                    </Button>
                    <Button
                        asChild
                        variant="ghost"
                        data-testid="cancel-go-home"
                    >
                        <Link to="/">Volver al inicio</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
