// @vitest-environment jsdom
// 노트 HTML 스크립트 지문(WP-1290) — 화면과 서버(WikiHtmlScriptSources)가 같은 노트에 같은 지문을 내야 서버 점검 결과를 쓴다.
// 서버 테스트(WikiHtmlScriptSourcesTest)와 같은 입력·같은 값을 둔다 — 한쪽 규칙(정렬·구분자·인코딩)이 바뀌면 둘 다 깨진다.
import { markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { describe, expect, it } from 'vitest'

import { htmlHasScripts } from '@/lib/sandboxedHtml'
import type { SecurityCheckView } from '@/types/securityCheck'

import { joinHtmlScriptSources, publicRunBlock, sha256Hex } from './wikiHtmlBlockSecurity'

const view = (over: Partial<SecurityCheckView>): SecurityCheckView => ({
  status: 'DONE',
  risk: 'LOW',
  headline: null,
  evidence: [],
  checkedAt: null,
  reason: null,
  ...over,
})

describe('노트 지문', () => {
  it('정렬·구분자·UTF-8 SHA-256 이 서버와 같은 값을 낸다(같은 블록 두 개·한글 포함)', async () => {
    const sources = ["<script>alert('나')</script>", '<div onclick="x()">b</div>', "<script>alert('나')</script>"]
    expect(joinHtmlScriptSources(sources).startsWith('<div onclick')).toBe(true)
    expect(await sha256Hex(joinHtmlScriptSources(sources))).toBe('20600931b3c45025f18a3e0359faef50e5ad7972b906221113af081925b10370')
  })

  it('블록 순서만 바뀐 노트는 같은 지문이다', async () => {
    expect(await sha256Hex(joinHtmlScriptSources(['<script>a</script>', '<script>b</script>']))).toBe(
      await sha256Hex(joinHtmlScriptSources(['<script>b</script>', '<script>a</script>'])),
    )
  })
})

/** 편집기가 보는 블록 소스 — 마크다운을 편집기 문서로 읽어 HTML 블록 글자를 모은다(스크립트가 든 것만). */
function editorSources(md: string): string[] {
  const out: string[] = []
  markdownToDoc(md).descendants((n) => {
    if (n.type.name === 'wikiHtmlEmbed') {
      if (htmlHasScripts(n.textContent)) out.push(n.textContent)
      return false
    }
    return true
  })
  return out
}

describe('블록 소스 추출 — 서버(WikiHtmlScriptSourcesTest)와 같은 입력에서 같은 소스', () => {
  it('최상위·목록 안 블록은 넣고, 스크립트 없는 블록·일반 html 코드 블록은 뺀다', () => {
    const md =
      '# 제목\n\n' +
      '```html-embed\n<script>\nrun()\n</script>\n\n<p>끝</p>\n```\n\n' +
      '- 항목\n' +
      '- ```html-embed\n  <div onclick="go()">x</div>\n\n  <b>y</b>\n  ```\n\n' +
      '```html-embed\n<p>스크립트 없음</p>\n```\n\n' +
      '```html\n<script>notEmbed()</script>\n```\n'
    expect(editorSources(md)).toEqual(['<script>\nrun()\n</script>\n\n<p>끝</p>', '<div onclick="go()">x</div>\n\n<b>y</b>'])
  })

  it('인용·CRLF 안 블록도 같은 글자다', () => {
    expect(editorSources('> ```html-embed\r\n> <script>a()</script>\r\n>\r\n> ```\r\n')).toEqual(['<script>a()</script>\n'])
  })
})

describe('공개 공유에서 켤 수 있나(publicRunBlock)', () => {
  it('같은 지문으로 끝난 낮음·주의·AI 없음은 켤 수 있다', () => {
    expect(publicRunBlock(view({ risk: 'LOW' }), true)).toBeUndefined()
    expect(publicRunBlock(view({ risk: 'CAUTION' }), true)).toBeUndefined()
    expect(publicRunBlock(view({ status: 'FAILED', risk: null, reason: 'NO_AI' }), true)).toBeUndefined()
    expect(publicRunBlock(view({ status: null, risk: null, reason: 'NO_AI' }), true)).toBeUndefined()
  })

  it('높음·점검 중·결과 없음·건너뜀·지문 다름은 막는다', () => {
    expect(publicRunBlock(view({ risk: 'HIGH' }), true)).toContain('공유 페이지에서는 실행할 수 없어요')
    for (const v of [view({ status: 'PENDING', risk: null }), view({ status: 'CHECKING', risk: null }), view({ status: null, risk: null }), view({ status: 'SKIPPED', risk: null })]) {
      expect(publicRunBlock(v, true)).toBe('보안 점검이 끝나면 실행할 수 있어요')
    }
    expect(publicRunBlock(undefined, true)).toBe('보안 점검이 끝나면 실행할 수 있어요')
    expect(publicRunBlock(view({ risk: 'LOW' }), false)).toBe('보안 점검이 끝나면 실행할 수 있어요')
  })

  it('점검 실패(너무 큼·오류)는 막는다 — 보지 못한 스크립트를 로그인 없는 손님에게 돌리지 않는다', () => {
    for (const reason of ['TOO_LARGE', 'ERROR', null] as const) {
      expect(publicRunBlock(view({ status: 'FAILED', risk: null, reason }), true)).toBe('보안 점검을 마치지 못해 공유 페이지에서는 실행할 수 없어요')
    }
  })
})
