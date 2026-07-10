"""SEO defaults and custom CSS validation for microsites."""
import re

DEFAULT_SEO = {
    "meta_title": "",
    "meta_description": "",
    "og_image_url": None,
}

MAX_META_TITLE = 70
MAX_META_DESCRIPTION = 160
MAX_CUSTOM_CSS = 8000

_UNSAFE_CSS = re.compile(
    r"(<script|javascript:|expression\s*\(|@import|behavior\s*:)",
    re.IGNORECASE,
)


def default_seo(*, company_name: str = "") -> dict:
    return {
        "meta_title": company_name[:MAX_META_TITLE] if company_name else "",
        "meta_description": "",
        "og_image_url": None,
    }


def validate_seo(raw: dict | None) -> dict:
    out = dict(DEFAULT_SEO)
    if not raw:
        return out
    title = raw.get("meta_title")
    if isinstance(title, str):
        out["meta_title"] = title.strip()[:MAX_META_TITLE]
    desc = raw.get("meta_description")
    if isinstance(desc, str):
        out["meta_description"] = desc.strip()[:MAX_META_DESCRIPTION]
    og = raw.get("og_image_url")
    if og is None or (isinstance(og, str) and og.strip()):
        out["og_image_url"] = og if og else None
    return out


def validate_custom_css(css: str | None) -> str:
    if not css:
        return ""
    css = css.strip()
    if len(css) > MAX_CUSTOM_CSS:
        raise ValueError(f"custom_css exceeds {MAX_CUSTOM_CSS} characters")
    if _UNSAFE_CSS.search(css):
        raise ValueError("custom_css contains disallowed patterns")
    return css
