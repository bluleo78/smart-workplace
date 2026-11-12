// 도움말 검색(WP-1509) — 검색 칸 질의를 디바운스해 서버 검색을 부르는 훅과, 패널의 검색 화면 상태(질의·강조·연 결과)·키 처리 훅.
// HelpPanel 이 둘을 써서 본문 자리에 결과 목록을 보이거나, 연 절 위에 「다른 결과」 칩을 단다.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ChangeEvent, type KeyboardEvent, useCallback, useState } from 'react'

import { type HelpSearchHit, searchHelp } from '@/api/help'
import { useDebounceValue } from '@/hooks/useDebounceValue'

import type { HelpTarget } from './helpNav'

/** 결과 목록 id — 검색 칸의 aria-controls 가 가리킨다. */
export const HELP_SEARCH_LIST_ID = 'help-search-results'

/** 결과 카드 id — 검색 칸의 aria-activedescendant 가 강조 카드를 가리킨다. */
export const helpSearchOptionId = (index: number) => `help-search-result-${index}`

/** 「다른 결과」 칩 최대 개수 — 패널이 좁아 한 줄 안팎에 들게. */
const OTHER_RESULTS_MAX = 3

/**
 * 질의를 300ms 디바운스해 `GET /help/search` 를 부른다. 공백뿐이면 부르지 않는다.
 * 새 질의의 응답을 기다리는 동안 앞 결과를 그대로 둔다(keepPreviousData) — 칠 때마다 목록이 비었다 차는 깜빡임을 없앤다.
 * 질의가 바뀌면 react-query 가 앞 요청의 signal 을 끊고, 늦게 온 앞 응답은 제 키에만 쌓여 지금 결과를 덮지 않는다.
 * 같은 질의를 지웠다 다시 치는 일이 잦아 5분 동안은 받은 결과를 다시 쓴다(매뉴얼 색인은 그보다 드물게 바뀐다).
 */
export function useHelpSearch(query: string) {
  const debounced = useDebounceValue(query.trim(), 300)
  const result = useQuery({
    queryKey: ['help', 'search', debounced],
    queryFn: ({ signal }) => searchHelp(debounced, signal),
    enabled: debounced !== '',
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
  // 보이는 결과가 지금 입력의 것이 아닌 때 — 디바운스 대기 중(입력 ≠ 디바운스 값)이거나 앞 질의 결과를 임시로 보이는 중.
  const stale = debounced !== query.trim() || result.isPlaceholderData
  return { ...result, stale }
}

/** 결과가 그 절인가 — 장과 절 id 를 함께 견준다(절 id 만으로는 다른 장의 같은 id 를 가르지 못한다). */
const isTarget = (hit: HelpSearchHit, target: HelpTarget) => hit.chapter === target.chapter && hit.sectionId === target.sectionId

/** 연 결과를 뺀 상위 결과(최대 3개) — 연 절 위 「다른 결과」 칩. */
export function otherHelpResults(results: HelpSearchHit[], opened: HelpTarget): HelpSearchHit[] {
  return results.filter((r) => !isTarget(r, opened)).slice(0, OTHER_RESULTS_MAX)
}

/**
 * 패널 검색 화면 상태.
 * - query: 입력값. 고치면 강조를 첫 결과로, 연 결과를 비워 목록으로 돌아간다.
 * - highlight: 강조한 결과 번호(↑/↓, 끝에서 멈춤). 결과 수가 줄면 그려질 때 끝으로 맞춘다.
 * - opened: 연 결과(장·절). null 이면 질의가 있는 동안 본문 자리에 결과 목록을 보인다.
 * @param onOpen 결과를 연다 — 패널이 그 절로 옮긴다(직접 고름, 뒤로 기록 규칙 그대로).
 * @param shown 지금 패널이 보이는 절(목차·절 없음이면 null) — 「다른 결과」 칩은 이 절이 검색으로 연 그 결과일 때만 보인다.
 */
export function useHelpSearchState(onOpen: (hit: HelpSearchHit) => void, shown: HelpTarget | null) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [opened, setOpened] = useState<HelpTarget | null>(null)
  const search = useHelpSearch(query)

  /** 질의를 바꾸고 강조를 첫 결과로, 연 결과를 비운다 — 입력을 고칠 때와 Esc 로 지울 때 같다. 상태 setter 만 써서 늘 같은 함수다. */
  const resetTo = useCallback((next: string) => {
    setQuery(next)
    setHighlight(0)
    setOpened(null)
  }, [])
  /** 검색을 지운다(Esc 와 같다) — 휴대폰 시트가 칸 밖에서 누른 Esc 로 부른다. 늘 같은 함수라 공급자에 한 번만 알리면 된다. */
  const clear = useCallback(() => resetTo(''), [resetTo])

  const active = query.trim() !== ''
  const results = active ? search.data?.results : undefined
  const current = results && results.length > 0 ? Math.min(highlight, results.length - 1) : -1
  // 결과 목록을 보일 때 — 질의가 있고 연 결과가 없으며, 받은 결과나 오류가 있을 때. 첫 응답 전에는 보던 본문을 그대로 둔다.
  const listing = active && opened === null && (results !== undefined || search.isError)
  // 「다른 결과」 칩 — 지금 보이는 절이 검색(또는 칩)으로 연 결과일 때만. 뒤로·경로·목차·관련 링크로 그 절을 떠나면 사라지고
  // (opened 는 둬서 결과 목록이 다시 덮지 않는다 — 떠난 곳의 본문이 그대로 보여야 한다), 보이는 절은 칩에서 뺀다.
  const showingOpened = opened !== null && shown !== null && opened.chapter === shown.chapter && opened.sectionId === shown.sectionId
  const others = active && showingOpened && results ? otherHelpResults(results, opened) : []

  const open = (hit: HelpSearchHit) => {
    setOpened({ chapter: hit.chapter, sectionId: hit.sectionId })
    onOpen(hit)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => resetTo(e.target.value)

  /** ↑/↓ 강조 이동(목록이 보일 때만), Enter 강조 결과 열기, Esc 질의 지우기. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중 Enter·화살표는 조합을 끝내는 키다 — 검색 동작으로 쓰지 않는다.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      if (query === '') return
      // 질의·칩만 지운다. 연 절은 그대로(직접 고른 내용 — 「뒤로」로 돌아간다), 연 적이 없으면 검색 전 본문이 다시 보인다.
      e.preventDefault()
      resetTo('')
      return
    }
    if (!listing || !results || current < 0) return
    // 결과가 앞 질의의 것인 동안 Enter 는 무시한다 — 안 그러면 사용자가 보지 못한 옛 결과가 열린다. 화살표 이동은 허용.
    if (e.key === 'Enter' && search.stale) {
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = current + (e.key === 'ArrowDown' ? 1 : -1)
      setHighlight(Math.max(0, Math.min(results.length - 1, next)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(results[current])
    }
  }

  return { query, onChange, onKeyDown, clear, listing, results, current, isError: search.isError, opened, others, open }
}
