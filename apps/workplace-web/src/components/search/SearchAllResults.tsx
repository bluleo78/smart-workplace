// 「전체」 탭의 묶음 목록(WP-1353) — 앱마다 상위 3건. 묶음 제목(sticky, 누르면 그 앱 탭)과 「○○에서 더 보기」.
// 로딩 중엔 스켈레톤, 0건 묶음은 숨기고, 실패한 묶음만 「불러오지 못했어요 · 다시 시도」로 보여 다른 앱 결과를 막지 않는다.
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { SEARCH_TABS, type SearchAppId } from './searchApps'
import type { SearchHit, SearchPage } from './searchProviders'
import { GROUP_SIZE } from './searchRules'
import { RetryNotice, RowSkeletons } from './SearchStates'

interface Props {
  order: SearchAppId[]
  groups: UseQueryResult<SearchPage, Error>[]
  term: string
  rowFor: (hit: SearchHit) => ReactNode
  onOpenTab: (app: SearchAppId) => void
}

export function SearchAllResults({ order, groups, term, rowFor, onOpenTab }: Props) {
  // 모든 묶음이 끝났는데 한 건도 없고 실패도 없으면 빈 화면 문구.
  const allDone = groups.every((g) => !g.isPending)
  const total = groups.reduce((n, g) => n + (g.data?.hits.length ?? 0), 0)
  if (allDone && total === 0 && groups.every((g) => !g.isError)) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground" data-testid="global-search-empty">
        모든 앱에 「{term}」와 맞는 것이 없어요
      </p>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="global-search-scroll">
      <div role="listbox" aria-label="전체 검색 결과">
        {order.map((app, i) => {
          const q = groups[i]
          const label = SEARCH_TABS.find((t) => t.id === app)?.label ?? ''
          const hits = q.data?.hits.slice(0, GROUP_SIZE) ?? []
          // 0건 묶음은 숨긴다(성공한 빈 응답만 — 로딩·실패는 자리를 보인다).
          if (q.isSuccess && hits.length === 0) return null
          return (
            <div key={app} role="group" aria-label={label} data-testid={`global-search-group-${app}`}>
              <button
                type="button"
                tabIndex={-1}
                data-testid={`global-search-group-title-${app}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpenTab(app)}
                className="sticky top-0 z-10 w-full bg-background px-2 py-1 text-left text-xs font-medium text-muted-foreground"
              >
                {label}
              </button>
              {q.isPending && <RowSkeletons count={GROUP_SIZE} />}
              {q.isError && <RetryNotice testId={`global-search-retry-${app}`} onRetry={() => void q.refetch()} />}
              {hits.map((h) => rowFor(h))}
              {q.isSuccess && (q.data.next !== null || hits.length >= GROUP_SIZE) && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid={`global-search-more-${app}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onOpenTab(app)}
                  className="w-full rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-accent"
                >
                  {label}에서 더 보기
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
