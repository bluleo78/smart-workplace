"""HWP·HWPX 엔진 — rhwp 로 쪽별 SVG 를 만들고, PDF 는 rsvg-convert 로 합치고 텍스트는 SVG 에서 바로 뽑는다.

왜 이 경로인가: rhwp `export-pdf` 는 텍스트가 누락되고, pymupdf 로 SVG→PDF 를 하면 시스템 폰트를 못 써
한글이 깨진다. rsvg-convert 는 fontconfig 로 나눔 폰트를 찾아 텍스트를 살린 채 여러 SVG 를 쪽으로 합친다.
텍스트는 PDF 를 거치지 않는다 — PDF 텍스트 층은 한글 단어 사이 공백을 잃고 rsvg 비용도 든다(아래 _svg_text).
요청마다 TMPDIR 아래 임시 디렉터리를 쓰고(읽기 전용 루트 FS 대응) 성공·실패 모두 지운다.
"""
import re
import tempfile
import threading
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from .. import config
from ..errors import ConvertError, convert_failed
from . import proc
from .result import PdfResult

T = TypeVar("T")

# mime → rhwp 가 형식을 판별하는 입력 확장자
_EXT = {"application/x-hwp": ".hwp", "application/hwp+zip": ".hwpx"}
MIMES = tuple(_EXT)

# rhwp 동시 실행 슬롯. 꽉 차면 기다리지 않고 즉시 429 — 호출자가 재시도하게 해 요청이 줄줄이 늘어지지 않게 한다.
_SLOTS = threading.BoundedSemaphore(config.RHWP_SLOTS)


def busy() -> bool:
    """슬롯이 다 찼는지 — 본문을 받기 전에 429 를 미리 판정하는 값싼 확인. 최종 판정은 _with_svgs 의 acquire.

    acquire→release 로 떠보면 그 사이 동시 요청의 마지막 슬롯을 뺏어 헛 429 를 낼 수 있어,
    부작용 없는 내부 카운터(CPython threading.Semaphore._value)를 읽는다.
    """
    return _SLOTS._value == 0


def _page_key(path: Path) -> list:
    """파일명 자연 정렬 키 — 숫자 덩어리는 정수로 비교해 'p10' 이 'p2' 뒤에 오게 한다."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", path.name)]


def _with_svgs(data: bytes | bytearray, mime: str,
               finish: Callable[[list[Path], Path, proc.Deadline], T]) -> T:
    """슬롯·임시 디렉터리 안에서 원본 → 쪽별 SVG 를 만들고 finish(svgs, work, deadline) 결과를 돌려준다.

    슬롯이 없으면 429 BUSY. rhwp 와 finish 단계를 합쳐 TIMEOUT_SEC 안에 끝나도록 공통 마감을 넘긴다.
    """
    if not _SLOTS.acquire(blocking=False):
        raise ConvertError(429, "BUSY")
    try:
        with tempfile.TemporaryDirectory(prefix="hwp-", dir=config.tmp_root()) as tmp:
            work = Path(tmp)
            deadline = proc.Deadline(config.TIMEOUT_SEC)
            src = work / f"input{_EXT[mime]}"
            src.write_bytes(data)
            svg_dir = work / "svg"
            svg_dir.mkdir()
            # rhwp: 쪽마다 SVG 1개(예: input_001.svg). 폰트는 fontconfig 가 담당(export-svg 에 폰트 옵션 없음)
            proc.run([config.RHWP_BIN, "export-svg", str(src), "-o", str(svg_dir)],
                     timeout=deadline.remaining(), cwd=work)
            svgs = sorted(svg_dir.glob("*.svg"), key=_page_key)
            if not svgs:
                # rhwp 가 0 으로 끝나도 쪽을 못 만들었으면 변환 불가
                raise convert_failed()
            # SVG 1개 = 1쪽. 상한 초과면 비싼 후속 단계(rsvg 합치기·텍스트 파싱) 전에 거절한다
            if len(svgs) > config.MAX_PAGES:
                raise ConvertError(422, "TOO_MANY_PAGES")
            return finish(svgs, work, deadline)
    finally:
        _SLOTS.release()


def _merge_pdf(svgs: list[Path], work: Path, deadline: proc.Deadline) -> PdfResult:
    """rsvg-convert 로 SVG 들을 쪽 순서대로 한 PDF 로 합친다. 쪽수는 SVG 개수 그대로 — PDF 를 다시 파싱하지 않는다."""
    out_pdf = work / "out.pdf"
    proc.run([config.RSVG_BIN, "-f", "pdf", "-o", str(out_pdf), *map(str, svgs)],
             timeout=deadline.remaining(), cwd=work)
    if not out_pdf.is_file():
        raise convert_failed()
    return PdfResult(data=out_pdf.read_bytes(), page_count=len(svgs))


def to_pdf(data: bytes | bytearray, mime: str) -> PdfResult:
    """HWP/HWPX 원본 바이트를 PDF 로 변환한다. 슬롯이 없으면 429 BUSY."""
    return _with_svgs(data, mime, _merge_pdf)


# ---- 텍스트: rhwp SVG 의 <text> 글자 위치로 줄·공백을 복원 ----

_SVG = "{http://www.w3.org/2000/svg}"
_TRANSFORM = re.compile(r"translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)(?:\s*scale\(\s*([-\d.eE]+))?")
# 글자 사이 간격(em = 앞 글자 font-size × 가로 배율)이 이보다 크면 단어 사이 공백으로 본다.
# rhwp 는 글자마다 <text> 하나를 찍고 공백 글자는 내보내지 않는다. 실측(sample.hwpx):
# 한글 등 전각 글자 진행폭 0.80~0.95em, 공백이 끼면 1.14em 이상 — 그 사이로 자른다.
# 폭 모호(East Asian Ambiguous: ○ □ ☆ ∼ ① 등)는 한글 글꼴에서 전각(0.96em)으로 그려지므로 전각 기준을 쓴다.
# 반각 글자는 폭이 제각각(0.2~0.9em)이라 문장부호(좁음)만 낮은 기준을 쓰고 나머지는 보수적으로 높게 둔다.
_GAP_WIDE = 1.05
_GAP_PUNCT = 0.6
_GAP_NARROW = 0.9


def _glyphs(svg: Path):
    """SVG 의 보이는 <text> 노드마다 (x, y, font_size, 가로 배율, 문자열). 문서 순서 = rhwp 그리기 순서."""
    for el in ET.parse(svg).iter(f"{_SVG}text"):
        if el.get("fill-opacity") == "0":
            continue  # 투명 글자(rhwp 가 위치 표시용으로 찍는 '·' 등)는 보이지 않으므로 뺀다
        s = "".join(el.itertext())
        if not s:
            continue
        size = float(el.get("font-size", 10))
        m = _TRANSFORM.search(el.get("transform", ""))
        if m:
            x, y, sx = float(m[1]), float(m[2]), float(m[3] or 1)
        else:
            x, y, sx = float(el.get("x", 0)), float(el.get("y", 0)), 1.0
        if size * sx <= 0:
            continue  # 크기 0 글자는 보이지 않고 간격 계산(em 나눗셈)도 할 수 없다
        yield x, y, size, sx, s


def _svg_text(svg: Path) -> str:
    """한 쪽 SVG → 평문. 기준선(y)이 바뀌거나 x 가 되돌아가면 줄바꿈, 글자 간격이 넓으면 공백을 넣는다.

    표 셀은 rhwp 가 셀 단위로 그리므로 셀 안 글은 이어지고, 다음 셀로 넘어가면 y·x 가 튀어 줄이 바뀐다.
    """
    lines: list[str] = []
    cur: list[str] = []
    prev = None
    for x, y, size, sx, s in _glyphs(svg):
        if prev is not None:
            px, py, psize, psx, pch = prev
            em = psize * psx
            if abs(y - py) > 0.5 * max(size, psize) or x < px - 0.1 * em:
                lines.append("".join(cur))
                cur = []
            else:
                if unicodedata.east_asian_width(pch) in "WFA":
                    gap = _GAP_WIDE
                elif unicodedata.category(pch).startswith("P"):
                    gap = _GAP_PUNCT
                else:
                    gap = _GAP_NARROW
                if (x - px) / em > gap and not pch.isspace() and not s[0].isspace():
                    cur.append(" ")
        cur.append(s)
        prev = (x, y, size, sx, s[-1])
    lines.append("".join(cur))
    return "\n".join(t for line in lines if (t := " ".join(line.split())))


def _extract_text(svgs: list[Path], _work: Path, deadline: proc.Deadline) -> str:
    """쪽마다 SVG 에서 텍스트를 뽑아 빈 줄(`\\n\\n`)로 잇는다. 쪽마다 마감을 확인한다(파싱은 하위 프로세스가 아니라 직접 시간 제한)."""
    pages = []
    for svg in svgs:
        deadline.remaining()
        try:
            pages.append(_svg_text(svg))
        except (ET.ParseError, ValueError) as e:
            # rhwp 가 깨진 SVG 를 냈다 — 코드 버그(500)가 아니라 이 입력의 변환 실패
            raise convert_failed() from e
    return "\n\n".join(pages)


def to_text(data: bytes | bytearray, mime: str) -> str:
    """HWP/HWPX → 평문. rhwp SVG 의 글자 위치로 줄·단어 공백을 복원하고 쪽 사이는 빈 줄로 잇는다."""
    return _with_svgs(data, mime, _extract_text)
