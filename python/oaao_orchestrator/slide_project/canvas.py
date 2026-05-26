"""Fixed slide canvas (1280×720) — all generated slide.html files share one coordinate system."""

from __future__ import annotations

import os
import re


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def slide_canvas_width() -> int:
    return max(640, min(_env_int("OAAO_SLIDE_CANVAS_W", 1280), 3840))


def slide_canvas_height() -> int:
    return max(360, min(_env_int("OAAO_SLIDE_CANVAS_H", 720), 2160))


def slide_canvas_aspect_label() -> str:
    w, h = slide_canvas_width(), slide_canvas_height()
    return f"{w}×{h}"


def slide_canvas_css_block() -> str:
    w, h = slide_canvas_width(), slide_canvas_height()
    return f"""<style id="oaao-slide-canvas-lock">
html, body {{
  margin: 0 !important;
  padding: 0 !important;
  width: {w}px !important;
  height: {h}px !important;
  min-width: {w}px !important;
  min-height: {h}px !important;
  max-width: {w}px !important;
  max-height: {h}px !important;
  overflow: hidden !important;
  box-sizing: border-box;
}}
.oaao-slide-canvas {{
  width: {w}px;
  height: {h}px;
  overflow: hidden;
  box-sizing: border-box;
  position: relative;
}}
</style>"""


def slide_canvas_viewport_meta() -> str:
    w, h = slide_canvas_width(), slide_canvas_height()
    return f'<meta name="viewport" content="width={w}, height={h}">'


def _strip_code_fences(text: str) -> str:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)
    return raw.replace("```", "")


def _wrap_fragment_as_document(fragment: str) -> str:
    """Wrap LLM fragments (no <html>) in a full slide document shell."""
    inner = fragment.strip()
    lower = inner.lower()
    if "<body" in lower:
        return (
            f'<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n'
            f'<meta charset="utf-8"/>\n{slide_canvas_viewport_meta()}\n'
            f"{slide_canvas_css_block()}\n</head>\n{inner}\n</html>"
        )
    return (
        f'<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n'
        f'<meta charset="utf-8"/>\n{slide_canvas_viewport_meta()}\n'
        f"{slide_canvas_css_block()}\n</head>\n<body>\n"
        f'<div class="oaao-slide-canvas">{inner}</div>\n</body>\n</html>'
    )


def normalize_slide_html(html: str) -> str:
    """Force LLM / legacy output onto the fixed slide canvas (prevents preview misalignment)."""
    raw = _strip_code_fences((html or "").strip())
    if len(raw) < 20:
        return raw

    if "<html" not in raw.lower():
        raw = _wrap_fragment_as_document(raw)

    w, h = slide_canvas_width(), slide_canvas_height()  # noqa: F841
    raw = re.sub(
        r"min-height\s*:\s*100vh",
        f"min-height:{h}px",
        raw,
        flags=re.IGNORECASE,
    )
    raw = re.sub(
        r"<meta[^>]*name=[\"']viewport[\"'][^>]*>",
        slide_canvas_viewport_meta(),
        raw,
        count=1,
        flags=re.IGNORECASE,
    )
    if "viewport" not in raw.lower():
        if re.search(r"<head\b", raw, re.IGNORECASE):
            raw = re.sub(
                r"(<head[^>]*>)",
                r"\1\n" + slide_canvas_viewport_meta(),
                raw,
                count=1,
                flags=re.IGNORECASE,
            )
        else:
            raw = f"<head>{slide_canvas_viewport_meta()}{slide_canvas_css_block()}</head>\n" + raw

    block = slide_canvas_css_block()
    if "oaao-slide-canvas-lock" not in raw:
        if re.search(r"</head>", raw, re.IGNORECASE):
            raw = re.sub(r"</head>", block + "\n</head>", raw, count=1, flags=re.IGNORECASE)
        else:
            raw = block + "\n" + raw

    if "oaao-slide-canvas" not in raw and re.search(r"<body\b", raw, re.IGNORECASE):
        raw = re.sub(
            r"<body([^>]*)>",
            r"<body\1><div class=\"oaao-slide-canvas\">",
            raw,
            count=1,
            flags=re.IGNORECASE,
        )
        raw = re.sub(r"</body>", "</div></body>", raw, count=1, flags=re.IGNORECASE)

    return raw


def build_fallback_slide_document(*, title: str, subtitle: str, theme: str, body_inner: str) -> str:
    """Stub / offline slide — same fixed canvas as LLM output."""
    is_dark = theme == "executive_problem"
    bg = "#0f172a" if is_dark else "#f8fafc"
    fg = "#e2e8f0" if is_dark else "#0f172a"
    accent = "#38bdf8" if is_dark else "#2563eb"
    safe_title = title.replace("<", "&lt;").replace(">", "&gt;")
    safe_sub = subtitle.replace("<", "&lt;").replace(">", "&gt;")
    w, h = slide_canvas_width(), slide_canvas_height()  # noqa: F841
    doc = f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
{slide_canvas_viewport_meta()}
<title>{safe_title}</title>
{slide_canvas_css_block()}
<style>
  .oaao-slide-canvas {{
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2.5rem 3rem;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: {bg};
    color: {fg};
  }}
  h1 {{ margin: 0 0 0.5rem; font-size: 2rem; line-height: 1.2; color: {accent}; }}
  p.lead {{ margin: 0 0 1rem; opacity: 0.88; font-size: 1.125rem; max-width: {int(w * 0.75)}px; }}
  ul {{ margin: 0; padding-left: 1.35rem; line-height: 1.55; font-size: 1.05rem; }}
  .layers {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.85rem; margin-top: 1.25rem; }}
  .layer {{ padding: 1rem; border-radius: 0.5rem; background: rgba(255,255,255,0.08); text-align: center; font-size: 1rem; }}
</style>
</head>
<body>
<div class="oaao-slide-canvas">
<h1>{safe_title}</h1>
<p class="lead">{safe_sub}</p>
{body_inner}
</div>
</body>
</html>
"""
    return normalize_slide_html(doc)
