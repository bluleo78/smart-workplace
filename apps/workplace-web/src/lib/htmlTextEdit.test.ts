// WP-1309 — HTML 글자 고치기 공용 모듈(iframe 쪽). iframe 에 들어가는 지문 계산(HTML_TEXT_EDIT_CORE)이 부모 계산과 같은 값을 내는지,
// 부모의 메시지 검증(보낸 창·토큰·꼴)과 스크립트 글자(토큰이 </script> 로 끊지 못함)를 본다. AI 에 보낼 HTML 의 편집 표지 걷기는 htmlPicker.test.
// 실제 클릭 편집·서식 도구·붙여넣기는 E2E(wiki-html-document.spec.ts·wiki-html-embed.spec.ts, @input).
import { describe, expect, it } from 'vitest'

import {
  HTML_TEXT_EDIT_CORE,
  HTML_TEXT_EDIT_MESSAGE,
  htmlTextEditEventFromMessage,
  htmlTextEditScript,
} from './htmlTextEdit'
import { htmlTextSignature } from './htmlTextEditSource'

const frameSig = new Function(`${HTML_TEXT_EDIT_CORE}; return wpSig`)() as (text: string) => string

describe('글자 지문', () => {
  it('iframe 계산(wpSig)과 부모 계산(htmlTextSignature)이 같은 값을 낸다 — 공백은 하나로 줄이고 앞뒤를 걷는다', () => {
    for (const text of ['', '3분기 회고', '  출시\n\t 4건 ', 'emoji 😀 + &amp;', 'a b', 'x'.repeat(5000)]) {
      expect(frameSig(text)).toBe(htmlTextSignature(text))
    }
    expect(htmlTextSignature(' a  b ')).toBe(htmlTextSignature('a b'))
    expect(htmlTextSignature('4건')).not.toBe(htmlTextSignature('5건'))
  })
})

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
type BarPos = { side: string; left: number; top: number }
const frameBar = new Function(`${HTML_TEXT_EDIT_CORE}; return { pos: wpBarPos, fits: wpBarFits }`)() as {
  pos: (t: Box, c: Box, w: number, h: number, vw: number, vh: number, cost?: (r: Box) => number) => BarPos
  fits: (l: number, t: number, c: Box, w: number, h: number, vw: number, vh: number) => boolean
}

describe('서식 도구 자리(wpBarPos)', () => {
  const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h })
  const hit = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  /** 남의 글자 상자들 — 후보가 가리는 넓이(iframe 의 elementFromPoint 재기 대신). */
  const coverOf = (texts: Box[]) => (r: Box) =>
    texts.reduce((sum, b) => sum + Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)) * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)), 0)
  const W = 200
  const H = 32

  it('위에 가릴 글자가 없으면 요소 위(8px 띄움)에 둔다', () => {
    const t = box(40, 200, 300, 24)
    expect(frameBar.pos(t, box(40, 200, 80, 24), W, H, 800, 600, coverOf([]))).toEqual({ side: 'above', left: 40, top: 200 - H - 8 })
  })

  it('카드 값 바로 위 이름표를 가리면 글자 오른쪽으로 옮긴다 — 고치는 글자·이름표 어느 것과도 겹치지 않는다', () => {
    const label = box(40, 180, 30, 18)
    const value = box(40, 200, 300, 24)
    const text = box(40, 200, 30, 24)
    const p = frameBar.pos(value, text, W, H, 800, 600, coverOf([label]))
    expect(p.side).toBe('right')
    const bar = box(p.left, p.top, W, H)
    expect(hit(bar, text)).toBe(false)
    expect(hit(bar, label)).toBe(false)
  })

  it('오른쪽에 자리가 없으면 아래로, 맨 위라 위에 자리가 없으면 오른쪽·아래로 간다', () => {
    // 글자가 창 오른쪽 끝까지 — 위는 이름표를 가리고 오른쪽은 창 밖이라 아래.
    const label = box(40, 180, 30, 18)
    expect(frameBar.pos(box(40, 200, 740, 24), box(40, 200, 740, 24), W, H, 800, 600, coverOf([label])).side).toBe('below')
    // 맨 위 제목 — 위는 창 밖.
    expect(frameBar.pos(box(8, 10, 784, 40), box(8, 10, 200, 40), W, H, 800, 600, coverOf([])).side).toBe('right')
    expect(frameBar.pos(box(8, 10, 784, 40), box(8, 10, 784, 40), W, H, 800, 600, coverOf([])).side).toBe('below')
  })

  it('모든 자리가 무언가를 가리면 가장 덜 가리는 자리를 고른다', () => {
    const t = box(40, 200, 300, 24)
    const c = box(40, 200, 30, 24)
    // 위는 크게, 오른쪽은 조금, 아래는 크게 가린다.
    const p = frameBar.pos(t, c, W, H, 800, 600, coverOf([box(0, 150, 800, 45), box(90, 215, 20, 4), box(0, 232, 800, 40)]))
    expect(p.side).toBe('right')
  })

  it('창보다 큰 요소라 어디에도 안 들면 창 안에 붙여 둔다(창 밖으로 나가지 않는다)', () => {
    const t = box(8, -100, 784, 900)
    const p = frameBar.pos(t, t, W, H, 800, 600, coverOf([]))
    expect(p.side).toBe('pinned')
    expect(p.top).toBeGreaterThanOrEqual(4)
    expect(p.left).toBeGreaterThanOrEqual(4)
    expect(p.left + W).toBeLessThanOrEqual(796)
  })

  it('기억한 자리는 창 안이고 고치는 글자와 안 겹칠 때만 그대로 쓴다 — 글자가 늘어 도구에 닿으면 다시 고른다', () => {
    expect(frameBar.fits(100, 100, box(40, 200, 30, 24), W, H, 800, 600)).toBe(true)
    expect(frameBar.fits(100, 190, box(40, 200, 80, 24), W, H, 800, 600)).toBe(false)
    expect(frameBar.fits(700, 100, box(40, 200, 30, 24), W, H, 800, 600)).toBe(false)
    expect(frameBar.fits(100, 1, box(40, 200, 30, 24), W, H, 800, 600)).toBe(false)
  })
})

describe('메시지 검증(htmlTextEditEventFromMessage)', () => {
  const frame = {} as Window
  const other = {} as Window
  const msg = (data: Record<string, unknown>, source: Window = frame) => ({
    source,
    data: { type: HTML_TEXT_EDIT_MESSAGE, token: 't1', ...data },
  })

  it('보낸 창·토큰·종류가 맞을 때만 받는다', () => {
    expect(htmlTextEditEventFromMessage(msg({ event: 'ready' }), frame, 't1')).toEqual({ event: 'ready' })
    expect(htmlTextEditEventFromMessage(msg({ event: 'ready' }, other), frame, 't1')).toBeNull()
    expect(htmlTextEditEventFromMessage(msg({ event: 'ready' }), frame, 't2')).toBeNull()
    expect(htmlTextEditEventFromMessage({ source: frame, data: { type: 'wp-html-picker', token: 't1', event: 'ready' } }, frame, 't1')).toBeNull()
  })

  it('고친 목록은 꼴이 맞는 것만 — ref 는 s:번호·n:id, after·cls 는 글자일 때만 싣는다', () => {
    const got = htmlTextEditEventFromMessage(
      msg({
        event: 'edits',
        items: [
          { ref: 's:3', html: '<b>a</b>' },
          { ref: 'n:ab1', after: 's:3', cls: 'lead', html: 'b' },
          { ref: 'n:ab2', after: 'n:ab1', html: 'c', cls: undefined },
          { ref: 'x:1', html: 'bad' },
          { ref: 's:4', html: 5 },
          { ref: 'n:ab3', after: 'javascript:1', html: 'bad' },
        ],
      }),
      frame,
      't1',
    )
    expect(got).toEqual({
      event: 'edits',
      items: [
        { ref: 's:3', html: '<b>a</b>' },
        { ref: 'n:ab1', after: 's:3', cls: 'lead', html: 'b' },
        { ref: 'n:ab2', after: 'n:ab1', html: 'c' },
      ],
    })
  })

  it('붙여넣기는 html·text 가 글자일 때만', () => {
    expect(htmlTextEditEventFromMessage(msg({ event: 'paste', html: '<b>x</b>', text: 'x' }), frame, 't1')).toEqual({
      event: 'paste',
      html: '<b>x</b>',
      text: 'x',
    })
    expect(htmlTextEditEventFromMessage(msg({ event: 'paste', html: null, text: 'x' }), frame, 't1')).toBeNull()
  })
})

describe('스크립트 글자(htmlTextEditScript)', () => {
  it('토큰이 </script> 를 담아도 스크립트를 끊지 못한다', () => {
    const script = htmlTextEditScript('</script><script>alert(1)</script>')
    expect(script.match(/<\/script>/g)).toHaveLength(1)
    expect(script.endsWith('</script>')).toBe(true)
  })

  it('스크립트 본문이 문법상 올바르다(iframe 에서 바로 실행된다)', () => {
    const body = htmlTextEditScript('tok').replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    expect(() => new Function(body)).not.toThrow()
  })
})
