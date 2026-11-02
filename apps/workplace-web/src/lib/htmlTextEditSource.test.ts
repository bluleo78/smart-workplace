// @vitest-environment jsdom
// WP-1309 — HTML 글자 고치기의 되돌리기(직렬화). 편집 화면 문서 만들기(번호·지문), 고친 것을 원본에 되돌리기(고친 요소만 바뀌고
// 스크립트·런타임 DOM·머리말은 그대로), 정리기(허용한 인라인 서식만)를 본다. iframe 안 클릭·붙여넣기는 E2E(@input).
import { describe, expect, it } from 'vitest'

import {
  applyHtmlTextEdits,
  HTML_EDIT_SIG_ATTR,
  HTML_EDIT_SRC_ATTR,
  htmlTextSignature,
  prepareHtmlTextEdit,
  sanitizeEditedHtml,
} from './htmlTextEditSource'

const DOC = [
  '<!DOCTYPE html>',
  '<!-- 아티팩트 -->',
  '<html lang="ko"><head><meta charset="utf-8"><title>3분기 회고</title>',
  '<style>.card{border:1px solid #ccc}</style>',
  '<script src="https://cdn.example.com/chart.js"></script></head>',
  '<body>',
  '<h1 class="title">3분기 회고</h1>',
  '<p>출시·운영 <b class="em">요약</b>입니다.</p>',
  '<div class="cards"><div class="card"><div class="label">출시</div><div class="v" id="n">4건</div></div></div>',
  '<div id="chart"></div>',
  '<script>document.getElementById("chart").innerHTML = "<svg><rect></rect></svg>"; document.getElementById("n").textContent = "5건"</script>',
  '</body></html>',
].join('\n')

/** 편집 화면 문서를 파싱해 번호 → 요소로 찾는다(iframe 이 보는 문서와 같은 것). */
function prepared(source: string) {
  const { html, editable } = prepareHtmlTextEdit(source)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const find = (sel: string) => (doc.querySelector(sel) ?? tpl.content.querySelector(sel)) as Element
  const index = (sel: string) => find(sel).getAttribute(HTML_EDIT_SRC_ATTR)!
  return { html, editable, find, index }
}

describe('편집 화면 문서(prepareHtmlTextEdit)', () => {
  it('원본의 모든 요소에 번호를, 글자를 고칠 수 있는 가장 바깥 요소에만 글자 지문을 단다', () => {
    const p = prepared(DOC)
    expect(p.find('html').getAttribute(HTML_EDIT_SRC_ATTR)).toBe('0')
    expect(p.find('script').hasAttribute(HTML_EDIT_SRC_ATTR)).toBe(true)
    // 제목·문단·카드 글자(label·v)가 고칠 단위 — 문단 안 <b> 는 문단 하나로 묶인다.
    expect(p.find('h1').getAttribute(HTML_EDIT_SIG_ATTR)).toBe(htmlTextSignature('3분기 회고'))
    expect(p.find('p').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(true)
    expect(p.find('p b').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(false)
    expect(p.find('.label').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(true)
    expect(p.find('#n').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(true)
    // 블록 자식을 담은 묶음·빈 차트 자리·스크립트·머리는 고칠 단위가 아니다.
    for (const sel of ['.card', '.cards', '#chart', 'script', 'title', 'body']) expect(p.find(sel).hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(false)
    expect(p.editable).toBe(4)
    // DOCTYPE·앞 주석은 원본 글자 그대로.
    expect(p.html.startsWith('<!DOCTYPE html>\n<!-- 아티팩트 -->\n<html')).toBe(true)
  })

  it('원본에 미리 달린 지문 속성은 지운다 — 원본이 스스로 「고칠 수 있다」고 표시하지 못한다', () => {
    const p = prepared(`<div ${HTML_EDIT_SIG_ATTR}="x"><p>a</p><p>b</p></div><button>누름</button>`)
    expect(p.find('div').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(false)
    // 단추 글자는 고치지 않는다(누르면 동작한다).
    expect(p.find('button').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(false)
  })

  it('svg 안 글자(차트 이름표)는 고치지 않는다', () => {
    const p = prepared('<svg><text>9월</text><a href="#"><text>링크</text></a></svg><p>본문</p>')
    expect(p.editable).toBe(1)
    expect(p.find('p').hasAttribute(HTML_EDIT_SIG_ATTR)).toBe(true)
  })

  // WP-1290 × WP-1309 — 노트 스크립트가 멈춘 채 띄우는 편집 화면은 띄울 사본에서 문서가 스스로 움직일 길을 걷는다(저장은 깨끗한 원본으로).
  it('inertPage 면 띄울 사본에서 스크립트·noscript·자동 이동·인라인 이벤트·링크 target 을 걷고, 되돌리기는 원본 그대로 쓴다', () => {
    const src =
      '<!DOCTYPE html><html><head><meta http-equiv="Refresh" content="0;url=data:text/html,x"><script>run()</script></head>' +
      '<body onload="init()"><noscript><p title="</noscript><script>x()</script>">대체</p></noscript>' +
      '<p onclick="go()">본문</p><a href="data:text/html,y" target="_self">링크</a></body></html>'
    const p = prepareHtmlTextEdit(src, { inertPage: true })
    expect(p.html).not.toMatch(/<script|<noscript|http-equiv|onload|onclick|target=/i)
    // 번호는 걷기 전에 달아 남은 요소의 번호가 원본과 같다 — 고친 것은 원본(스크립트 포함)에 되돌린다.
    const doc = new DOMParser().parseFromString(p.html, 'text/html')
    const para = doc.querySelector(`p[${HTML_EDIT_SIG_ATTR}]`)!
    const out = p.apply([{ ref: `s:${para.getAttribute(HTML_EDIT_SRC_ATTR)}`, html: '고친 본문' }])
    expect(out).toContain('<script>run()</script>')
    expect(out).toContain('<p onclick="go()">고친 본문</p>')
    expect(out).toContain('http-equiv="Refresh"')
  })

  it('inertPage 가 아니면(노트 스크립트 실행 중) 문서 스크립트를 그대로 띄운다', () => {
    expect(prepareHtmlTextEdit('<p onclick="go()">a</p><script>run()</script>').html).toMatch(/onclick="go\(\)"[\s\S]*<script data-wp-src="1">run\(\)<\/script>/)
  })
})

describe('되돌리기(applyHtmlTextEdits)', () => {
  it('고친 요소의 글자만 바뀌고, 스크립트·머리·DOCTYPE·다른 요소는 그대로다 — 다시 열면 스크립트가 그대로 돈다', () => {
    const p = prepared(DOC)
    const out = applyHtmlTextEdits(DOC, [{ ref: `s:${p.index('h1')}`, html: '3분기 회고 (최종)' }])
    expect(out).toContain('<h1 class="title">3분기 회고 (최종)</h1>')
    expect(out.startsWith('<!DOCTYPE html>\n<!-- 아티팩트 -->\n<html lang="ko">')).toBe(true)
    expect(out).toContain('<script src="https://cdn.example.com/chart.js"></script>')
    expect(out).toContain('document.getElementById("chart").innerHTML = "<svg><rect></rect></svg>"')
    // 런타임 DOM(스크립트가 그린 svg)·편집 표지는 들어가지 않는다.
    expect(out).toContain('<div id="chart"></div>')
    expect(out).not.toContain(HTML_EDIT_SRC_ATTR)
    expect(out).not.toContain(HTML_EDIT_SIG_ATTR)
    expect(out).not.toContain('contenteditable')
    expect(out).toContain('<div class="v" id="n">4건</div>')
  })

  it('고친 것이 없거나 글자가 그대로면 원본 글자를 그대로 돌려준다(직렬화 모양 차이도 없다)', () => {
    const src = "<p class='x'>a<br/>b</p><script>1</script>"
    expect(applyHtmlTextEdits(src, [])).toBe(src)
    const p = prepared(src)
    expect(applyHtmlTextEdits(src, [{ ref: `s:${p.index('p')}`, html: 'a<br>b' }])).toBe(src)
  })

  it('</html> 뒤 주석은 고친 뒤에도 남는다 — 파서가 문서 바로 아래에 둬 outerHTML 에 들어가지 않는 노드', () => {
    const src = '<!DOCTYPE html>\n<html><body><p>안녕</p></body></html>\n<!-- 끝 -->'
    const p = prepared(src)
    const out = applyHtmlTextEdits(src, [{ ref: `s:${p.index('p')}`, html: '안녕하세요' }])
    expect(out).toContain('<p>안녕하세요</p>')
    expect(out.endsWith('</html><!-- 끝 -->')).toBe(true)
  })

  it('원본 안 서식 요소는 iframe 이 보낸 번호로 원본 속성째 되살리고, 새 서식은 허용한 것만 남긴다', () => {
    const p = prepared(DOC)
    const b = p.index('p b')
    const html = `출시 <b class="em" ${HTML_EDIT_SRC_ATTR}="${b}">요약</b> <i>강조</i> <span style="color: rgb(220, 38, 38); font-size: 30px" class="x">빨강</span> <a href="javascript:alert(1)">나쁨</a> <a href="https://ex.com/a" onclick="x()">좋음</a><img src=x onerror="alert(1)">`
    const out = applyHtmlTextEdits(DOC, [{ ref: `s:${p.index('p')}`, html }])
    expect(out).toContain(
      '<p>출시 <b class="em">요약</b> <i>강조</i> <span style="color: rgb(220, 38, 38)">빨강</span> 나쁨 <a href="https://ex.com/a">좋음</a></p>',
    )
  })

  it('스크립트·스타일처럼 고칠 수 없는 요소의 번호로 온 것은 버린다(iframe 스크립트가 흉내 내도 원본이 다치지 않는다)', () => {
    const p = prepared(DOC)
    const out = applyHtmlTextEdits(DOC, [
      { ref: `s:${p.index('body > script')}`, html: 'alert(1)' },
      { ref: `s:${p.index('style')}`, html: 'body{display:none}' },
      { ref: `s:${p.index('.card')}`, html: '<b>덮어쓰기</b>' },
      { ref: 's:99999', html: 'x' },
    ])
    expect(out).toBe(DOC)
  })

  it('새 문단은 앞 요소 뒤에 같은 class 로 들어가고, 이어 만든 새 문단은 그 뒤에 온다 — 빈 새 문단은 넣지 않는다', () => {
    const src = '<div class="wrap"><p class="lead">첫 문단</p><ul><li>하나</li></ul></div>'
    const p = prepared(src)
    const out = applyHtmlTextEdits(src, [
      { ref: `s:${p.index('p')}`, html: '첫' },
      { ref: 'n:a1', after: `s:${p.index('p')}`, cls: 'lead', html: '<br>' },
      { ref: 'n:a2', after: 'n:a1', cls: 'lead', html: '둘째 <b>문단</b>' },
      { ref: 'n:a3', after: `s:${p.index('li')}`, html: '둘' },
      { ref: 'n:a4', after: `s:${p.index('li')}`, cls: 'x" onclick="y', html: 'class 거름' },
    ])
    expect(out).toBe(
      '<div class="wrap"><p class="lead">첫</p><p class="lead">둘째 <b>문단</b></p><ul><li>하나</li><li>class 거름</li><li>둘</li></ul></div>',
    )
  })

  it('조각 소스(노트 HTML 블록)는 앞의 <style>·<script> 순서를 그대로 두고 조각으로 돌려준다', () => {
    const src = '<style>h1{color:red}</style>\n<h1>제목</h1>\n<script>window.x=1</script>'
    const p = prepared(src)
    const out = applyHtmlTextEdits(src, [{ ref: `s:${p.index('h1')}`, html: '새 제목' }])
    expect(out).toBe('<style>h1{color:red}</style>\n<h1>새 제목</h1>\n<script>window.x=1</script>')
  })

  it('안쪽과 바깥 요소가 함께 오면 바깥(최신 화면)이 이긴다', () => {
    const src = '<div><span>a</span> 글</div>'
    const p = prepared(src)
    // div 는 인라인만 담아 div 가 고칠 단위, span 은 아니다 — span 번호로 온 것은 버린다.
    const out = applyHtmlTextEdits(src, [
      { ref: `s:${p.index('span')}`, html: '무시' },
      { ref: `s:${p.index('div')}`, html: `<span ${HTML_EDIT_SRC_ATTR}="${p.index('span')}">b</span> 글` },
    ])
    expect(out).toBe('<div><span>b</span> 글</div>')
  })

  it('편집 화면의 apply 는 한 번 파싱한 원본의 사본에 되돌린다 — applyHtmlTextEdits 와 같은 결과, 같은 고친 것이면 앞 결과를 그대로 돌려준다', () => {
    const session = prepareHtmlTextEdit(DOC)
    const p = prepared(DOC)
    const edits = [{ ref: `s:${p.index('h1')}`, html: '3분기 회고 (최종)' }]
    const first = session.apply(edits)
    expect(first).toBe(applyHtmlTextEdits(DOC, edits))
    expect(first).not.toContain('data-wp-')
    // 같은 항목 객체면 다시 직렬화하지 않는다(같은 글자 객체). 다른 고친 것은 깨끗한 원본에서 새로 — 앞 고침이 쌓이지 않는다.
    expect(session.apply([...edits])).toBe(first)
    const other = session.apply([{ ref: `s:${p.index('p')}`, html: '바뀐 문단' }])
    expect(other).toContain('바뀐 문단')
    expect(other).not.toContain('(최종)')
    expect(session.apply([])).toBe(DOC)
  })
})

describe('서식 도구 결과가 보이는 대로 저장된다(execCommand 출력)', () => {
  /** 원본 하나를 띄워 sel 요소를 html 로 고친 뒤 저장 결과를 돌려준다. */
  const edit = (src: string, sel: string, html: (index: (s: string) => string) => string) => {
    const p = prepared(src)
    return applyHtmlTextEdits(src, [{ ref: `s:${p.index(sel)}`, html: html(p.index) }])
  }

  it('이미 굵은 제목에서 「굵게」로 굵게를 끈 글자는 <span style="font-weight: normal"> 로 남는다 — 다시 열어도 보통 굵기', () => {
    // 크롬 execCommand('bold') 가 <h1> 안에서 만드는 꼴(끝 세미콜론 포함). 400 도 같은 뜻이다.
    expect(edit('<h1>3분기 회고</h1>', 'h1', () => '<span style="font-weight: normal;">3분기</span> 회고')).toBe(
      '<h1><span style="font-weight: normal">3분기</span> 회고</h1>',
    )
    expect(edit('<h2>제목</h2>', 'h2', () => '<span style="font-weight: 400">제목</span>')).toBe('<h2><span style="font-weight: normal">제목</span></h2>')
  })

  it('기울임 스타일 안에서 「기울임」으로 끈 글자는 <span style="font-style: normal"> 로 남는다', () => {
    const src = '<style>.q{font-style:italic}</style><p class="q">인용 문장</p>'
    expect(edit(src, 'p', () => '<span style="font-style: normal;">인용</span> 문장')).toBe(
      '<style>.q{font-style:italic}</style><p class="q"><span style="font-style: normal">인용</span> 문장</p>',
    )
  })

  it('끄기 값은 엄격하다 — lighter·숫자 굵기·그 밖의 CSS 는 버리고, 글자색과 함께 오면 span 하나로 합친다', () => {
    expect(
      edit('<h1>a b c</h1>', 'h1', () =>
        '<span style="font-weight: lighter">a</span> <span style="font-weight: 300; font-size: 40px">b</span> <span style="color: rgb(37, 99, 235); font-weight: normal; font-style: normal; background: url(x)">c</span>',
      ),
    ).toBe('<h1>a b <span style="color: rgb(37, 99, 235); font-weight: normal; font-style: normal">c</span></h1>')
  })

  it('굵게·기울임·색 — b/strong, styleWithCSS 의 span style, <font color> 가 모두 같은 꼴로 남는다', () => {
    const html = [
      '<b>a</b><strong>b</strong><span style="font-weight: bold;">c</span>',
      '<span style="font-weight: 700; color: rgb(220, 38, 38);">d</span><font color="#2563eb">e</font>',
      '<span style="color: rgb(22, 163, 74);">f</span><i>g</i><em>h</em><span style="font-style: italic;">i</span>',
    ].join('')
    expect(edit('<p>x</p>', 'p', () => html)).toBe(
      '<p><b>a</b><strong>b</strong><b>c</b><b><span style="color: rgb(220, 38, 38)">d</span></b><span style="color: #2563eb">e</span>' +
        '<span style="color: rgb(22, 163, 74)">f</span><i>g</i><em>h</em><i>i</i></p>',
    )
  })

  it('편집 경로의 <b style="font-weight:normal"> 은 굵게가 아니라 굵게 끄기로 남는다(iframe 에서 보통 굵기로 보였다)', () => {
    expect(edit('<h1>제목</h1>', 'h1', () => '<b style="font-weight: normal">제목</b>')).toBe('<h1><span style="font-weight: normal">제목</span></h1>')
  })

  it('브라우저가 원본 span 의 style 에 서식을 넣었으면, 원본 속성은 그대로 두고 안쪽에 달라진 서식만 더한다', () => {
    const src = '<h1>a <span class="k" style="color: #111827">b</span></h1>'
    const out = edit(src, 'h1', (index) => `a <span class="k" style="color: rgb(220, 38, 38); font-weight: normal;" ${HTML_EDIT_SRC_ATTR}="${index('span')}">b</span>`)
    expect(out).toBe('<h1>a <span class="k" style="color: #111827"><span style="color: rgb(220, 38, 38); font-weight: normal">b</span></span></h1>')
    // 서식이 원본과 같으면 더하지 않는다.
    expect(edit(src, 'h1', (index) => `a <span class="k" style="color: #111827" ${HTML_EDIT_SRC_ATTR}="${index('span')}">c</span>`)).toBe(
      '<h1>a <span class="k" style="color: #111827">c</span></h1>',
    )
  })

  it('붙여넣기 정리는 끄기 값을 버린다 — 웹에서 복사한 span 마다 달린 font-weight: 400·font-style: normal 이 붙인 곳 모양을 깨지 않게', () => {
    expect(sanitizeEditedHtml('<span style="font-weight: 400; font-style: normal; color: #dc2626">a</span><span style="font-weight: normal">b</span>')).toBe(
      '<span style="color: #dc2626">a</span>b',
    )
  })
})

describe('정리기(sanitizeEditedHtml)', () => {
  it('웹에서 붙인 HTML — 굵게·기울임·링크·글자색은 남기고 블록은 줄바꿈으로 풀고 스크립트·스타일·주석은 버린다', () => {
    const html = [
      '<meta charset="utf-8"><style>p{color:red}</style><!--StartFragment-->',
      '<h2 style="font-size:20px">제목</h2><p>본문 <strong>굵게</strong> <em>기울임</em>',
      '<span style="font-weight:700;font-style:italic;color:#2563eb;font-family:Arial">모양</span></p>',
      '<p><a href="mailto:a@b.c">메일</a> <a href="data:text/html,x">데이터</a><script>alert(1)</script></p><!--EndFragment-->',
    ].join('')
    expect(sanitizeEditedHtml(html)).toBe(
      '제목<br>본문 <strong>굵게</strong> <em>기울임</em><b><i><span style="color: #2563eb">모양</span></i></b><br><a href="mailto:a@b.c">메일</a> 데이터',
    )
  })

  it('Google Docs 처럼 전체를 감싼 <b style="font-weight:normal"> 은 굵게로 치지 않고, <font color> 는 글자색으로 옮긴다', () => {
    expect(sanitizeEditedHtml('<b style="font-weight:normal;" id="docs-internal-guid-1"><span>보통</span></b>')).toBe('보통')
    expect(sanitizeEditedHtml('<font color="#dc2626">빨강</font>')).toBe('<span style="color: #dc2626">빨강</span>')
    // 색 값에 url()·식은 받지 않는다.
    expect(sanitizeEditedHtml('<span style="color: url(javascript:x)">a</span>')).toBe('a')
  })

  it('번호 속성은 버리고(붙인 내용은 원본 요소가 아니다), 빈 칸 자리표 <br> 하나는 비운다', () => {
    expect(sanitizeEditedHtml(`<b ${HTML_EDIT_SRC_ATTR}="3" class="x">a</b>`)).toBe('<b>a</b>')
    expect(sanitizeEditedHtml('<br>')).toBe('')
    expect(sanitizeEditedHtml('a<br><br>')).toBe('a<br><br>')
  })
})
