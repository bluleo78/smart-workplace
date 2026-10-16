"""HWP·HWPX 엔진 테스트 — rhwp export-svg → rsvg-convert PDF 합치기.

단위 테스트는 proc.run 을 가짜로 바꿔 호출 순서·인자·오류 매핑·슬롯·임시 디렉터리 정리와
SVG 글자 위치 → 텍스트(줄·공백 복원) 규칙을 검증한다.
`@pytest.mark.engine` 테스트는 실제 rhwp/rsvg-convert 가 있는 컨테이너 test 타깃에서만 돈다.
"""
import re
import subprocess
from pathlib import Path

import pymupdf
import pytest

from app import config, main
from app.engines import hwp, proc
from app.errors import ConvertError

HWP = "application/x-hwp"
HWPX = "application/hwp+zip"
FIXTURES = Path(__file__).parent / "fixtures"


def _tiny_pdf(pages: int) -> bytes:
    """쪽수가 정해진 최소 PDF 바이트 — 가짜 rsvg-convert 출력용."""
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"page {i + 1}")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def tmpdir_env(tmp_path, monkeypatch):
    """엔진이 쓰는 TMPDIR 을 테스트 전용 디렉터리로 돌려 누수 여부를 확인할 수 있게 한다."""
    root = tmp_path / "tmp"
    root.mkdir()
    monkeypatch.setenv("TMPDIR", str(root))
    return root


def _svg(*glyphs: tuple[float, float, str], size: float = 10) -> str:
    """rhwp 처럼 글자마다 <text transform="translate(x,y) scale(1,1)"> 하나씩 찍은 SVG 문자열."""
    texts = "".join(f'<text transform="translate({x},{y}) scale(1,1)" font-size="{size}">{ch}</text>'
                    for x, y, ch in glyphs)
    return f'<svg xmlns="http://www.w3.org/2000/svg">{texts}</svg>'


def _line(text: str, y: float) -> list[tuple[float, float, str]]:
    """한 줄 글자 위치(font-size 10) — rhwp 실측 모양: 전각 글자 진행폭 0.94em, 반각 0.55em,
    공백 글자는 찍지 않고 0.45em 만큼 띄우기만 한다."""
    out, x = [], 0.0
    for ch in text:
        if ch == " ":
            x += 4.5
            continue
        out.append((x, y, ch))
        x += 9.4 if ord(ch) > 0x2E80 else 5.5
    return out


@pytest.fixture
def fake_run(monkeypatch):
    """proc.run 대체 — 호출을 기록하고, rhwp 면 svg 파일을 만들고, rsvg 면 PDF 를 쓴다.

    반환된 dict 의 svg_names 를 바꿔 rhwp 가 만들 파일 이름(0개 포함)을 조정한다.
    SVG 마다 "<파일 이름 줄기>" 한 줄 텍스트를 담는다(텍스트 경로 검증용).
    """
    state = {"calls": [], "svg_names": ["input_001.svg"]}

    def run(cmd, timeout, cwd):
        state["calls"].append(list(cmd))
        if cmd[0] == config.RHWP_BIN:
            out = Path(cmd[cmd.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            for name in state["svg_names"]:
                (out / name).write_text(_svg(*_line(Path(name).stem, 20)))
        elif cmd[0] == config.RSVG_BIN:
            out_pdf = Path(cmd[cmd.index("-o") + 1])
            out_pdf.write_bytes(_tiny_pdf(len(cmd) - 5))
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    monkeypatch.setattr(proc, "run", run)
    return state


def test_hwp_runs_export_svg_then_rsvg(fake_run, tmpdir_env):
    # 쪽 번호가 자리수 다른 파일명 — 문자열 정렬이면 p10 이 p2 앞에 온다
    fake_run["svg_names"] = ["doc_p10.svg", "doc_p2.svg", "doc_p1.svg"]
    result = hwp.to_pdf(b"HWPX-BYTES", HWPX)

    assert len(fake_run["calls"]) == 2
    rhwp_cmd, rsvg_cmd = fake_run["calls"]
    # 1) rhwp export-svg <in.hwpx> -o <svgdir>
    assert rhwp_cmd[:2] == [config.RHWP_BIN, "export-svg"]
    src = Path(rhwp_cmd[2])
    assert src.suffix == ".hwpx"
    assert rhwp_cmd[3] == "-o"
    svgdir = Path(rhwp_cmd[4])
    # 2) rsvg-convert -f pdf -o <out.pdf> <svg 쪽 순서>
    assert rsvg_cmd[:5] == [config.RSVG_BIN, "-f", "pdf", "-o", rsvg_cmd[4]]
    assert rsvg_cmd[4].endswith(".pdf")
    assert [Path(p) for p in rsvg_cmd[5:]] == [
        svgdir / "doc_p1.svg", svgdir / "doc_p2.svg", svgdir / "doc_p10.svg"]

    assert result.data.startswith(b"%PDF")
    assert result.page_count == 3


def test_hwp_too_many_pages_rejected_before_rsvg(fake_run, tmpdir_env, monkeypatch):
    """SVG 수(=쪽수)가 MAX_PAGES 를 넘으면 rsvg 합치기 전에 422 TOO_MANY_PAGES — 텍스트 경로도 같다."""
    monkeypatch.setattr(config, "MAX_PAGES", 2)
    fake_run["svg_names"] = ["input_001.svg", "input_002.svg", "input_003.svg"]
    for fn in (hwp.to_pdf, hwp.to_text):
        fake_run["calls"].clear()
        with pytest.raises(ConvertError) as e:
            fn(b"x", HWP)
        assert (e.value.status, e.value.code) == (422, "TOO_MANY_PAGES")
        assert [c[0] for c in fake_run["calls"]] == [config.RHWP_BIN]


def test_hwp_page_count_is_svg_count(fake_run, tmpdir_env, monkeypatch):
    """쪽수는 PDF 재파싱이 아니라 SVG 개수 — rsvg 출력과 무관하게 SVG 수를 따른다."""
    fake_run["svg_names"] = ["a1.svg", "a2.svg"]
    assert hwp.to_pdf(b"x", HWP).page_count == 2


def test_hwp_input_extension_follows_mime(fake_run, tmpdir_env):
    hwp.to_pdf(b"HWP5", HWP)
    assert Path(fake_run["calls"][0][2]).suffix == ".hwp"


def test_hwp_input_bytes_written(monkeypatch, tmpdir_env):
    """rhwp 가 받는 입력 파일 내용이 요청 바이트와 같아야 한다."""
    seen = {}

    def run(cmd, timeout, cwd):
        seen["data"] = Path(cmd[2]).read_bytes()
        raise ConvertError(422, "CONVERT_FAILED")

    monkeypatch.setattr(proc, "run", run)
    with pytest.raises(ConvertError):
        hwp.to_pdf(b"\x00ORIGINAL", HWP)
    assert seen["data"] == b"\x00ORIGINAL"


def test_hwp_no_svg_output_is_convert_failed(fake_run, tmpdir_env):
    fake_run["svg_names"] = []
    with pytest.raises(ConvertError) as e:
        hwp.to_pdf(b"x", HWP)
    assert (e.value.status, e.value.code) == (422, "CONVERT_FAILED")
    # rsvg 는 호출되지 않아야 한다
    assert len(fake_run["calls"]) == 1


def test_hwp_timeout_maps_504(tmp_path, tmpdir_env, monkeypatch):
    """실제 proc.run 경로 — 멈춘 rhwp 를 타임아웃으로 죽이고 504 TIMEOUT.

    가짜 rhwp 스크립트는 실행 비트 없이 /bin/sh 로 읽혀 돌린다 — 운영처럼 /tmp 가 noexec tmpfs
    (`--read-only --tmpfs /tmp`)여도 tmp_path 의 스크립트를 직접 exec 하지 않아 PermissionError 가 나지 않는다.
    """
    slow = tmp_path / "slow-rhwp"
    slow.write_text("sleep 30\n")
    real_run = proc.run

    def run(cmd, *args, **kwargs):
        # cmd[0] 은 config.RHWP_BIN — 그 자리에 sh + 스크립트를 넣고 나머지 인자는 그대로 넘긴다
        return real_run(["/bin/sh", str(slow), *cmd[1:]], *args, **kwargs)

    monkeypatch.setattr(proc, "run", run)
    monkeypatch.setattr(config, "TIMEOUT_SEC", 0.5)
    with pytest.raises(ConvertError) as e:
        hwp.to_pdf(b"x", HWP)
    assert (e.value.status, e.value.code) == (504, "TIMEOUT")


def test_proc_nonzero_exit_is_convert_failed(tmp_path):
    with pytest.raises(ConvertError) as e:
        proc.run(["/bin/sh", "-c", "exit 3"], timeout=5, cwd=tmp_path)
    assert (e.value.status, e.value.code) == (422, "CONVERT_FAILED")


def test_proc_ok_returns_completed(tmp_path):
    cp = proc.run(["/bin/sh", "-c", "echo hi"], timeout=5, cwd=tmp_path)
    assert cp.returncode == 0
    assert cp.stdout.strip() == b"hi"


def test_deadline_expiry_error():
    """Deadline: 예산 소진은 기본 504, min_left 미달은 on_expire 오류(soffice 는 503). left() 는 던지지 않는다."""
    from app.errors import unavailable
    gone = proc.Deadline(0)
    assert gone.left() == 0
    with pytest.raises(ConvertError) as e:
        gone.remaining()
    assert (e.value.status, e.value.code) == (504, "TIMEOUT")
    with pytest.raises(ConvertError) as e:
        proc.Deadline(5, on_expire=unavailable).remaining(min_left=10)
    assert (e.value.status, e.value.code) == (503, "UNAVAILABLE")
    assert 0 < proc.Deadline(5).remaining() <= 5


def test_hwp_slots_exhausted_429(fake_run, tmpdir_env, monkeypatch):
    import threading
    sem = threading.BoundedSemaphore(2)
    monkeypatch.setattr(hwp, "_SLOTS", sem)
    sem.acquire()
    sem.acquire()
    try:
        with pytest.raises(ConvertError) as e:
            hwp.to_pdf(b"x", HWP)
        assert (e.value.status, e.value.code) == (429, "BUSY")
        assert fake_run["calls"] == []
    finally:
        sem.release()
        sem.release()


def test_hwp_slot_released_after_failure(fake_run, tmpdir_env, monkeypatch):
    """실패해도 슬롯을 돌려줘 이후 요청이 BUSY 로 막히지 않아야 한다."""
    import threading
    monkeypatch.setattr(hwp, "_SLOTS", threading.BoundedSemaphore(1))
    fake_run["svg_names"] = []
    with pytest.raises(ConvertError):
        hwp.to_pdf(b"x", HWP)
    fake_run["svg_names"] = ["input_001.svg"]
    assert hwp.to_pdf(b"x", HWP).page_count == 1


@pytest.mark.parametrize("svg_names", [[], ["input_001.svg"]], ids=["failure", "success"])
@pytest.mark.parametrize("fn", [hwp.to_pdf, hwp.to_text], ids=["pdf", "text"])
def test_hwp_tempdir_removed(fake_run, tmpdir_env, svg_names, fn):
    """성공·실패 모두 요청 임시 디렉터리를 지운다."""
    fake_run["svg_names"] = svg_names
    if svg_names:
        fn(b"x", HWP)
    else:
        with pytest.raises(ConvertError):
            fn(b"x", HWP)
    assert list(tmpdir_env.iterdir()) == []


def test_hwp_to_text_joins_pages_without_rsvg(fake_run, tmpdir_env):
    """텍스트는 SVG 에서 바로 — rsvg(PDF) 를 부르지 않고 쪽 순서대로 빈 줄로 잇는다."""
    fake_run["svg_names"] = ["p10.svg", "p2.svg"]
    assert hwp.to_text(b"x", HWP) == "p2\n\np10"
    assert [c[0] for c in fake_run["calls"]] == [config.RHWP_BIN]


def test_svg_text_restores_spaces_and_lines(tmp_path):
    """글자 간격이 넓으면 공백, 기준선이 바뀌면 줄바꿈. 문장부호 뒤 좁은 공백도 살리고 투명 글자는 뺀다."""
    glyphs = _line("가나 다라", 20) + _line("마바", 40)
    svg = _svg(*glyphs).replace("</svg>", "")
    # 반각: 'A' 0.7em 진행은 공백 아님, ',' 0.3em + 공백 0.45em 은 공백
    svg += ('<text transform="translate(0,60) scale(1,1)" font-size="10">A</text>'
            '<text transform="translate(7,60) scale(1,1)" font-size="10">,</text>'
            '<text transform="translate(14.5,60) scale(1,1)" font-size="10">B</text>'
            '<text x="30" y="60" font-size="10" fill-opacity="0">·</text></svg>')
    path = tmp_path / "p.svg"
    path.write_text(svg)
    assert hwp._svg_text(path) == "가나 다라\n마바\nA, B"


def test_svg_text_ambiguous_width_symbols_are_wide(tmp_path):
    """○ □ 같은 폭 모호 기호는 한글 글꼴에서 전각(0.96em)으로 그려진다 — 붙은 기호 사이에 헛 공백을 넣지 않는다."""
    # ○○신문 (0.96em 간격) · 공백 뒤 '보도'(1.43em)
    glyphs = [(0, 20, "○"), (9.6, 20, "○"), (19.2, 20, "신"), (28.6, 20, "문"), (42.9, 20, "보"), (52.3, 20, "도")]
    path = tmp_path / "p.svg"
    path.write_text(_svg(*glyphs))
    assert hwp._svg_text(path) == "○○신문 보도"


def test_hwp_broken_svg_is_convert_failed(fake_run, tmpdir_env, monkeypatch):
    """rhwp 가 깨진 SVG 를 내면 500 이 아니라 422 CONVERT_FAILED."""
    fake = proc.run  # fake_run 이 끼운 가짜 — 그대로 돌린 뒤 SVG 만 망가뜨린다

    def run(cmd, timeout, cwd):
        cp = fake(cmd, timeout, cwd)
        for svg in Path(cmd[cmd.index("-o") + 1]).glob("*.svg"):
            svg.write_text("<svg")
        return cp

    monkeypatch.setattr(proc, "run", run)
    with pytest.raises(ConvertError) as e:
        hwp.to_text(b"x", HWP)
    assert (e.value.status, e.value.code) == (422, "CONVERT_FAILED")


def test_hwp_engines_registered():
    for mime in (HWP, HWPX):
        assert main.PDF_ENGINES[mime] is hwp.to_pdf
        assert main.TEXT_ENGINES[mime] is hwp.to_text


@pytest.mark.engine
def test_hwpx_sample_to_text_keeps_word_spaces(tmpdir_env):
    """실제 rhwp SVG 에서 뽑은 텍스트 — 한글 단어 사이 공백이 살아 있어야 한다(PDF 텍스트 층은 잃었다)."""
    text = hwp.to_text((FIXTURES / "sample.hwpx").read_bytes(), HWPX)
    assert len(text) > 1000
    assert re.search(r"[가-힣] [가-힣]", text)
    assert "\n\n" in text


@pytest.mark.engine
def test_hwpx_sample_to_pdf_has_hangul(tmpdir_env):
    data = (FIXTURES / "sample.hwpx").read_bytes()
    result = hwp.to_pdf(data, HWPX)
    assert result.data[:4] == b"%PDF"
    assert result.page_count >= 1
    with pymupdf.open(stream=result.data, filetype="pdf") as doc:
        text = "".join(page.get_text() for page in doc)
    assert any("가" <= ch <= "힣" for ch in text)
