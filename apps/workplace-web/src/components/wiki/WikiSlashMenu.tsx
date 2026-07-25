// 위키 에디터 슬래시(/) 명령 메뉴. MentionList 미러 — 키보드 네비(↑↓ Enter)는
// forwardRef 의 onKeyDown 으로 노출(suggestion render 가 위임 호출). 선택 시 command(item) 호출.
//
// 원래 AI 전용 메뉴였으나 #748 에서 표 삽입이 들어오며 일반 명령 메뉴가 됐다. AI 여부는
// kind 로 구분하고, 실행 분기는 wikiSlashSuggestion 의 command 가 담당한다.

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'

export type WikiAiAction =
  | 'summarize'
  | 'draft'
  | 'continue'
  | 'rewrite_tone'
  | 'translate'
  | 'expand'
  | 'condense'
  | 'polish'

/** AI 가 아닌 삽입 명령 키. 현재는 표 하나. */
export type WikiInsertCommand = 'table'

export interface WikiSlashItem {
  key: WikiAiAction | WikiInsertCommand
  label: string
  /** ai=LLM 스트림 트리거, insert=에디터 로컬 삽입(네트워크 없음). command 분기 기준. */
  kind: 'ai' | 'insert'
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

    // 필터 결과에서도 순서(삽입 → AI)가 유지되므로, 두 그룹으로 나눠도 전역 인덱스는
    // insert 개수만 더하면 복원된다. 키보드 네비는 전역 인덱스 기준이라 이 대응이 필요하다.
    const insertItems = items.filter((i) => i.kind === 'insert')
    const aiItems = items.filter((i) => i.kind === 'ai')

    function option(item: WikiSlashItem, idx: number) {
      return (
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
      )
    }

    return (
      <div
        role="listbox"
        aria-label="슬래시 명령"
        className="max-h-60 w-56 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="wiki-slash-popover"
      >
        {items.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground" data-testid="wiki-slash-empty">
            일치하는 명령이 없습니다
          </p>
        )}
        {insertItems.map((item, i) => option(item, i))}
        {/* AI 행들은 group 으로 묶고 마킹을 그룹 헤더에서 한 번만 한다(07-iconography §7.2
            "마킹은 컨테이너 레벨에서 한 번만"). 행마다 AiLabel 을 붙이면 마커가 과포화되고,
            AiLabel 의 text-xs 가 본문 행의 text-sm 과 섞여 타이포도 어긋난다. 메뉴가 AI 전용이던
            시절엔 listbox 의 aria-label="AI 액션" 이 이 역할을 했는데, 표 삽입(#748)이 들어오며
            그 컨테이너 마킹이 사라져 여기서 복원한다. listbox 자식은 option/group 이어야 하므로
            섹션 제목은 group 밖이 아니라 aria-labelledby 로 연결한다. */}
        {aiItems.length > 0 && (
          <div role="group" aria-labelledby="wiki-slash-ai-group">
            <div id="wiki-slash-ai-group" className="px-3 pb-1 pt-2">
              <AiLabel>AI</AiLabel>
            </div>
            {aiItems.map((item, i) => option(item, insertItems.length + i))}
          </div>
        )}
      </div>
    )
  },
)
WikiSlashMenu.displayName = 'WikiSlashMenu'
