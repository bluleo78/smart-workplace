// @vitest-environment jsdom
import { COLLAB_FRAGMENT, docToMarkdown, markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'

import { revisionDiffDecorations } from './wikiRevisionDiff'
import { revisionPreviewDoc, WikiRevisionDiffHighlight, wikiRevisionDiffKey } from './wikiRevisionPreviewDoc'

/**
 * 미리보기 문서 고르기(WP-298) — 공용 markdownToDoc 스키마에서 만든 차이 문서를 다른 스키마 인스턴스(미리보기 에디터)로 옮겨도
 * 좌표가 그대로 맞아 데코레이션이 같은 글자를 가리키는지 본다(컴포넌트와 같은 setContent → 데코 순서).
 */
describe('revisionPreviewDoc', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy())
  })
  const preview = () => {
    const editor = new Editor({ extensions: [...wikiSchemaExtensions(), WikiRevisionDiffHighlight], editable: false })
    editors.push(editor)
    return editor
  }
  /** 컴포넌트 effect 와 같은 순서로 그리고, 그려진 데코레이션을 종류·글자로 읽는다(추가 글자 위젯은 실제로 그려진 span 의 글자). */
  const render = (editor: Editor, body: string, compareTo: Parameters<typeof revisionPreviewDoc>[2], showDiff: boolean) => {
    const { doc, marks } = revisionPreviewDoc(editor.schema, body, compareTo, showDiff)
    expect(doc.type.schema).toBe(editor.schema)
    editor.commands.setContent(doc.toJSON(), false)
    editor.view.dispatch(editor.state.tr.setMeta(wikiRevisionDiffKey, revisionDiffDecorations(editor.state.doc, marks)))
    const set = wikiRevisionDiffKey.getState(editor.state)!
    const widgets = [...editor.view.dom.querySelectorAll('span.wiki-diff-added')].map((el) => el.textContent)
    return set.find().map((d) => {
      const kind = (d.spec as { kind: string }).kind
      return kind === 'added-text'
        ? { kind, text: widgets.shift() }
        : { kind, text: editor.state.doc.textBetween(d.from, d.to, '\n') }
    })
  }

  it('차이를 끄면 보는 판 그대로 그리고 표시가 없다', () => {
    const editor = preview()
    expect(render(editor, '# 제목\n\n하나 둘', '# 제목\n\n하나 셋', false)).toEqual([])
    expect(editor.state.doc.textContent).toBe('제목하나 둘')
  })

  it('비교 대상이 없으면 표시가 없다', () => {
    const editor = preview()
    expect(render(editor, '본문', null, true)).toEqual([])
    expect(editor.state.doc.textContent).toBe('본문')
  })

  it('마크다운 비교 대상 — 다른 스키마로 옮겨도 글자 삭제·추가와 블록 추가가 같은 글자를 가리킨다', () => {
    const editor = preview()
    const marks = render(editor, '하나 둘\n\n끝', '하나 셋\n\n끝\n\n새 문단', true)
    expect(marks).toEqual(
      expect.arrayContaining([
        { kind: 'removed-text', text: '둘' },
        { kind: 'added-text', text: '셋' },
        { kind: 'added-node', text: '새 문단' },
      ]),
    )
    expect(marks).toHaveLength(3)
  })

  it('라이브 문서(PMNode) 비교 대상도 받는다 — 지운 블록은 블록 통째 표시', () => {
    const editor = preview()
    const marks = render(editor, '남김\n\n지울 문단', markdownToDoc('남김'), true)
    expect(marks).toEqual([{ kind: 'removed-node', text: '지울 문단' }])
  })

  // 최신 판은 라이브 에디터 문서와 비교한다 — 라이브 문서는 마크다운 → 동기화 서버 스키마 → Yjs → 웹 에디터 스키마를 거친다.
  // 노드 속성(이미지 alt·title·width, 표 셀 colwidth·colspan 등)이 이 길에서 마크다운 파싱 결과와 달라지면 내용이 같아도
  // 블록이 지움+추가로 보인다(최종 리뷰 Minor 4). 표·이미지·멘션이 든 본문으로 차이가 없는지 지킨다.
  it('표·이미지·멘션이 든 본문 — 동기화(Yjs) 를 거친 라이브 문서와 같은 내용이면 표시가 없다', () => {
    const md = [
      '# 회의록',
      '앞 문단 ![설계도](/api/v1/wiki/pages/1/attachments/9/content "도면") 뒤 문단',
      '![](/api/v1/wiki/pages/1/attachments/10/content)',
      '| 이름 | 담당 |\n| --- | --- |\n| 동시 편집 | <@7> <#page:12> |\n| 이미지 셀 | ![칩](/api/v1/wiki/pages/1/attachments/11/content) |',
      '끝 문단',
    ].join('\n\n')
    // 동기화 서버가 마크다운을 Yjs 로 넣고(markdownToYUpdate), 웹 에디터(Collaboration)가 자기 스키마로 읽는 길 그대로.
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(markdownToDoc(md), ydoc.getXmlFragment(COLLAB_FRAGMENT))
    const liveEditor = new Editor({ extensions: wikiSchemaExtensions() })
    editors.push(liveEditor)
    const live = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(COLLAB_FRAGMENT), liveEditor.schema)
    expect(live.type.schema).toBe(liveEditor.schema)
    // 표·이미지가 실제로 들어 있어야 의미 있는 검사다.
    const types = new Set<string>()
    live.descendants((n) => void types.add(n.type.name))
    expect([...types]).toEqual(expect.arrayContaining(['table', 'image', 'wikiMention']))

    // 최신 판 본문 = 라이브 문서를 저장한 마크다운(동기화 서버 저장 경로) — 원본 마크다운과 그 저장본 둘 다 차이가 없어야 한다.
    expect(render(preview(), md, live, true)).toEqual([])
    expect(render(preview(), docToMarkdown(live), live, true)).toEqual([])
  })
})
