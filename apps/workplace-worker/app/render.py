"""PDF 페이지·이미지를 모델에 보낼 이미지로 만든다(WP-250).

긴 변을 max_edge 로 맞춰 픽셀 수를 묶는다 — 거대한 도면 페이지도 메모리가 폭주하지 않는다.
결과는 PNG(투명도·도면) 또는 JPEG(사진)이며, PNG 가 PNG_MAX_BYTES(1MB) 를 넘으면 JPEG 로 다시 인코딩한다.
"""
import io
from dataclasses import dataclass

import fitz
from PIL import Image, ImageOps

# 이전 이미지가 매 턴 다시 실리므로 작게 — 넘으면 JPEG 로 줄인다(요청 크기 상한 대비).
PNG_MAX_BYTES = 1_000_000
JPEG_QUALITY = 85
# 작은 페이지를 지나치게 키우지 않는다(흐릿한 확대 방지).
MAX_ZOOM = 4.0


@dataclass
class Rendered:
    data: bytes
    mime: str
    page_count: int | None = None


class RenderError(Exception):
    """HTTP 상태와 detail 을 실어 라우트가 그대로 응답하게 한다."""

    def __init__(self, status: int, detail: dict):
        super().__init__(detail.get("code"))
        self.status = status
        self.detail = detail


def render_pdf_page(data: bytes, page: int, max_edge: int) -> Rendered:
    """PDF 의 page(1부터) 를 긴 변 max_edge 로 그린다."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # noqa: BLE001 — 깨진 PDF
        raise RenderError(422, {"code": "UNREADABLE"}) from e
    with doc:
        if doc.needs_pass:
            raise RenderError(422, {"code": "UNREADABLE"})
        count = len(doc)
        if page < 1 or page > count:
            raise RenderError(400, {"code": "PAGE_OUT_OF_RANGE", "pageCount": count})
        p = doc[page - 1]
        zoom = min(max_edge / max(p.rect.width, p.rect.height), MAX_ZOOM)
        pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png = pix.tobytes("png")
        if len(png) <= PNG_MAX_BYTES:
            return Rendered(png, "image/png", count)
        return Rendered(pix.tobytes("jpeg", jpg_quality=JPEG_QUALITY), "image/jpeg", count)


def _open_image(data: bytes) -> Image.Image:
    # HEIC/HEIF 를 Pillow 가 열 수 있게 등록(멱등).
    import pillow_heif
    pillow_heif.register_heif_opener()
    try:
        img = Image.open(io.BytesIO(data))
        img.seek(0)  # 애니메이션은 첫 프레임
        img.load()
    except Exception as e:  # noqa: BLE001
        raise RenderError(422, {"code": "UNREADABLE"}) from e
    return img


def render_image(data: bytes, mime: str, max_edge: int) -> Rendered:
    """이미지를 회전 반영·축소해 PNG(투명도 있음) 또는 JPEG 로 만든다."""
    if not mime.startswith("image/"):
        raise RenderError(415, {"code": "UNSUPPORTED"})
    img = ImageOps.exif_transpose(_open_image(data))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")
    img.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    if has_alpha:
        img.save(buf, "PNG", optimize=True)
        if buf.tell() <= PNG_MAX_BYTES:
            return Rendered(buf.getvalue(), "image/png")
        img = img.convert("RGB")
        buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY)
    return Rendered(buf.getvalue(), "image/jpeg")
