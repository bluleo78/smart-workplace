"""render.py 단위 테스트 — PDF 페이지·이미지 변환(WP-250)."""
import io

import fitz
import pytest
from PIL import Image

from app.render import RenderError, _open_image, render_image, render_pdf_page


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


# --- 수정 라운드 1 ---------------------------------------------------------

def _noise_rgba(size=(800, 800)) -> Image.Image:
    """압축이 안 되는 랜덤 노이즈 RGBA — PNG 가 1MB 를 넘게 만든다."""
    import os
    return Image.frombytes("RGBA", size, os.urandom(size[0] * size[1] * 4))


@pytest.mark.parametrize("mode", ["I;16", "I"])
def test_16bit_grayscale_png_is_not_white(mode):
    """16비트 회색조(중간값 30000)가 흰색(255)으로 날아가지 않고 중간 회색으로 변환된다."""
    buf = io.BytesIO()
    Image.new(mode, (4, 4), 30000).save(buf, "PNG")
    out = render_image(buf.getvalue(), "image/png", max_edge=1568)
    img = Image.open(io.BytesIO(out.data)).convert("RGB")
    r, g, b = img.getpixel((0, 0))
    assert abs(r - 117) <= 2 and r == g == b  # 30000 / 256 ≈ 117


def test_pdf_page_png_over_limit_falls_back_to_jpeg():
    """페이지 PNG 가 1MB 를 넘으면 JPEG 로 다시 인코딩한다."""
    import os
    noise = Image.frombytes("RGB", (1200, 1200), os.urandom(1200 * 1200 * 3))
    buf = io.BytesIO()
    noise.save(buf, "PNG")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buf.getvalue())
    out = render_pdf_page(doc.tobytes(), page=1, max_edge=1568)
    assert out.mime == "image/jpeg" and out.page_count == 1


def test_rgba_png_over_limit_falls_back_to_jpeg_on_white():
    """알파 이미지의 PNG 가 1MB 를 넘으면 JPEG 로 줄이고, 투명 영역은 검정이 아닌 흰색이 된다."""
    img = _noise_rgba()
    img.paste((0, 0, 0, 0), (0, 0, 100, 100))  # 좌상단 완전 투명
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = render_image(buf.getvalue(), "image/png", max_edge=1568)
    assert out.mime == "image/jpeg"
    px = Image.open(io.BytesIO(out.data)).getpixel((10, 10))
    assert min(px) >= 240


def test_pa_mode_treated_as_alpha(monkeypatch):
    """PA(팔레트+알파)는 파일로 만들기 어려워 열기 단계를 대체해 알파 판정만 검증한다."""
    monkeypatch.setattr("app.render._open_image", lambda data, max_edge=None: Image.new("PA", (10, 10)))
    out = render_image(b"", "image/png", max_edge=1568)
    assert out.mime == "image/png"


def test_truncated_jpeg_is_unreadable():
    data = _img("RGB", size=(1200, 900))
    with pytest.raises(RenderError) as e:
        render_image(data[: len(data) // 3], "image/jpeg", max_edge=1568)
    assert e.value.status == 422 and e.value.detail == {"code": "UNREADABLE"}


def test_decompression_bomb_is_unreadable():
    """1비트 PNG 는 파일이 작아도 픽셀 수가 한도를 넘으면 열지 않고 422."""
    buf = io.BytesIO()
    Image.new("1", (11000, 11000)).save(buf, "PNG")  # 1.21억 픽셀 > 1억
    with pytest.raises(RenderError) as e:
        render_image(buf.getvalue(), "image/png", max_edge=1568)
    assert e.value.status == 422


# --- 코드 리뷰: 메모리(전체 해상도 사본 줄이기) -----------------------------

def _with_orientation(mode: str, size, fmt: str, orientation: int) -> bytes:
    """좌상단만 흰 사각형인 이미지에 EXIF Orientation 을 붙여 저장한다 — 회전 방향까지 확인할 수 있게."""
    img = Image.new(mode, size, "black")
    img.paste("white", (0, 0, size[0] // 4, size[1] // 4))
    exif = img.getexif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    img.save(buf, fmt, exif=exif)
    return buf.getvalue()


def _expected_old_way(data: bytes, max_edge: int) -> Image.Image:
    """바꾸기 전 방식(전체 해상도에서 회전한 뒤 축소)의 결과 — 새 방식과 크기·방향이 같아야 한다."""
    from PIL import ImageOps
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((max_edge, max_edge))
    return img


def test_jpeg_is_decoded_reduced_with_draft():
    """큰 JPEG 는 디코딩 단계에서 줄여 읽는다(1/2 배율) — 목표 크기보다 작아지지는 않는다."""
    img = _open_image(_img("RGB", size=(4000, 3000)), max_edge=1568)
    assert img.size == (2000, 1500)
    # max_edge 를 주지 않으면(다른 호출자) 전체 해상도 그대로.
    assert _open_image(_img("RGB", size=(4000, 3000))).size == (4000, 3000)


@pytest.mark.parametrize("orientation", [3, 6, 8])
def test_large_rotated_jpeg_matches_rotate_then_shrink(orientation):
    """축소 뒤에 돌려도(draft 포함) 전체 해상도에서 돌린 뒤 줄인 결과와 크기·방향이 같다."""
    data = _with_orientation("RGB", (4000, 3000), "JPEG", orientation)
    out = Image.open(io.BytesIO(render_image(data, "image/jpeg", max_edge=1568).data))
    expected = _expected_old_way(data, 1568)
    assert out.size == expected.size
    # 흰 사각형이 같은 모서리에 있다(회전 방향 확인) — JPEG 손실을 감안해 밝기만 비교한다.
    for xy in ((5, 5), (out.width - 5, 5), (5, out.height - 5), (out.width - 5, out.height - 5)):
        assert (sum(out.getpixel(xy)) > 380) == (sum(expected.getpixel(xy)) > 380)


def test_large_rotated_png_matches_rotate_then_shrink():
    """JPEG 가 아닌 이미지는 축소할 수 있는 모드에서 먼저 thumbnail 한 뒤 돌린다 — 결과는 기존 방식과 같다."""
    data = _with_orientation("RGB", (3000, 2000), "PNG", 6)
    out = Image.open(io.BytesIO(render_image(data, "image/png", max_edge=1568).data))
    expected = _expected_old_way(data, 1568)
    assert out.size == expected.size == (1045, 1568)
    assert sum(out.getpixel((out.width - 5, 5))) > 380  # 좌상단 흰 사각형이 90도 돌아 우상단으로


def test_palette_with_transparency_shrinks_with_alpha():
    """투명도 있는 팔레트(P) 이미지는 RGBA 로 먼저 바꾼 뒤 줄인다(최근접 보간으로 깨지지 않게) — 결과는 투명도를 지킨 PNG."""
    img = Image.new("P", (3200, 1600), 0)
    img.putpalette([0, 0, 0, 255, 0, 0] + [0] * 762)
    img.paste(1, (1600, 0, 3200, 1600))
    buf = io.BytesIO()
    img.save(buf, "PNG", transparency=0)
    out = render_image(buf.getvalue(), "image/png", max_edge=1568)
    res = Image.open(io.BytesIO(out.data))
    assert out.mime == "image/png" and res.size == (1568, 784) and res.mode == "RGBA"
    assert res.getpixel((10, 10))[3] == 0 and res.getpixel((1500, 10))[:3] == (255, 0, 0)
