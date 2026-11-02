import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

import { EditorFloatingToolbar, EditorToolbarDivider } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'

import { choosePastePlain, choosePasteShape, pasteChipState, type PasteChoice } from './wikiPasteChip'

/**
 * 붙여넣기 칩(WP-1306) — 노트 밖 HTML 을 붙인 자리(붙인 범위 끝) 아래에 「붙여 넣었습니다 · 모양 유지 | 글만」을 띄운다. 지금 고른 쪽이 눌린 상태다.
 * - 상태·동작은 wikiPasteChip.ts(플러그인)가 쥔다 — 여기는 그 상태를 그리고 단추를 잇기만 한다.
 * - 떠 있는 막대(EditorFloatingToolbar)를 쓴다 — 표·상자 막대와 같은 표면·배치. 다만 막대(tiptap BubbleMenu)는 선택·문서가 바뀔 때만 다시 판정하므로,
 *   칩만 닫히는 거래(Esc·밖 누르기 — 메타만 바뀜)에도 숨도록 칩 상태를 거래마다 읽어(useEditorState) 표면을 직접 감춘다(suppressed).
 * - 단추는 mousedown 기본 동작을 막아 편집기 포커스·선택을 지킨다 — 선택이 옮겨지면 칩이 닫힌다.
 * - 보기 전용(disabled)이면 뜨지 않는다.
 */
export function WikiPasteChip({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  // 지금 고른 쪽 — 거래마다 다시 읽고, 바뀔 때만 다시 그린다. 칩이 없으면 null.
  const choice = useEditorState({
    editor,
    selector: ({ editor: ed }): PasteChoice | null => (ed ? (pasteChipState(ed.state)?.choice ?? null) : null),
  })
  if (!editor) return null

  /** 칩 단추 — 고른 쪽은 눌린 상태(aria-pressed)로 그린다. */
  const option = (key: PasteChoice, label: string, run: (ed: Editor) => boolean) => (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-pressed={choice === key}
      data-testid={`wiki-paste-${key}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        run(editor)
        editor.view.focus()
      }}
      className={choice === key ? 'bg-accent font-semibold text-accent-foreground' : undefined}
    >
      {label}
    </Button>
  )

  return (
    <EditorFloatingToolbar
      editor={editor}
      // 다른 떠 있는 막대(AI·표·상자·링크)와 키를 나눈다.
      pluginKey="wikiPasteChip"
      placement="bottom-start"
      shouldShow={({ editor: ed, state }) => !disabled && ed.isEditable && pasteChipState(state) !== null}
      suppressed={disabled || choice === null}
      ariaLabel="붙여넣기 모양"
      testId="wiki-paste-chip"
      // 붙인 범위 끝 글자 자리 — 막대가 붙인 내용 바로 아래에 뜬다.
      getReferenceClientRect={() => {
        const st = pasteChipState(editor.state)
        if (!st) return null
        try {
          const c = editor.view.coordsAtPos(st.to, -1)
          return new DOMRect(c.left, c.top, 0, c.bottom - c.top)
        } catch {
          return null
        }
      }}
    >
      <span className="px-2 text-xs text-muted-foreground">붙여 넣었습니다</span>
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        ·
      </span>
      {option('shape', '모양 유지', choosePasteShape)}
      <EditorToolbarDivider />
      {option('plain', '글만', choosePastePlain)}
    </EditorFloatingToolbar>
  )
}
