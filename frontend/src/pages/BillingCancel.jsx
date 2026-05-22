import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";

export default function BillingCancel() {
    return (
        <div data-testid="billing-cancel-page" className="max-w-xl space-y-6">
            <Badge variant="secondary" className="text-primary">
                Pago cancelado
            </Badge>
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-2xl flex items-center gap-2">
                        <XCircle className="h-6 w-6 text-amber-600" />
                        Cancelaste el pago
                    </CardTitle>
                    <CardDescription>
                        No se cobró nada. Cuando quieras retomar, elegí un plan de nuevo.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <Button
                        asChild
                        data-testid="cancel-retry-btn"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        <Link to="/onboarding">Volver a elegir plan</Link>
                    </Button>
                    <Button asChild variant="outline" data-testid="cancel-go-dashboard">
                        <Link to="/dashboard">Ir al dashboard</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
