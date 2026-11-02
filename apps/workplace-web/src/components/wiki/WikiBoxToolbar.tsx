import type { Editor } from '@tiptap/core'
import { Palette } from 'lucide-react'

import { EditorFloatingToolbar, EditorToolbarDivider } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'

import { addLineBesideBox, deleteBox, selectedBox, unwrapBox } from './wikiBox'

/** 상자 막대 「꾸미기」 자리 안내 — 꾸미기 묶음(기본·안내·주의·강조)은 WP-1304 에서 이 단추에 붙는다. */
export const BOX_STYLE_COMING_SOON = '꾸미기는 곧 제공됩니다'

/**
 * 상자 막대(WP-1303) — 상자(wikiHtmlBox)가 통째 선택되면 상자 위에 뜬다: 꾸미기 | ↑ 줄 추가 | ↓ 줄 추가 | 글만 남기기 | 삭제.
 * - 들여온 HTML 카드도 같은 상자라 같은 막대가 뜬다.
 * - 상자는 NodeView 없이 그려져(자식 선택자·grid 배치를 지키려고 — htmlNodes.ts) 막대를 상자 안에 둘 수 없다 — 표 툴바처럼
 *   떠 있는 막대(EditorFloatingToolbar)를 상자 DOM 위에 붙인다.
 * - 「꾸미기」는 자리만 둔 비활성 단추다(WP-1304). 비활성 단추는 마우스 올림을 받지 않아 안내(title)를 감싼 span 에 단다.
 * - 동작은 누르는 순간의 선택에서 상자 위치를 다시 읽는다 — 동료 편집으로 위치가 옮겨졌을 수 있다.
 * - 보기 전용(disabled)이면 뜨지 않는다.
 */
export function WikiBoxToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
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
      <span title={BOX_STYLE_COMING_SOON} data-testid="wiki-box-style-slot">
        <Button type="button" variant="ghost" size="xs" disabled aria-label={`꾸미기 — ${BOX_STYLE_COMING_SOON}`} data-testid="wiki-box-style">
          <Palette aria-hidden="true" />
          꾸미기
        </Button>
      </span>
      <EditorToolbarDivider />
      {action('line-above', '↑ 줄 추가', run((state, dispatch, pos) => addLineBesideBox(state, dispatch, pos, -1)))}
      {action('line-below', '↓ 줄 추가', run((state, dispatch, pos) => addLineBesideBox(state, dispatch, pos, 1)))}
      {action('unwrap', '글만 남기기', run(unwrapBox))}
      <EditorToolbarDivider />
      {action('delete', '삭제', run(deleteBox), 'text-destructive')}
    </EditorFloatingToolbar>
  )
}
