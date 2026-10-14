"""render.py 단위 테스트 — PDF 페이지·이미지 변환(WP-250)."""
import io

import fitz
import pytest
from PIL import Image

from app.render import RenderError, render_image, render_pdf_page


def _pdf(pages: int, size=(595, 842)) -> bytes:
    doc = fitz.open()
    for i in range(pages):
        p = doc.new_page(width=size[0], height=size[1])
        p.insert_text((72, 72), f"page {i + 1}")
    return doc.tobytes()


def test_pdf_page_long_edge_fits_max_edge():
    out = render_pdf_page(_pdf(3), page=2, max_edge=1568)
    img = Image.open(io.BytesIO(out.data))
    assert abs(max(img.size) - 1568) <= 1  # PyMuPDF 반올림 허용
    assert out.mime == "image/png"
    assert out.page_count == 3


def test_huge_page_is_capped_by_max_edge():
    # A0 의 4배(약 9500pt) — 배율을 긴 변으로 정하므로 픽셀이 폭주하지 않는다(Review Focus 1)
    out = render_pdf_page(_pdf(1, size=(9536, 13484)), page=1, max_edge=1568)
    assert max(Image.open(io.BytesIO(out.data)).size) <= 1569  # 반올림 허용


def test_page_out_of_range():
    with pytest.raises(RenderError) as e:
        render_pdf_page(_pdf(2), page=3, max_edge=1568)
    assert e.value.status == 400 and e.value.detail == {"code": "PAGE_OUT_OF_RANGE", "pageCount": 2}


def test_broken_pdf_is_unreadable():
    with pytest.raises(RenderError) as e:
        render_pdf_page(b"%PDF-1.4 broken", page=1, max_edge=1568)
    assert e.value.status == 422


def test_encrypted_pdf_is_unreadable():
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    with pytest.raises(RenderError) as e:
        render_pdf_page(data, page=1, max_edge=1568)
    assert e.value.status == 422


def _img(mode: str, size=(4000, 3000), fmt="JPEG", **save) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color=0).save(buf, fmt, **save)
    return buf.getvalue()


def test_large_jpeg_downscaled_to_jpeg():
    out = render_image(_img("RGB"), "image/jpeg", max_edge=1568)
    img = Image.open(io.BytesIO(out.data))
    assert max(img.size) == 1568 and out.mime == "image/jpeg"


def test_cmyk_jpeg_becomes_rgb():
    out = render_image(_img("CMYK"), "image/jpeg", max_edge=1568)
    assert Image.open(io.BytesIO(out.data)).mode == "RGB"


def test_png_with_alpha_stays_png():
    out = render_image(_img("RGBA", fmt="PNG"), "image/png", max_edge=1568)
    assert out.mime == "image/png"


def test_tiff_and_bmp_convert():
    for fmt, mime in (("TIFF", "image/tiff"), ("BMP", "image/bmp")):
        out = render_image(_img("RGB", size=(800, 600), fmt=fmt), mime, max_edge=1568)
        assert out.mime == "image/jpeg"


def test_exif_rotation_applied():
    img = Image.new("RGB", (400, 200))
    exif = img.getexif()
    exif[0x0112] = 6  # 90도 회전
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    out = render_image(buf.getvalue(), "image/jpeg", max_edge=1568)
    assert Image.open(io.BytesIO(out.data)).size == (200, 400)


def test_animated_gif_first_frame():
    frames = [Image.new("RGB", (100, 100), c) for c in ("red", "blue")]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    out = render_image(buf.getvalue(), "image/gif", max_edge=1568)
    assert out.mime in ("image/jpeg", "image/png")


def test_heic_converts():
    import pillow_heif
    pillow_heif.register_heif_opener()
    buf = io.BytesIO()
    Image.new("RGB", (640, 480)).save(buf, "HEIF")
    out = render_image(buf.getvalue(), "image/heic", max_edge=1568)
    assert out.mime == "image/jpeg"


def test_unsupported_mime():
    with pytest.raises(RenderError) as e:
        render_image(b"x", "application/zip", max_edge=1568)
    assert e.value.status == 415
