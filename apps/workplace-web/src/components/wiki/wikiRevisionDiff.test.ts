// @vitest-environment jsdom
import { markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { buildRevisionDiff, revisionDiffDecorations, type RevisionDiffMark } from './wikiRevisionDiff'

/** 표시를 위치 대신 글자로 읽는다 — 범위 표시는 그 범위 글자, 위젯은 끼울 글자. */
function read(doc: PMNode, marks: RevisionDiffMark[]) {
  return marks.map((m) => (m.kind === 'added-text' ? { kind: m.kind, text: m.text } : { kind: m.kind, text: doc.textBetween(m.from, m.to, '\n') }))
}

/** 두 마크다운 판의 차이 — 결과 문서가 스키마상 유효한지도 매번 확인한다(케이스 9). */
function diff(fromMd: string, toMd: string) {
  const result = buildRevisionDiff(markdownToDoc(fromMd), markdownToDoc(toMd))
  expect(() => result.doc.check()).not.toThrow()
  return { ...result, read: read(result.doc, result.marks) }
}

/** 최상위 블록 종류 목록. */
const topTypes = (doc: PMNode) => {
  const out: string[] = []
  doc.forEach((n) => out.push(n.type.name))
  return out
}

describe('buildRevisionDiff', () => {
  it('같은 문서면 표시가 없고 내용도 그대로다', () => {
    const md = '# 제목\n\n본문 문단\n\n- 하나\n- 둘'
    const { doc, marks } = diff(md, md)
    expect(marks).toEqual([])
    expect(doc.eq(markdownToDoc(md))).toBe(true)
  })

  it('문단 글자가 바뀌면 지운 글자는 범위, 새 글자는 위젯으로 표시한다', () => {
    const { read: r, doc } = diff('안녕 세상', '안녕 노트')
    expect(r).toEqual([
      { kind: 'removed-text', text: '세상' },
      { kind: 'added-text', text: '노트' },
    ])
    // 문서는 보는 판 그대로(새 글자는 위젯이라 본문에 들어가지 않는다).
    expect(doc.textContent).toBe('안녕 세상')
  })

  it('끝에 문단을 더하면 그 문단을 끼워 넣고 added-node 로 표시한다', () => {
    const { read: r, doc } = diff('첫 문단\n\n둘째 문단', '첫 문단\n\n둘째 문단\n\n새로 쓴 문단')
    expect(r).toEqual([{ kind: 'added-node', text: '새로 쓴 문단' }])
    expect(doc.childCount).toBe(3)
  })

  it('처음 문단을 지우면 그 문단만 removed-node 로 표시한다', () => {
    const { read: r, doc } = diff('지울 문단\n\n남는 문단\n\n끝 문단', '남는 문단\n\n끝 문단')
    expect(r).toEqual([{ kind: 'removed-node', text: '지울 문단' }])
    expect(doc.childCount).toBe(3)
  })

  it('순서 목록 항목 낱말만 바뀌면 그 항목만 표시하고 목록은 하나로 번호를 유지한다', () => {
    // 낱말 하나뿐인 항목 — 겹치는 낱말이 없지만 글자는 겹쳐 블록 안 교체(지운 낱말 + 새 낱말 위젯)로 보인다.
    const { read: r, doc } = diff('1. a\n2. b\n3. 셋', '1. a\n2. b\n3. 셋째')
    expect(r).toEqual([
      { kind: 'removed-text', text: '셋' },
      { kind: 'added-text', text: '셋째' },
    ])
    expect(topTypes(doc)).toEqual(['orderedList'])
    expect(doc.firstChild!.childCount).toBe(3)
  })

  it('표 셀이 바뀌면 표를 통째로 지움·추가로 표시한다', () => {
    const table = (cell: string) => `| 이름 | 값 |\n| --- | --- |\n| 가 | ${cell} |`
    const { read: r, doc } = diff(`앞\n\n${table('1')}`, `앞\n\n${table('2')}`)
    expect(r.map((m) => m.kind)).toEqual(['removed-node', 'added-node'])
    expect(r[0].text).toContain('1')
    expect(r[1].text).toContain('2')
    expect(topTypes(doc)).toEqual(['paragraph', 'table', 'table'])
  })

  it('코드 블록 한 줄이 바뀌면 글자 단위로 표시하고 코드 블록은 하나다', () => {
    const { read: r, doc } = diff('```\nconst a = 1\nconst b = 2\n```', '```\nconst a = 1\nconst b = 3\n```')
    expect(r).toEqual([
      { kind: 'removed-text', text: '2' },
      { kind: 'added-text', text: '3' },
    ])
    expect(topTypes(doc)).toEqual(['codeBlock'])
  })

  it('같은 이미지 앞뒤 문단만 바뀌면 이미지는 표시하지 않는다', () => {
    const img = '![그림](https://example.com/a.png)'
    const { doc, marks } = diff(`앞 문단 하나\n\n${img}\n\n뒤 문단 하나`, `앞 문단 둘\n\n${img}\n\n뒤 문단 둘`)
    const imagePos: number[] = []
    doc.descendants((n, pos) => {
      if (n.type.name === 'image') imagePos.push(pos)
    })
    expect(imagePos).toHaveLength(1)
    for (const m of marks) {
      if (m.kind === 'added-text') continue
      // 이미지 노드를 덮는 표시가 없어야 한다.
      expect(m.from <= imagePos[0] && m.to > imagePos[0]).toBe(false)
    }
    expect(read(doc, marks).filter((m) => m.kind === 'added-text').map((m) => m.text)).toEqual(['둘', '둘'])
  })

  it('줄바꿈(인라인 노드) 뒤 글자 변경도 정확한 위치를 가리킨다', () => {
    const { read: r, doc } = diff('첫 줄\\\n둘째 줄 세상', '첫 줄\\\n둘째 줄 노트')
    let breaks = 0
    doc.descendants((n) => {
      if (n.type.name === 'hardBreak') breaks++
    })
    expect(breaks).toBe(1)
    expect(r).toEqual([
      { kind: 'removed-text', text: '세상' },
      { kind: 'added-text', text: '노트' },
    ])
  })

  it('줄바꿈 바로 뒤 낱말이 바뀌면 지운 범위는 줄바꿈 뒤(다음 줄 시작)부터다', () => {
    const { doc, marks, read: r } = diff('abc\\\ndef', 'abc\\\nXdef')
    expect(r).toEqual([
      { kind: 'removed-text', text: 'def' },
      { kind: 'added-text', text: 'Xdef' },
    ])
    const m = marks[0]
    if (m.kind !== 'removed-text') throw new Error('removed-text 여야 한다')
    expect(doc.resolve(m.from).nodeBefore?.type.name).toBe('hardBreak')
  })

  it('지운 줄바꿈은 지운 글자 범위에 들고, 더한 줄바꿈은 위젯에 ↵ 로 보인다', () => {
    // 겹치는 낱말이 없으니(abc·↵·def vs abcdef) 블록 안 전체 교체 — 지운 범위에 줄바꿈이 든다.
    const removed = diff('abc\\\ndef', 'abcdef')
    expect(removed.read.map((m) => m.kind)).toEqual(['removed-text', 'added-text'])
    const rm = removed.marks[0]
    expect(rm.kind).toBe('removed-text')
    if (rm.kind !== 'removed-text') return
    let breakInRange = false
    removed.doc.nodesBetween(rm.from, rm.to, (n) => {
      if (n.type.name === 'hardBreak') breakInRange = true
    })
    expect(breakInRange).toBe(true)

    const added = diff('abcdef', 'abc\\\ndef')
    expect(added.read).toEqual([
      { kind: 'removed-text', text: 'abcdef' },
      { kind: 'added-text', text: 'abc↵def' },
    ])
  })

  it('순서 목록 시작 번호(attrs)만 바뀌면 목록 통째 지움+추가로 표시한다', () => {
    const { read: r } = diff('1. a\n2. b', '3. a\n4. b')
    expect(r.map((m) => m.kind)).toEqual(['removed-node', 'added-node'])
  })

  it('한국어 어절은 쪼개지 않고 낱말 단위로 지움·추가한다', () => {
    const { read: r } = diff('노트 동시 편집은 CRDT 없이 병합으로 간다.', '노트 동시 편집은 Yjs로 간다.')
    expect(r).toEqual([
      { kind: 'removed-text', text: 'CRDT 없이 병합으로' },
      { kind: 'added-text', text: 'Yjs로' },
    ])
  })

  it('낱말 사이에 낱말을 끼우면 끼운 낱말(과 공백)만 추가로 보인다', () => {
    const { read: r } = diff('회의는 내일 한다', '회의는 내일 오후에 한다')
    expect(r).toEqual([{ kind: 'added-text', text: '오후에 ' }])
  })

  it('공통 글자가 없는 짧은 문단끼리는 글자 diff 대신 블록 지움+추가로 표시한다', () => {
    const { read: r } = diff('사과', '바나나')
    expect(r).toEqual([
      { kind: 'removed-node', text: '사과' },
      { kind: 'added-node', text: '바나나' },
    ])
  })

  it('스키마 인스턴스가 다른 문서(라이브 에디터 vs 리비전)도 바뀐 글자만 표시한다', () => {
    const editor = new Editor({ extensions: wikiSchemaExtensions() })
    editor.commands.setContent('# 제목\n\n안녕 노트\n\n- 하나', false)
    const live = editor.state.doc
    const revision = markdownToDoc('# 제목\n\n안녕 세상\n\n- 하나')
    expect(live.type.schema).not.toBe(revision.type.schema)
    const result = buildRevisionDiff(revision, live)
    expect(() => result.doc.check()).not.toThrow()
    expect(read(result.doc, result.marks)).toEqual([
      { kind: 'removed-text', text: '세상' },
      { kind: 'added-text', text: '노트' },
    ])
    editor.destroy()
  })

  it('짝 없는 다른 종류 블록은 지움+추가로 나란히 둔다', () => {
    const { read: r } = diff('# 제목 글자', '제목 글자')
    expect(r).toEqual([
      { kind: 'removed-node', text: '제목 글자' },
      { kind: 'added-node', text: '제목 글자' },
    ])
  })
})

describe('revisionDiffDecorations', () => {
  it('표시 수만큼 데코를 만든다(위젯 포함)', () => {
    const { doc, marks } = buildRevisionDiff(
      markdownToDoc('안녕 세상\n\n지울 문단'),
      markdownToDoc('안녕 노트\n\n새 문단 추가됨'),
    )
    expect(marks.length).toBeGreaterThanOrEqual(3)
    const set = revisionDiffDecorations(doc, marks)
    const decos = set.find()
    expect(decos).toHaveLength(marks.length)
    const widget = decos.find((d) => (d.spec as { kind?: string }).kind === 'added-text')
    expect(widget).toBeDefined()
  })
})
