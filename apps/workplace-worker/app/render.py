"""PDF 페이지·이미지를 모델에 보낼 이미지로 만든다(WP-250).

긴 변을 max_edge 로 맞춰 픽셀 수를 묶는다 — 거대한 도면 페이지도 메모리가 폭주하지 않는다.
결과는 PNG(투명도·도면) 또는 JPEG(사진)이며, PNG 가 PNG_MAX_BYTES(1MB) 를 넘으면 JPEG 로 다시 인코딩한다.
"""
import io
import math
import threading
from dataclasses import dataclass

import fitz
import pillow_heif
from PIL import Image
from PIL.JpegImagePlugin import JpegImageFile

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
# PyMuPDF(MuPDF)는 스레드 안전하지 않다 — /render 는 동기 라우트라 스레드풀에서 동시에 돈다. AI 가 여러 쪽을 한꺼번에 요청하면(pageBlocks 병렬)
# 같은 순간 여러 렌더가 겹치므로 페이지 그리기를 한 번에 하나씩 한다(쪽당 수십~수백 ms 라 직렬화 비용이 작다).
_PDF_LOCK = threading.Lock()


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
    with _PDF_LOCK:
        return _render_pdf_page(data, page, max_edge)


def _render_pdf_page(data: bytes, page: int, max_edge: int) -> Rendered:
    """render_pdf_page 의 본체 — 잠금 안에서만 부른다."""
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


def _open_image(data: bytes, max_edge: int | None = None) -> Image.Image:
    """바이트를 열어 첫 프레임까지 로드한다. 깨진 파일·폭탄 이미지는 UNREADABLE(422).

    JPEG 는 max_edge 를 주면 load 전에 draft 로 디코더가 1/2·1/4·1/8 로 줄여 읽게 한다 — 큰 사진을 전체 해상도로 풀지 않아 메모리가 크게 준다.
    draft 는 요청 크기보다 작아지지 않는 가장 작은 배율을 고르므로 이후 thumbnail 결과(긴 변 max_edge)는 그대로다.
    """
    try:
        img = Image.open(io.BytesIO(data))
        # load 전에 픽셀 수를 직접 확인 — Pillow 는 한도 1~2배 구간에선 경고만 낸다.
        if img.width * img.height > MAX_IMAGE_PIXELS:
            raise RenderError(422, {"code": "UNREADABLE"})
        img.seek(0)  # 애니메이션은 첫 프레임
        # MPO(휴대폰 사진의 깊이·HDR 보조 영상이 붙은 JPEG)도 JpegImageFile 하위 클래스라 같은 축소 디코딩을 쓴다.
        if max_edge and isinstance(img, JpegImageFile):
            scale = max_edge / max(img.size)
            if scale < 1:
                img.draft(img.mode, (math.ceil(img.width * scale), math.ceil(img.height * scale)))
        img.load()
    except RenderError:
        raise
    except Exception as e:  # noqa: BLE001 — 손상·잘림·DecompressionBombError
        raise RenderError(422, {"code": "UNREADABLE"}) from e
    return img


# 16비트(회색조) 모드 — convert("RGB") 가 255 로 잘라 전부 흰색이 되므로 8비트로 먼저 줄인다.
_HIGH_DEPTH_MODES = ("I;16", "I;16B", "I;16L", "I;16N", "I")
# 그대로 축소(thumbnail)해도 되는 모드 — 그 밖(P·1 은 최근접 보간으로 품질이 깨지고, CMYK·F 등은 최종 변환이 필요)은 필요한 변환을 먼저 한다.
_RESIZABLE_MODES = ("RGB", "RGBA", "L", "LA")
# EXIF Orientation → 같은 결과를 내는 변환(ImageOps.exif_transpose 와 같은 표). 축소한 뒤에 돌린다 — 긴 변 기준 정사각형 상자로 줄이므로
# 돌리기 전·후 어느 쪽에서 줄여도 결과 크기가 같고, 전체 해상도 회전 사본을 만들지 않는다.
_ORIENTATION_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


def _to_8bit(img: Image.Image) -> Image.Image:
    """16비트 회색조를 값/256 으로 8비트(L) 로 줄인다. 그 외 모드는 그대로."""
    if img.mode in _HIGH_DEPTH_MODES:
        return img.point(lambda v: v / 256).convert("L")
    return img


def render_image(data: bytes, mime: str, max_edge: int) -> Rendered:
    """이미지를 회전 반영·축소해 PNG(투명도 있음) 또는 JPEG 로 만든다. 손상 파일은 UNREADABLE(422).

    메모리: 전체 해상도에서 회전·모드 변환 사본을 만들지 않도록 가능한 한 먼저 줄인다 — JPEG 는 디코딩 단계에서(draft), 나머지는
    축소할 수 있는 모드가 되자마자 thumbnail 한 뒤 회전·최종 모드 변환을 한다.
    """
    if not mime.startswith("image/"):
        raise RenderError(415, {"code": "UNSUPPORTED"})
    img = _open_image(data, max_edge)
    try:
        # 회전 정보는 모드 변환(point·convert) 전에 읽는다 — 변환 사본은 TIFF 태그 등 원본의 EXIF 를 잃을 수 있다.
        orientation = img.getexif().get(0x0112, 1)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
        target = "RGBA" if has_alpha else "RGB"
        img = _to_8bit(img)
        if img.mode not in _RESIZABLE_MODES:
            img = img.convert(target)
        img.thumbnail((max_edge, max_edge))
        method = _ORIENTATION_TRANSPOSE.get(orientation)
        if method is not None:
            img = img.transpose(method)
        if img.mode != target:
            img = img.convert(target)
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
