import { WikiHtmlEmbedSchema } from '@smart-workplace/wiki-editor-schema'
import type { Command, Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import { createElement } from 'react'

import { WikiHtmlEmbedView } from './WikiHtmlEmbedView'

/**
 * 「막 넣은 블록은 소스 칸을 연 채 시작」 한 번짜리 표시(WP-1242) — 넣은 그 화면(클라이언트)에서만 연다.
 *
 * 왜 문서(attrs)가 아니라 화면 메모리인가: 열림은 사람마다 다른 화면 상태다. 문서에 두면 동시 편집자에게도 빈 블록이 열린 채 퍼진다.
 * 그래서 삽입 명령이 이 편집기에 「이 위치에 넣었다」를 남기고, 그 위치에 처음 만들어지는 블록 화면이 꺼내 쓴다(한 번만).
 * 꺼내지지 않은 표시는 잠시 뒤 버린다 — 오래 남아 나중에 같은 위치에 생긴 다른 블록(동료가 넣은 것)이 열리지 않게.
 */
const pendingInsert = new WeakMap<Editor, { pos: number; at: number }>()

/** 표시 유효 시간(ms) — 삽입 거래 뒤 블록 화면이 만들어지기까지는 한 프레임 남짓이다. */
const PENDING_TTL_MS = 2000

/** 이 편집기에서 pos 에 HTML 블록을 넣었다고 남긴다(삽입 명령). */
function markHtmlEmbedInserted(editor: Editor, pos: number): void {
  pendingInsert.set(editor, { pos, at: Date.now() })
}

/**
 * pos 에 만들어지는 블록 화면이 「막 넣은 블록」인지 — 표시는 묻는 즉시 지운다(한 번만). 낡았거나 위치가 다르면 false.
 * 위치가 다른 블록이 먼저 만들어지는 경우는 없다(삽입 거래가 만드는 블록 화면은 넣은 블록 하나다) — 그래서 어긋나면 그냥 버린다.
 */
export function consumeHtmlEmbedInserted(editor: Editor, pos: number | undefined): boolean {
  const p = pendingInsert.get(editor)
  if (!p) return false
  pendingInsert.delete(editor)
  return pos === p.pos && Date.now() - p.at <= PENDING_TTL_MS
}

/**
 * 커서 자리에 빈 HTML 블록을 넣고 커서를 그 안(소스 칸)으로 옮긴다(WP-1242, 슬래시 메뉴 「HTML 블록」).
 * 빈 문단(「/HTML」 만 친 줄)이면 그 문단을 블록으로 바꾸고, 글자가 있는 문단이면 문단 뒤에 새로 넣는다 —
 * setNode 로 바꾸면 그 줄의 글자가 HTML 소스로 들어가 버린다. 넣은 이 화면에서만 소스 칸을 연 채 시작하게 위치를 남긴다.
 */
export const insertHtmlEmbed: Command = ({ editor, state, tr, dispatch }) => {
  const type = state.schema.nodes.wikiHtmlEmbed
  if (!type) return false
  const { $from } = tr.selection
  const parent = $from.parent
  if (!dispatch) return true
  if (parent.type.name === 'paragraph' && parent.content.size === 0) {
    const at = $from.before()
    tr.setBlockType(at, $from.after(), type)
    tr.setSelection(TextSelection.create(tr.doc, $from.pos))
    markHtmlEmbedInserted(editor, at)
    return true
  }
  const insertAt = $from.after()
  tr.insert(insertAt, type.create())
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  markHtmlEmbedInserted(editor, insertAt)
  return true
}

/**
 * 노트 HTML 블록(WP-1242) — 공용 스키마(WikiHtmlEmbedSchema)에 웹 NodeView(격리 iframe 미리보기·소스 편집 칸)와 단축키만 얹는다.
 * 스키마는 그대로라 지문이 같다. 편집기·판 미리보기·공개 공유가 wikiRenderExtensions 로 함께 쓴다.
 * contentDOM 은 <code> 로 — 코드 블록처럼 글자가 그대로(공백·줄바꿈 유지) 들어간다.
 * 블록 화면을 만들 때 「막 넣은 블록」 표시를 한 번 꺼내 initialOpen 으로 넘긴다(화면은 표시를 모른다).
 */
export const WikiHtmlEmbed = WikiHtmlEmbedSchema.extend({
  addNodeView() {
    return (props) => {
      const initialOpen = consumeHtmlEmbedInserted(props.editor, typeof props.getPos === 'function' ? props.getPos() : undefined)
      const View = (p: ReactNodeViewProps) => createElement(WikiHtmlEmbedView, { ...p, initialOpen })
      return ReactNodeViewRenderer(View, { contentDOMElementTag: 'code' })(props)
    }
  },

  addKeyboardShortcuts() {
    return {
      // 소스 칸에서 빠져나가기 — 블록 뒤에 문단을 만들고 옮긴다(코드 블록의 exitCode 와 같다). 마지막 블록이어도 나갈 수 있게.
      'Mod-Enter': () => this.editor.isActive(this.name) && this.editor.commands.exitCode(),
      // 빈 HTML 블록 맨 앞 Backspace — 문단으로 되돌린다(코드 블록과 같은 동작, 잘못 넣은 블록을 지우기 쉽게).
      Backspace: () => {
        const { $anchor, empty } = this.editor.state.selection
        if (!empty || $anchor.parent.type.name !== this.name || $anchor.parent.textContent !== '') return false
        return this.editor.commands.setParagraph()
      },
    }
  },
})
