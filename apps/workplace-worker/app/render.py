"""PDF 페이지·이미지를 모델에 보낼 이미지로 만든다(WP-250).

긴 변을 max_edge 로 맞춰 픽셀 수를 묶는다 — 거대한 도면 페이지도 메모리가 폭주하지 않는다.
결과는 PNG(투명도·도면) 또는 JPEG(사진)이며, PNG 가 PNG_MAX_BYTES(1MB) 를 넘으면 JPEG 로 다시 인코딩한다.
"""
import io
from dataclasses import dataclass

import fitz
import pillow_heif
from PIL import Image, ImageOps

# 이전 이미지가 매 턴 다시 실리므로 작게 — 넘으면 JPEG 로 줄인다(요청 크기 상한 대비).
PNG_MAX_BYTES = 1_000_000
JPEG_QUALITY = 85
# 작은 페이지를 지나치게 키우지 않는다(흐릿한 확대 방지).
MAX_ZOOM = 4.0
# 디컴프레션 폭탄 방어 — 작은 파일이 거대한 픽셀로 풀려 메모리를 먹는 것을 막는다(초과 시 UNREADABLE).
MAX_IMAGE_PIXELS = 100_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
# HEIC/HEIF 를 Pillow 가 열 수 있게 모듈 로드 시 한 번만 등록한다.
pillow_heif.register_heif_opener()


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
    """PDF 의 page(1부터) 를 긴 변 max_edge 로 그린다. 깨진 페이지는 UNREADABLE(422)."""
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
        try:
            p = doc[page - 1]
            zoom = min(max_edge / max(p.rect.width, p.rect.height), MAX_ZOOM)
            pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            png = pix.tobytes("png")
            if len(png) <= PNG_MAX_BYTES:
                return Rendered(png, "image/png", count)
            return Rendered(pix.tobytes("jpeg", jpg_quality=JPEG_QUALITY), "image/jpeg", count)
        except Exception as e:  # noqa: BLE001 — 렌더 중 손상된 페이지(500 방지)
            raise RenderError(422, {"code": "UNREADABLE"}) from e


def _open_image(data: bytes) -> Image.Image:
    """바이트를 열어 첫 프레임까지 로드한다. 깨진 파일·폭탄 이미지는 UNREADABLE(422)."""
    try:
        img = Image.open(io.BytesIO(data))
        # load 전에 픽셀 수를 직접 확인 — Pillow 는 한도 1~2배 구간에선 경고만 낸다.
        if img.width * img.height > MAX_IMAGE_PIXELS:
            raise RenderError(422, {"code": "UNREADABLE"})
        img.seek(0)  # 애니메이션은 첫 프레임
        img.load()
    except RenderError:
        raise
    except Exception as e:  # noqa: BLE001 — 손상·잘림·DecompressionBombError
        raise RenderError(422, {"code": "UNREADABLE"}) from e
    return img


# 16비트(회색조) 모드 — convert("RGB") 가 255 로 잘라 전부 흰색이 되므로 8비트로 먼저 줄인다.
_HIGH_DEPTH_MODES = ("I;16", "I;16B", "I;16L", "I;16N", "I")


def _to_8bit(img: Image.Image) -> Image.Image:
    """16비트 회색조를 값/256 으로 8비트(L) 로 줄인다. 그 외 모드는 그대로."""
    if img.mode in _HIGH_DEPTH_MODES:
        return img.point(lambda v: v / 256).convert("L")
    return img


def render_image(data: bytes, mime: str, max_edge: int) -> Rendered:
    """이미지를 회전 반영·축소해 PNG(투명도 있음) 또는 JPEG 로 만든다. 손상 파일은 UNREADABLE(422)."""
    if not mime.startswith("image/"):
        raise RenderError(415, {"code": "UNSUPPORTED"})
    img = _open_image(data)
    try:
        img = _to_8bit(ImageOps.exif_transpose(img))
        has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
        img = img.convert("RGBA" if has_alpha else "RGB")
        img.thumbnail((max_edge, max_edge))
        buf = io.BytesIO()
        if has_alpha:
            img.save(buf, "PNG", optimize=True)
            if buf.tell() <= PNG_MAX_BYTES:
                return Rendered(buf.getvalue(), "image/png")
            # JPEG 는 알파가 없다 — 투명 영역이 검게 변하지 않도록 흰 배경에 합성한다.
            bg = Image.new("RGB", img.size, "white")
            bg.paste(img, mask=img.getchannel("A"))
            img = bg
            buf = io.BytesIO()
        img.save(buf, "JPEG", quality=JPEG_QUALITY)
        return Rendered(buf.getvalue(), "image/jpeg")
    except Exception as e:  # noqa: BLE001 — 변환·축소·인코딩 중 손상(500 방지)
        raise RenderError(422, {"code": "UNREADABLE"}) from e
