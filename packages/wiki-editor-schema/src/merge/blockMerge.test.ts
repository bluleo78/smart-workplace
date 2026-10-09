import MarkdownIt from 'markdown-it'
import { describe, expect, it, vi } from 'vitest'

import { alignBlocks, applyExactPatch, closestBase, joinBlocks, mergeMarkdown3, similarity, splitBlocks } from './blockMerge'
import { docToMarkdown, markdownToDoc } from '../markdown'

// 3-way 블록 병합(WP-289, 스펙 §5.1-3) — 입력은 모두 공용 스키마로 정규화된 마크다운이라고 가정한다(정규화는 collab 이 한다).
const doc = (...blocks: string[]) => blocks.join('\n\n')
const P = (n: number, s = '') => `문단${n}: 원래 내용 문장입니다${s}.`
const BASE = doc(P(1), P(2), P(5))

describe('splitBlocks / joinBlocks', () => {
  it('keeps fences and tables whole and splits lists per item', () => {
    const md = '# 제목\n\n- a\n- b\n\n```ts\nconst x = 1\n\nconst y = 2\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(splitBlocks(md)).toEqual([
      '# 제목',
      '- a',
      '- b',
      '```ts\nconst x = 1\n\nconst y = 2\n```',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
    ])
  })

  it('joins items of the same list with a single newline and other blocks with a blank line', () => {
    const md = '# 제목\n\n- a\n- b\n\n문단\n\n1. 하나\n2. 둘'
    expect(joinBlocks(splitBlocks(md))).toBe(md)
  })

  it('returns no blocks for an empty document', () => {
    expect(splitBlocks('')).toEqual([])
    expect(joinBlocks([])).toBe('')
  })
})

describe('similarity / alignBlocks', () => {
  it('scores identical text 1 and unrelated text near 0', () => {
    expect(similarity('같은 문장', '같은 문장')).toBe(1)
    expect(similarity('가나다라마바사', 'zyxwvut')).toBe(0)
  })

  it('pairs an edited block in place and marks inserted/deleted blocks', () => {
    // base: [P1, P2, P5]  other: [P1, P2 수정, 새 문단]  → P2↔1(수정), P5 삭제
    expect(alignBlocks([P(1), P(2), P(5)], [P(1), P(2, ' 수정'), '완전히 다른 새 블록 abc'])).toEqual([0, 1, -1])
  })

  it('aligns a 5000-block note quickly', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `문단 ${i} 내용`)
    const other = [...base]
    other[4000] = '문단 4000 내용 바뀜'
    const started = performance.now()
    const match = alignBlocks(base, other)
    expect(performance.now() - started).toBeLessThan(500)
    expect(match[4000]).toBe(4000)
    expect(match[4999]).toBe(4999)
  })
})

describe('applyExactPatch (no fuzzy)', () => {
  it('applies the AI change where its context still matches exactly', () => {
    expect(applyExactPatch('첫 문단', '첫 문단입니다', '사람 첫 문단')).toBe('사람 첫 문단입니다')
  })

  it('fails when the person changed the context the AI patch needs', () => {
    expect(applyExactPatch('가나다라마바사 아자차카', '가나다라MBS 아자차카', '가나다라마바X 아자차카')).toBeNull()
  })

  it('fails when the context is ambiguous even with the whole base as context', () => {
    expect(applyExactPatch('사과 하나', '사과 둘', '사과 하나 그리고 사과 하나')).toBeNull()
  })
})

describe('mergeMarkdown3', () => {
  it('returns the document unchanged when nobody changed anything', () => {
    expect(mergeMarkdown3(BASE, BASE, BASE)).toEqual({ markdown: BASE, conflicts: 0 })
  })

  it('takes the AI block and the person block when they changed different blocks', () => {
    const cur = doc(P(1), P(2), '문단5: 사람이 고친 내용입니다.')
    const ai = doc(P(1), '문단2: AI 가 다듬은 문장입니다.', P(5))
    expect(mergeMarkdown3(BASE, cur, ai).markdown).toBe(doc(P(1), '문단2: AI 가 다듬은 문장입니다.', '문단5: 사람이 고친 내용입니다.'))
  })

  it('merges edits at different spots of the same paragraph', () => {
    const cur = doc(P(1), '문단2: 원래 내용 문장입니다 (사람 덧붙임).', P(5))
    const ai = doc(P(1), '문단2: 수정된 내용 문장입니다.', P(5))
    expect(mergeMarkdown3(BASE, cur, ai)).toEqual({
      markdown: doc(P(1), '문단2: 수정된 내용 문장입니다 (사람 덧붙임).', P(5)),
      conflicts: 0,
    })
  })

  it('takes the AI side for that block when both changed the same words', () => {
    const cur = doc(P(1), '문단2: 사람 내용 문장입니다.', P(5))
    const ai = doc(P(1), '문단2: AI 내용 문장입니다.', P(5))
    expect(mergeMarkdown3(BASE, cur, ai)).toEqual({ markdown: doc(P(1), '문단2: AI 내용 문장입니다.', P(5)), conflicts: 1 })
  })

  it('removes a block the AI deleted even if the person edited it (AI side)', () => {
    const cur = doc(P(1), P(2), P(5, ' (사람 수정)'))
    const ai = doc(P(1), P(2))
    expect(mergeMarkdown3(BASE, cur, ai)).toEqual({ markdown: doc(P(1), P(2)), conflicts: 1 })
  })

  it('keeps a block the person deleted when the AI left it alone', () => {
    const cur = doc(P(1), P(5))
    expect(mergeMarkdown3(BASE, cur, BASE).markdown).toBe(doc(P(1), P(5)))
  })

  it('keeps the person edit next to a paragraph the AI inserted', () => {
    const cur = doc(P(1), '문단2: 사람이 고친 문장.', P(5))
    const ai = doc(P(1), P(2), 'AI 가 추가한 새 문단.', P(5))
    expect(mergeMarkdown3(BASE, cur, ai).markdown).toBe(doc(P(1), '문단2: 사람이 고친 문장.', 'AI 가 추가한 새 문단.', P(5)))
  })

  it('keeps a paragraph the person inserted while the AI rewrote another', () => {
    const cur = doc(P(1), '사람이 넣은 새 문단', P(2), P(5))
    const ai = doc(P(1), P(2, ' AI'), P(5))
    expect(mergeMarkdown3(BASE, cur, ai).markdown).toBe(doc(P(1), '사람이 넣은 새 문단', P(2, ' AI'), P(5)))
  })

  it('merges list items individually', () => {
    const base = '- 항목 a\n- 항목 b'
    const cur = '- 항목 a (사람)\n- 항목 b'
    const ai = '- 항목 a\n- 항목 b\n- 항목 c (AI)'
    expect(mergeMarkdown3(base, cur, ai).markdown).toBe('- 항목 a (사람)\n- 항목 b\n- 항목 c (AI)')
  })

  it('keeps code blocks with blank lines and tables as single blocks', () => {
    const base = doc('```ts\nconst x = 1\n\nconst y = 2\n```', '| a | b |\n| --- | --- |\n| 1 | 2 |')
    const cur = base.replace('| 1 | 2 |', '| 1 | 3 |')
    const ai = base.replace('const y = 2', 'const y = 42')
    expect(mergeMarkdown3(base, cur, ai).markdown).toBe(doc('```ts\nconst x = 1\n\nconst y = 42\n```', '| a | b |\n| --- | --- |\n| 1 | 3 |'))
  })

  it("keeps others' blocks when the base is the writer's own submitted body", () => {
    // 구버전 웹: 직전에 보낸 본문(base)에서 이어 친다. 그사이 다른 사람이 넣은 블록은 base·writer 둘 다에 없다 → 사람만의 변경 → 유지.
    const base = doc(P(1), P(2))
    const cur = doc(P(1), P(2), '다른 사람이 넣은 문단')
    const writer = doc(P(1, ' 이어 침'), P(2))
    expect(mergeMarkdown3(base, cur, writer).markdown).toBe(doc(P(1, ' 이어 침'), P(2), '다른 사람이 넣은 문단'))
  })

  it('applies an identical change only once', () => {
    const both = doc(P(1), P(2, ' 같은 수정'), P(5))
    expect(mergeMarkdown3(BASE, both, both)).toEqual({ markdown: both, conflicts: 0 })
  })

  it('emits a block once when both sides inserted it (AI continued from the merged response)', () => {
    const base = doc(P(1), P(2))
    const cur = doc(P(1), '사람이 넣은 문단', P(2))
    const ai = doc(P(1, ' AI'), '사람이 넣은 문단', P(2))
    expect(mergeMarkdown3(base, cur, ai).markdown).toBe(doc(P(1, ' AI'), '사람이 넣은 문단', P(2)))
  })

  it('keeps both when the person and the AI inserted different (even similar) paragraphs at the same spot', () => {
    const base = doc(P(1), P(2))
    const cur = doc(P(1), '회의 결과를 정리합니다', P(2))
    const ai = doc(P(1), '회의 결과를 요약합니다', P(2))
    expect(mergeMarkdown3(base, cur, ai).markdown).toBe(doc(P(1), '회의 결과를 정리합니다', '회의 결과를 요약합니다', P(2)))
  })

  it('keeps AI-only inserts in order around a shared insert', () => {
    const base = doc(P(1), P(2))
    const cur = doc(P(1), '공통 새 문단', P(2))
    const ai = doc(P(1), 'AI 앞 문단', '공통 새 문단', 'AI 뒤 문단', P(2))
    expect(mergeMarkdown3(base, cur, ai).markdown).toBe(doc(P(1), 'AI 앞 문단', '공통 새 문단', 'AI 뒤 문단', P(2)))
  })
})

describe('mergeMarkdown3 — 큰 틈(리뷰 fix)', () => {
  // AI 가 맨 앞에 문단을 넣고 전체를 다듬는 사이 사람이 가운데 문단 하나를 고친 경우 — 순서 짝짓기면 사람 수정이 이웃 문단에 붙는다.
  const polishAll = (n: number, edited: number) => {
    const base = Array.from({ length: n }, (_, i) => `문단 ${i} 내용 텍스트`)
    const cur = base.map((b, i) => (i === edited ? `${b} 사람끝` : b))
    const ai = ['AI 가 맨 앞에 넣은 요약 abc', ...base.map((b) => `${b} 수정`)]
    const expected = ['AI 가 맨 앞에 넣은 요약 abc', ...base.map((b, i) => (i === edited ? `${b} 수정 사람끝` : `${b} 수정`))]
    return { base: doc(...base), cur: doc(...cur), ai: doc(...ai), expected: doc(...expected) }
  }

  it('keeps the person edit on its own paragraph when the AI inserted at the top and rewrote 30 paragraphs', () => {
    const { base, cur, ai, expected } = polishAll(30, 20)
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: expected, conflicts: 0 })
  })

  it('does the same on a 5000-block note quickly', () => {
    const { base, cur, ai, expected } = polishAll(5000, 4000)
    const started = performance.now()
    const result = mergeMarkdown3(base, cur, ai)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(result).toEqual({ markdown: expected, conflicts: 0 })
  })

  it('pairs by similarity even when the AI appended so many blocks that the band is too wide (greedy path)', () => {
    const base = Array.from({ length: 400 }, (_, i) => `문단 ${i} 내용 텍스트`)
    const cur = base.map((b, i) => (i === 200 ? `${b} 사람끝` : b))
    const added = Array.from({ length: 1000 }, (_, i) => `zz${i} 덧붙인 블록`)
    const ai = [...base.map((b) => `${b} 수정`), ...added]
    const result = mergeMarkdown3(doc(...base), doc(...cur), doc(...ai))
    expect(result.markdown).toBe(doc(...base.map((b, i) => (i === 200 ? `${b} 수정 사람끝` : `${b} 수정`)), ...added))
    expect(result.conflicts).toBe(0)
  })

  it('never pairs unrelated blocks in a large rewritten gap', () => {
    const base = Array.from({ length: 30 }, (_, i) => `문단 ${i} 내용 텍스트`)
    const other = Array.from({ length: 31 }, (_, i) => `zz${i} qq${i} 무관한 다른 블록 ${'x'.repeat(i)}`)
    expect(alignBlocks(base, other)).toEqual(base.map(() => -1))
  })
})

describe('mergeMarkdown3 — 위치와 무관한 큰 틈 짝짓기(리뷰 fix 2)', () => {
  // 결정적 의사난수(mulberry32) — 실패 시 같은 입력으로 재현된다.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const word = (r: () => number) =>
    Array.from({ length: 2 + Math.floor(r() * 3) }, () => String.fromCharCode(0xac00 + Math.floor(r() * 11172))).join('')
  const para = (r: () => number) => Array.from({ length: 8 + Math.floor(r() * 8) }, () => word(r)).join(' ')
  const reword = (r: () => number, p: string) => {
    const ws = p.split(' ')
    ws[1 + Math.floor(r() * (ws.length - 2))] = word(r)
    return ws.join(' ')
  }
  const MARK = ' 사람편집ZZQ'

  it('keeps the person edit after an AI insert run longer than any window (2000 paragraphs, +120 at #500)', () => {
    const r = rng(1)
    const base = Array.from({ length: 2000 }, () => para(r))
    const cur = base.map((b, i) => (i === 1500 ? b + MARK : b))
    const polished = base.map((b) => reword(r, b))
    const ai = [...polished.slice(0, 500), ...Array.from({ length: 120 }, () => para(r)), ...polished.slice(500)]
    const result = mergeMarkdown3(doc(...base), doc(...cur), doc(...ai))
    expect(result.markdown).toContain(polished[1500] + MARK)
    expect(result.conflicts).toBe(0)
  })

  it('keeps the person edit when the AI deleted the first 40 and appended 40 (1000 paragraphs)', () => {
    const r = rng(2)
    const base = Array.from({ length: 1000 }, () => para(r))
    const cur = base.map((b, i) => (i === 500 ? b + MARK : b))
    const polished = base.map((b) => reword(r, b))
    const ai = [...polished.slice(40), ...Array.from({ length: 40 }, () => para(r))]
    const result = mergeMarkdown3(doc(...base), doc(...cur), doc(...ai))
    expect(result.markdown).toContain(polished[500] + MARK)
    expect(result.conflicts).toBe(0)
  })

  it.each([50, 600, 3000])('keeps a person edit through random AI inserts/deletes/rewording (N=%i)', (n) => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = rng(n * 100 + seed)
      const base = Array.from({ length: n }, () => para(r))
      // AI: 블록마다 일정 확률로 지움(가끔 70블록 넘게 연속), 대부분 다듬음, 사이사이 새 블록(가끔 70블록 넘게 연속).
      const ai: string[] = []
      const kept: number[] = []
      for (let i = 0; i < n; i++) {
        if (r() < 0.01) ai.push(...Array.from({ length: 65 + Math.floor(r() * 40) }, () => para(r)))
        else if (r() < 0.05) ai.push(para(r))
        if (r() < 0.005) {
          i += 65 + Math.floor(r() * 40)
          continue
        }
        if (r() < 0.05) continue
        kept.push(i)
        ai.push(r() < 0.8 ? reword(r, base[i]) : base[i])
      }
      const edited = kept[Math.floor(r() * kept.length)]
      const cur = base.map((b, i) => (i === edited ? b + MARK : b))
      expect(mergeMarkdown3(doc(...base), doc(...cur), doc(...ai)).markdown, `seed ${seed}`).toContain(MARK)
    }
  })

  it('merges a 10000-block note with a bulk insert and a bulk delete quickly', () => {
    const r = rng(3)
    const base = Array.from({ length: 10000 }, () => para(r))
    const cur = base.map((b, i) => (i === 7000 ? b + MARK : b))
    const polished = base.map((b) => reword(r, b))
    const ai = [...polished.slice(0, 2000), ...Array.from({ length: 300 }, () => para(r)), ...polished.slice(2000, 5000), ...polished.slice(5300)]
    const started = performance.now()
    const result = mergeMarkdown3(doc(...base), doc(...cur), doc(...ai))
    expect(performance.now() - started).toBeLessThan(3000)
    expect(result.markdown).toContain(polished[7000] + MARK)
  })
})

describe('mergeMarkdown3 — 반복되는 같은 블록(회의록, 리뷰 fix 3)', () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const word = (r: () => number) =>
    Array.from({ length: 2 + Math.floor(r() * 3) }, () => String.fromCharCode(0xac00 + Math.floor(r() * 11172))).join('')
  const para = (r: () => number) => Array.from({ length: 8 + Math.floor(r() * 8) }, () => word(r)).join(' ')
  const reword = (r: () => number, p: string) => {
    const ws = p.split(' ')
    ws[1 + Math.floor(r() * (ws.length - 2))] = word(r)
    return ws.join(' ')
  }
  const MARK = ' 사람편집ZZQ'
  const TABLE = '| 담당 | 내용 |\n| --- | --- |\n| 김 | 확인 |'
  type Kind = 'h' | 'rep' | 'u' | 'p' | 'tab'

  /** 회의록 노트 — 회차마다 같은 소제목·표·구분선이 반복되고 회차 제목·참석자 줄·문단만 고유하다. */
  const meetingLog = (r: () => number, blockTarget: number) => {
    const blocks: string[] = []
    const kinds: Kind[] = []
    const push = (b: string, k: Kind) => {
      blocks.push(b)
      kinds.push(k)
    }
    for (let k = 0; blocks.length < blockTarget; k++) {
      push(`## 회의록 ${k}회차`, 'h')
      push('### 참석자', 'rep')
      push(`김${word(r)} 이${word(r)} 박${word(r)}`, 'u')
      push('### 논의 내용', 'rep')
      const paras = 3 + Math.floor(r() * 4)
      for (let p = 0; p < paras; p++) push(`문서 ${k}-${p} ${para(r)}`, 'p')
      push('### 액션 아이템', 'rep')
      push(TABLE, 'tab')
      push('---', 'rep')
    }
    return { blocks, kinds }
  }

  /** AI 변환 — 기준 블록마다 결과 블록(-1=지움)과 그 앞에 새 블록을 넣었는지 기록한다. */
  const transform = (
    blocks: string[],
    kinds: Kind[],
    edit: (b: string, k: Kind, i: number) => string | null,
    insertBefore: (i: number) => string[],
  ) => {
    const ai: string[] = []
    const aiOf: Array<string | null> = []
    const inserted: boolean[] = []
    blocks.forEach((b, i) => {
      const ins = insertBefore(i)
      inserted.push(ins.length > 0)
      ai.push(...ins)
      const e = edit(b, kinds[i], i)
      aiOf.push(e)
      if (e != null) ai.push(e)
    })
    return { ai, aiOf, inserted }
  }

  /** 사람이 반복 블록 target 끝에 MARK 를 붙였을 때, 결과에서 MARK 블록이 그 회차의 고유 이웃 옆에 있는지. */
  const expectAtSection = (
    blocks: string[],
    kinds: Kind[],
    t: ReturnType<typeof transform>,
    target: number,
    label: string,
  ) => {
    const cur = blocks.map((b, i) => (i === target ? b + MARK : b))
    const out = splitBlocks(mergeMarkdown3(doc(...blocks), doc(...cur), doc(...t.ai)).markdown)
    const at = out.findIndex((b) => b.includes(MARK))
    expect(at, `${label}: MARK 유실`).toBeGreaterThanOrEqual(0)
    const unique = (k: Kind) => k === 'h' || k === 'u' || k === 'p'
    const next = target + 1
    if (next < blocks.length && unique(kinds[next]) && t.aiOf[next] != null && !t.inserted[next]) {
      expect(out[at + 1], `${label}: 다음 이웃`).toBe(t.aiOf[next])
    } else {
      expect(out[at - 1], `${label}: 이전 이웃`).toBe(t.aiOf[target - 1])
    }
  }

  /** 고유 이웃이 남아 있고(그쪽에 AI 삽입 없음) AI 가 지우지 않은 반복 블록인가. */
  const checkable = (kinds: Kind[], t: ReturnType<typeof transform>, i: number) => {
    if (kinds[i] !== 'rep' || t.aiOf[i] == null) return false
    const unique = (k: Kind) => k === 'h' || k === 'u' || k === 'p'
    const nextOk = i + 1 < kinds.length && unique(kinds[i + 1]) && t.aiOf[i + 1] != null && !t.inserted[i + 1]
    const prevOk = i > 0 && unique(kinds[i - 1]) && t.aiOf[i - 1] != null && !t.inserted[i]
    return nextOk || prevOk
  }

  it.each([
    ['paragraphs only', false],
    ['every unique block reworded too', true],
  ])('keeps an edit to a middle repeated heading in a 2100+ block log (%s)', (_label, all) => {
    const r = rng(all ? 31 : 30)
    const { blocks, kinds } = meetingLog(r, 2100)
    const last = blocks.length - 1
    const t = transform(
      blocks,
      kinds,
      (b, k, i) => {
        if (i === 0 || i === last) return `${b} (AI)`
        if (k === 'p') return reword(r, b)
        if (all && k === 'h') return `${b} (정리)`
        if (all && k === 'u') return `${b} 외`
        return b
      },
      () => [],
    )
    const mid = Math.floor(blocks.length / 2)
    for (const kind of ['### 액션 아이템', '### 참석자', '---']) {
      let target = mid
      while (blocks[target] !== kind) target++
      expectAtSection(blocks, kinds, t, target, kind)
    }
  })

  it('never anchors a repeated block to the wrong copy (exact anchors are unique blocks only)', () => {
    // 옛 LCS 앵커: 기준 두 번째 소제목이 AI 첫 번째 소제목 과 짝지어져 문단2 가 "AI 가 지움"이 됐다.
    const base = [P(1), '### 참석자', P(2), '### 참석자', P(3)]
    const other = [P(1, 'x'), '### 참석자', P(2, 'x'), '### 참석자 (정리)', P(3, 'x')]
    expect(alignBlocks(base, other)).toEqual([0, 1, 2, 3, 4])
    const cur = doc(P(1), '### 참석자', `사람 ${P(2)}`, '### 참석자', P(3))
    expect(mergeMarkdown3(doc(...base), cur, doc(...other))).toEqual({
      markdown: doc(P(1, 'x'), '### 참석자', `사람 ${P(2, 'x')}`, '### 참석자 (정리)', P(3, 'x')),
      conflicts: 0,
    })
  })

  it('does not move an edit to a neighbouring meeting when the AI inserted 100 blocks (800 blocks)', () => {
    const r = rng(40)
    const { blocks, kinds } = meetingLog(r, 800)
    let section = 0
    const t = transform(
      blocks,
      kinds,
      (b, k) => {
        if (k === 'h') section++
        if (k === 'p') return reword(r, b)
        if (section % 2 === 0 && (k === 'h' || k === 'rep')) return `${b} (정리)`
        return b
      },
      (i) => (i === 200 ? Array.from({ length: 100 }, () => para(r)) : []),
    )
    const target = blocks.findIndex((b, i) => i >= 400 && kinds[i] === 'p' && / \d+-0 /.test(b))
    const cur = blocks.map((b, i) => (i === target ? b + MARK : b))
    const out = mergeMarkdown3(doc(...blocks), doc(...cur), doc(...t.ai))
    expect(out.markdown).toContain(t.aiOf[target]! + MARK)
    expect(out.conflicts).toBe(0)
  })

  it.each([50, 600, 3000])('keeps an edit to a random repeated copy at its own section (templated log, N=%i)', (n) => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = rng(n * 7 + seed)
      const { blocks, kinds } = meetingLog(r, n)
      let skip = 0
      const t = transform(
        blocks,
        kinds,
        (b, k) => {
          if (skip > 0) {
            skip--
            return null
          }
          if (r() < 0.002) {
            skip = 65 + Math.floor(r() * 40)
            return null
          }
          if (k === 'p') return r() < 0.05 ? null : r() < 0.8 ? reword(r, b) : b
          if (k === 'h' || k === 'rep') return r() < 0.25 ? `${b} (정리)` : b
          if (k === 'u') return r() < 0.3 ? `${b} 외` : b
          return b
        },
        () => (r() < 0.003 ? Array.from({ length: 65 + Math.floor(r() * 40) }, () => para(r)) : r() < 0.03 ? [para(r)] : []),
      )
      const choices = blocks.map((_, i) => i).filter((i) => checkable(kinds, t, i))
      const target = choices[Math.floor(r() * choices.length)]
      expectAtSection(blocks, kinds, t, target, `seed ${seed} target ${target}`)
    }
  })
})

describe('mergeMarkdown3 — 반복 블록을 공통 앞뒤 떼기로 짝짓지 않는다(리뷰 fix 4)', () => {
  // 같은 틀의 회의록 — 회차 제목·문단만 고유하고 나머지(참석자·액션 아이템·구분선)는 회차마다 똑같다.
  const meeting = (n: string, polished = false) => {
    const end = polished ? '습니다.' : '다.'
    return [
      `## 회의록 ${n}회차`,
      '### 참석자',
      '김철수, 이영희',
      '### 논의 내용',
      `${n}회차 첫 안건을 검토했${end}`,
      `${n}회차 둘째 안건은 다음 회의로 넘겼${end}`,
      '### 액션 아이템',
      '- [ ] 후속 확인',
      '---',
    ]
  }
  const TAIL = ['### 액션 아이템', '- [ ] 후속 확인', '---']
  const EDITS: Record<string, string> = {
    '### 액션 아이템': '### 액션 아이템 (사람)',
    '- [ ] 후속 확인': '- [ ] 후속 확인 (사람)',
    '---': '--- (사람)',
  }
  // 사람이 6회차 꼬리 블록 하나를 고친 현재본.
  const personEdit = (base: string[], target: string) => {
    const at = base.indexOf('## 회의록 6회차') + 1 + meeting('6').slice(1).indexOf(target)
    return base.map((b, i) => (i === at ? EDITS[target] : b))
  }
  // 결과에서 6회차 구간(다음 회차 제목 전까지)에 사람 수정이 있어야 한다.
  const expectInMeeting6 = (merged: string, target: string) => {
    const blocks = splitBlocks(merged)
    const start = blocks.indexOf('## 회의록 6회차')
    let end = blocks.findIndex((b, i) => i > start && b.startsWith('## 회의록'))
    if (end < 0) end = blocks.length
    expect(blocks.slice(start, end)).toContain(EDITS[target])
    expect(blocks.filter((b) => b === EDITS[target])).toHaveLength(1)
  }

  it.each(TAIL)('(a) keeps the edit to meeting 6 %s in meeting 6 when the AI inserted a templated meeting 6.5 after it', (target) => {
    const base = [...meeting('6'), ...meeting('7')]
    const ai = [...meeting('6', true), ...meeting('6.5'), ...meeting('7')]
    const r = mergeMarkdown3(joinBlocks(base), joinBlocks(personEdit(base, target)), joinBlocks(ai))
    expect(r.conflicts).toBe(0)
    expectInMeeting6(r.markdown, target)
    expect(r.markdown).toContain('6회차 첫 안건을 검토했습니다.')
  })

  it.each(TAIL)('(b) keeps the edit to meeting 6 %s when the AI deleted meetings 7-8 and reworded', (target) => {
    const base = [...meeting('6'), ...meeting('7'), ...meeting('8'), ...meeting('9')]
    const ai = [...meeting('6', true), ...meeting('9', true)]
    const r = mergeMarkdown3(joinBlocks(base), joinBlocks(personEdit(base, target)), joinBlocks(ai))
    expect(r.conflicts).toBe(0)
    expectInMeeting6(r.markdown, target)
    expect(r.markdown).not.toContain('## 회의록 7회차')
    expect(r.markdown).not.toContain('## 회의록 8회차')
  })

  it('keeps the edit to meeting 6 when the AI deleted a run starting right after it that ends inside meeting 8', () => {
    // 지운 구간(6회차 구분선 ~ 8회차 체크 항목) 안에 6회차 꼬리와 똑같은 사본이 있다 — 틈 안 상대 위치로는 그 사본이 더 가까워 보인다.
    const m6 = meeting('6')
    const base = [...m6, ...meeting('7'), ...meeting('8'), ...meeting('9')]
    const keepTo = m6.indexOf('- [ ] 후속 확인') + 1
    const resume = 3 * m6.length - 1 // 8회차 구분선부터 다시 남긴다.
    const ai = [...meeting('6', true).slice(0, keepTo), ...base.slice(resume, 3 * m6.length), ...meeting('9', true)]
    const r = mergeMarkdown3(joinBlocks(base), joinBlocks(personEdit(base, '- [ ] 후속 확인')), joinBlocks(ai))
    expect(r.conflicts).toBe(0)
    expectInMeeting6(r.markdown, '- [ ] 후속 확인')
  })

  it('still pairs an unchanged run of identical blocks one-to-one', () => {
    const blocks = ['---', '---', '- [ ] 후속 확인', '---']
    expect(alignBlocks(blocks, [...blocks])).toEqual([0, 1, 2, 3])
  })
})

describe('alignBlocks — 근접 동점은 작은 틈·큰 틈 모두 앞쪽(WP-325)', () => {
  // 고유 블록이 없는 채움(양쪽 같은 수) — 앞에 붙이면 틈이 MAX_GAP_CELLS(300k 칸)를 넘어 큰 틈(내용 사슬) 경로로 간다.
  const FILL = 600
  const filler = () => Array.from({ length: FILL }, () => '채움 문단은 계속 같은 말을 되풀이합니다')
  const X = P(7)
  const X2 = P(7, ' 다듬음')
  const T = '- [ ] 후속 확인'
  const cases: Array<[string, string[], string[], number[]]> = [
    // 기준 [X,X,X] ↔ [X′] — 앞 사본(기준 0)과 짝.
    ['three equal base copies vs one edited copy', [X, X, X], [X2], [0, -1, -1]],
    // 기준 [X] ↔ [X′,X′] — 앞 사본(상대 0)과 짝.
    ['one base copy vs two equal edited copies', [X], [X2, X2], [0]],
    // 리뷰 4차(525) 큰 틈 판 — 사람이 고친 T 바로 뒤부터 다음 T 까지 지웠다. 뒤 T 가 상대 위치로는 더 가깝다.
    ['a deletion starting right after the edited copy', [T, '---', '---', T, '---'], [T, '---'], [0, 1, -1, -1, -1]],
  ]

  it.each(cases)('small gap: %s', (_label, base, other, want) => {
    expect(alignBlocks(base, other)).toEqual(want)
  })

  it.each(cases)('large gap: %s', (_label, base, other, want) => {
    const b = [...filler(), ...base]
    const o = [...filler(), ...other]
    expect(b.length * o.length).toBeGreaterThan(300_000)
    expect(alignBlocks(b, o).slice(FILL)).toEqual(want.map((k) => (k < 0 ? k : FILL + k)))
  })
})

describe('reference definitions (리뷰 fix)', () => {
  it('keeps reference-definition lines as their own blocks', () => {
    expect(splitBlocks('[r]: http://a\n문단 [링크][r]\n\n[s]: http://b')).toEqual(['[r]: http://a', '문단 [링크][r]', '[s]: http://b'])
  })

  it('carries reference definitions through a merge', () => {
    const base = doc(P(1, ' [링크][r]'), '[r]: http://a', P(2))
    const cur = doc(P(1, ' [링크][r] 사람'), '[r]: http://a', P(2))
    const ai = doc(P(1, ' [링크][r]'), '[r]: http://a', P(2, ' AI'))
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: doc(P(1, ' [링크][r] 사람'), '[r]: http://a', P(2, ' AI')), conflicts: 0 })
  })
})

describe('closestBase', () => {
  // 저장 응답 version 의 기준본 후보 = [그 판의 실제 본문(병합본), 쓴 쪽이 제출한 본문]. 쓴 쪽이 어느 쪽에서 이어 썼는지 블록 차이로 고른다.
  const merged = doc(P(1), P(2), '다른 사람이 넣은 문단')
  const submitted = doc(P(1), P(2))

  it('picks the merged body when the writer continued from the response (it contains the merged-in block)', () => {
    expect(closestBase([merged, submitted], doc(P(1, ' 수정'), P(2), '다른 사람이 넣은 문단'))).toBe(merged)
  })

  it("picks the submitted body when the writer continued from its own text (old web ignores the response body)", () => {
    expect(closestBase([merged, submitted], doc(P(1, ' 이어 침'), P(2)))).toBe(submitted)
  })

  it('prefers the first candidate on a tie and returns the only candidate as is', () => {
    expect(closestBase([doc('가 문단'), doc('나 문단')], doc('다 문단'))).toBe(doc('가 문단'))
    expect(closestBase([submitted], merged)).toBe(submitted)
  })
})

describe('mergeMarkdown3 — 표 행·칸 단위 병합(Task 8 후속)', () => {
  // 공용 직렬화기 표기 그대로의 표(| a | b |, | --- |).
  const table = (head: string[], rows: string[][]) =>
    [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
  const HEAD = ['담당', '할 일', '기한']
  const ROWS = Array.from({ length: 6 }, (_, i) => [`담당자${i}`, `${i}번 할 일 내용`, `10/${10 + i}`])
  const edit = (rows: string[][], r: number, c: number, text: string) => rows.map((row, i) => (i === r ? row.map((x, k) => (k === c ? text : x)) : row))
  const around = (t: string) => doc('회의 메모', t, '끝 문단')

  it('keeps the person edit in row 3 and the AI edit in row 5', () => {
    const base = around(table(HEAD, ROWS))
    const cur = around(table(HEAD, edit(ROWS, 3, 1, '3번 할 일 내용 (사람)')))
    const ai = around(table(HEAD, edit(ROWS, 5, 2, '10/31')))
    const r = mergeMarkdown3(base, cur, ai)
    expect(r.conflicts).toBe(0)
    expect(r.markdown).toBe(around(table(HEAD, edit(edit(ROWS, 3, 1, '3번 할 일 내용 (사람)'), 5, 2, '10/31'))))
  })

  it('keeps both edits to different short cells of the same row', () => {
    // 칸이 짧아 행 전체 글자 패치의 문맥(앞뒤 8자)이 옆 칸 수정과 겹친다 — 칸 단위로 합쳐야 둘 다 남는다.
    const rows = [['1', 'O', 'X'], ['2', 'X', 'O'], ['3', 'O', 'O']]
    const r = mergeMarkdown3(around(table(['번호', '참석', '발표'], rows)), around(table(['번호', '참석', '발표'], edit(rows, 1, 1, 'O'))), around(table(['번호', '참석', '발표'], edit(rows, 1, 2, 'X'))))
    expect(r.conflicts).toBe(0)
    expect(r.markdown).toBe(around(table(['번호', '참석', '발표'], edit(edit(rows, 1, 1, 'O'), 1, 2, 'X'))))
  })

  it('keeps a row the AI added and the person edit to another row', () => {
    const added = [...ROWS.slice(0, 4), ['새 담당', '새 할 일', '11/2'], ...ROWS.slice(4)]
    const r = mergeMarkdown3(around(table(HEAD, ROWS)), around(table(HEAD, edit(ROWS, 1, 1, '1번 (사람)'))), around(table(HEAD, added)))
    expect(r.conflicts).toBe(0)
    expect(r.markdown).toBe(around(table(HEAD, edit(added, 1, 1, '1번 (사람)'))))
  })

  it('keeps the AI header rename and the person body edit', () => {
    const r = mergeMarkdown3(
      around(table(HEAD, ROWS)),
      around(table(HEAD, edit(ROWS, 0, 1, '0번 (사람)'))),
      around(table(['담당자', '할 일', '기한'], ROWS)),
    )
    expect(r.conflicts).toBe(0)
    expect(r.markdown).toBe(around(table(['담당자', '할 일', '기한'], edit(ROWS, 0, 1, '0번 (사람)'))))
  })

  it('takes the AI table and counts a conflict when the AI added a column', () => {
    const wide = around(table([...HEAD, '상태'], ROWS.map((row) => [...row, '진행'])))
    const r = mergeMarkdown3(around(table(HEAD, ROWS)), around(table(HEAD, edit(ROWS, 1, 1, '1번 (사람)'))), wide)
    expect(r.conflicts).toBe(1)
    expect(r.markdown).toBe(wide)
  })

  it('takes the AI cell and counts a conflict when both rewrote the same cell', () => {
    const r = mergeMarkdown3(around(table(HEAD, ROWS)), around(table(HEAD, edit(ROWS, 1, 2, '12/1'))), around(table(HEAD, edit(ROWS, 1, 2, '12/9'))))
    expect(r.conflicts).toBe(1)
    expect(r.markdown).toBe(around(table(HEAD, edit(ROWS, 1, 2, '12/9'))))
  })

  // 표가 많은 회의록 — 사람은 한 칸을 고치고, AI 는 다른 행을 고치거나 행을 넣고 지우고 문단을 다듬는다. 사람 칸과 AI 수정이 모두 남고
  // 결과의 모든 표는 열 수가 맞아야 한다.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const MARK = '사람ZQ'
  it.each([20, 120, 400])('keeps a person cell edit and every AI row edit in a table-heavy note (%i sections)', (sections) => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = rng(sections * 31 + seed)
      type Tbl = { head: string[]; rows: string[][] }
      const parts: Array<string | Tbl> = []
      for (let s = 0; s < sections; s++) {
        parts.push(`## ${s}회차`, `${s}회차 논의를 정리했다 ${Math.floor(r() * 1e6)}`)
        const cols = 2 + Math.floor(r() * 3)
        parts.push({
          head: Array.from({ length: cols }, (_, c) => `열${c}`),
          rows: Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i) => Array.from({ length: cols }, (_, c) => (c === 0 ? `${s}-${i}` : r() < 0.4 ? '-' : `값${Math.floor(r() * 1000)}`))),
        })
      }
      const render = (ps: Array<string | Tbl>) => doc(...ps.map((p) => (typeof p === 'string' ? p : table(p.head, p.rows))))
      const tables = parts.flatMap((p, k) => (typeof p === 'string' ? [] : [k]))
      const pk = tables[Math.floor(r() * tables.length)]
      const pt = parts[pk] as Tbl
      const prow = Math.floor(r() * pt.rows.length)
      const pcol = 1 + Math.floor(r() * (pt.head.length - 1))
      const cur = parts.map((p, k) => (k === pk ? { ...pt, rows: edit(pt.rows, prow, pcol, `${pt.rows[prow][pcol]} ${MARK}`) } : p))
      const aiMarks: string[] = []
      const ai = parts.map((p, k) => {
        if (typeof p === 'string') return r() < 0.5 ? `${p} 다듬음` : p
        // 지우기를 먼저 — 지운 행의 AI 표식은 기대하지 않는다.
        const kept = k !== pk && r() < 0.2 && p.rows.length > 1 ? p.rows.slice(0, -1) : p.rows
        let rows = kept.map((row, i) => {
          if ((k === pk && i === prow) || r() > 0.3) return row
          const mark = `AI${k}-${i}`
          aiMarks.push(mark)
          return row.map((x, c) => (c === p.head.length - 1 ? mark : x))
        })
        if (r() < 0.3) {
          const mark = `AI새${k}`
          aiMarks.push(mark)
          rows = [...rows.slice(0, 1), p.head.map(() => mark), ...rows.slice(1)]
        }
        return { ...p, rows }
      })
      const out = mergeMarkdown3(render(parts), render(cur), render(ai))
      const msg = `sections ${sections} seed ${seed}`
      expect(out.conflicts, msg).toBe(0)
      expect(out.markdown.split(MARK), msg).toHaveLength(2)
      for (const m of aiMarks) expect(out.markdown, `${msg} ${m}`).toContain(m)
      for (const t of splitBlocks(out.markdown).filter((b) => b.startsWith('|'))) {
        const counts = t.split('\n').map((l) => l.split('|').length)
        expect(new Set(counts).size, msg).toBe(1)
      }
    }
  })
})

describe('mergeMarkdown3 — 줄 안 강제 줄바꿈 표기(Task 8 후속)', () => {
  // 운영 입력은 모두 `\` + 줄바꿈 표기라(기준본·AI본 정규화, 현재본은 직렬화기 출력) 블록 병합은 표기를 맞추지 않는다(WP-329,
  // canonicalBreaks 제거). 표기가 섞인 운영 경로는 collab mergeJob.test.ts, 줄 끝 공백 뒤 역슬래시는 markdownCodec.test.ts(keepLive)가 본다.
  // 여기 남은 것은 다른 블록의 사람 수정 옆에서 원문 기준본(줄 끝 공백 둘)을 그대로 넣어도 문단이 두 번 나오지 않는 사례다.
  it('does not duplicate it when the current is the raw base either', () => {
    expect(mergeMarkdown3('앞 문단\n\n가  \n나', '앞 문단 사람\n\n가  \n나', '앞 문단\n\n가\n나').markdown).toBe('앞 문단 사람\n\n가\n나')
  })
})

describe('mergeMarkdown3 — 목록 항목·인용 안 자식 단위 병합(WP-326)', () => {
  // 사람은 한 자식(하위 항목·문단·표 칸)을, AI 는 같은 컨테이너의 다른 자식을 고친다. 고친 자리가 8자 안쪽이라 컨테이너 전체 글자 패치는
  // 문맥이 겹쳐 실패하고 AI 쪽이 이겼다 — 자식 단위로 다시 3-way 병합해 둘 다 남아야 한다.
  const normalize = (s: string) => docToMarkdown(markdownToDoc(s)).replace(/\s+$/, '')
  // 손으로 만든 입력도 운영 입력 규칙(직렬화기 표기)을 지키는지 함께 확인한다.
  const around = (t: string) => {
    const s = doc('앞 문단', t, '뒤 문단')
    expect(normalize(s)).toBe(s)
    return s
  }

  it('keeps the person edit to one sub-item and the AI edit to its sibling (nested list)', () => {
    const base = around('- 준비\n  - 가\n  - 나\n- 다음')
    const cur = around('- 준비\n  - 가 사람\n  - 나\n- 다음')
    const ai = around('- 준비\n  - 가\n  - 나 AI\n- 다음')
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: around('- 준비\n  - 가 사람\n  - 나 AI\n- 다음'), conflicts: 0 })
  })

  it('keeps both edits to repeated checklist sub-items whose text repeats', () => {
    const item = (a: string, b: string) => around(`- 회의 준비\n  - \\[ \\] 확인${a}\n  - \\[ \\] 확인${b}`)
    expect(mergeMarkdown3(item('', ''), item(' 함', ''), item('', ' 끝'))).toEqual({ markdown: item(' 함', ' 끝'), conflicts: 0 })
  })

  it('keeps edits to different paragraphs of the same quote', () => {
    const q = (a: string, b: string) => around(`> 가${a}\n>\n> 나${b}`)
    expect(mergeMarkdown3(q('', ''), q(' 사람', ''), q('', ' AI'))).toEqual({ markdown: q(' 사람', ' AI'), conflicts: 0 })
  })

  it('keeps edits to different items of a list inside a quote', () => {
    const q = (a: string, b: string) => around(`> 메모\n>\n> - 가${a}\n> - 나${b}`)
    expect(mergeMarkdown3(q('', ''), q(' 사람', ''), q('', ' AI'))).toEqual({ markdown: q(' 사람', ' AI'), conflicts: 0 })
  })

  it('keeps edits to different cells of a table inside a list item', () => {
    const t = (x: string, y: string) => around(`- 표\n\n  | 참석 | 발표 |\n  | --- | --- |\n  | ${x} | ${y} |\n\n- 끝`)
    // 최상위 목록 항목 사이 구분(줄바꿈 하나)은 joinBlocks 정책이라 블록 단위로 비교한다.
    const out = mergeMarkdown3(t('O', 'X'), t('X', 'X'), t('O', 'O'))
    expect(out.conflicts).toBe(0)
    expect(splitBlocks(out.markdown)).toEqual(splitBlocks(t('X', 'O')))
  })

  it('keeps edits to different cells of a table inside a quote', () => {
    const t = (x: string, y: string) => around(`> | 참석 | 발표 |\n> | --- | --- |\n> | ${x} | ${y} |`)
    expect(mergeMarkdown3(t('O', 'X'), t('X', 'X'), t('O', 'O'))).toEqual({ markdown: t('X', 'O'), conflicts: 0 })
  })

  it('keeps the person edit near the start of an item the AI renumbered', () => {
    // AI 가 2번 앞에 항목을 넣어 뒤 번호가 밀렸다. 사람은 밀린 짧은 항목 앞쪽을 고쳤다 — 번호와 사람 수정이 겹쳐 글자 패치가 실패했다.
    const base = around('1. 첫째 항목입니다\n2. 짧음\n3. 마지막 항목입니다')
    const cur = around('1. 첫째 항목입니다\n2. 꼭 짧음\n3. 마지막 항목입니다')
    const ai = around('1. 첫째 항목입니다\n2. AI 가 넣은 새 항목\n3. 짧음\n4. 마지막 항목입니다')
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: around('1. 첫째 항목입니다\n2. AI 가 넣은 새 항목\n3. 꼭 짧음\n4. 마지막 항목입니다'), conflicts: 0 })
  })

  it('keeps continuation lines aligned when the AI renumbering widens the marker (9. → 10.)', () => {
    const items = (n: number, pad: boolean, last: string) =>
      Array.from({ length: n }, (_, i) => `${pad && i + 1 < 10 ? ' ' : ''}${i + 1}. 항목${i}${i === 8 ? last : ''}`).join('\n')
    const withSub = (s: string, sub: string) => s.replace(/(\d+\. 항목8[^\n]*)/, `$1\n${sub}`)
    const base = around(withSub(items(9, false, ''), '   - 가\n   - 나'))
    const cur = around(withSub(items(9, false, ''), '   - 가 사람\n   - 나'))
    // AI 가 앞에 항목을 넣어 9번 항목이 10번이 되고 번호 폭이 넓어졌다(직렬화기는 1~9 번에 앞 공백을 붙인다).
    const aiItems = [' 1. 새 항목', ...items(9, true, '').split('\n').map((l, i) => l.replace(/^ ?\d+\./, `${i + 2 < 10 ? ' ' : ''}${i + 2}.`))].join('\n')
    const ai = around(withSub(aiItems, '    - 가\n    - 나 AI'))
    const out = mergeMarkdown3(base, cur, ai)
    expect(out.conflicts).toBe(0)
    expect(out.markdown).toBe(around(withSub(aiItems, '    - 가 사람\n    - 나 AI')))
  })

  it('takes the AI number without a conflict when both sides renumbered an item differently', () => {
    // 사람은 위에 하나, AI 는 위에 둘을 넣어 같은 항목 번호가 3·4 로 갈렸다 — 둘째 이후 번호는 표시용이라 AI 번호, 충돌 아님.
    const base = around('1. 가\n2. 짧음\n3. 끝')
    const cur = around('1. 가\n2. 사람 새\n3. 꼭 짧음\n4. 끝')
    const ai = around('1. AI 새 하나\n2. AI 새 둘\n3. 가\n4. 짧음 AI\n5. 끝')
    const out = mergeMarkdown3(base, cur, ai)
    expect(out.conflicts).toBe(0)
    expect(splitBlocks(out.markdown)).toContain('4. 꼭 짧음 AI')
    expect(out.markdown).toContain('사람 새')
  })

  it('takes the AI start number and counts a conflict when both changed the first item number differently', () => {
    // 첫 항목 번호는 목록 시작 번호라 뜻이 있다 — 표시용 번호 다시 매기기로 보지 않는다.
    const base = around('1. 가 항목입니다\n2. 나')
    const cur = around('3. 가 항목입니다 사람\n4. 나')
    const ai = around('5. AI 가 항목입니다\n6. 나')
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: around('5. AI 가 항목입니다 사람\n6. 나'), conflicts: 1 })
  })

  it('counts a conflict when the AI changed the number delimiter while the person renumbered', () => {
    // 구분자(. ↔ ))가 바뀌면 다른 목록이 된다 — 번호 다시 매기기가 아니다(직렬화기는 .만 쓰므로 원문 그대로 넣는다).
    const out = mergeMarkdown3('1. 가\n2. 나 항목입니다', '1. 가\n3. 나 항목입니다 사람', '1. 가\n4) AI 나 항목입니다')
    expect(out.conflicts).toBe(1)
    expect(out.markdown).toContain('4) AI 나 항목입니다 사람')
  })

  it('keeps edits in a tight item that holds a loose sub-list', () => {
    // 항목 자신의 자식(문단 ↔ 하위 목록)은 촘촘하고 하위 목록만 느슨하다 — 안쪽의 빈 줄 하나로 항목 전체를 느슨하다고 보면 안 된다.
    // 공용 직렬화기는 이 모양을 `- a\n\n  - b\n\n  - c` 로 쓰므로(운영 입력엔 안 나온다) 원문 그대로 넣는다.
    const t = (a: string, c: string) => doc('앞 문단', `- a${a}\n  - b\n\n  - c${c}`, '뒤 문단')
    const out = mergeMarkdown3(t('', ''), t(' 사람', ''), t('', ' AI'))
    expect(out.conflicts).toBe(0)
    expect(splitBlocks(out.markdown)).toEqual(splitBlocks(t(' 사람', ' AI')))
  })

  it('merges a 60-deep ~3000-line nested list with bounded parsing work (depth cap, no per-level reparse)', () => {
    // 병합은 실시간 문서 잠금 안에서 돈다 — 깊은 중첩에서 단계마다 하위 트리를 다시 파싱하면 수 초가 걸렸다.
    // 시계 대신 작업량(markdown-it 파싱 횟수·파싱한 줄 수)을 본다 — 모듈의 파서 인스턴스도 원형 메서드를 쓰므로 원형을 엿본다.
    const nested = (depth: number, mark: (d: number, k: number) => string) => {
      const per = Math.floor(3000 / depth) - 1
      const lines: string[] = []
      for (let d = 0; d < depth; d++) {
        lines.push(`${'  '.repeat(d)}- 단계 ${d} 머리`)
        for (let k = 0; k < per; k++) lines.push(`${'  '.repeat(d + 1)}- 잎 ${d}-${k}${mark(d, k)}`)
      }
      return lines.join('\n')
    }
    const base = nested(60, () => '')
    const cur = nested(60, (d, k) => (d === 59 && k === 1 ? ' 사람' : ''))
    const ai = nested(60, (d, k) => (d === 59 && k === 30 ? ' AI' : ''))
    const parse = vi.spyOn(MarkdownIt.prototype, 'parse')
    let out: ReturnType<typeof mergeMarkdown3>
    let calls: string[]
    try {
      out = mergeMarkdown3(base, cur, ai)
      calls = parse.mock.calls.map(([src]) => String(src))
    } finally {
      parse.mockRestore() // 기록도 지워지므로 위에서 먼저 옮겨 둔다
    }
    const lines = calls.reduce((n, src) => n + src.split('\n').length, 0)
    expect(out.markdown).toContain('잎 59-1 사람')
    expect(out.markdown).toContain('잎 59-30 AI')
    expect(calls.length).toBeLessThanOrEqual(20)
    expect(lines).toBeLessThanOrEqual(15 * 3000)
    // 거친 안전망(시계) — 작업량이 같아도 다른 곳이 크게 느려지면 잡는다. 셋 중 가장 빠른 값만 본다.
    const times = [0, 1, 2].map(() => {
      const started = performance.now()
      mergeMarkdown3(base, cur, ai)
      return performance.now() - started
    })
    expect(Math.min(...times)).toBeLessThan(1500)
  })

  it('preserves a tight item with a sub-list and a loose item with two paragraphs', () => {
    const loose = (a: string, b: string) => around(`- 가${a}\n\n  나${b}\n\n- 다`)
    const out = mergeMarkdown3(loose('', ''), loose(' 사람', ''), loose('', ' AI'))
    expect(out.conflicts).toBe(0)
    expect(splitBlocks(out.markdown)).toEqual(splitBlocks(loose(' 사람', ' AI')))
    expect(splitBlocks(out.markdown)[1]).toBe('- 가 사람\n\n  나 AI')
  })

  it('falls back to the AI side when the person wrote a lazy continuation line', () => {
    const base = around('> 가\n>\n> 나')
    const cur = doc('앞 문단', '> 가 사람\n지연 줄\n>\n> 나', '뒤 문단')
    const ai = around('> 가\n>\n> 나 AI')
    expect(mergeMarkdown3(base, cur, ai)).toEqual({ markdown: ai, conflicts: 1 })
  })

  it('takes the AI child and counts one conflict when both rewrote the same sub-item', () => {
    // 같은 낱말을 양쪽이 다르게 바꿈 — 그 하위 항목만 AI 쪽(충돌 1), 다른 자식의 사람 수정은 남는다.
    const base = around('- 준비\n  - 가 항목\n  - 나')
    const out = mergeMarkdown3(base, around('- 준비 사람\n  - 사람 항목\n  - 나'), around('- 준비\n  - AI 항목\n  - 나'))
    expect(out).toEqual({ markdown: around('- 준비 사람\n  - AI 항목\n  - 나'), conflicts: 1 })
  })

  // 무작위 컨테이너(목록·번호 목록·하위 목록·인용)에서 양쪽이 서로 다른 자식을 고치면 둘 다 남고, 결과는 같은 블록 구성으로 다시 읽혀야 한다.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const WORDS = ['가', '나', '다', '확인', '자료', '보고', 'x', 'ok', '정리']
  it('keeps both non-overlapping child edits in random small lists and quotes (seeded)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed)
      const pick = () => WORDS[Math.floor(r() * WORDS.length)]
      // 0 글머리+하위, 1 번호+하위, 2 인용 문단, 3 인용 안 목록, 4 인용 안 번호 목록(AI 삽입 시 번호 밀림), 5 느슨한 항목(문단 여럿)
      const kind = Math.floor(r() * 6)
      const n = 2 + Math.floor(r() * 4)
      // 번호 목록(4)은 자식 글이 겹치지 않게 한다 — 번호가 블록 글자에 들어 있어, 같은 글 항목이 번호 밀림 뒤 엉뚱한 사본과 짝지어지는 것은
      // 최상위 번호 목록에도 있는 기존 짝짓기 한계(WP-326 범위 밖, 보고서 참고)다.
      const kids = Array.from({ length: n }, (_, i) => `${pick()} ${pick()}${kind === 4 ? ` ${i}` : ''}`)
      const p = Math.floor(r() * n)
      let a = Math.floor(r() * (n - 1))
      if (a >= p) a++
      const aiInsert = r() < 0.3
      const build = (ks: string[]) => {
        if (kind === 0) return `- 머리\n${ks.map((k) => `  - ${k}`).join('\n')}`
        if (kind === 1) return `1. 머리\n${ks.map((k) => `   - ${k}`).join('\n')}\n2. 꼬리`
        if (kind === 2) return ks.map((k) => `> ${k}`).join('\n>\n')
        if (kind === 3) return `> 머리\n>\n${ks.map((k) => `> - ${k}`).join('\n')}`
        if (kind === 4) return ks.map((k, i) => `> ${i + 1}. ${k}`).join('\n')
        return `- 머리\n\n${ks.map((k) => `  ${k}`).join('\n\n')}\n\n- 꼬리`
      }
      const curKids = kids.map((k, i) => (i === p ? `${k} 사람ZQ` : k))
      const aiKids = kids.map((k, i) => (i === a ? `${k} AIZQ` : k))
      if (aiInsert) aiKids.splice(Math.floor(r() * (n + 1)), 0, '새 자식 AINEW')
      const wrap = (s: string) => doc('앞 문단', s, '뒤 문단')
      const [base, cur, ai] = [kids, curKids, aiKids].map((ks) => normalize(wrap(build(ks))))
      const msg = `seed ${seed} kind ${kind}\n${base}\n---\n${cur}\n---\n${ai}`
      const out = mergeMarkdown3(base, cur, ai)
      expect(out.markdown, msg).toContain('사람ZQ')
      expect(out.markdown, msg).toContain('AIZQ')
      if (aiInsert) expect(out.markdown, msg).toContain('AINEW')
      expect(out.conflicts, msg).toBe(0)
      // 다시 읽어도 같은 블록 구성(컨테이너 종류·개수)이어야 한다 — 목록이 쪼개지거나 인용이 풀리면 안 된다.
      const shape = (s: string) => splitBlocks(s).map((b) => b[0])
      expect(shape(out.markdown), msg).toEqual(shape(ai))
      // 직렬화기를 거쳐도 블록이 그대로여야 한다(최상위 느슨한 목록 항목 사이 빈 줄은 joinBlocks 정책상 줄바꿈 하나라 블록으로 비교).
      expect(splitBlocks(normalize(out.markdown)), msg).toEqual(splitBlocks(out.markdown))
    }
  })
})
