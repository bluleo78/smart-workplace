// 통합 검색 결과 한 줄(WP-1353) — 앱 아이콘 · 제목(일치 강조) · 오른쪽 meta · 둘째 줄 snippet.
// 링크(<a>)라 가운데 클릭·⌘/Ctrl+클릭의 새 탭 열기가 자연스럽고, 일반 클릭은 앱 안 이동(navigate)으로 가로챈다.
import type { MouseEvent } from 'react'

import { cn } from '@/lib/utils'

import { SEARCH_TABS } from './searchApps'
import type { SearchHit } from './searchProviders'
import { highlightParts } from './searchRules'

/** 제목에서 검색어와 맞은 곳을 <mark> 로 강조한다. */
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

interface Props {
  hit: SearchHit
  q: string
  active: boolean
  id: string
  /** newTab 이면 새 탭으로 열고 팔레트는 유지한다. */
  onPick: (hit: SearchHit, newTab: boolean) => void
  onHover: () => void
}

export function SearchResultRow({ hit, q, active, id, onPick, onHover }: Props) {
  const Icon = SEARCH_TABS.find((t) => t.id === hit.app)?.icon

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    onPick(hit, e.metaKey || e.ctrlKey)
  }
  // 가운데 클릭 — 브라우저 기본 새 탭 대신 같은 경로(noopener)로 열고 팔레트를 유지한다.
  const onAuxClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 1) return
    e.preventDefault()
    onPick(hit, true)
  }

  return (
    <a
      id={id}
      href={hit.href}
      role="option"
      aria-selected={active}
      data-testid={`global-search-hit-${hit.key}`}
      data-active={active || undefined}
      onClick={onClick}
      onAuxClick={onAuxClick}
      onMouseEnter={onHover}
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm no-underline',
        active ? 'bg-accent text-accent-foreground' : 'text-foreground',
      )}
    >
      <span className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">
          <Highlighted text={hit.title} q={q} />
        </span>
        {hit.meta && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{hit.meta}</span>}
      </span>
      {hit.snippet && <span className="truncate pl-6 text-xs text-muted-foreground">{hit.snippet}</span>}
    </a>
  )
}
