"""파일 바이트에서 평문 텍스트를 추출. mime 별 라이브러리 분기.

대부분 순수 함수(외부 IO 없음)지만 레거시 OLE(.doc/.ppt/.xls)·.hwp 4종은 문서 변환 서비스
(workplace-converter) `POST /convert/text` HTTP 호출을 탄다(WP-433). converter 예외는 여기서
잡지 않고 호출측(main._run_extract)으로 올려 일시/영구 오류를 구분하게 한다.

지원 mime 목록은 api `com.workplace.fileai.ExtractableTypes` 와 1:1 미러다 —
한쪽만 고치면 드리프트(#735). 목록 변경 시 양쪽을 함께 수정한다.
"""
import io
from html.parser import HTMLParser
from xml.etree import ElementTree
from zipfile import ZipFile

from . import config, converter

# PDF·문서 mime — 이 형식만 DOC_MAX_BYTES 까지 받는다(WP-803). api FileUploadService 의 PDF·DOCUMENT 범주와 1:1 미러 —
# 한쪽만 고치면 25MB~100MB 문서가 추출 oversize 로 빠진다. 레거시 .xls 는 데이터 형식이라 변환기 형식에서 뺀다.
_DOC_MIMES: frozenset[str] = (converter.CONVERTER_MIMES - {"application/vnd.ms-excel"}) | {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/hwp+zip",
}


def max_bytes_for(mime: str) -> int:
    """mime 별 추출·렌더 입력 상한(바이트). PDF·문서는 DOC_MAX_BYTES, 그 밖은 MAX_BYTES."""
    return config.DOC_MAX_BYTES if mime in _DOC_MIMES else config.MAX_BYTES


class _HtmlTextStripper(HTMLParser):
    """HTML 마크업을 제거하고 텍스트 노드만 수집. script/style 내부 텍스트는 버린다.

    표준 라이브러리(html.parser)만 사용 — 신규 의존성 없음.
    """

    def __init__(self):
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0  # script/style 내부 깊이(중첩 대비 카운터)

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._chunks.append(data)

    def get_text(self) -> str:
        return " ".join(chunk.strip() for chunk in self._chunks if chunk.strip())


def _strip_html(data: bytes) -> str:
    """HTML 바이트 → 마크업 제거된 평문. 원문 그대로 넘기면 요약 토큰을 마크업이 잠식한다."""
    stripper = _HtmlTextStripper()
    stripper.feed(data.decode("utf-8", errors="replace"))
    return stripper.get_text().strip()


def _extract_pptx(data: bytes) -> str:
    """PPTX: python-pptx 로 슬라이드 텍스트 + 노트를 개행 결합."""
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    parts: list[str] = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text
                if text:
                    parts.append(text)
        # 노트가 없는 슬라이드도 있으므로 존재할 때만 수집.
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text
            if notes:
                parts.append(notes)
    return "\n".join(parts).strip()


def _extract_hwpx(data: bytes) -> str:
    """HWPX = ZIP + XML. Contents/section*.xml 의 모든 텍스트 노드를 수집.

    태그에 네임스페이스가 붙으므로(hp:t 등) 태그명으로 필터하지 않고
    표준 라이브러리(zipfile + xml.etree)만으로 전체 텍스트 노드를 순회한다.
    """
    parts: list[str] = []
    with ZipFile(io.BytesIO(data)) as zf:
        section_names = sorted(
            n for n in zf.namelist() if n.startswith("Contents/section") and n.endswith(".xml")
        )
        for name in section_names:
            root = ElementTree.fromstring(zf.read(name))
            for elem in root.iter():
                if elem.text and elem.text.strip():
                    parts.append(elem.text.strip())
    return "\n".join(parts).strip()


# 텍스트 계열 범용 처리에 포함되는 application/* mime(Global Constraints 표와 동일).
_TEXT_LIKE_APPLICATION_MIMES = (
    "application/json",
    "application/xml",
    "application/x-yaml",
    "application/yaml",
    "application/javascript",
    "application/x-sh",
)


def extract_text(data: bytes, mime: str, max_chars: int, page_markers: bool = False) -> dict:
    """
    파일 바이트를 받아 평문 텍스트를 추출한다.

    :param data: 파일 원본 바이트
    :param mime: MIME 타입 문자열
    :param max_chars: 최대 반환 문자 수 (초과 시 잘라냄)
    :param page_markers: True 면 PDF 에 [페이지 N] 표식을 넣는다(첨부 TEXT_ONLY 전용, WP-242).
                         False(기본)는 드라이브 FULL — 표식이 검색·요약·임베딩을 오염시키지 않도록 \n 으로만 잇는다.
    :return: {text, charCount, lang, truncated, pageCount}
             - text: 추출된 텍스트 (미지원 mime → "")
             - charCount: 반환된 text 길이 (I1: api ExtractResult.charCount 와 키 통일)
             - lang: 언어 코드(현재 미구현, None)
             - truncated: max_chars 초과로 잘렸으면 True
             - pageCount: PDF 만 전체 페이지 수, 그 외 None. 텍스트가 비어도(스캔 PDF) 유지해
               api 가 '페이지 이미지 보기'의 범위(WP-250)를 알 수 있게 한다.
    """
    text, page_count = _dispatch(data, mime, page_markers)
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    # I1 수정: 워커→api 콜백 페이로드 키를 charCount(camelCase)로 통일.
    # 이전 char_count(snake_case)는 Jackson 기본 설정으로 역직렬화 불가(null 폴백).
    return {"text": text, "charCount": len(text), "lang": None, "truncated": truncated, "pageCount": page_count}


def _dispatch(data: bytes, mime: str, page_markers: bool) -> tuple[str, int | None]:
    """mime 타입에 따라 적절한 파서를 선택해 (텍스트, 페이지 수) 추출. 페이지 수는 PDF 만, 그 외 None.

    api `ExtractableTypes` 와 1:1 미러 — 한쪽만 고치면 드리프트(#735).
    """
    if mime == "application/pdf":
        # PDF: pymupdf(fitz) 로 페이지별 텍스트를 뽑아 [페이지 N] 표식으로 잇는다(WP-242).
        # 표식은 첨부(page_markers=True)에만 — 드라이브 검색 오염 방지.
        # 모델이 출처 페이지를 말하고 후속 '페이지 이미지 보기'가 볼 페이지를 정하는 기준이다.
        # 모든 페이지가 비면(스캔 PDF) 표식만 남지 않도록 빈 문자열을 돌려 empty 판정을 유지한다.
        import fitz  # pymupdf
        with fitz.open(stream=data, filetype="pdf") as doc:
            pages = [page.get_text().strip() for page in doc]
        # 페이지 수는 텍스트 유무와 무관하게 돌려준다(스캔 PDF 도 이미지로 볼 수 있어야 함).
        page_count = len(pages)
        if not any(pages):
            return "", page_count
        if not page_markers:
            # 드라이브(FULL): 브랜치 이전 동작 — 표식 없이 페이지를 \n 으로만 잇는다.
            return "\n".join(pages).strip(), page_count
        parts = [pages[0]]
        for no, body in enumerate(pages[1:], start=2):
            parts.append(f"\n\n[페이지 {no}]\n\n{body}")
        return "".join(parts).strip(), page_count

    if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        # DOCX: python-docx 로 단락 텍스트 추출
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip(), None

    if mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        # XLSX: openpyxl 로 모든 시트 셀 값을 CSV 형태로 결합
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        rows = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                rows.append(",".join("" if c is None else str(c) for c in row))
        return "\n".join(rows).strip(), None

    if mime == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        # PPTX: python-pptx 로 슬라이드 텍스트 + 노트 추출
        return _extract_pptx(data), None

    if mime == "application/hwp+zip":
        # HWPX: ZIP+XML 표준 라이브러리 파싱
        return _extract_hwpx(data), None

    if mime in converter.CONVERTER_MIMES:
        # 레거시 OLE(.doc/.ppt/.xls)·.hwp: 문서 변환 서비스에 텍스트 변환 위임(예외는 호출측이 분류)
        return converter.convert_to_text(data, mime), None

    if mime == "text/html":
        # HTML: 범용 text/ 분기보다 먼저 처리 — 마크업 제거 후 텍스트만 남긴다.
        return _strip_html(data), None

    if mime.startswith("text/") or mime in _TEXT_LIKE_APPLICATION_MIMES:
        # 텍스트 계열: UTF-8 디코딩(오류 문자 대체)
        return data.decode("utf-8", errors="replace").strip(), None

    # 미지원 mime(이미지 등) → 빈 텍스트(호출측이 SKIPPED 판정)
    return "", None
