// 상단 전체 이슈 검색(WP-1324) — AI 어시스턴트 칩 오른쪽의 검색 아이콘. 누르거나 「/」를 치면 검색창이 옆으로 펼쳐지고
// 입력하면 바로 아래에 내가 볼 수 있는 모든 프로젝트의 이슈가 나온다(작업 번호·제목·본문, 최근 수정순 20건).
// 왜 아이콘에서 펼치나: 앱에 전역 상단 바가 없고 위 가운데는 AI 칩 자리라, 평소엔 자리를 거의 차지하지 않고
// 필요할 때만 넓어지게 한다(이슈 챗에서 사람이 고른 방식). 서버는 프로젝트 횡단 검색(/me/issues?q=)을 그대로 쓴다.
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchMeIssues } from '@/api/meIssues'
import { useOptionalAssistant } from '@/components/ai/AIAssistantContext'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { issuePath } from '@/lib/appUrl'
import { formatIssueKey } from '@/lib/issueKey'
import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits'
import { cn } from '@/lib/utils'
import type { IssueResponse } from '@/types/issue'

import {
  GLOBAL_SEARCH_DEBOUNCE_MS,
  GLOBAL_SEARCH_LIMIT,
  highlightParts,
  isSearchableTerm,
  isSearchShortcut,
  moveActive,
} from './globalIssueSearchRules'

/** 제목에서 검색어와 맞은 곳을 강조한다. */
function Highlighted({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/** 결과 한 줄 — 상태 아이콘·유형·작업 번호·제목(강조). 본문으로만 맞은 이슈도 같은 줄로 보인다. */
function ResultRow({
  issue,
  q,
  active,
  id,
  onPick,
  onHover,
}: {
  issue: IssueResponse
  q: string
  active: boolean
  id: string
  onPick: () => void
  onHover: () => void
}) {
  const key = formatIssueKey(issue.projectKey, issue.number)
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      data-testid={`global-search-result-${key}`}
      // 입력칸 포커스를 잃지 않게 mousedown 기본 동작을 막고 click 으로 연다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        active ? 'bg-accent text-accent-foreground' : 'text-foreground',
      )}
    >
      <IssueStatusIcon status={issue.status} name={issue.statusName} color={issue.statusColor} className="h-4 w-4" />
      {issue.type && <IssueTypeBadge type={issue.type} size="sm" iconOnly />}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        <Highlighted text={key} q={q} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <Highlighted text={issue.title} q={q} />
      </span>
    </li>
  )
}

/**
 * 펼치는 전역 이슈 검색. 접혀 있으면 원형 아이콘 버튼, 펼치면 입력칸 + 아래 결과 목록.
 * 위·아래 키로 고르고 Enter 로 열며, Esc·바깥 클릭·이슈를 열면 접힌다.
 */
export function GlobalIssueSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const listId = useId()
  // AI 표면 — 옆 패널이 열려 있으면 검색 칸을 왼쪽으로 펼쳐 패널을 덮지 않고, 전체 화면이면 이슈를 열 때 옆 패널로 내린다.
  // 비서 없는 워크스페이스·테스트처럼 공급자가 없으면 null(늘 닫힌 것으로 본다).
  const ai = useOptionalAssistant()
  const growLeft = ai?.mode === 'side'

  const term = useDebounceValue(q.trim(), GLOBAL_SEARCH_DEBOUNCE_MS)
  // 검색할 만한 검색어일 때만 조회하고 결과 목록을 펼친다(한 글자는 번호일 때만 — 본문까지 훑는 검색이라).
  const showList = isSearchableTerm(term)
  const { data, isFetching, isError } = useQuery({
    queryKey: ['global-issue-search', term],
    queryFn: ({ signal }) => fetchMeIssues({ q: term }, null, GLOBAL_SEARCH_LIMIT, signal),
    enabled: open && showList,
    staleTime: 30_000,
  })
  const items = data?.items ?? []
  // 입력이 디바운스·응답보다 앞서 있으면 보이는 줄은 이전 검색어의 결과다 — 그동안 Enter 로 엉뚱한 이슈를 열지 않게 막는다.
  const settled = term === q.trim() && !isFetching

  /** 접는다 — 검색어는 비워 다음에 열 때 새로 시작한다. */
  const close = () => {
    setOpen(false)
    setQ('')
    setActive(-1)
  }

  // 「/」로 연다(입력 중이 아닐 때) — 열면 입력칸에 포커스.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isSearchShortcut(e)) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 바깥을 누르면 접는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (issue: IssueResponse) => {
    close()
    // 전체 화면 AI 가 콘텐츠를 덮고 있으면 이동한 화면이 보이지 않는다 — 답 안 링크(WP-384)와 같은 규칙으로
    // 히스토리를 건드리지 않고 옆 패널로 내린다(close 는 history 를 되돌려 방금 한 이동을 무른다).
    if (ai?.mode === 'fullscreen') ai.dismiss('side')
    navigate(issuePath(issue.projectKey, issue.number))
  }

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((cur) => moveActive(cur, e.key === 'ArrowDown' ? 1 : -1, items.length))
    } else if (e.key === 'Enter') {
      const target = settled ? items[active >= 0 ? active : 0] : undefined
      if (target) {
        e.preventDefault()
        pick(target)
      }
    } else if (e.key === 'Escape') {
      // AI 패널의 전역 Esc 처리까지 닿지 않게 여기서 멈춘다 — 검색만 접는다.
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  // 바깥 틀은 늘 30px 칸 하나 — 펼친 검색 칸은 그 위에 떠서(absolute) 칩·헤더 자리 계산(useAiChipClamp)을 흔들지 않는다.
  return (
    // 30px — TopCenterSlot 의 108px 계산(칩 반폭 70 + 간격 8 + 이 아이콘 30)과 맞물린다. 바꾸면 그쪽도 고친다.
    <div ref={rootRef} className="relative h-[30px] w-[30px]">
      {!open ? (
        <button
          type="button"
          data-testid="global-search-toggle"
          aria-label="이슈 검색 (/)"
          title="이슈 검색 (/)"
          onClick={() => setOpen(true)}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border bg-card/90 text-muted-foreground shadow-md backdrop-blur hover:text-foreground"
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <div
          className={cn('absolute top-0 w-[min(360px,calc(100vw-2rem))]', growLeft ? 'right-0' : 'left-0')}
          data-testid="global-search"
        >
          <div className="flex h-[30px] items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3 shadow-md">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              data-testid="global-search-input"
              role="combobox"
              aria-label="이슈 검색"
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              placeholder="작업 번호·제목·내용으로 이슈 찾기"
          // GET 요청 줄 길이 상한(WP-732) — 긴 본문을 붙여 넣어도 서버가 요청을 거절하지 않게 자른다.
          maxLength={SEARCH_QUERY_MAX_LENGTH}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                // 검색어가 바뀌면 고른 줄을 처음으로 — 이전 결과의 인덱스가 새 결과에 남지 않게.
                setActive(-1)
              }}
              onKeyDown={onInputKey}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              aria-label="검색 닫기"
              data-testid="global-search-close"
              onClick={close}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {showList && (
            <div className="absolute left-0 right-0 top-full mt-2 rounded-lg border bg-popover p-1 shadow-lg">
              {isError ? (
                <p className="px-2 py-3 text-center text-xs text-destructive" data-testid="global-search-error">
                  검색하지 못했습니다. 잠시 뒤 다시 시도해 주세요.
                </p>
              ) : items.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground" data-testid="global-search-empty">
                  {isFetching ? '찾는 중…' : '일치하는 이슈가 없습니다'}
                </p>
              ) : (
                <ul
                  id={listId}
                  role="listbox"
                  aria-label="이슈 검색 결과"
                  className="max-h-[min(60vh,420px)] overflow-y-auto"
                >
                  {items.map((issue, i) => (
                    <ResultRow
                      key={issue.id}
                      id={`${listId}-${i}`}
                      issue={issue}
                      q={term}
                      active={i === active}
                      onPick={() => pick(issue)}
                      onHover={() => setActive(i)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
