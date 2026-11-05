// 통합 검색 결과 한 줄(WP-1353) — 앱 아이콘 · [보낸 사람] · 제목(일치 강조) · 오른쪽 meta · 시각 · 둘째 줄 snippet.
// 링크(<a>)라 가운데 클릭·⌘/Ctrl+클릭의 새 탭 열기가 자연스럽고, 일반 클릭은 앱 안 이동(navigate)으로 가로챈다.
import type { MouseEvent } from 'react'

import { resolvePalette } from '@/lib/calendarPalette'
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
  /** 「전체」 탭 묶음처럼 좁은 자리 — 짧은 meta(metaShort)를 쓰고 꼬리표(캘린더 이름)는 숨긴다. */
  compact?: boolean
}

export function SearchResultRow({ hit, q, active, id, onPick, onHover, compact }: Props) {
  const Icon = hit.icon ?? SEARCH_TABS.find((t) => t.id === hit.app)?.icon
  const meta = compact ? (hit.metaShort ?? hit.meta) : hit.meta
  const tag = compact ? undefined : hit.tag

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
        active ? 'bg-accent text-accent-foreground' : hit.dimmed ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {/* WP-1384: lg 미만(휴대폰)은 제목을 두 줄까지 보이고 meta·시각 묶음을 둘째 줄로 내린다 — 한 줄에 다 얹으면 제목이 14자 안팎만 남아
          서버 발췌(맞은 곳 앞 12자부터)의 맞은 글자가 줄 끝 「…」에 잘렸다. lg 이상은 지금처럼 한 줄(묶음은 contents 라 자식이 첫 줄에 그대로 놓인다). */}
      <span className="flex flex-wrap items-start gap-x-2 lg:flex-nowrap lg:items-center">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground lg:mt-0" aria-hidden />}
        {/* 메시지 결과(WP-1358)는 본문 앞에 보낸 사람을 작게·굵게 — 좁게 잘라 본문 자리를 남긴다. */}
        {hit.sender && (
          <span className="mt-0.5 max-w-28 shrink-0 truncate text-xs font-medium lg:mt-0" data-testid="global-search-hit-sender">
            {hit.sender}
          </span>
        )}
        {/* basis-0 + flex-1 — flex-wrap 에서도 제목이 줄을 바꾸지 않고 남은 폭을 차지한다. 휴대폰은 두 줄까지, lg 이상은 한 줄 말줄임. */}
        <span className="line-clamp-2 min-w-0 flex-1 basis-0 break-words lg:line-clamp-none lg:truncate">
          <Highlighted text={hit.title} q={q} />
        </span>
        {(meta || hit.time) && (
          <span className="flex basis-full items-center gap-1 pl-6 pt-0.5 text-xs text-muted-foreground lg:contents" data-testid="global-search-hit-meta-group">
            {meta && (
              <span className="flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground lg:max-w-[55%] lg:shrink-0">
                <span className="truncate">{meta}</span>
                {tag && (
                  <>
                    <span aria-hidden>·</span>
                    <span className={cn('size-2 shrink-0 rounded-full', resolvePalette(tag.color).dotClass)} aria-hidden />
                    <span className="max-w-24 truncate">{tag.name}</span>
                  </>
                )}
              </span>
            )}
            {/* 메시지 결과는 「# 채널 · 시각」 처럼 meta 와 시각 사이에 점을 둔다 — 다른 행(AI 대화·캘린더)은 그대로. */}
            {hit.sender && meta && hit.time && (
              <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>
                ·
              </span>
            )}
            {hit.time && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{hit.time}</span>}
          </span>
        )}
      </span>
      {hit.snippet && (
        <span className="truncate pl-6 text-xs text-muted-foreground">
          {/* 둘째 줄도 맞은 곳을 강조한다 — 본문·메시지에서 맞은 결과는 제목에 검색어가 없어 어디가 맞았는지 보여야 한다. */}
          {hit.snippetLabel && `${hit.snippetLabel}: `}
          <Highlighted text={hit.snippet} q={q} />
        </span>
      )}
    </a>
  )
}
