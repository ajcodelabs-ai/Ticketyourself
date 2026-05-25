/**
 * PublishPendingDialog — explanatory dialog shown when a pending organizer
 * tries to publish an event, venue or microsite. It explains why publishing
 * is blocked and what to do next. Closed via a single "Entendido" CTA.
 *
 * Lives next to its caller, controlled with an `open` state. The text is
 * tailored per resource via the `resource` prop ("evento" | "venue" | "microsite").
 */
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const RESOURCE_LABELS = {
    evento: "este evento",
    venue: "este venue",
    microsite: "tu microsite",
};

export default function PublishPendingDialog({ open, onOpenChange, resource = "evento" }) {
    const label = RESOURCE_LABELS[resource] ?? "esto";
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent data-testid="publish-pending-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>Tu cuenta está en revisión</AlertDialogTitle>
                    <AlertDialogDescription>
                        Una vez aprobada vas a poder publicar {label}. Podés
                        seguir editándolo libremente mientras tanto y, en cuanto
                        habilitemos tu cuenta, lo publicás con un solo click.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction
                        onClick={() => onOpenChange?.(false)}
                        data-testid="publish-pending-ok"
                    >
                        Entendido
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
