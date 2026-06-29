import { type Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  LANGUAGE_PRESETS,
  TONE_PRESETS,
  TRANSFORM_ACTIONS,
  type TransformActionKey,
} from './wikiAiActions'

/** 선택 텍스트 변형 툴바 — 비어있지 않은 선택에서 선택영역 위에 표시(tiptap BubbleMenu).
 *  param 액션(톤/번역)은 드롭다운으로 프리셋을 고른 뒤, 그 외는 즉시 onAction 을 호출한다.
 *  disabled(뷰어/생성 중)면 아예 렌더하지 않는다. */
export function WikiAiBubbleToolbar({
  editor,
  disabled,
  onAction,
}: {
  editor: Editor | null
  disabled: boolean
  onAction: (action: TransformActionKey, param?: string) => void
}) {
  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      // 선택이 비어있지 않고 비활성이 아닐 때만 노출.
      shouldShow={({ state }) => !disabled && !state.selection.empty}
      tippyOptions={{ placement: 'top' }}
    >
      <div
        data-testid="wiki-ai-toolbar"
        className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md"
      >
        <span className="px-1 text-xs font-medium text-primary">✦ AI</span>
        {TRANSFORM_ACTIONS.map((a) => {
          if (a.param === null) {
            return (
              <button
                key={a.key}
                type="button"
                data-testid={`wiki-ai-tb-${a.key}`}
                // mousedown 기본동작 차단 — 클릭이 에디터 선택을 잃지 않게 한다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAction(a.key)}
                className="rounded px-2 py-1 text-xs hover:bg-accent"
              >
                {a.label}
              </button>
            )
          }
          const presets = a.param === 'tone' ? TONE_PRESETS : LANGUAGE_PRESETS
          const testidPrefix = a.param === 'tone' ? 'wiki-ai-tone' : 'wiki-ai-lang'
          return (
            <DropdownMenu key={a.key}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid={`wiki-ai-tb-${a.key}`}
                  onMouseDown={(e) => e.preventDefault()}
                  className="rounded px-2 py-1 text-xs hover:bg-accent"
                >
                  {a.label} ▾
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {presets.map((p) => (
                  <DropdownMenuItem
                    key={p.value}
                    data-testid={`${testidPrefix}-${p.value}`}
                    onSelect={() => onAction(a.key, p.value)}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
    </BubbleMenu>
  )
}
