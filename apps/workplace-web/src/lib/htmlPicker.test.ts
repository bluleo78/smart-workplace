// @vitest-environment jsdom
// WP-1301 — HTML 요소 고르기 공용 모듈. iframe 에 들어가는 판정 글자(HTML_PICKER_CORE)를 그대로 jsdom 에서 돌려 선택자 경로·이름표를 보고,
// 부모 쪽 메시지 검증(보낸 창·토큰·모양)과 칩 글자를 본다. 마우스로 고르기·링크 막기는 실제 브라우저 E2E(wiki-html-embed.spec.ts, @input).
import { afterEach, describe, expect, it } from 'vitest'

import {
  HTML_PICKER_CORE,
  HTML_PICKER_MESSAGE,
  htmlPickerEventFromMessage,
  htmlPickerScript,
  type PickedElement,
  pickedLabel,
} from './htmlPicker'

type Core = {
  htmlPickerKind: (el: Element) => string
  htmlPickerPath: (el: Element) => string
  htmlPickerInfo: (el: Element) => PickedElement
}
const core = new Function(`${HTML_PICKER_CORE}; return { htmlPickerKind, htmlPickerPath, htmlPickerInfo }`)() as Core

afterEach(() => {
  document.body.innerHTML = ''
})

describe('선택자 경로(htmlPickerPath)', () => {
  it('같은 태그 형제 순서로 nth-of-type 을 붙여 body 까지 올라간다', () => {
    document.body.innerHTML = '<main><h1>a</h1><p>x</p><p>y</p><section><p>z</p><p id="t2">w</p></section></main>'
    const second = document.querySelectorAll('main > p')[1]
    const path = core.htmlPickerPath(second)
    expect(path).toBe('body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(2)')
    // 경로로 다시 찾으면 같은 요소다 — AI 요청이 고칠 곳을 짚는 데 쓴다.
    expect(document.querySelector(path)).toBe(second)
  })

  it('id 가 있으면 거기서 끊고, 선택자로 쓸 수 없는 id 는 건너뛴다', () => {
    document.body.innerHTML = '<div id="card"><span>a</span><span>b</span></div><div id="1bad"><em>c</em></div>'
    expect(core.htmlPickerPath(document.querySelectorAll('#card span')[1])).toBe('div#card > span:nth-of-type(2)')
    const em = document.querySelector('em')!
    expect(core.htmlPickerPath(em)).toBe('body:nth-of-type(1) > div:nth-of-type(2) > em:nth-of-type(1)')
    expect(document.querySelector(core.htmlPickerPath(em))).toBe(em)
  })
})

describe('이름표(htmlPickerKind)', () => {
  it('태그로 제목·차트·표·버튼·링크·이미지·목록·입력 칸·글을 가른다', () => {
    document.body.innerHTML = [
      '<h2>제목</h2><canvas></canvas><svg><rect></rect></svg><table><tr><td>1</td></tr></table>',
      '<button>b</button><input type="submit"><a href="#">l</a><img alt=""><ul><li>i</li></ul><input type="text"><p>글</p>',
    ].join('')
    const kind = (sel: string) => core.htmlPickerKind(document.querySelector(sel)!)
    expect(kind('h2')).toBe('제목')
    expect(kind('canvas')).toBe('차트')
    expect(kind('svg')).toBe('차트')
    expect(kind('rect')).toBe('차트 요소')
    expect(kind('table')).toBe('표')
    expect(kind('tr')).toBe('표 행')
    expect(kind('td')).toBe('표 칸')
    expect(kind('button')).toBe('버튼')
    expect(kind('input[type=submit]')).toBe('버튼')
    expect(kind('a')).toBe('링크')
    expect(kind('img')).toBe('이미지')
    expect(kind('ul')).toBe('목록')
    expect(kind('li')).toBe('목록 항목')
    expect(kind('input[type=text]')).toBe('입력 칸')
    expect(kind('p')).toBe('글')
  })

  // 둥근 모서리·그림자는 jsdom 이 계산 값을 내지 않아 여기서는 테두리만 본다(실제 브라우저는 E2E 의 카드 고르기가 본다).
  it('테두리가 있는 묶음은 카드, 아니면 영역', () => {
    document.body.innerHTML =
      '<div id="a" style="border:1px solid #ccc"><b>x</b></div><div id="c"><b>z</b></div><div id="d" style="border:1px solid #ccc"></div>'
    const kind = (id: string) => core.htmlPickerKind(document.getElementById(id)!)
    expect(kind('a')).toBe('카드')
    expect(kind('c')).toBe('영역')
    // 자식이 없는 테두리 상자는 묶음이 아니다.
    expect(kind('d')).toBe('영역')
  })
})

describe('요소 정보(htmlPickerInfo)', () => {
  it('글자는 공백을 줄여 80자, outerHTML 은 300자까지만 싣는다', () => {
    const long = '가'.repeat(400)
    document.body.innerHTML = `<p id="p">  ${long}\n\n 끝 </p>`
    const info = core.htmlPickerInfo(document.getElementById('p')!)
    expect(info.tag).toBe('p')
    expect(info.kind).toBe('글')
    expect(info.path).toBe('p#p')
    expect(info.text).toHaveLength(80)
    expect(info.text.startsWith('가')).toBe(true)
    expect(info.html).toHaveLength(300)
    expect(info.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('부모 쪽 메시지 검증(htmlPickerEventFromMessage)', () => {
  const frame = {} as Window
  const other = {} as Window
  const token = 'tok-1'
  const item: PickedElement = { path: 'h1#t', tag: 'h1', kind: '제목', text: '3분기 회고', html: '<h1 id="t">', rect: { x: 1, y: 2, width: 3, height: 4 } }
  const msg = (data: unknown, source: Window | null = frame) => ({ source, data }) as Pick<MessageEvent, 'source' | 'data'>

  it('그 iframe 창이 그 토큰으로 보낸 상태만 받는다', () => {
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'state', enabled: true, items: [item] }), frame, token)).toEqual({
      event: 'state',
      enabled: true,
      items: [item],
    })
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'ready' }), frame, token)).toEqual({ event: 'ready' })
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'escape' }), frame, token)).toEqual({ event: 'escape' })
  })

  it('다른 창·다른 블록(토큰이 틀림)·종류가 다른 메시지는 무시한다', () => {
    const ok = { type: HTML_PICKER_MESSAGE, token, event: 'state', enabled: true, items: [item] }
    expect(htmlPickerEventFromMessage(msg(ok, other), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg(ok, null), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg({ ...ok, token: 'tok-2' }), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg({ ...ok, token: undefined }), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg({ ...ok, type: 'wp-html-embed-height' }), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg({ ...ok, event: 'navigate' }), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg('wp-html-picker'), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg(ok), null, token)).toBeNull()
  })

  it('꼴이 틀린 상태는 버리고, 고른 목록에서 꼴이 틀린 항목만 뺀다', () => {
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'state', enabled: 'yes', items: [] }), frame, token)).toBeNull()
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'state', enabled: true, items: 'x' }), frame, token)).toBeNull()
    const bad = [{ ...item, rect: null }, { ...item, path: 1 }, 'x', null]
    expect(htmlPickerEventFromMessage(msg({ type: HTML_PICKER_MESSAGE, token, event: 'state', enabled: true, items: [...bad, item] }), frame, token)).toEqual({
      event: 'state',
      enabled: true,
      items: [item],
    })
  })
})

describe('고르기 스크립트·칩 글자', () => {
  it('스크립트는 그 블록 토큰을 싣고, 판정 글자를 그대로 담는다', () => {
    const script = htmlPickerScript('a"b</script>')
    // 토큰은 JSON 문자열로 들어가고 < 는 풀어 써 스크립트를 끊지 못한다.
    expect(script).toContain('var TOKEN="a\\"b\\u003c/script>"')
    expect(script.match(/<\/script>/g)).toHaveLength(1)
    expect(script).toContain(HTML_PICKER_CORE)
    expect(script.startsWith('<script data-wp-html-picker>')).toBe(true)
  })

  it('칩 글자는 이름표 · 글자 앞부분, 글자가 없으면 이름표만', () => {
    expect(pickedLabel({ kind: '제목', text: '3분기 회고' })).toBe('제목 · 3분기 회고')
    expect(pickedLabel({ kind: '차트', text: '' })).toBe('차트')
    expect(pickedLabel({ kind: '글', text: '가나다라마바사아자차카타파하가나다라' })).toBe('글 · 가나다라마바사아자차카타파하가나…')
  })
})
