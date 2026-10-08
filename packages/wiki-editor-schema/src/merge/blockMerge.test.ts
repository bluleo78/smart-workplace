import { describe, expect, it } from 'vitest'

import { alignBlocks, applyExactPatch, closestBase, joinBlocks, mergeMarkdown3, similarity, splitBlocks } from './blockMerge'

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
  it('does not duplicate a paragraph whose hard break is written with trailing spaces in the base and a backslash in the current', () => {
    const r = mergeMarkdown3('가  \n나', '가\\\n나', '가\n나')
    expect(r.markdown).toBe('가\n나')
    expect(r.markdown.match(/가/g)).toHaveLength(1)
  })

  it('does not duplicate it when the current is the raw base either', () => {
    expect(mergeMarkdown3('앞 문단\n\n가  \n나', '앞 문단 사람\n\n가  \n나', '앞 문단\n\n가\n나').markdown).toBe('앞 문단 사람\n\n가\n나')
  })

  it('keeps a person edit next to a hard break written in the other notation', () => {
    const r = mergeMarkdown3('첫 줄 내용입니다  \n둘째 줄 내용입니다', '첫 줄 내용입니다\\\n둘째 줄 내용입니다 사람', '첫 줄 내용입니다 AI\\\n둘째 줄 내용입니다')
    expect(r).toEqual({ markdown: '첫 줄 내용입니다 AI\\\n둘째 줄 내용입니다 사람', conflicts: 0 })
  })

  // 끝 공백이 강제 줄바꿈이 아닌 곳(다음 줄이 같은 문단을 잇지 않음)에 역슬래시를 만들면 글자 `\` 가 남는다(리뷰 5차).
  it.each([
    ['a nested list item', '- 안건\n  - 하위\n\n끝 문단', '- 안건  \n  - 하위\n\n끝 문단'],
    ['a blockquote paragraph break', '> 첫\n>\n> 둘\n\n끝 문단', '> 첫  \n>\n> 둘\n\n끝 문단'],
    ['a setext underline', '제목\n===\n\n끝 문단', '제목  \n===\n\n끝 문단'],
  ])('does not turn trailing spaces before %s into a backslash', (_n, base, cur) => {
    const r = mergeMarkdown3(base, cur, base.replace('끝 문단', '끝 문단 AI'))
    expect(r.conflicts).toBe(0)
    expect(r.markdown).not.toContain('\\')
    expect(r.markdown).toBe(cur.replace('끝 문단', '끝 문단 AI'))
  })

  it('still canonicalizes real hard breaks inside a list item and a blockquote', () => {
    expect(mergeMarkdown3('- 가  \n  나\n\n끝', '- 가\\\n  나\n\n끝', '- 가\n  나\n\n끝').markdown).toBe('- 가\n  나\n\n끝')
    expect(mergeMarkdown3('> 가  \n> 나', '> 가\\\n> 나', '> 가\n> 나').markdown).toBe('> 가\n> 나')
  })

  it('canonicalizes only the real hard break when one block has both kinds', () => {
    const base = '- 가  \n  나  \n  - 하위'
    const r = mergeMarkdown3(base, '- 가\\\n  나  \n  - 하위', '- 가\\\n  나 AI\n  - 하위')
    expect(r).toEqual({ markdown: '- 가\\\n  나 AI\n  - 하위', conflicts: 0 })
  })

  it('leaves trailing spaces inside code alone', () => {
    const code = '```\na  \nb\n```'
    expect(mergeMarkdown3(code, code, `${code}\n\n추가`).markdown).toBe(`${code}\n\n추가`)
  })
})
