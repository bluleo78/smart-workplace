"""상주 soffice 에 UNO 소켓으로 붙어 문서 1건을 변환하는 독립 스크립트.

시스템 파이썬(/usr/bin/python3, python3-uno 설치)으로 실행된다 — 앱 파이썬에서는 `import uno` 가 안 되므로
app 패키지를 import 하지 않는다(표준 라이브러리 + uno 만).

사용: python3 uno_helper.py --port 2002 --in <원본> --out <결과> --target pdf|txt [--filter <가져오기 필터>]
동작: 문서 로드(숨김·매크로 금지·외부 링크 갱신 금지·읽기 전용, --filter 를 주면 그 필터로만) → 모든 문단 ParaIsCharacterDistance=False
      → 내보내기 → 닫기. 실패 시 stderr 한 줄 + 종료코드:
      2 = 문서 로드·변환 실패(입력 문제 — soffice 는 정상), 3 = soffice 연결 실패 또는 변환 중 연결이 끊김(인프라).
      호출자(soffice.py)는 2 는 422 로, 3 은 503 + soffice 내리기로 처리한다.

왜 ParaIsCharacterDistance 를 끄나: LibreOffice 는 기본으로 아시아 문자와 비아시아 문자(영문·숫자) 사이에
간격을 넣어 "2,603명" 이 "2,603 명" 처럼 렌더링·추출된다. PowerPoint/Word 원본에는 없는 공백이라 끈다.
"""
import argparse
import os
import sys
import time

import uno
from com.sun.star.beans import PropertyValue

# 종료코드(soffice.py 와 맞춘다): 2 = 입력 문제, 3 = soffice 연결 실패·끊김
RC_BAD_INPUT = 2
RC_UNAVAILABLE = 3
# 연결 재시도 시간(초) — soffice 가 포트는 열었지만 UNO 초기화가 덜 끝난 순간을 견딘다
CONNECT_WAIT_SEC = 10


def _pv(name, value):
    """UNO PropertyValue 하나를 만든다."""
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def _connect(port):
    """상주 soffice 의 Desktop 을 얻는다. 접속 실패가 이어지면 마지막 예외를 그대로 던진다."""
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    url = f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    deadline = time.monotonic() + CONNECT_WAIT_SEC
    while True:
        try:
            ctx = resolver.resolve(url)
            break
        except Exception:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.3)
    return ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)


# ---- 문단 자동 공백 끄기 ----

def _fix_text(text):
    """XText 안의 모든 문단에 ParaIsCharacterDistance=False. Writer 표는 셀 텍스트로 재귀한다."""
    if text is None:
        return
    en = text.createEnumeration()
    while en.hasMoreElements():
        el = en.nextElement()
        if el.supportsService("com.sun.star.text.TextTable"):
            for name in el.getCellNames():
                _fix_text(el.getCellByName(name).getText())
            continue
        try:
            el.setPropertyValue("ParaIsCharacterDistance", False)
        except Exception:
            pass  # 속성이 없는 요소(구역 등)는 건너뛴다


def _fix_writer(doc):
    """Writer: 본문·표 셀·글상자·머리글/바닥글. 문단 스타일 기본값도 함께 꺼서 빠진 곳을 줄인다."""
    styles = doc.getStyleFamilies()
    paras = styles.getByName("ParagraphStyles")
    for name in paras.getElementNames():
        try:
            paras.getByName(name).setPropertyValue("ParaIsCharacterDistance", False)
        except Exception:
            pass
    _fix_text(doc.getText())
    frames = doc.getTextFrames()
    for name in frames.getElementNames():
        _fix_text(frames.getByName(name).getText())
    pages = styles.getByName("PageStyles")
    for name in pages.getElementNames():
        st = pages.getByName(name)
        for prop in ("HeaderText", "HeaderTextLeft", "HeaderTextFirst",
                     "FooterText", "FooterTextLeft", "FooterTextFirst"):
            try:
                _fix_text(st.getPropertyValue(prop))
            except Exception:
                pass  # 해당 머리글/바닥글이 없거나 이 버전에 없는 속성


def _walk_shapes(shapes, on_text):
    """도형 컬렉션을 돌며 텍스트를 가진 도형마다 on_text(XText) 호출. 그룹은 재귀, 표는 셀마다."""
    for i in range(shapes.getCount()):
        s = shapes.getByIndex(i)
        # 표 도형은 supportsService("...TableShape") 가 False 라(실측) 종류는 ShapeType 으로 판별한다
        kind = s.getShapeType()
        if kind == "com.sun.star.drawing.GroupShape":
            _walk_shapes(s, on_text)
            continue
        if kind == "com.sun.star.drawing.TableShape":
            model = s.getPropertyValue("Model")
            for r in range(model.getRows().getCount()):
                for c in range(model.getColumns().getCount()):
                    on_text(model.getCellByPosition(c, r).getText())
            continue
        if hasattr(s, "getText"):
            try:
                on_text(s.getText())
            except Exception:
                pass


def _fix_impress(doc):
    """Impress: 모든 슬라이드 + 마스터 페이지(바닥글·제목 자리표시자 서식이 마스터에 있음)의 텍스트 도형 문단."""
    for coll in (doc.getDrawPages(), doc.getMasterPages()):
        for i in range(coll.getCount()):
            _walk_shapes(coll.getByIndex(i), _fix_text)


# ---- 텍스트 추출(Impress·Calc 는 필터 대신 직접 모은다) ----

def _impress_text(doc):
    """슬라이드 순서대로 도형 텍스트를 모은다(마스터는 반복 문구라 제외). 슬라이드 사이는 빈 줄."""
    slides = doc.getDrawPages()
    chunks = []
    for i in range(slides.getCount()):
        parts = []
        _walk_shapes(slides.getByIndex(i), lambda t: parts.append(t.getString()))
        chunks.append("\n".join(p for p in parts if p.strip()))
    return "\n\n".join(chunks)


def _cell_str(v, sheet, c, r):
    """getDataArray 값 → 문자열. 숫자는 float 로 오므로 정수값은 '.0' 없이 쓴다.

    수식 오류 셀(#DIV/0! 등)은 값이 None 으로 오므로 그 셀만 개별 조회로 표시 문자열을 얻는다(드물어 비용 무시).
    """
    if v is None:
        return sheet.getCellByPosition(c, r).getString()
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def _calc_text(doc):
    """시트마다 사용 영역 값을 탭 구분 행으로 모은다. 시트 사이는 빈 줄.

    셀마다 UNO 왕복하면 큰 시트에서 수십만 번 호출이 되므로 사용 영역을 getDataArray 한 번으로 읽는다.
    대가: 표시 서식(날짜·백분율·통화 등)은 사라지고 원값(날짜는 일련번호)이 나온다 — 검색·요약용이라 감수한다.
    """
    sheets = doc.getSheets()
    chunks = []
    for i in range(sheets.getCount()):
        sheet = sheets.getByIndex(i)
        cur = sheet.createCursor()
        cur.gotoEndOfUsedArea(False)
        addr = cur.getRangeAddress()
        # 인자 순서: 왼쪽 열, 위 행, 오른쪽 열, 아래 행
        rows = sheet.getCellRangeByPosition(0, 0, addr.EndColumn, addr.EndRow).getDataArray()
        lines = ["\t".join(_cell_str(v, sheet, c, r) for c, v in enumerate(row)).rstrip("\t")
                 for r, row in enumerate(rows)]
        while lines and not lines[-1]:
            lines.pop()
        chunks.append("\n".join(lines))
    return "\n\n".join(chunks)


def _writer_text(doc, out, out_url):
    """Writer: 텍스트 필터로 바로 저장(BOM 이 붙을 수 있어 앱 쪽에서 utf-8-sig 로 읽는다)."""
    doc.storeToURL(out_url, (_pv("FilterName", "Text (encoded)"), _pv("FilterOptions", "UTF8")))


def _text_writer(collect):
    """collect(doc) 로 모은 문자열을 out 파일에 UTF-8 로 쓰는 텍스트 내보내기 함수를 만든다(Impress·Calc)."""
    def write(doc, out, _out_url):
        with open(out, "w", encoding="utf-8") as f:
            f.write(collect(doc))
    return write


# 문서 서비스 → (자동 공백 끄기, PDF 내보내기 필터, 텍스트 내보내기). Calc 는 셀 값이라 자동 공백 처리가 없다.
_KINDS = (
    ("com.sun.star.text.TextDocument", _fix_writer, "writer_pdf_Export", _writer_text),
    ("com.sun.star.presentation.PresentationDocument", _fix_impress, "impress_pdf_Export",
     _text_writer(_impress_text)),
    ("com.sun.star.sheet.SpreadsheetDocument", None, "calc_pdf_Export", _text_writer(_calc_text)),
)


def _convert(desktop, src, out, target, filter_name=None):
    """문서 1건 로드 → 문단 자동 공백 끄기 → target 으로 내보내기.

    filter_name 을 주면 FilterName 으로 고정해 내용 자동 판별을 끈다 — 형식이 맞지 않는 파일은 로드 실패가 된다.
    """
    in_url = uno.systemPathToFileUrl(src)
    out_url = uno.systemPathToFileUrl(out)
    # 매크로 실행 금지(MacroExecutionMode=0 NEVER_EXECUTE)·외부 링크 갱신 금지(UpdateDocMode=0 NO_UPDATE)
    props = [_pv("Hidden", True), _pv("MacroExecutionMode", 0), _pv("UpdateDocMode", 0), _pv("ReadOnly", True)]
    if filter_name:
        props.append(_pv("FilterName", filter_name))
    doc = desktop.loadComponentFromURL(in_url, "_blank", 0, tuple(props))
    if doc is None:
        raise RuntimeError("문서를 열 수 없음")
    try:
        kind = next((k for k in _KINDS if doc.supportsService(k[0])), None)
        if kind is None:
            raise RuntimeError("지원하지 않는 문서 종류")
        _service, fix, pdf_filter, write_text = kind
        if fix is not None:
            fix(doc)
        if target == "pdf":
            doc.storeToURL(out_url, (_pv("FilterName", pdf_filter),))
        else:
            write_text(doc, out, out_url)
    finally:
        # 닫기 실패가 본문의 원래 예외를 덮지 않게 따로 잡는다(성공 후 닫기 실패는 기록만)
        try:
            doc.close(True)
        except Exception as e:
            sys.stderr.write(f"close 실패: {type(e).__name__}\n")


def _fail(e, rc):
    """UNO 예외는 다양하므로 한 줄 요약만 stderr 에 남기고 종료코드를 돌려준다."""
    msg = " ".join(f"{type(e).__name__}: {e}".split())
    sys.stderr.write(msg[:500] + "\n")
    return rc


def _bridge_alive(desktop):
    """변환 실패 뒤 soffice 연결이 살아 있는지 — 가벼운 UNO 호출 하나로 확인한다."""
    try:
        desktop.getComponents()
        return True
    except Exception:
        return False


def main(argv=None):
    """인자를 읽어 변환을 실행한다. 연결 실패(·변환 중 연결 끊김)는 종료코드 3, 문서 로드·변환 실패는 2."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", choices=("pdf", "txt"), required=True)
    # 선택: 가져오기 필터 이름. 없으면 LibreOffice 자동 판별(기존 동작)
    ap.add_argument("--filter", dest="filter_name", default=None)
    args = ap.parse_args(argv)
    try:
        desktop = _connect(args.port)
    except Exception as e:
        return _fail(e, RC_UNAVAILABLE)
    try:
        _convert(desktop, args.src, args.out, args.target, args.filter_name)
    except Exception as e:
        # 변환 중 soffice 가 죽으면 브리지 예외로 여기 온다 — 입력 문제가 아니므로 3 으로 구분
        return _fail(e, RC_BAD_INPUT if _bridge_alive(desktop) else RC_UNAVAILABLE)
    return 0


if __name__ == "__main__":
    rc = main()
    # 정상 인터프리터 종료(Py_Finalize)를 건너뛴다 — 원격 브리지를 쥔 pyuno 가 종료 정리 중 가끔(~1%) SIGSEGV 로 죽어,
    # 변환은 끝나 결과 파일이 써졌는데도 종료코드 -11 이 되어 호출자가 503 으로 처리하고 soffice 까지 내린다.
    # 결과는 이미 파일·stderr 로 다 냈으므로 버퍼만 비우고 바로 끝낸다.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(rc)
