// @vitest-environment jsdom
import { markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { addedTextOf, buildRevisionDiff, revisionDiffDecorations, type RevisionDiffMark } from './wikiRevisionDiff'

/** 표시를 위치 대신 글자로 읽는다 — 범위 표시는 그 범위 글자, 위젯은 끼울 글자(멘션은 기본 자리 글자 '@'). */
function read(doc: PMNode, marks: RevisionDiffMark[]) {
  return marks.map((m) =>
    m.kind === 'added-text' ? { kind: m.kind, text: addedTextOf(m.segments) } : { kind: m.kind, text: doc.textBetween(m.from, m.to, '\n') },
  )
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

  /** 표 마크다운 — 첫 줄은 머리 행, 나머지는 본문 행(셀 배열). */
  const table = (head: string[], rows: string[][]) =>
    [head, head.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const HEAD = ['단계', '담당', '상태']
  const ROWS = [
    ['서버 스냅샷 정책 정리', '박민수', '완료'],
    ['데스크톱 버전 기록 패널', '이영희', '진행 중'],
  ]
  /** 표 안에 표시가 걸린 셀 종류(tableCell·tableHeader)와 행 — 표시 위치를 감싸는 가장 가까운 셀/행. */
  const enclosing = (doc: PMNode, pos: number, type: string) => {
    const $pos = doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === type) return $pos.node(d)
    return null
  }

  it('표에 행 하나를 더하면 그 행만 added-node 이고 다른 셀은 표시가 없다(WP-324)', () => {
    const extra = ['디자이너 리뷰와 실데이터 시각 검증', '최수진', '예정']
    const { doc, marks, read: r } = diff(`앞\n\n${table(HEAD, ROWS)}`, `앞\n\n${table(HEAD, [...ROWS, extra])}`)
    expect(r).toEqual([{ kind: 'added-node', text: extra.join('\n') }])
    const m = marks[0]
    if (m.kind !== 'added-node') throw new Error('added-node 여야 한다')
    expect(doc.nodeAt(m.from)?.type.name).toBe('tableRow')
    // 표는 하나 — 통째 지움·추가가 아니다.
    expect(topTypes(doc)).toEqual(['paragraph', 'table'])
    expect(doc.child(1).childCount).toBe(4)
  })

  it('표 셀 하나의 글자가 바뀌면 그 셀 안 어절만 표시한다(WP-324)', () => {
    const edited = ROWS.map((row) => [...row])
    edited[1][0] = '데스크톱 버전 기록 패널과 비교 화면'
    const { doc, marks, read: r } = diff(table(HEAD, ROWS), table(HEAD, edited))
    // 지운 글자 "패널" 과 새 글자 "패널과 비교 화면" — 둘 다 그 셀 안에 있다.
    expect(r).toEqual([
      { kind: 'removed-text', text: '패널' },
      { kind: 'added-text', text: '패널과 비교 화면' },
    ])
    for (const m of marks) {
      const at = m.kind === 'added-text' ? m.pos : m.from
      expect(enclosing(doc, at, 'tableCell')?.textContent).toBe('데스크톱 버전 기록 패널')
    }
    expect(topTypes(doc)).toEqual(['table'])
  })

  it('표 셀 글자가 통째 바뀌면 그 셀 안 문단만 지움+추가로 표시하고 표는 하나다(WP-324)', () => {
    const edited = ROWS.map((row) => [...row])
    edited[1][2] = '완료'
    const { doc, marks, read: r } = diff(table(HEAD, ROWS), table(HEAD, edited))
    expect(r).toEqual([
      { kind: 'removed-node', text: '진행 중' },
      { kind: 'added-node', text: '완료' },
    ])
    for (const m of marks) if (m.kind !== 'added-text') expect(doc.nodeAt(m.from)?.type.name).toBe('paragraph')
    expect(topTypes(doc)).toEqual(['table'])
  })

  it('표 열 수가 바뀌면 표를 통째로 지움·추가로 표시한다(WP-324)', () => {
    const wide = table([...HEAD, '마감'], ROWS.map((row) => [...row, '10월 9일']))
    const { read: r, doc } = diff(`앞\n\n${table(HEAD, ROWS)}`, `앞\n\n${wide}`)
    expect(r.map((m) => m.kind)).toEqual(['removed-node', 'added-node'])
    expect(r[1].text).toContain('10월 9일')
    expect(topTypes(doc)).toEqual(['paragraph', 'table', 'table'])
  })

  it('셀 종류가 바뀐 행(본문 셀 → 머리 셀)은 행 통째 지움+추가로 표시하고 열은 그대로다(WP-324)', () => {
    const from = markdownToDoc(table(HEAD, ROWS))
    const json = from.toJSON()
    // 둘째 본문 행 첫 셀을 머리 셀로 — 마크다운으로 못 쓰는 표(HTML 저장본)도 같은 규칙으로 비교된다.
    json.content[0].content[2].content[0].type = 'tableHeader'
    const result = buildRevisionDiff(from, from.type.schema.nodeFromJSON(json))
    expect(() => result.doc.check()).not.toThrow()
    expect(result.marks.map((m) => m.kind)).toEqual(['removed-node', 'added-node'])
    for (const m of result.marks) if (m.kind !== 'added-text') expect(result.doc.nodeAt(m.from)?.type.name).toBe('tableRow')
    result.doc.child(0).forEach((row) => expect(row.childCount).toBe(3))
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

  it('같은 글자 문단에서 멘션 대상만 바뀌어도 그 멘션을 지움+추가로 표시한다(WP-324)', () => {
    // 낱말도 함께 바뀐 문단 — 멘션 자리표시가 대상과 무관하면 멘션은 "같음"으로 묻혀 바뀐 대상이 보이지 않았다.
    const { doc, marks, read: r } = diff('담당 <@7> 이 정리했다.', '담당 <@8> 이 다시 정리했다.')
    expect(r.filter((m) => m.kind === 'added-text').map((m) => m.text)).toEqual(['@', '다시 '])
    const removed = marks.filter((m) => m.kind === 'removed-text')
    expect(removed).toHaveLength(1)
    const rm = removed[0]
    if (rm.kind !== 'removed-text') return
    const inRange: string[] = []
    doc.nodesBetween(rm.from, rm.to, (n) => {
      if (n.isInline) inRange.push(n.type.name)
    })
    expect(inRange).toEqual(['wikiMention'])
  })

  it('사용자 글에 있는 사설 영역 글자는 멘션 자리표시와 겹치지 않는다(WP-324)', () => {
    // 자리표시 배정이 글 속 U+E000 을 건너뛰지 않으면 새 글자 위젯에서 그 글자가 "@" 로 바뀌어 보였다.
    const { read: r } = diff('공통 낱말', '공통 낱말 \uE000 <@7>')
    expect(r).toEqual([{ kind: 'added-text', text: ' \uE000 @' }])
  })

  it('표 셀 안 멘션 대상만 바뀌어도 그 셀 안에서 지움+추가로 표시한다(WP-324)', () => {
    const at = (id: number) => table(['담당', '상태'], [[`<@${id}>`, '진행 중']])
    const { doc, marks } = diff(at(7), at(8))
    expect(marks.length).toBeGreaterThan(0)
    expect(topTypes(doc)).toEqual(['table'])
    for (const m of marks) expect(enclosing(doc, m.kind === 'added-text' ? m.pos : m.from, 'tableCell')).not.toBeNull()
  })

  it('추가된 멘션은 대상(mtype·id)을 조각으로 넘겨 화면이 칩과 같은 라벨로 그린다(WP-324)', () => {
    const { marks } = diff('담당 <@7> 이 정리했다.', '담당 <@8> 이 다시 정리했다.')
    const added = marks.filter((m) => m.kind === 'added-text')
    expect(added.map((m) => m.kind === 'added-text' && m.segments)).toEqual([[{ mtype: 'USER', id: 8 }], ['다시 ']])
    const label = (mtype: string, id: number) => (mtype === 'USER' ? `@사용자${id}` : `#${id}`)
    expect(added.map((m) => m.kind === 'added-text' && addedTextOf(m.segments, label))).toEqual(['@사용자8', '다시 '])
  })

  it('같은 멘션은 두 판에서 같은 자리표시라 바뀌지 않은 멘션 옆 글자만 표시한다(WP-324)', () => {
    // 배정 방식이 비교 도중 바뀌면(대상별 → 종류) 같은 멘션이 두 판에서 다른 글자가 되어 "바뀜"으로 보였다.
    const { read: r } = diff('담당 <@7> 확인', '담당 <@7> 확인 완료')
    expect(r).toEqual([{ kind: 'added-text', text: ' 완료' }])
    // 남은 사설 영역 글자가 경계에 걸리게 사용자 글로 채운다(종류 몫 64 + 2) — 예전엔 첫 멘션만 대상별 글자를 받고
    // 다음 판에선 같은 멘션이 종류 글자가 되어 지움+추가로 보였다.
    let pua = ''
    for (let c = 0xf8ff - (0x1900 - 64 - 2) + 1; c <= 0xf8ff; c++) pua += String.fromCharCode(c)
    const edge = diff(`${pua}\n\nA <@1> B <@2>`, `${pua}\n\nA <@1> B <@2> C`)
    expect(edge.read).toEqual([{ kind: 'added-text', text: ' C' }])
  })

  it('사설 영역이 사용자 글로 가득 차도 자리표시가 U+F8FF 를 넘지 않는다(WP-324)', () => {
    // U+E000–U+F8FF 전부를 글에 넣는다 — 배정이 상한을 넘으면 U+F900(CJK 호환 한자)이 자리표시가 되어
    // 사용자가 쓴 U+F900 이 위젯에서 멘션 기호로 바뀌어 보였다.
    let pua = ''
    for (let c = 0xe000; c <= 0xf8ff; c++) pua += String.fromCharCode(c)
    const { read: r } = diff(`${pua}\n\n공통 낱말`, `${pua}\n\n공통 낱말 豈 <@1>`)
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('added-text')
    expect(r[0].text.startsWith(' 豈 ')).toBe(true)
  })

  it('표 행 짝짓기는 셀 경계를 본다 — ab|c 앞에 a|bc 행을 끼우면 끼운 행만 추가다(WP-324)', () => {
    const { read: r } = diff(table(['가', '나'], [['ab', 'c']]), table(['가', '나'], [['a', 'bc'], ['ab', 'c']]))
    expect(r).toEqual([{ kind: 'added-node', text: 'a\nbc' }])
  })

  it('표 행 짝짓기는 멘션 대상을 본다 — 멘션만 다른 행을 앞에 끼우면 끼운 행만 추가다(WP-324)', () => {
    const { marks, doc } = diff(table(['담당', '메모'], [['<@7>', 'x']]), table(['담당', '메모'], [['<@8>', 'x'], ['<@7>', 'x']]))
    expect(marks.map((m) => m.kind)).toEqual(['added-node'])
    const m = marks[0]
    if (m.kind !== 'added-node') return
    expect(doc.nodeAt(m.from)?.type.name).toBe('tableRow')
    expect(doc.nodeAt(m.from)?.firstChild?.firstChild?.firstChild?.attrs.id).toBe(8)
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
