import './dom-install'

import { docToMarkdown, getMarkdownSchema, markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { mergeMarkdown3 } from '@smart-workplace/wiki-editor-schema/merge'
import { describe, expect, it } from 'vitest'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'

import {
  applyKeepLivePlan,
  FRAGMENT,
  hasVisibleContent,
  markdownToYUpdate,
  normalizeMarkdown,
  planKeepLive,
  replaceWithMarkdown,
  yDocToMarkdown,
  yUpdateToRoot,
} from './markdownCodec'
import { liveDoc, rootOf, typeIn } from './testing/liveDoc'

/** md → Y.Doc → md 한 바퀴. */
function viaYjs(md: string): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, markdownToYUpdate(md))
  return yDocToMarkdown(doc)
}

/** Y 조각 안 특정 노드 이름의 개수(멘션 칩 중복 검사용). */
function countNodes(doc: Y.Doc, nodeName: string): number {
  let n = 0
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (child.nodeName === nodeName) n += 1
        walk(child)
      }
    }
  }
  walk(doc.getXmlFragment(FRAGMENT))
  return n
}

// 서버측 md ↔ Yjs 변환 — 이관(최초 로드)·파생 body·외부 본문 반영의 기반.
describe('markdownCodec', () => {
  it('builds a Y.Doc from markdown and serializes it back unchanged', () => {
    // 표 직렬화는 끝에 개행을 남긴다(tiptap-markdown 표 직렬화기) — 기존 저장본과 같은 형태.
    const md = '# 제목\n\n본문 <@5>\n\n| a |\n| --- |\n| 1 |\n'
    expect(viaYjs(md)).toBe(md)
  })

  it('parses mention tokens once without duplicate chips', () => {
    const md = '본문 <@5> 과 <#page:12> 그리고 <#issue:7>'
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate(md))
    expect(countNodes(doc, 'wikiMention')).toBe(3)
    expect(yDocToMarkdown(doc)).toBe(md)
  })

  it('replace touches only changed blocks so an unrelated concurrent edit survives', () => {
    const base = '첫 문단\n\n둘째 문단'
    const server = new Y.Doc()
    Y.applyUpdate(server, markdownToYUpdate(base))
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    // 클라이언트가 둘째 문단을 고치는 동안 서버가 첫 문단을 교체
    const frag = client.getXmlFragment(FRAGMENT)
    const second = frag.get(1) as Y.XmlElement
    ;(second.get(0) as Y.XmlText).insert(0, '수정된 ')
    replaceWithMarkdown(server, '바뀐 첫 문단\n\n둘째 문단', { actor: 'test' })
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    expect(yDocToMarkdown(server)).toBe('바뀐 첫 문단\n\n수정된 둘째 문단')
    expect(yDocToMarkdown(client)).toBe(yDocToMarkdown(server))
  })

  it('passes the transaction origin through to update listeners', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate('a'))
    const origins: unknown[] = []
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    const origin = { actor: 'ai' }
    replaceWithMarkdown(doc, 'b', origin)
    expect(origins).toEqual([origin])
  })

  // 골든 — Yjs 를 한 번 거쳐도 기존 웹 경로(ProseMirror 직렬화)와 같은 마크다운이 나와야 한다(스펙 §10).
  // 기준은 "PM 한 바퀴" 결과: Y 경유가 그 위에 추가 손실을 만들지 않음을 본다. 정규화 없는 입력은 원문과도 같아야 한다.
  describe('golden round-trip through Yjs', () => {
    const cases: Array<[string, string, { exact?: boolean }]> = [
      ['E2E 픽스처 본문', '# 온보딩\n신규 입사자를 위한 안내 문서입니다.', {}],
      ['제목·목록·코드·한글', '# 회의록\n\n- 항목 1\n- 항목 2\n\n```ts\nconst a = 1\n```\n\n한글 문단입니다.', { exact: true }],
      ['순서 목록·인용·강조', '1. 하나\n2. 둘\n\n> 인용문\n\n**굵게** *기울임* ~~취소~~ `코드`', { exact: true }],
      ['GFM 표(셀 안 파이프 이스케이프)', '| a | b |\n| --- | --- |\n| 1 | 2 \\| 3 |\n', { exact: true }],
      ['이미지', '![설명](/api/v1/wiki/attachments/1)\n\n![](/api/v1/wiki/attachments/2)', {}],
      ['멘션 3종', '담당 <@5> · 문서 <#page:12> · 이슈 <#issue:7>', { exact: true }],
      ['코드 안 멘션 토큰은 글자 그대로', '`<@5>` 와\n\n```\n<#page:1>\n```', { exact: true }],
      ['병합 셀 표(raw HTML 폴백)', '<table><tbody><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>', {}],
      ['하드 브레이크·수평선', '첫 줄  \n둘째 줄\n\n---\n\n끝', {}],
    ]

    it.each(cases)('%s', (_name, md, { exact }) => {
      const viaPm = docToMarkdown(markdownToDoc(md))
      const once = viaYjs(md)
      expect(once).toBe(viaPm)
      // 저장 → 재로드 → 재저장이 안정적이어야 이관 후 매 저장마다 본문이 흔들리지 않는다.
      expect(viaYjs(once)).toBe(once)
      if (exact) expect(once).toBe(md)
    })
  })
})

describe('normalizeMarkdown', () => {
  it('rewrites to the serializer notation and is idempotent', () => {
    const raw = '|a|b|\n|-|-|\n|1|2|\n\n_강조_'
    const once = normalizeMarkdown(raw)
    expect(once).not.toBe(raw)
    expect(normalizeMarkdown(once)).toBe(once)
  })
})

// WP-330 — 빈 AI본 거부의 "현재본에 내용이 있나"를 직렬화 없이 판정한다. 직렬화(trim) 결과와 늘 같아야 한다.
describe('hasVisibleContent', () => {
  const P = (content?: unknown[]) => ({ type: 'paragraph', ...(content ? { content } : {}) })
  const T = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
  /** ProseMirror JSON 블록들로 Y 문서를 만든다(빈 배열 = 아무 블록도 없는 새 문서). */
  const docOf = (blocks: unknown[]) => {
    const doc = new Y.Doc()
    if (blocks.length > 0) prosemirrorToYXmlFragment(getMarkdownSchema().nodeFromJSON({ type: 'doc', content: blocks }), doc.getXmlFragment(FRAGMENT))
    return doc
  }
  it.each<[string, unknown[], boolean]>([
    ['an empty document', [], false],
    ['a single empty paragraph', [P()], false],
    ['two empty paragraphs', [P(), P()], false],
    ['a paragraph with spaces only', [P([T('   ')])], false],
    ['a paragraph with a no-break space only', [P([T('\u00a0')])], false],
    ['a paragraph with a hard break only', [P([{ type: 'hardBreak' }])], false],
    ['spaces around a hard break (serialized as a backslash)', [P([T(' '), { type: 'hardBreak' }, T(' ')])], true],
    ['a linked space', [P([T(' ', [{ type: 'link', attrs: { href: 'http://x' } }])])], true],
    ['a space in code', [P([T(' ', [{ type: 'code' }])])], true],
    ['a bold space', [P([T(' ', [{ type: 'bold' }])])], false],
    ['text after an empty paragraph', [P(), P([T('글')])], true],
    ['a mention only', [P([{ type: 'wikiMention', attrs: { id: '1', type: 'user', label: 'a' } }])], true],
    ['a horizontal rule only', [{ type: 'horizontalRule' }], true],
    ['an image only', [{ type: 'image', attrs: { src: 'http://x/a.png' } }], true],
    ['an empty list item', [{ type: 'bulletList', content: [{ type: 'listItem', content: [P()] }] }], true],
    ['an empty heading', [{ type: 'heading', attrs: { level: 2 } }], true],
    ['an empty table', [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [P()] }] }] }], true],
  ])('agrees with the serializer for %s', (_label, blocks, want) => {
    const doc = docOf(blocks)
    expect(yDocToMarkdown(doc).trim() !== '').toBe(want)
    expect(hasVisibleContent(doc)).toBe(want)
  })
})

describe('replaceWithMarkdown', () => {
  it('returns the first changed top-level block and makes no transaction when nothing changed', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate('# 제목\n\n첫 문단\n\n둘째 문단'))
    const origins: unknown[] = []
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    expect(replaceWithMarkdown(doc, '# 제목\n\n첫 문단\n\n둘째 문단', 'o')).toBeNull()
    expect(origins).toEqual([])
    expect(replaceWithMarkdown(doc, '# 제목\n\n첫 문단\n\n둘째 문단 바뀜', 'o')).toBe(2)
    expect(origins).toEqual(['o'])
    // 끝 블록 삭제 → 남은 마지막 블록을 가리킨다(표식 위치가 문서 밖이 되지 않게).
    expect(replaceWithMarkdown(doc, '# 제목\n\n첫 문단', 'o')).toBe(1)
  })
})

// WP-289 — 병합 적용(keepLive)은 병합이 손대지 않은 사람 입력을 마크다운 왕복으로 잃지 않는다. 실제 경로처럼 현재본을 직렬화해
// mergeMarkdown3 에 넣고 그 결과를 적용한다.
describe('keepLive plan (merge apply)', () => {
  /**
   * 실제 경로 그대로 — 워커 쪽(planKeepLive)은 실시간 상태 사본(Y 업데이트)으로 계획을 만들고, 계획은 스레드 경계(structuredClone)를 건너
   * 메인 쪽(applyKeepLivePlan)이 적용한다. 그래서 colwidth 같은 속성도 실제 경계를 지나 살아남는지 본다.
   */
  const keepLive = (doc: Y.Doc, merged: string) =>
    applyKeepLivePlan(doc, structuredClone(planKeepLive(yUpdateToRoot(Y.encodeStateAsUpdate(doc)), merged)), 'ai')
  /** 운영처럼 기준본·AI본은 정규화(prepare), 현재본은 직렬화기 출력 그대로 넣는다 — 원문 표기가 섞이면 블록 병합이 문단을 두 번 낼 수 있다. */
  const applyMerge = (doc: Y.Doc, base: string, ai: string) =>
    keepLive(doc, mergeMarkdown3(normalizeMarkdown(base), yDocToMarkdown(doc), normalizeMarkdown(ai)).markdown)

  it('keeps the trailing space typed in another block (and that block’s Y node)', () => {
    const base = '첫 문단\n\n둘째 문단'
    const doc = liveDoc(base, (f) => typeIn(f, [1], ' 내입력 '))
    const second = doc.getXmlFragment(FRAGMENT).get(1)
    expect(applyMerge(doc, base, '첫 문단 AI\n\n둘째 문단')).toBe(0)
    expect(yDocToMarkdown(doc)).toBe('첫 문단 AI\n\n둘째 문단 내입력 ')
    expect(doc.getXmlFragment(FRAGMENT).get(1)).toBe(second)
  })

  it('keeps the trailing space when the AI changed another part of the same block', () => {
    const base = '회의 안건을 정리합니다'
    const doc = liveDoc(base, (f) => typeIn(f, [0], ' 내입력 '))
    applyMerge(doc, base, '다음 회의 안건을 정리합니다')
    expect(yDocToMarkdown(doc)).toBe('다음 회의 안건을 정리합니다 내입력 ')
  })

  it('keeps an empty paragraph the person just opened, in place', () => {
    const base = '첫 문단\n\n둘째 문단'
    const doc = liveDoc(base, (f) => f.insert(2, [new Y.XmlElement('paragraph')]))
    applyMerge(doc, base, '첫 문단 AI\n\n둘째 문단')
    const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema())
    expect(root.childCount).toBe(3)
    expect(root.child(0).textContent).toBe('첫 문단 AI')
    expect(root.child(2).type.name).toBe('paragraph')
    expect(root.child(2).childCount).toBe(0)
  })

  it('leaves an untouched block that does not round-trip through markdown byte-for-byte', () => {
    // 열 너비(colwidth)가 든 표(HTML 붙여넣기 등) — 마크다운으로는 너비가 사라져 다시 파싱하면 다른 노드가 된다.
    const schema = getMarkdownSchema()
    const cell = (type: string, text: string) => ({
      type,
      attrs: { colwidth: [150] },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const pm = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '첫 문단' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'h')] }, { type: 'tableRow', content: [cell('tableCell', 'c')] }] },
      ],
    })
    const doc = new Y.Doc()
    prosemirrorToYXmlFragment(pm, doc.getXmlFragment(FRAGMENT))
    const base = yDocToMarkdown(doc)
    const table = doc.getXmlFragment(FRAGMENT).get(1) as Y.XmlElement
    const before = table.toString()
    expect(applyMerge(doc, base, base.replace('첫 문단', '첫 문단 AI'))).toBe(0)
    expect(doc.getXmlFragment(FRAGMENT).get(1)).toBe(table)
    expect(table.toString()).toBe(before)
  })

  it('still deletes and inserts the blocks the merge changed', () => {
    const base = '하나\n\n둘\n\n셋'
    const doc = liveDoc(base, (f) => typeIn(f, [2], ' 끝 '))
    applyMerge(doc, base, '하나\n\n새 블록\n\n셋')
    expect(yDocToMarkdown(doc)).toBe('하나\n\n새 블록\n\n셋 끝 ')
  })

  it('writes into an empty note without leaving a leading empty paragraph', () => {
    const doc = liveDoc('')
    keepLive(doc, mergeMarkdown3('', yDocToMarkdown(doc), 'AI 초안').markdown)
    const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema())
    expect(root.childCount).toBe(1)
    expect(root.textContent).toBe('AI 초안')
  })

  /** 경로(최상위부터 자식 인덱스)를 따라 내려간 글 블록의 글자 끝(at='end') 또는 처음(at=0)에 text 를 친다. */

  it.each([
    ['list item', '- a\n- b\n- c', [0, 2, 0], '- a AI\n- b\n- c'],
    ['blockquote paragraph', '> 첫 문단\n>\n> 둘째 문단', [0, 1], '> 첫 문단 AI\n>\n> 둘째 문단'],
    // 다른 블록을 고칠 때 셀 끝 공백. 같은 표 안 다른 셀 편집은 아래 표 행·칸 병합 테스트.
    ['table cell', '문단\n\n| h1 | h2 |\n| --- | --- |\n| a | b |', [1, 1, 1, 0], '문단 AI\n\n| h1 | h2 |\n| --- | --- |\n| a | b |'],
  ])('keeps the trailing space typed inside a %s when the AI edits elsewhere', (_n, base, path, ai) => {
    const doc = liveDoc(base, (f) => typeIn(f, path, ' 내입력 '))
    applyMerge(doc, base, ai)
    let node = rootOf(doc)
    for (const i of path) node = node.child(i)
    expect(node.textContent).toMatch(/ 내입력 $/)
    expect(rootOf(doc).textContent).toContain('AI')
  })

  it('keeps the cell the person is typing in when the AI edits another row of the same table', () => {
    const base = '| 담당 | 할 일 |\n| --- | --- |\n| 김 | 회의록 정리 |\n| 이 | 일정 공유 |\n| 박 | 예산 확인 |'
    const doc = liveDoc(base, (f) => typeIn(f, [0, 1, 1, 0], ' 사람'))
    expect(applyMerge(doc, base, base.replace('예산 확인', '예산 확인 AI'))).toBe(0)
    expect(yDocToMarkdown(doc)).toBe('| 담당 | 할 일 |\n| --- | --- |\n| 김 | 회의록 정리 사람 |\n| 이 | 일정 공유 |\n| 박 | 예산 확인 AI |\n')
  })

  it('does not duplicate a paragraph whose hard break the AI rewrote as a plain newline', () => {
    const base = '앞 문단\n\n가  \n나'
    const doc = liveDoc(base)
    applyMerge(doc, base, '앞 문단\n\n가\n나')
    expect(rootOf(doc).childCount).toBe(2)
    expect(rootOf(doc).textContent.match(/가/g)).toHaveLength(1)
  })

  it.each([
    ['a list item followed by a nested list', '- 안건\n  - 하위\n\n끝 문단', [0, 0, 0]],
    ['a blockquote paragraph followed by another', '> 첫\n>\n> 둘\n\n끝 문단', [0, 0]],
  ])('does not leave a backslash after two spaces typed at the end of %s', (_n, base, path) => {
    const doc = liveDoc(base, (f) => typeIn(f, path, '  '))
    applyMerge(doc, base, base.replace('끝 문단', '끝 문단 AI'))
    expect(rootOf(doc).textContent).not.toContain('\\')
    expect(rootOf(doc).textContent).toContain('끝 문단 AI')
  })

  it('re-appends the space with the live marks (a plain space after bold stays plain)', () => {
    const base = '**굵게**'
    const doc = liveDoc(base, (f) => typeIn(f, [0], ' ', 'end', { bold: null }))
    applyMerge(doc, base, '아주 **굵게**')
    const block = rootOf(doc).child(0)
    expect(block.textContent).toBe('아주 굵게 ')
    expect(block.lastChild!.text).toBe(' ')
    expect(block.lastChild!.marks).toHaveLength(0)
  })

  it('leaves an untouched block with leading spaces byte-for-byte', () => {
    const base = '첫 문단\n\n둘째 문단'
    const doc = liveDoc(base, (f) => typeIn(f, [1], '  ', 0))
    const second = doc.getXmlFragment(FRAGMENT).get(1) as Y.XmlElement
    const before = second.toString()
    applyMerge(doc, base, '첫 문단 AI\n\n둘째 문단')
    expect(rootOf(doc).child(0).textContent).toBe('첫 문단 AI')
    expect(doc.getXmlFragment(FRAGMENT).get(1)).toBe(second)
    expect(second.toString()).toBe(before)
  })

  it('without keepLive (version restore) the document becomes the body exactly as before', () => {
    const doc = liveDoc('첫 문단', (f) => typeIn(f, [0], ' '))
    replaceWithMarkdown(doc, '첫 문단', 'o')
    expect(yDocToMarkdown(doc)).toBe('첫 문단')
  })
})
