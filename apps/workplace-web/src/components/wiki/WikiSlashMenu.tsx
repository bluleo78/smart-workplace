// 위키 에디터 슬래시(/) AI 액션 메뉴. MentionList 미러 — 키보드 네비(↑↓ Enter)는
// forwardRef 의 onKeyDown 으로 노출(suggestion render 가 위임 호출). 선택 시 command(action) 호출.

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

export type WikiAiAction =
  | 'summarize'
  | 'draft'
  | 'continue'
  | 'rewrite_tone'
  | 'translate'
  | 'expand'
  | 'condense'
  | 'polish'

export interface WikiSlashItem {
  key: WikiAiAction
  label: string
}

export interface WikiSlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface WikiSlashMenuProps {
  items: WikiSlashItem[]
  command: (item: WikiSlashItem) => void
}

export const WikiSlashMenu = forwardRef<WikiSlashMenuHandle, WikiSlashMenuProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0)

    useEffect(() => setSelected(0), [items])

    function select(index: number) {
      const item = items[index]
      if (item) command(item)
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowUp') {
          setSelected((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          select(selected)
          return true
        }
        return false
      },
    }))

    return (
      <div
        role="listbox"
        aria-label="AI 액션"
        className="max-h-60 w-56 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="wiki-slash-popover"
      >
        {items.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground" data-testid="wiki-slash-empty">
            일치하는 명령이 없습니다
          </p>
        )}
        {items.map((item, idx) => (
          <button
            type="button"
            key={item.key}
            role="option"
            aria-selected={idx === selected}
            data-testid={`wiki-slash-option-${item.key}`}
            onMouseEnter={() => setSelected(idx)}
            onClick={() => select(idx)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
              idx === selected ? 'bg-accent' : ''
            }`}
          >
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    )
  },
)
WikiSlashMenu.displayName = 'WikiSlashMenu'
