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
  /** 표 삽입 확정 시에만 채워진다(그리드에서 고른 크기). 헤더 행 포함 행 수. */
  rows?: number
  cols?: number
}

export interface WikiSlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface WikiSlashMenuProps {
  items: WikiSlashItem[]
  command: (item: WikiSlashItem) => void
}

// 그리드 상한 — 그 이상은 삽입 후 툴바로 늘린다. 팝업 폭(w-56)에 8열이 들어가는 크기다.
const MAX_ROWS = 5
const MAX_COLS = 8
// 초기값은 기존 기본값(3×3)과 같게 둬서, 바로 Enter 를 눌러도 이전과 동일한 표가 나온다.
const DEFAULT_SIZE = { rows: 3, cols: 3 }

export const WikiSlashMenu = forwardRef<WikiSlashMenuHandle, WikiSlashMenuProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0)
    const [mode, setMode] = useState<'list' | 'tableSize'>('list')
    const [size, setSize] = useState(DEFAULT_SIZE)

    // 쿼리가 바뀌어 항목이 갱신되면 목록 모드로 되돌린다(그리드가 떠 있는 채로 필터가
    // 바뀌면 사용자가 무엇을 고르는 중인지 알 수 없다).
    useEffect(() => {
      setSelected(0)
      setMode('list')
      setSize(DEFAULT_SIZE)
    }, [items])

    function select(index: number) {
      const item = items[index]
      if (!item) return
      // 표는 크기를 먼저 고른다 — 팝업을 닫지 않고 같은 자리에서 그리드로 전환한다.
      if (item.key === 'table') {
        setMode('tableSize')
        return
      }
      command(item)
    }

    function confirmSize() {
      const table = items.find((i) => i.key === 'table')
      if (table) command({ ...table, rows: size.rows, cols: size.cols })
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (mode === 'tableSize') {
          // 그리드 모드에서는 화살표가 크기 조절, Enter 가 확정, Escape 가 목록 복귀다.
          const delta: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
          }
          const d = delta[event.key]
          if (d) {
            setSize((s) => ({
              rows: Math.min(MAX_ROWS, Math.max(1, s.rows + d[0])),
              cols: Math.min(MAX_COLS, Math.max(1, s.cols + d[1])),
            }))
            return true
          }
          if (event.key === 'Enter') {
            confirmSize()
            return true
          }
          if (event.key === 'Escape') {
            setMode('list')
            setSize(DEFAULT_SIZE)
            return true
          }
          return false
        }
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
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => select(idx)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
            idx === selected ? 'bg-accent' : ''
          }`}
        >
          <span className="font-medium">{item.label}</span>
        </button>
      )
    }

    if (mode === 'tableSize') {
      return (
        <div
          className="w-56 rounded-md border bg-popover p-2 shadow-md"
          data-testid="wiki-slash-popover"
        >
          <p
            className="pb-2 text-center text-xs text-muted-foreground"
            data-testid="wiki-table-size-label"
          >
            {size.rows} × {size.cols}
          </p>
          {/* 행 × 열 그리드. 셀에 마우스를 올리거나 화살표로 크기를 바꾸고 클릭·Enter 로 확정한다. */}
          <div
            className="grid grid-cols-8 gap-0.5"
            role="grid"
            aria-label="표 크기 선택"
            data-testid="wiki-table-size-grid"
          >
            {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
              const row = Math.floor(i / MAX_COLS) + 1
              const col = (i % MAX_COLS) + 1
              const on = row <= size.rows && col <= size.cols
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  aria-label={`${row} × ${col}`}
                  aria-selected={on}
                  data-testid={`wiki-table-size-cell-${row}-${col}`}
                  onMouseEnter={() => setSize({ rows: row, cols: col })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSize({ rows: row, cols: col })
                    const table = items.find((it) => it.key === 'table')
                    if (table) command({ ...table, rows: row, cols: col })
                  }}
                  className={`h-4 w-4 rounded-[2px] border ${on ? 'border-primary bg-primary' : 'border-border'}`}
                />
              )
            })}
          </div>
        </div>
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
