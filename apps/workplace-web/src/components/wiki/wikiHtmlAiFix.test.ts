// WP-1302 — HTML 블록 「AI로 고치기」 순수 판정: 요청 칩 채우기·고른 요소 설명·요청 본문·AI 답 다듬기(코드 울타리)·크기 상한·줄 비교.
import { describe, expect, it } from 'vitest'

import type { PickedElement } from '@/lib/htmlPicker'

import {
  buildFixHtmlRequest,
  cleanAiHtml,
  describePicked,
  FIX_HTML_CHIPS,
  FIX_HTML_MAX_PROMPT_CHARS,
  FIX_HTML_MAX_TARGET_CHARS,
  FIX_HTML_MAX_TARGETS,
  fixHtmlResultProblem,
  lineDiff,
  lineDiffStats,
  prefillChip,
} from './wikiHtmlAiFix'
import { HTML_IMPORT_MAX_BYTES } from './wikiHtmlImportInsert'

function picked(over: Partial<PickedElement> = {}): PickedElement {
  return {
    path: 'main:nth-of-type(1) > h1:nth-of-type(1)',
    tag: 'h1',
    kind: '제목',
    text: '3분기 회고',
    html: '<h1 class="t">3분기 회고</h1>',
    rect: { x: 0, y: 0, width: 100, height: 20 },
    ...over,
  }
}

describe('prefillChip', () => {
  const starter = FIX_HTML_CHIPS.find((c) => c.key === 'color')!.starter

  it('빈 칸이면 시작 말만 채운다', () => {
    expect(prefillChip('', starter)).toBe(starter)
    expect(prefillChip('   ', starter)).toBe(starter)
  })

  it('쓴 글이 있으면 시작 말을 앞에 붙인다(쓴 글은 지우지 않는다)', () => {
    expect(prefillChip(' 막대를 빨강으로 ', starter)).toBe(`${starter}막대를 빨강으로`)
  })

  it('이미 그 시작 말로 시작하면 그대로 — 두 번 눌러도 겹치지 않는다', () => {
    const once = prefillChip('파랑', starter)
    expect(prefillChip(once, starter)).toBe(once)
  })

  it('상한 가까운 글에 시작 말을 붙여도 지시 상한(4000자)을 넘지 않는다 — 넘으면 API 가 400', () => {
    expect(prefillChip('가'.repeat(FIX_HTML_MAX_PROMPT_CHARS), starter)).toHaveLength(FIX_HTML_MAX_PROMPT_CHARS)
  })

  it('칩은 시안의 다섯 가지 순서다', () => {
    expect(FIX_HTML_CHIPS.map((c) => c.label)).toEqual(['값 바꾸기', '색 바꾸기', '제목 바꾸기', '항목 추가', '꺾은선으로'])
  })
})

describe('describePicked · buildFixHtmlRequest', () => {
  it('고른 요소 설명에 선택자 경로·태그·종류·글자·짧은 HTML 을 줄마다 싣는다', () => {
    expect(describePicked(picked())).toBe(
      [
        '선택자: main:nth-of-type(1) > h1:nth-of-type(1)',
        '태그: h1',
        '종류: 제목',
        '글자: 3분기 회고',
        'HTML: <h1 class="t">3분기 회고</h1>',
      ].join('\n'),
    )
  })

  it('글자·HTML 이 없으면 그 줄을 뺀다', () => {
    expect(describePicked(picked({ text: '', html: '' }))).toBe('선택자: main:nth-of-type(1) > h1:nth-of-type(1)\n태그: h1\n종류: 제목')
  })

  it('설명은 2000자 상한으로 자른다(API 400 이 나지 않게)', () => {
    expect(Array.from(describePicked(picked({ html: '가'.repeat(5000) })))).toHaveLength(FIX_HTML_MAX_TARGET_CHARS)
    // API·zod 는 UTF-16 단위로 센다 — 이모지(서로게이트 쌍)가 섞여도 상한을 넘지 않고, 반쪽 글자를 남기지 않는다.
    const emoji = describePicked(picked({ html: '😀'.repeat(3000) }))
    expect(emoji.length).toBeLessThanOrEqual(FIX_HTML_MAX_TARGET_CHARS)
    expect(emoji).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('고른 요소가 없으면 targets 를 빼고(블록 전체), 지시 앞뒤 공백을 걷는다', () => {
    expect(buildFixHtmlRequest('<p>x</p>', '  색을 파랑으로 \n', [])).toEqual({
      action: 'fix_html',
      selection: '<p>x</p>',
      prompt: '색을 파랑으로',
    })
  })

  it('고른 요소는 순서대로 설명을 싣고 10개까지만 보낸다', () => {
    const items = Array.from({ length: 12 }, (_, i) => picked({ path: `li:nth-of-type(${i + 1})`, tag: 'li', kind: '항목', text: `${i + 1}`, html: '' }))
    const req = buildFixHtmlRequest('<ul></ul>', '지워 줘', items)
    expect(req.targets).toHaveLength(FIX_HTML_MAX_TARGETS)
    expect(req.targets![0]).toContain('선택자: li:nth-of-type(1)')
    expect(req.targets![9]).toContain('선택자: li:nth-of-type(10)')
  })
})

describe('cleanAiHtml', () => {
  it('답 전체를 감싼 코드 울타리(```html … ```)를 벗기고 앞뒤 공백을 걷는다', () => {
    expect(cleanAiHtml('\n```html\n<h1>4분기</h1>\n<p>x</p>\n```\n')).toBe('<h1>4분기</h1>\n<p>x</p>')
    expect(cleanAiHtml('```\n<p>x</p>```')).toBe('<p>x</p>')
  })

  it('울타리가 없으면 그대로(앞뒤 공백만), 가운데 ``` 는 건드리지 않는다', () => {
    expect(cleanAiHtml('  <pre>```js</pre>  ')).toBe('<pre>```js</pre>')
  })

  it('줄바꿈을 \\n 으로 맞춘다', () => {
    expect(cleanAiHtml('<p>a</p>\r\n<p>b</p>')).toBe('<p>a</p>\n<p>b</p>')
  })
})

describe('fixHtmlResultProblem', () => {
  it('빈 답은 적용할 수 없다', () => {
    expect(fixHtmlResultProblem('  ')).toMatch('빈 결과')
  })

  it('블록 크기 상한(5MB)을 넘으면 적용할 수 없다 — 딱 상한은 된다', () => {
    expect(fixHtmlResultProblem('a'.repeat(HTML_IMPORT_MAX_BYTES))).toBeNull()
    expect(fixHtmlResultProblem('a'.repeat(HTML_IMPORT_MAX_BYTES + 1))).toMatch('5MB')
  })
})

describe('lineDiff', () => {
  it('바뀐 줄만 지움·더함으로, 나머지는 같음으로 나눈다', () => {
    const before = '<h1>3분기</h1>\n<div id="c"></div>\n<script>draw()</script>'
    const after = '<h1>4분기</h1>\n<div id="c"></div>\n<script>draw()</script>'
    const parts = lineDiff(before, after)
    expect(parts).toEqual([
      { kind: 'removed', lines: ['<h1>3분기</h1>'] },
      { kind: 'added', lines: ['<h1>4분기</h1>'] },
      { kind: 'same', lines: ['<div id="c"></div>', '<script>draw()</script>'] },
    ])
    expect(lineDiffStats(parts)).toEqual({ added: 1, removed: 1 })
  })

  it('끝 줄바꿈 차이만으로 마지막 줄을 바뀐 줄로 보지 않는다', () => {
    expect(lineDiff('<p>a</p>\n<p>b</p>\n', '<p>a</p>\n<p>b</p>')).toEqual([{ kind: 'same', lines: ['<p>a</p>', '<p>b</p>'] }])
  })

  it('줄을 더하기만 하면 더한 줄만', () => {
    const parts = lineDiff('<ul>\n<li>1</li>\n</ul>', '<ul>\n<li>1</li>\n<li>2</li>\n</ul>')
    expect(lineDiffStats(parts)).toEqual({ added: 1, removed: 0 })
    expect(parts.find((p) => p.kind === 'added')?.lines).toEqual(['<li>2</li>'])
  })
})
