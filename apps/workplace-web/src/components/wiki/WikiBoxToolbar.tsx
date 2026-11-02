import type { Editor } from '@tiptap/core'
import { Palette } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { EditorFloatingToolbar, EditorToolbarDivider } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'

import { addLineBesideBox, deleteBox, selectedBox, unwrapBox } from './wikiBox'
import { WikiBoxStylePanel } from './WikiBoxStylePanel'
import { anchorPosition } from './wikiCollabPosition'
import { keepFocus } from './wikiPinVisible'

/**
 * 상자 막대(WP-1303) — 상자(wikiHtmlBox)가 통째 선택되면 상자 위에 뜬다: 꾸미기 | ↑ 줄 추가 | ↓ 줄 추가 | 글만 남기기 | 삭제.
 * - 들여온 HTML 카드도 같은 상자라 같은 막대가 뜬다.
 * - 상자는 NodeView 없이 그려져(자식 선택자·grid 배치를 지키려고 — htmlNodes.ts) 막대를 상자 안에 둘 수 없다 — 표 툴바처럼
 *   떠 있는 막대(EditorFloatingToolbar)를 상자 DOM 위에 붙인다.
 * - 「꾸미기」는 막대 아래에 「상자 꾸미기」 창(WikiBoxStylePanel, WP-1304)을 열고 닫는다. 창은 막대 안에 들어 있어(막대 아래로 떠 보인다)
 *   막대와 함께 뜨고 사라진다 — 상자 선택이 풀리면 막대째 숨고, 다시 고르면 닫힌 상태로 뜬다.
 * - 동작은 누르는 순간의 선택에서 상자 위치를 다시 읽는다 — 동료 편집으로 위치가 옮겨졌을 수 있다.
 * - 보기 전용(disabled)이면 뜨지 않는다.
 */
export function WikiBoxToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  // 꾸미기 창이 열렸는지. 상자 통째 선택이 풀리거나(다른 곳 누르기·Esc·삭제) 내가 다른 상자를 고르면 닫는다 — 다시 고르면 닫힌 막대로 뜬다.
  // 열 때 고른 상자 위치를 Yjs 상대 위치로 붙잡아(anchorPosition) 거래마다 지금 문서에서 풀어 지금 선택된 상자와 비교한다 —
  // 동료 편집으로 상자가 옮겨져도 같은 상자면 열린 채 남고(동료 타자에 창이 닫히지 않게), 다른 상자를 고르면 닫는다
  // (창이 남으면 「CSS 로 직접 고치기」 칸의 앞 상자 글자가 새 상자에 덮어써진다).
  const [styling, setStyling] = useState(false)
  useEffect(() => {
    if (!editor || !styling) return
    const opened = selectedBox(editor.state)
    const anchor = opened ? anchorPosition(editor, opened.pos) : null
    const onTransaction = () => {
      const hit = selectedBox(editor.state)
      if (!hit || !anchor || anchor(editor) !== hit.pos) setStyling(false)
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor, styling])
  // 창 닫기 — 편집기에 포커스를 돌려 상자 통째 선택에서 키(Enter·화살표·Esc)를 이어 쓰게 한다.
  const closeStyle = useCallback(() => {
    setStyling(false)
    editor?.view.focus()
  }, [editor])
  if (!editor) return null

  /** 지금 통째 선택된 상자 위치로 fn 을 부르고 편집기에 포커스를 돌린다 — 상자가 선택돼 있지 않으면 아무것도 하지 않는다. */
  const run = (fn: (state: Editor['state'], dispatch: Editor['view']['dispatch'], pos: number) => unknown) => () => {
    const hit = selectedBox(editor.state)
    if (!hit) return
    fn(editor.state, editor.view.dispatch, hit.pos)
    editor.view.focus()
  }

  /** 막대 단추 — mousedown 기본 동작을 막아 편집기 선택(상자 통째 선택)을 잃지 않게. */
  const action = (key: string, label: string, onClick: () => void, className?: string) => (
    <Button
      key={key}
      type="button"
      variant="ghost"
      size="xs"
      data-testid={`wiki-box-${key}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={className}
    >
      {label}
    </Button>
  )

  return (
    <EditorFloatingToolbar
      editor={editor}
      // 다른 떠 있는 막대(AI·표·링크)와 키를 나눈다(같은 키면 서로 덮어쓴다).
      pluginKey="wikiBoxBubble"
      // 상자 통째 선택일 때만 — AI 막대는 노드 선택에서 숨고, 표 막대는 빈 선택에서만 떠 겹치지 않는다.
      shouldShow={({ editor: ed, state }) => !disabled && ed.isEditable && selectedBox(state) !== null}
      ariaLabel="상자 편집"
      testId="wiki-box-toolbar"
      // 기본 앵커(선택 좌표)는 상자 전체라 막대가 상자 가운데를 기준으로 뜬다 — 상자 DOM 사각형 위에 붙인다.
      getReferenceClientRect={() => {
        const hit = selectedBox(editor.state)
        const dom = hit ? editor.view.nodeDOM(hit.pos) : null
        return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={styling}
        aria-haspopup="dialog"
        data-testid="wiki-box-style"
        onMouseDown={keepFocus}
        onClick={() => setStyling(!styling && selectedBox(editor.state) !== null)}
        className={styling ? 'bg-accent text-accent-foreground' : undefined}
      >
        <Palette aria-hidden="true" />
        꾸미기
      </Button>
      <EditorToolbarDivider />
      {action('line-above', '↑ 줄 추가', run((state, dispatch, pos) => addLineBesideBox(state, dispatch, pos, -1)))}
      {action('line-below', '↓ 줄 추가', run((state, dispatch, pos) => addLineBesideBox(state, dispatch, pos, 1)))}
      {action('unwrap', '글만 남기기', run(unwrapBox))}
      <EditorToolbarDivider />
      {action('delete', '삭제', run(deleteBox), 'text-destructive')}
      {styling && <WikiBoxStylePanel editor={editor} onClose={closeStyle} />}
    </EditorFloatingToolbar>
  )
}
