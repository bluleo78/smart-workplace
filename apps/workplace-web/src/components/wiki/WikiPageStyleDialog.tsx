import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { anchorPosition } from './wikiCollabPosition'
import {
  PAGE_CSS_REMOVED_NOTE,
  sanitizeEditedPageCss,
  setPageStyleCss,
  WIKI_PAGE_STYLE_EDIT_EVENT,
  type WikiPageStyleEditDetail,
} from './wikiStyleNode'
import { WikiStyleTextForm } from './WikiStyleTextForm'

/**
 * 페이지 스타일 고치기 창(WP-1304) — 칩 「페이지 스타일」을 누르면(칩이 올린 이벤트) 그 노트 CSS 를 칸에 채워 연다.
 * 상자 꾸미기의 「CSS 로 직접 고치기」와 같은 칸(WikiStyleTextForm)이다. 「적용」은 페이지 CSS 정리기(sanitizeStyleSheet)를 거쳐
 * 노드 css 속성에 쓰고, 정리기가 뺀 것이 있으면 안내와 함께 정리된 글자를 보여 준다. Esc·취소는 바꾸지 않고 닫는다.
 * 노드 위치는 열 때 Yjs 상대 위치로 붙잡아(anchorPosition) 동료 편집으로 옮겨져도 따라간다 — 그 자리가 더는 페이지 스타일이 아니면(동료가 지움) 적용하지 않는다.
 * 편집할 수 없게 되면(보기 전용 전환) 창을 숨긴다(적용할 수 없게).
 */
export function WikiPageStyleDialog({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  // 열 때의 CSS — 칸 첫 글자. null 이면 닫힘. 닫히면 창 내용이 빠지므로 다시 열 때 칸이 새로 채워진다.
  const [initialCss, setInitialCss] = useState<string | null>(null)
  // 고칠 페이지 스타일 위치를 지금 문서에서 다시 푸는 함수 — 렌더와 무관해 state 가 아닌 ref.
  const anchor = useRef<((current: Editor) => number) | null>(null)

  useEffect(() => {
    if (!editor || disabled) return
    const dom = editor.view.dom
    const onEdit = (e: Event) => {
      const { pos } = (e as CustomEvent<WikiPageStyleEditDetail>).detail
      const node = editor.state.doc.nodeAt(pos)
      if (node?.type.name !== 'wikiStyle') return
      anchor.current = anchorPosition(editor, pos)
      setInitialCss(String(node.attrs.css ?? ''))
    }
    dom.addEventListener(WIKI_PAGE_STYLE_EDIT_EVENT, onEdit)
    return () => dom.removeEventListener(WIKI_PAGE_STYLE_EDIT_EVENT, onEdit)
  }, [editor, disabled])

  const close = () => setInitialCss(null)

  return (
    <Dialog open={initialCss !== null && !disabled} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl" data-testid="wiki-page-style-dialog">
        <DialogHeader>
          <DialogTitle>페이지 스타일</DialogTitle>
          <DialogDescription>이 노트 전체에 적용되는 CSS 입니다. 쓸 수 없는 값은 적용할 때 빠집니다.</DialogDescription>
        </DialogHeader>
        {initialCss !== null && editor && (
          <WikiStyleTextForm
            initial={initialCss}
            label="페이지 CSS"
            testId="wiki-page-style-css"
            rows={12}
            onApply={(text) => {
              const { css, changed } = sanitizeEditedPageCss(text)
              const pos = anchor.current?.(editor)
              if (pos == null || !setPageStyleCss(editor, pos, css)) return null
              return { text: css, note: changed ? PAGE_CSS_REMOVED_NOTE : null }
            }}
            onCancel={close}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
