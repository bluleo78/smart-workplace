import { sanitizeStyleSheet, WikiStyleSchema } from '@smart-workplace/wiki-editor-schema'
import type { Editor } from '@tiptap/core'
import { Palette, X } from 'lucide-react'

import { lucideSvg } from './lucideSvg'
import { dispatchAsUndoStep } from './wikiCollabPosition'
import { pinVisible } from './wikiPinVisible'

/** 칩 「페이지 스타일」을 누르면 칩 요소에서 올라가는 이벤트 — 편집기 화면(WikiPageStyleDialog)이 받아 CSS 고치기 창을 연다(WP-1304). */
export const WIKI_PAGE_STYLE_EDIT_EVENT = 'wiki-page-style-edit'
/** 이벤트에 실리는 것 — 칩 노드 위치(누른 순간). */
export interface WikiPageStyleEditDetail {
  pos: number
}

/**
 * pos 의 페이지 스타일 노드 css 를 바꾼다 — 거래 하나를 실행 취소 한 단계로 따로 내보낸다(dispatchAsUndoStep — 직전 글자 입력과 묶이지 않게).
 * 동료에게 바로 간다. 정리는 부르는 쪽(sanitizeEditedPageCss)이 한다. pos 에 페이지 스타일이 없으면(동료가 지움) false.
 */
export function setPageStyleCss(editor: Editor, pos: number, css: string): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'wikiStyle') return false
  if (node.attrs.css !== css) dispatchAsUndoStep(editor, editor.state.tr.setNodeAttribute(pos, 'css', css))
  return true
}

/** 페이지 스타일 CSS 직접 고치기 적용 — 정리한 CSS 와, 정리기가 무언가를 빼거나 바꿨는지(공백 차이는 보지 않는다). */
export function sanitizeEditedPageCss(text: string): { css: string; changed: boolean } {
  const css = sanitizeStyleSheet(text).trim()
  const squash = (s: string) => s.replace(/\s+/g, '')
  return { css, changed: squash(css) !== squash(text) }
}

/** 정리기가 페이지 CSS 에서 무언가를 뺐을 때의 안내 — 규칙 단위로 세기 어려워 수 없이 알린다. 오타도 빠지므로 「쓸 수 없는」이라 한다. */
export const PAGE_CSS_REMOVED_NOTE = '쓸 수 없는 값을 뺐습니다'

/**
 * 페이지 스타일 노드(WP-1240) — 공용 스키마(WikiStyleSchema)에 화면 칩만 얹는다(스키마는 그대로라 지문이 같다).
 * CSS 자체는 이 칩이 아니라 WikiHtmlScope 가 본문 범위로 가둬 <head> 에 넣는다 — 칩은 「이 노트에 페이지 스타일이 있다」를 알리고
 * 고치고 지우는 손잡이일 뿐이다. 「페이지 스타일」 글자를 누르면 CSS 고치기 창이 열리고(WP-1304 — 칩은 DOM 이라 창은 React 쪽
 * WikiPageStyleDialog 가 이벤트로 받아 연다), ✕ 는 지운다. 보기 전용 화면에서는 숨긴다(편집 가능 여부가 바뀌면 따라간다).
 * React NodeView 가 아니라 DOM 으로 그린다 — 상태가 없는 작은 칩이고, 공개 공유 화면처럼 Provider 없는 곳에서도 그려야 해서.
 *
 * 칩은 페이지 스타일이 가두어지는 본문 범위 안에 있다 — 노트 CSS(`[범위] div{display:none !important}` 등)가 칩을 가려
 * 지울 손잡이를 없애지 못하게, 보이기에 관한 속성은 인라인 !important 로 박는다(pinVisible). 인라인 !important 는 어떤
 * 스타일시트의 !important 보다도 앞선다(캐스케이드의 「요소에 붙은 선언」 단계 — @layer 보다 먼저 비교된다).
 */
export const WikiStyle = WikiStyleSchema.extend({
  addNodeView() {
    return ({ editor, view, getPos, node: initial }) => {
      let node = initial
      const dom = document.createElement('div')
      dom.className = 'wiki-style-chip'
      dom.contentEditable = 'false'
      dom.setAttribute('data-testid', 'wiki-style-chip')
      dom.append(lucideSvg(Palette, 'wiki-style-chip__icon'))
      // 「페이지 스타일」 글자 — 누르면 CSS 고치기 창을 연다(이벤트만 올리고 창은 편집기 화면이 그린다).
      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'wiki-style-chip__edit'
      label.textContent = '페이지 스타일'
      label.title = '페이지 스타일 고치기'
      label.addEventListener('mousedown', (e) => e.preventDefault())
      label.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (!editor.isEditable || typeof pos !== 'number') return
        dom.dispatchEvent(new CustomEvent<WikiPageStyleEditDetail>(WIKI_PAGE_STYLE_EDIT_EVENT, { bubbles: true, detail: { pos } }))
      })
      dom.append(label)

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'wiki-style-chip__remove'
      remove.setAttribute('aria-label', '페이지 스타일 지우기')
      remove.title = '페이지 스타일 지우기'
      remove.append(lucideSvg(X, 'wiki-style-chip__icon'))
      // mousedown 기본 동작을 막아 에디터 선택이 칩으로 옮겨 가며 깜빡이지 않게 한다.
      remove.addEventListener('mousedown', (e) => e.preventDefault())
      remove.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (!editor.isEditable || typeof pos !== 'number') return
        editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      })
      dom.append(remove)

      // 보이기 고정 — 칩은 편집할 수 있을 때만 보인다(보기 전용 화면엔 지울 손잡이가 필요 없다). 인라인 display 가 CSS 보다
      // 앞서므로 보기 전용 숨김도 여기서 한다. 편집 가능 여부는 거래 없이 바뀌므로(setEditable → 'update' 이벤트) 그때 다시 맞춘다.
      // view.editable 을 본다 — 첫 그리기는 editor.view 가 정해지기 전(EditorView 생성 중)이라 editor.isEditable 이 거짓이다.
      pinVisible(label, 'inline')
      pinVisible(remove, 'inline-flex')
      // 'update' 는 글자 입력마다 오므로 지난번 편집 가능 여부를 기억해 바뀌었을 때만 다시 박는다.
      let lastEditable: boolean | null = null
      const syncVisible = () => {
        if (view.editable === lastEditable) return
        lastEditable = view.editable
        pinVisible(dom, lastEditable ? 'inline-flex' : 'none')
      }
      syncVisible()
      editor.on('update', syncVisible)

      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          return true
        },
        // 고치기·지우기 단추 클릭은 에디터가 노드 선택으로 가로채지 않게 한다.
        stopEvent: (e: Event) => remove.contains(e.target as globalThis.Node) || label.contains(e.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy: () => {
          editor.off('update', syncVisible)
        },
      }
    }
  },
})
