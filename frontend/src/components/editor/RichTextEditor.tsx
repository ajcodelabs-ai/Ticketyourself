import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Undo, Redo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Lightweight TipTap rich text editor (policies, FAQ answers, etc.).
 */
export default function RichTextEditor({
    value = "",
    onChange,
    placeholder = "Escribí aquí…",
    disabled = false,
    className = undefined,
    testid,
}) {
    const editor = useEditor({
        extensions: [StarterKit],
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
        if (!editor) return;
        const current = editor.getHTML();
        const next = value || "";
        if (next !== current && next !== "<p></p>") {
            editor.commands.setContent(next, { emitUpdate: false });
        }
    }, [editor, value]);

    useEffect(() => {
        if (editor) editor.setEditable(!disabled);
    }, [editor, disabled]);

    if (!editor) return null;

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
        </div>
    );
}
