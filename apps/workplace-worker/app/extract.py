"""파일 바이트에서 평문 텍스트를 추출. mime 별 라이브러리 분기. 순수 함수(외부 IO 없음)."""
import io


def extract_text(data: bytes, mime: str, max_chars: int) -> dict:
    """
    파일 바이트를 받아 평문 텍스트를 추출한다.

    :param data: 파일 원본 바이트
    :param mime: MIME 타입 문자열
    :param max_chars: 최대 반환 문자 수 (초과 시 잘라냄)
    :return: {text, charCount, lang, truncated}
             - text: 추출된 텍스트 (미지원 mime → "")
             - charCount: 반환된 text 길이 (I1: api ExtractResult.charCount 와 키 통일)
             - lang: 언어 코드(현재 미구현, None)
             - truncated: max_chars 초과로 잘렸으면 True
    """
    text = _dispatch(data, mime)
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    # I1 수정: 워커→api 콜백 페이로드 키를 charCount(camelCase)로 통일.
    # 이전 char_count(snake_case)는 Jackson 기본 설정으로 역직렬화 불가(null 폴백).
    return {"text": text, "charCount": len(text), "lang": None, "truncated": truncated}


def _dispatch(data: bytes, mime: str) -> str:
    """mime 타입에 따라 적절한 파서를 선택해 텍스트 추출."""
    if mime == "application/pdf":
        # PDF: pymupdf(fitz) 로 페이지별 텍스트 결합
        import fitz  # pymupdf
        with fitz.open(stream=data, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc).strip()

    if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        # DOCX: python-docx 로 단락 텍스트 추출
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip()

    if mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        # XLSX: openpyxl 로 모든 시트 셀 값을 CSV 형태로 결합
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        rows = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                rows.append(",".join("" if c is None else str(c) for c in row))
        return "\n".join(rows).strip()

    if mime.startswith("text/") or mime in ("application/json", "application/xml"):
        # 텍스트 계열: UTF-8 디코딩(오류 문자 대체)
        return data.decode("utf-8", errors="replace").strip()

    # 미지원 mime → 빈 텍스트(호출측이 SKIPPED 판정)
    return ""
