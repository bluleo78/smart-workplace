import { WikiHtmlEmbedSchema } from '@smart-workplace/wiki-editor-schema'
import type { Command } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { arrowBesideBlock, moveBesideBlock, neighborAt } from './wikiBlockExit'
import { htmlEmbedSourcePlugin, isHtmlEmbedSourceOpen, selectedEmbed, setHtmlEmbedSourceOpen } from './wikiHtmlEmbedSource'
import { WikiHtmlEmbedView } from './WikiHtmlEmbedView'

/**
 * 막 넣은 블록은 이 화면에서만 소스 칸을 연 채 시작한다(WP-1242) — 삽입 거래에 열림 메타를 싣는다(메타는 동기화로 퍼지지 않는다).
 * 빈 문단(「/HTML」 만 친 줄)이면 그 문단을 블록으로 바꾸고, 글자가 있는 문단이면 문단 뒤에 새로 넣는다 —
 * setNode 로 바꾸면 그 줄의 글자가 HTML 소스로 들어가 버린다.
 */
export const insertHtmlEmbed: Command = ({ state, tr, dispatch }) => {
  const type = state.schema.nodes.wikiHtmlEmbed
  if (!type) return false
  const { $from } = tr.selection
  const parent = $from.parent
  if (!dispatch) return true
  if (parent.type.name === 'paragraph' && parent.content.size === 0) {
    const at = $from.before()
    tr.setBlockType(at, $from.after(), type)
    tr.setSelection(TextSelection.create(tr.doc, $from.pos))
    setHtmlEmbedSourceOpen(tr, at, true)
    return true
  }
  const insertAt = $from.after()
  tr.insert(insertAt, type.create())
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  setHtmlEmbedSourceOpen(tr, insertAt, true)
  return true
}

/**
 * 노트 HTML 블록(WP-1242) — 공용 스키마(WikiHtmlEmbedSchema)에 웹 NodeView(격리 iframe 미리보기·소스 편집 칸)·열림 상태 플러그인·단축키만 얹는다.
 * 스키마는 그대로라 지문이 같다. 편집기·판 미리보기·공개 공유가 wikiRenderExtensions 로 함께 쓴다.
 * contentDOM 은 <code> 로 — 코드 블록처럼 글자가 그대로(공백·줄바꿈 유지) 들어간다.
 */
export const WikiHtmlEmbed = WikiHtmlEmbedSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WikiHtmlEmbedView, { contentDOMElementTag: 'code' })
  },

  addProseMirrorPlugins() {
    return [htmlEmbedSourcePlugin(() => this.editor.isEditable)]
  },

  addKeyboardShortcuts() {
    /** 노드 선택된(닫힌) 블록에서 옆으로(WP-1288) — Enter 는 다음 줄(없으면 만든다), 화살표는 옆 블록(끝이면 새 줄)으로. */
    const leave = (dir: 1 | -1, move: typeof moveBesideBlock) => () => {
      const hit = selectedEmbed(this.editor.state)
      return !!hit && move(this.editor.state, this.editor.view.dispatch, hit.pos, hit.node.nodeSize, dir)
    }
    /**
     * 글 줄 끝(↓)·처음(↑)에서 바로 옆이 닫힌 블록이면 그 블록을 통째 선택한다(WP-1288) — 브라우저 기본 이동은 숨은 소스(display:none)를
     * 건너뛰거나 그 안에 커서를 두는 등 일정하지 않다. 연 블록이면 넘긴다(기본 이동으로 소스 글자 안에 들어간다).
     */
    const enter = (dir: 1 | -1) => () => {
      const { state, view } = this.editor
      const { $from, empty } = state.selection
      if (!empty || !$from.parent.isTextblock || $from.parent.type.name === this.name) return false
      if (!view.endOfTextblock(dir > 0 ? 'down' : 'up')) return false
      const { edge, node } = neighborAt(state.doc, $from.before(), $from.parent.nodeSize, dir)
      if (node?.type.name !== this.name) return false
      const pos = dir > 0 ? edge : edge - node.nodeSize
      if (isHtmlEmbedSourceOpen(state, pos)) return false
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView())
      return true
    }
    return {
      // 소스 칸에서 빠져나가기 — 블록 뒤에 문단을 만들고 옮긴다(코드 블록의 exitCode 와 같다). 마지막 블록이어도 나갈 수 있게.
      'Mod-Enter': () => this.editor.isActive(this.name) && this.editor.commands.exitCode(),
      // 닫힌 블록(노드 선택)에서 Enter·↓ 는 다음 줄, ↑ 는 앞 줄로 — 소스를 연 채면 선택이 글자 안이라 지금처럼 소스 편집 키로 돈다.
      // 옆 줄에서 ↓·↑ 로 닿으면 블록을 통째 선택한다.
      Enter: leave(1, moveBesideBlock),
      ArrowDown: () => leave(1, arrowBesideBlock)() || enter(1)(),
      ArrowUp: () => leave(-1, arrowBesideBlock)() || enter(-1)(),
      // 빈 HTML 블록 맨 앞 Backspace — 문단으로 되돌린다(코드 블록과 같은 동작, 잘못 넣은 블록을 지우기 쉽게).
      Backspace: () => {
        const { $anchor, empty } = this.editor.state.selection
        if (!empty || $anchor.parent.type.name !== this.name || $anchor.parent.textContent !== '') return false
        return this.editor.commands.setParagraph()
      },
    }
  },
})
