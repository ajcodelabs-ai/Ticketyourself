import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount } from "@tiptap/extensions";
import { Bold, Italic, List, ListOrdered, Undo, Redo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// TI-88: shared by every FAQ answer field (event content, microsite block)
// so both surfaces enforce the same limit — 500 matches the cap already
// used for other description-style fields (backend/models.py).
export const FAQ_ANSWER_MAX_LENGTH = 500;

/**
 * Lightweight TipTap rich text editor (policies, FAQ answers, etc.).
 * `maxLength` (plain-text characters, not HTML markup) is opt-in per call
 * site — e.g. FAQ answers (TI-88), not the longer-form policies editor.
 */
export default function RichTextEditor({
    value = "",
    onChange,
    placeholder = "Escribe aquí…",
    disabled = false,
    className = undefined,
    testid,
    maxLength = undefined,
}) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            // autoTrim (default true) silently deletes from the start of any
            // content that's already over the limit the first time the
            // editor mounts/receives focus — e.g. a FAQ answer written
            // before this limit existed. Disabled so an over-limit answer
            // is just flagged (red counter) instead of corrupted on open.
            ...(maxLength
                ? [CharacterCount.configure({ limit: maxLength, autoTrim: false })]
                : []),
        ],
        content: value || "",
        editable: !disabled,
        onUpdate: ({ editor: ed }) => {
            onChange?.(ed.getHTML());
        },
        editorProps: {
            attributes: {
                class: "prose prose-sm max-w-none min-h-[120px] px-3 py-2 focus:outline-none",
                "data-placeholder": placeholder,
            },
        },
    });

    useEffect(() => {
        // isDestroyed guard: React.StrictMode (see index.tsx) mounts every
        // component twice in dev — useEditor()'s first instance is torn down
        // before this effect's real run, and calling .getHTML() on a
        // destroyed editor throws (its ProseMirror schema is already gone).
        if (!editor || editor.isDestroyed) return;
        const current = editor.getHTML();
        const next = value || "";
        if (next !== current && next !== "<p></p>") {
            editor.commands.setContent(next, { emitUpdate: false });
        }
    }, [editor, value]);

    useEffect(() => {
        if (editor && !editor.isDestroyed) editor.setEditable(!disabled);
    }, [editor, disabled]);

    if (!editor || editor.isDestroyed) return null;

    const ToolBtn = ({ onClick, active = false, children, title }) => (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", active && "bg-muted")}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            {children}
        </Button>
    );

    return (
        <div
            className={cn("rounded-lg border bg-background", className)}
            data-testid={testid}
        >
            <div className="flex flex-wrap gap-0.5 border-b p-1">
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    active={editor.isActive("bold")}
                    title="Negrita"
                >
                    <Bold className="h-4 w-4" />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    active={editor.isActive("italic")}
                    title="Cursiva"
                >
                    <Italic className="h-4 w-4" />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    active={editor.isActive("bulletList")}
                    title="Lista"
                >
                    <List className="h-4 w-4" />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    active={editor.isActive("orderedList")}
                    title="Lista numerada"
                >
                    <ListOrdered className="h-4 w-4" />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().undo().run()}
                    title="Deshacer"
                >
                    <Undo className="h-4 w-4" />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().redo().run()}
                    title="Rehacer"
                >
                    <Redo className="h-4 w-4" />
                </ToolBtn>
            </div>
            <EditorContent editor={editor} />
            {maxLength ? (() => {
                const chars = editor.storage.characterCount.characters();
                return (
                    <div
                        className={cn(
                            "px-3 py-1 text-right text-xs border-t",
                            chars > maxLength ? "text-destructive" : "text-muted-foreground",
                        )}
                        data-testid={testid ? `${testid}-char-count` : undefined}
                    >
                        {chars} / {maxLength}
                    </div>
                );
            })() : null}
        </div>
    );
}
