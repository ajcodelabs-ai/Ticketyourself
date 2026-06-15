import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { ImageIcon, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

const DEFAULT_ACCEPT = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "image/heic": [".heic"],
    "image/heif": [".heif"],
};

/**
 * Drag-and-drop image upload zone (react-dropzone).
 */
export default function ImageDropzone({
    label,
    currentUrl,
    onUpload,
    testid,
    aspect = "square",
    compact = false,
    multiple = false,
    uploading = false,
    accept = DEFAULT_ACCEPT,
}) {
    const ratio = aspect === "video" ? "aspect-video" : "aspect-square";

    const onDrop = useCallback(
        (accepted: File[]) => {
            if (!accepted.length || uploading) return;
            const dt = new DataTransfer();
            accepted.forEach((f) => dt.items.add(f));
            onUpload(dt.files);
        },
        [onUpload, uploading],
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept,
        multiple,
        disabled: uploading,
        noClick: uploading,
        noKeyboard: uploading,
    });

    return (
        <div className="space-y-1.5">
            {label && <Label>{label}</Label>}
            <div
                {...getRootProps()}
                className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer transition ${ratio} ${
                    compact ? "min-h-0" : ""
                } ${
                    uploading
                        ? "border-primary bg-primary/5 cursor-wait"
                        : isDragActive
                          ? "border-primary bg-primary/10"
                          : "hover:border-primary hover:bg-primary/5"
                }`}
                data-testid={testid}
                aria-busy={uploading}
            >
                <input {...getInputProps()} data-testid={`${testid}-input`} />
                {currentUrl ? (
                    <img
                        src={currentUrl}
                        alt={label || "preview"}
                        className="max-h-full max-w-full rounded object-contain pointer-events-none"
                    />
                ) : (
                    <>
                        <ImageIcon className="h-7 w-7 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground text-center px-2">
                            {isDragActive
                                ? "Soltá la imagen aquí"
                                : multiple
                                  ? "Arrastrá o click (varias)"
                                  : "Arrastrá o click"}
                        </span>
                    </>
                )}
                {uploading && (
                    <div
                        className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px] rounded-xl"
                        data-testid={`${testid}-spinner`}
                    >
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                )}
            </div>
        </div>
    );
}
