// 위키 @ 통합 멘션 후보 리스트. MentionList/WikiSlashMenu 미러 — 키보드 네비(↑↓ Enter)는
// forwardRef 의 onKeyDown 으로 노출(suggestion render 가 위임 호출). 각 행에 타입 배지(유저/페이지/이슈)
// + label + sublabel. 디자인 시스템 시맨틱 토큰만 사용(hex 금지).

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

import type { WikiEntityCandidate } from '../../hooks/queries/useWikiEntitySearch'
import type { WikiMentionType } from '../../types/wiki'

export interface WikiMentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface WikiMentionListProps {
  items: WikiEntityCandidate[]
  command: (item: WikiEntityCandidate) => void
}

// 타입별 배지 라벨(한국어). 배지는 시맨틱 토큰(secondary)만 사용해 테마 대응.
const BADGE_LABEL: Record<WikiMentionType, string> = {
  USER: '유저',
  PAGE: '페이지',
  ISSUE: '이슈',
}

export const WikiMentionList = forwardRef<WikiMentionListHandle, WikiMentionListProps>(
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

    // 검색 결과가 없을 때 팝업을 닫지 않고 "결과 없음" 메시지를 표시한다.
    // null 반환 시 DOM에서 제거돼 사용자가 검색 실패인지 결과 없음인지 구분 불가.
    if (items.length === 0) {
      return (
        <div
          className="w-80 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md"
          data-testid="wiki-mention-empty"
        >
          결과 없음
        </div>
      )
    }

    return (
      <div
        role="listbox"
        aria-label="멘션 후보"
        className="max-h-60 w-80 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="wiki-mention-popover"
      >
        {items.map((item, idx) => (
          <button
            type="button"
            // mtype+id 조합이 유일 키(타입 간 id 중복 가능).
            key={`${item.mtype}-${item.id}`}
            role="option"
            aria-selected={idx === selected}
            data-testid={`wiki-mention-option-${item.mtype}-${item.id}`}
            onMouseEnter={() => setSelected(idx)}
            onClick={() => select(idx)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
              idx === selected ? 'bg-accent' : ''
            }`}
          >
            {/* 타입 배지 — 시맨틱 토큰만(hex 금지). */}
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
              {BADGE_LABEL[item.mtype]}
            </span>
            <span className="truncate font-medium">{item.label}</span>
            {item.sublabel && (
              <span className="truncate text-xs text-muted-foreground">{item.sublabel}</span>
            )}
          </button>
        ))}
      </div>
    )
  },
)
WikiMentionList.displayName = 'WikiMentionList'
