import { WikiStyleSchema } from '@smart-workplace/wiki-editor-schema'
import { Palette, X } from 'lucide-react'

import { lucideSvg } from './lucideSvg'

/** 칩·지우기 단추·이름표를 노트 CSS 가 숨기거나 옮기거나 클릭을 막지 못하게 인라인 !important 로 고정한다. */
function pinVisible(el: HTMLElement, display: string): void {
  el.style.setProperty('display', display, 'important')
  el.style.setProperty('visibility', 'visible', 'important')
  el.style.setProperty('opacity', '1', 'important')
  el.style.setProperty('pointer-events', 'auto', 'important')
  el.style.setProperty('position', 'static', 'important')
}

/**
 * 페이지 스타일 노드(WP-1240) — 공용 스키마(WikiStyleSchema)에 화면 칩만 얹는다(스키마는 그대로라 지문이 같다).
 * CSS 자체는 이 칩이 아니라 WikiHtmlScope 가 본문 범위로 가둬 <head> 에 넣는다 — 칩은 「이 노트에 페이지 스타일이 있다」를 알리고
 * 지우는 손잡이일 뿐이다. 보기 전용 화면에서는 숨긴다(편집 가능 여부가 바뀌면 따라간다).
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
      const label = document.createElement('span')
      label.textContent = '페이지 스타일'
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
        // 지우기 단추 클릭은 에디터가 노드 선택으로 가로채지 않게 한다.
        stopEvent: (e: Event) => remove.contains(e.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy: () => {
          editor.off('update', syncVisible)
        },
      }
    }
  },
})
