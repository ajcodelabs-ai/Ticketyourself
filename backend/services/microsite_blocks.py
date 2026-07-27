"""
Block layout helpers for the microsite page builder.
Blocks are stored as an ordered JSON array; legacy microsites without blocks
are inferred from template + sections_enabled at read time.
"""

import re
import uuid
from typing import Any

import nh3

_ALLOWED_TAGS = {
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "a",
    "blockquote",
}
_ALLOWED_ATTRIBUTES = {"a": {"href", "target"}}


def sanitize_html(html: str | None) -> str:
    """Server-side defense in depth: strips scripts/handlers/unsafe URLs
    regardless of what the client's sanitizer already did."""
    if not html:
        return ""
    return nh3.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        link_rel="noopener noreferrer",
    )


_SAFE_HREF_RE = re.compile(r"^(#|https?://|mailto:|tel:)", re.IGNORECASE)


def safe_href(href: str | None) -> str | None:
    if not href:
        return None
    href = href.strip()
    return href if _SAFE_HREF_RE.match(href) else None


BLOCK_TYPES = (
    "hero",
    "about",
    "events",
    "contact",
    "social",
    "spacer",
    "image",
    "gallery",
    "faq",
    "testimonials",
)

# Preset block layouts keyed by legacy template code
TEMPLATE_BLOCK_PRESETS: dict[str, list[dict[str, Any]]] = {
    "estandar": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "normal", "align": "left"},
        },
        {"type": "about", "enabled": True, "props": {"align": "left"}},
        {"type": "events", "enabled": True, "props": {"layout": "grid"}},
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "galeria": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "huge", "align": "center"},
        },
        {"type": "events", "enabled": True, "props": {"layout": "galeria"}},
        {"type": "about", "enabled": True, "props": {"align": "center"}},
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "evento_unico": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "huge", "align": "center"},
        },
        {"type": "events", "enabled": True, "props": {"layout": "featured"}},
        {"type": "about", "enabled": True, "props": {"align": "left"}},
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "minimal": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "normal", "align": "center"},
        },
        {"type": "events", "enabled": True, "props": {"layout": "grid"}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "showcase": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "huge", "align": "center"},
        },
        {
            "type": "gallery",
            "enabled": True,
            "props": {"columns": 3, "layout": "grid", "images": []},
        },
        {"type": "events", "enabled": True, "props": {"layout": "galeria"}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "cronologico": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "normal", "align": "left"},
        },
        {"type": "events", "enabled": True, "props": {"layout": "list"}},
        {"type": "about", "enabled": True, "props": {"align": "left"}},
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "landing": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "huge", "align": "center"},
        },
        {"type": "about", "enabled": True, "props": {"align": "center"}},
        {"type": "events", "enabled": True, "props": {"layout": "grid"}},
        {
            "type": "testimonials",
            "enabled": True,
            "props": {"title": "Lo que dicen nuestros asistentes", "items": []},
        },
        {
            "type": "faq",
            "enabled": True,
            "props": {"title": "Preguntas frecuentes", "items": []},
        },
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
    "portfolio": [
        {
            "type": "hero",
            "enabled": True,
            "props": {"variant": "normal", "align": "center"},
        },
        {
            "type": "gallery",
            "enabled": True,
            "props": {"columns": 2, "layout": "masonry", "images": []},
        },
        {"type": "about", "enabled": True, "props": {"align": "center"}},
        {
            "type": "image",
            "enabled": True,
            "props": {"layout": "full", "caption": "", "image_url": None},
        },
        {"type": "contact", "enabled": True, "props": {}},
        {"type": "social", "enabled": True, "props": {}},
    ],
}

DEFAULT_BLOCK_PROPS: dict[str, dict[str, Any]] = {
    "hero": {"variant": "normal", "align": "left", "layers": []},
    "about": {"align": "left"},
    "events": {"layout": "grid"},
    "contact": {},
    "social": {},
    "spacer": {"height": "md"},
    "image": {"image_url": None, "caption": "", "layout": "contained"},
    "gallery": {"images": [], "columns": 3, "layout": "grid"},
    "faq": {
        "title": "Preguntas frecuentes",
        "items": [],
    },
    "testimonials": {
        "title": "Testimonios",
        "items": [],
    },
}


def new_block_id() -> str:
    return str(uuid.uuid4())


def _safe_hex_color(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    if (
        len(v) == 7
        and v.startswith("#")
        and all(c in "0123456789abcdefABCDEF" for c in v[1:])
    ):
        return v.lower()
    return None


def make_block(
    block_type: str, *, enabled: bool = True, props: dict | None = None
) -> dict:
    if block_type not in BLOCK_TYPES:
        raise ValueError(f"Invalid block type: {block_type}")
    merged_props = dict(DEFAULT_BLOCK_PROPS.get(block_type, {}))
    if props:
        merged_props.update(props)
    return {
        "id": new_block_id(),
        "type": block_type,
        "enabled": enabled,
        "props": merged_props,
    }


def blocks_for_template(
    template: str,
    sections_enabled: dict | None = None,
) -> list[dict]:
    """Build block list from a legacy template preset, honouring section toggles."""
    preset = TEMPLATE_BLOCK_PRESETS.get(template) or TEMPLATE_BLOCK_PRESETS["estandar"]
    sections = sections_enabled or {}
    out: list[dict] = []
    for spec in preset:
        block_type = spec["type"]
        section_key = block_type if block_type != "social" else "social"
        # Only legacy section keys gate hero/about/events/contact/social
        if section_key in sections:
            enabled = sections.get(section_key, spec.get("enabled", True))
        else:
            enabled = spec.get("enabled", True)
        out.append(
            make_block(
                block_type,
                enabled=bool(enabled),
                props=dict(spec.get("props") or {}),
            )
        )
    return out


def default_blocks() -> list[dict]:
    return blocks_for_template("estandar")


def resolve_blocks(
    *,
    blocks: list | None,
    template: str | None,
    sections_enabled: dict | None,
) -> list[dict]:
    """Return stored blocks or infer from legacy template fields."""
    if blocks:
        return blocks
    return blocks_for_template(template or "estandar", sections_enabled)


def sections_from_blocks(blocks: list[dict]) -> dict[str, bool]:
    """Sync legacy sections_enabled from the block list."""
    mapping = {
        "hero": "hero",
        "about": "about",
        "events": "events",
        "contact": "contact",
        "social": "social",
    }
    out = {k: False for k in mapping.values()}
    for block in blocks:
        key = mapping.get(block.get("type", ""))
        if key and block.get("enabled", True):
            out[key] = True
    return out


def _validate_block_props(block_type: str, props: dict) -> dict:
    """Normalize props per block type."""
    defaults = DEFAULT_BLOCK_PROPS.get(block_type, {})
    merged = {**defaults, **props}
    if block_type == "gallery":
        images = merged.get("images")
        if not isinstance(images, list):
            merged["images"] = []
        else:
            merged["images"] = [
                img for img in images[:12] if isinstance(img, dict) and img.get("url")
            ]
        cols = merged.get("columns")
        if not isinstance(cols, int) or cols < 1 or cols > 4:
            merged["columns"] = 3
    if block_type == "faq":
        items = merged.get("items")
        if not isinstance(items, list):
            merged["items"] = []
        else:
            cleaned_items = []
            for item in items[:20]:
                if not isinstance(item, dict):
                    continue
                cleaned_items.append(
                    {
                        "id": str(item.get("id") or new_block_id()),
                        "question": str(item.get("question") or "")[:200],
                        "answer_html": sanitize_html(
                            str(item.get("answer_html") or "")[:2000]
                        ),
                    }
                )
            merged["items"] = cleaned_items
    if block_type == "testimonials":
        items = merged.get("items")
        if not isinstance(items, list):
            merged["items"] = []
        else:
            cleaned_items = []
            for item in items[:20]:
                if not isinstance(item, dict):
                    continue
                cleaned_items.append(
                    {
                        "id": str(item.get("id") or new_block_id()),
                        "name": str(item.get("name") or "")[:80],
                        "role": str(item.get("role") or "")[:80],
                        "quote": str(item.get("quote") or "")[:500],
                        "avatar_url": str(item.get("avatar_url") or "")[:500] or None,
                    }
                )
            merged["items"] = cleaned_items
    if block_type == "image":
        caption = merged.get("caption")
        if isinstance(caption, str) and len(caption) > 200:
            merged["caption"] = caption[:200]
    if block_type == "hero":
        layers = merged.get("layers")
        if not isinstance(layers, list):
            merged["layers"] = []
        else:
            cleaned_layers = []
            for layer in layers[:15]:
                if not isinstance(layer, dict):
                    continue
                role = layer.get("role")
                cleaned = {
                    "id": str(layer.get("id") or new_block_id()),
                    "type": (
                        layer.get("type")
                        if layer.get("type")
                        in ("heading", "text", "badge", "button", "image")
                        else "text"
                    ),
                    "content": str(layer.get("content") or "")[:120],
                    "colStart": max(1, min(12, int(layer.get("colStart") or 1))),
                    "colSpan": max(1, min(12, int(layer.get("colSpan") or 6))),
                    "row": max(1, min(6, int(layer.get("row") or 1))),
                    "align": (
                        layer.get("align")
                        if layer.get("align") in ("left", "center", "right")
                        else "left"
                    ),
                    "color": _safe_hex_color(layer.get("color")),
                    "fontSize": (
                        layer.get("fontSize")
                        if layer.get("fontSize")
                        in ("sm", "base", "lg", "xl", "2xl", "3xl")
                        else None
                    ),
                    "fontWeight": (
                        layer.get("fontWeight")
                        if layer.get("fontWeight")
                        in ("normal", "medium", "semibold", "bold")
                        else None
                    ),
                    "href": safe_href(str(layer.get("href") or "")[:500]),
                    "imageUrl": str(layer.get("imageUrl") or "")[:500] or None,
                }
                if role in ("title", "subtitle", "cta"):
                    cleaned["role"] = role
                cleaned_layers.append(cleaned)
            merged["layers"] = cleaned_layers
    return merged


def validate_blocks(raw: list) -> list[dict]:
    if not isinstance(raw, list):
        raise ValueError("blocks must be an array")
    if len(raw) > 30:
        raise ValueError("Maximum 30 blocks allowed")
    seen_ids: set[str] = set()
    cleaned: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Each block must be an object")
        block_type = item.get("type")
        if block_type not in BLOCK_TYPES:
            raise ValueError(f"Invalid block type: {block_type}")
        block_id = item.get("id") or new_block_id()
        if block_id in seen_ids:
            raise ValueError(f"Duplicate block id: {block_id}")
        seen_ids.add(block_id)
        props = item.get("props") if isinstance(item.get("props"), dict) else {}
        merged = _validate_block_props(block_type, props)
        cleaned.append(
            {
                "id": block_id,
                "type": block_type,
                "enabled": bool(item.get("enabled", True)),
                "props": merged,
            }
        )
    return cleaned
