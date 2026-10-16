"""PDF 엔진 결과 타입."""
from dataclasses import dataclass


@dataclass
class PdfResult:
    """변환된 PDF 바이트와 쪽수. 쪽수는 응답 헤더 X-Page-Count 와 MAX_PAGES 검사에 쓰인다."""
    data: bytes
    page_count: int
