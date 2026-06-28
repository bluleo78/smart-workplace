"""
extract_text 순수 함수 단위 테스트.
txt/csv 는 인라인 바이트, docx/xlsx 는 라이브러리로 생성.
"""
import pytest
from app.extract import extract_text


def test_plain_text():
    """일반 텍스트 추출 + charCount 검증(I1: snake→camelCase 통일)."""
    r = extract_text(b"hello world", "text/plain", max_chars=1000)
    assert r["text"] == "hello world"
    assert r["charCount"] == 11  # I1: char_count → charCount
    assert r["truncated"] is False


def test_csv_text():
    """CSV는 text/ prefix로 일반 텍스트 처리."""
    r = extract_text(b"a,b\n1,2", "text/csv", max_chars=1000)
    assert "a,b" in r["text"]


def test_truncation():
    """max_chars 초과 시 잘라내고 truncated=True."""
    r = extract_text(b"x" * 5000, "text/plain", max_chars=100)
    assert r["charCount"] == 100  # I1: char_count → charCount
    assert r["truncated"] is True


def test_unsupported_mime_returns_empty():
    """미지원 mime → 빈 텍스트 반환(호출측이 SKIPPED 판정)."""
    r = extract_text(b"\x00\x01", "application/octet-stream", max_chars=1000)
    assert r["text"] == ""


def test_docx(tmp_path):
    """docx 파일에서 본문 단락 추출."""
    from docx import Document
    p = tmp_path / "d.docx"
    doc = Document()
    doc.add_paragraph("도큐먼트 본문")
    doc.save(p)
    r = extract_text(
        p.read_bytes(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        max_chars=1000,
    )
    assert "도큐먼트 본문" in r["text"]


def test_xlsx(tmp_path):
    """xlsx 파일에서 셀 값 추출."""
    from openpyxl import Workbook
    p = tmp_path / "s.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.append(["이름", "점수"])
    ws.append(["홍길동", 100])
    wb.save(p)
    r = extract_text(
        p.read_bytes(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        max_chars=1000,
    )
    assert "이름" in r["text"]
    assert "홍길동" in r["text"]
