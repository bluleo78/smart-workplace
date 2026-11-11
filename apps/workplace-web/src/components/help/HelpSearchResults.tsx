// 도움말 검색 결과(WP-1509) — 패널 본문 자리에 그리는 결과 목록과, 연 절 위에 다는 「다른 결과」 칩 줄.
// 강조·키 처리는 검색 칸(useHelpSearchState)이 한다 — 목록은 aria-activedescendant 로 강조 카드를 알리는 listbox 다.
import { useMemo } from 'react'

import type { HelpSearchHit } from '@/api/help'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { HelpVars } from './helpBundle'
import { fillHelpSnippet, type HelpValues } from './helpMarkup'
import { HELP_SEARCH_LIST_ID, helpSearchOptionId } from './useHelpSearch'

/** 결과 이름 — 짧은 이름(label)이 없으면 절 제목. */
const hitName = (hit: HelpSearchHit) => hit.label || hit.title

interface HelpSearchResultsProps {
  results: HelpSearchHit[] | undefined
  /** 요청이 실패했는가 — 「검색할 수 없음」. */
  isError: boolean
  /** 강조한 결과 번호(-1 = 없음). */
  current: number
  onOpen: (hit: HelpSearchHit) => void
  /** 발췌의 자리표시를 채울 화면 값·목록(본문과 같은 것). */
  values: HelpValues
  vars: HelpVars | null
}

/**
 * 결과 목록 — 위에 「결과 N건」, 아래 카드(제목 + 두 줄 발췌). 강조 카드는 테두리(border-primary)로 보인다.
 * 0건이면 「결과 없음」, 요청 실패면 「검색할 수 없음」 한 줄. 카드를 누르면 그 결과를 연다.
 */
export function HelpSearchResults({ results, isError, current, onOpen, values, vars }: HelpSearchResultsProps) {
  // 채운 발췌 — ↑/↓ 로 강조만 바뀌는 렌더마다 결과 전부를 다시 채우지 않게 결과·값이 바뀔 때만 만든다.
  const snippets = useMemo(() => results?.map((hit) => fillHelpSnippet(hit.snippet, values, vars)) ?? [], [results, values, vars])
  if (isError && !results)
    return (
      <p data-testid="help-search-error" className="px-4 py-3 text-sm text-muted-foreground">
        검색할 수 없음
      </p>
    )
  if (!results || results.length === 0)
    return (
      <p data-testid="help-search-empty" className="px-4 py-3 text-sm text-muted-foreground">
        결과 없음
      </p>
    )
  return (
    <div className="px-4 pb-4 pt-1">
      <p data-testid="help-search-count" className="pb-2 text-xs text-muted-foreground">
        결과 {results.length}건
      </p>
      {/* 포커스는 검색 칸에 남는다 — 카드는 포인터로만 누르고, 키보드는 칸의 ↑/↓·Enter 로 고른다. */}
      <ul id={HELP_SEARCH_LIST_ID} role="listbox" aria-label="도움말 검색 결과" className="space-y-2">
        {results.map((hit, i) => (
          <li
            key={`${hit.chapter}:${hit.sectionId}`}
            id={helpSearchOptionId(i)}
            role="option"
            aria-selected={i === current}
            data-testid="help-search-result"
            onClick={() => onOpen(hit)}
            className={cn(
              'cursor-pointer rounded-md border px-3 py-2 transition-colors hover:bg-accent',
              i === current ? 'border-primary' : 'border-border',
            )}
          >
            <div className="truncate text-sm font-medium">{hitName(hit)}</div>
            <p className="line-clamp-2 pt-0.5 text-xs text-muted-foreground">{snippets[i]}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 「다른 결과」 칩 줄 — 연 절 위에, 누르면 그 절로 옮긴다. */
export function HelpSearchOtherResults({ others, onOpen }: { others: HelpSearchHit[]; onOpen: (hit: HelpSearchHit) => void }) {
  if (others.length === 0) return null
  return (
    <div data-testid="help-search-other" className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
      <span className="text-xs text-muted-foreground">다른 결과</span>
      {others.map((hit) => (
        <Button
          key={`${hit.chapter}:${hit.sectionId}`}
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onOpen(hit)}
          className="max-w-full rounded-full"
        >
          <span className="truncate">{hitName(hit)}</span>
        </Button>
      ))}
    </div>
  )
}
