import '../dom-install'

import { describe, expect, it } from 'vitest'

import { diffHunks, dryRunReport, roundTrip } from './dryRun'

// 실제 노트 모양을 흉내 낸 합성 픽스처 — 개발 DB 본문은 저장소에 넣지 않는다.
// 이미 정규형인 본문(웹 에디터가 저장한 모양): 표·이미지·멘션·코드·인용·목록.
const CLEAN_NOTE = [
  '# 주간 회의록',
  '',
  '참석: <@5> <@12> · 관련 <#page:34> <#issue:7>',
  '',
  '## 결정 사항',
  '',
  '- 배포는 **목요일** 오전',
  '- `pnpm build` 후 *스모크* 확인',
  '  - 하위 항목',
  '',
  '1. 첫째',
  '2. 둘째',
  '',
  '| 항목 | 담당 | 상태 |',
  '| --- | --- | --- |',
  '| API | 김철수 | 완료 |',
  '| 웹 \\| 모바일 | 이영희 | 진행 |',
  '',
  '![스크린샷](/api/v1/files/88 "대시보드")',
  '',
  '> 인용문',
  '',
  '```ts',
  'const token = "<@5>" // 코드 안 토큰은 그대로',
  '```',
  '',
  '---',
  '',
  '마지막 줄\\',
  '이어지는 줄',
].join('\n')

// GFM 으로 표현할 수 없는 병합 셀 표 — 에디터가 raw HTML 폴백으로 저장한 모양(#742·#754).
const MERGED_TABLE_INPUT =
  '<table><tbody><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>'

// 출시 전 왕복 점검 — 쓰기 없이 "마크다운 → Yjs → 마크다운" 차이를 분류한다.
describe('dryRunReport', () => {
  it('reports unchanged pages as clean and classifies known normalizations', () => {
    const r = dryRunReport([
      { id: 1, body: '# 제목\n\n본문' },
      { id: 2, body: '_기울임_' },
      { id: 3, body: '| a |\n| :---: |\n| 1 |\n' },
    ])
    expect(r.total).toBe(3)
    expect(r.changed.map((c) => c.id)).toEqual([2, 3])
    expect(r.changed[0].categories).toContain('emphasis')
    expect(r.changed[1].categories).toContain('table-align')
  })

  it('keeps a realistic already-normalized note (tables, images, mentions, code) unchanged', () => {
    expect(roundTrip(CLEAN_NOTE)).toBe(CLEAN_NOTE)
    expect(dryRunReport([{ id: 10, body: CLEAN_NOTE }]).changed).toEqual([])
  })

  it('keeps a long note unchanged and reports quickly', () => {
    const long = Array.from({ length: 400 }, (_, i) => `## 절 ${i}\n\n문단 ${i} <@${i + 1}> 내용`).join('\n\n')
    const r = dryRunReport([{ id: 11, body: long }])
    expect(r.changed).toEqual([])
  })

  it('keeps the merged-cell HTML table fallback stable once it is in saved form', () => {
    // 최초 입력은 래퍼·셀 속성이 붙은 저장형으로 한 번 바뀌고(raw-html), 그 저장형은 이후 왕복해도 그대로다.
    const first = dryRunReport([{ id: 12, body: MERGED_TABLE_INPUT }])
    expect(first.changed[0].categories).toContain('raw-html')
    const saved = roundTrip(MERGED_TABLE_INPUT)
    expect(saved).toContain('colspan="2"')
    expect(dryRunReport([{ id: 13, body: saved }]).changed).toEqual([])
  })

  it('classifies each known normalization', () => {
    const r = dryRunReport([
      { id: 20, body: '첫 문단\n\n\n\n둘째 문단' },
      { id: 21, body: '줄 하나  \n줄 둘' },
      { id: 22, body: '- [ ] 할 일\n- [x] 한 일' },
      { id: 23, body: '<div align="center">가운데</div>\n\n본문' },
      { id: 24, body: '__굵게__ 와 _기울임_' },
      { id: 25, body: '| a | b |\n|:--|--:|\n| 1 | 2 |' },
    ])
    const cats = Object.fromEntries(r.changed.map((c) => [c.id, c.categories]))
    expect(cats[20]).toEqual(['blank-lines'])
    expect(cats[21]).toEqual(['hard-break'])
    expect(cats[22]).toEqual(expect.arrayContaining(['checkbox', 'escape']))
    expect(cats[22]).not.toContain('other')
    expect(cats[23]).toEqual(['raw-html'])
    expect(cats[24]).toEqual(['emphasis'])
    expect(cats[25]).toEqual(['table-align'])
  })

  it('flags unexplained differences as other with a readable diff', () => {
    const r = dryRunReport([{ id: 30, body: '* 별표 목록\n* 둘째' }])
    expect(r.changed[0].categories).toEqual(['other'])
    expect(r.changed[0].diff).toBe('@@ 1\n- * 별표 목록\n- * 둘째\n+ - 별표 목록\n+ - 둘째')
  })

  it('never mutates its input', () => {
    const pages = [{ id: 40, body: '_x_' }]
    const snapshot = JSON.stringify(pages)
    dryRunReport(pages)
    expect(JSON.stringify(pages)).toBe(snapshot)
  })
})

describe('diffHunks', () => {
  it('groups consecutive changes and reports the original line number', () => {
    const h = diffHunks(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e'])
    expect(h).toEqual([
      { line: 2, removed: ['b'], added: ['B'] },
      { line: 5, removed: [], added: ['e'] },
    ])
  })
})
