"""Office 엔진 — PPTX·PPT·DOC 를 PDF 로, 거기에 XLS 를 더해 텍스트로 바꾼다.

실제 변환은 상주 soffice(OFFICE) 에 맡기고, 이 모듈은 mime → (입력 확장자, 가져오기 필터) 매핑과
결과 검증(PDF 쪽수 계산·UTF-8 디코드)만 한다.

왜 가져오기 필터를 고정하나: LibreOffice 는 내용으로 형식을 자동 판별해서, 평문을 .pptx 로 저장한 파일도
텍스트 문서로 열어 '성공'시킨다. mime 이 말하는 형식으로만 열게 해 확장자만 바꾼 파일은 422 가 되게 한다.
"""
import pymupdf

from ..errors import convert_failed
from .result import PdfResult
from .soffice import OFFICE

PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PPT = "application/vnd.ms-powerpoint"
DOC = "application/msword"
XLS = "application/vnd.ms-excel"

# mime → (soffice 입력 파일 확장자, LibreOffice 가져오기 필터 이름)
_SPEC = {
    PPTX: (".pptx", "Impress MS PowerPoint 2007 XML"),
    PPT: (".ppt", "MS PowerPoint 97"),
    DOC: (".doc", "MS Word 97"),
    XLS: (".xls", "MS Excel 97"),
}
# PDF 미리보기 대상. XLS 는 시트 PDF 가 미리보기로 쓸모없어(쪽 분할이 제각각) 텍스트만 지원한다.
PDF_MIMES = (PPTX, PPT, DOC)
TEXT_MIMES = tuple(_SPEC)


def busy() -> bool:
    """상주 soffice 가 변환 중인지 — main 이 본문을 받기 전에 429 를 미리 판정한다(최종 판정은 OFFICE.convert)."""
    return OFFICE.busy()


def to_pdf(data: bytes | bytearray, mime: str) -> PdfResult:
    """Office 원본 → PDF. 쪽수는 pymupdf 로 센다. soffice 가 PDF 가 아니거나 0쪽인 결과를 내면 422.

    지원 mime 확인은 main 레지스트리가 맡는다(여기는 PDF_MIMES 만 등록된다).
    """
    suffix, filter_name = _SPEC[mime]
    pdf = OFFICE.convert(data, suffix, "pdf", filter_name=filter_name)
    try:
        with pymupdf.open(stream=pdf, filetype="pdf") as doc:
            page_count = doc.page_count
    except Exception as e:  # 깨진 출력 — 500 이 아닌 변환 실패로
        raise convert_failed() from e
    if page_count == 0:
        # 빈 PDF 는 미리보기로 쓸 수 없다 — 성공으로 넘기지 않는다
        raise convert_failed()
    return PdfResult(data=pdf, page_count=page_count)


def to_text(data: bytes | bytearray, mime: str) -> str:
    """Office 원본 → 평문(UTF-8). 헬퍼가 형식별로(Writer 필터·슬라이드 도형·시트 셀) 텍스트를 만든다.

    utf-8-sig: Writer 텍스트 필터가 붙이는 BOM 을 떼어 다른 형식의 결과와 맞춘다.
    """
    suffix, filter_name = _SPEC[mime]
    out = OFFICE.convert(data, suffix, "txt", filter_name=filter_name)
    return out.decode("utf-8-sig", "replace")
