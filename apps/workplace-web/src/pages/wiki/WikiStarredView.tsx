// WP-1765: 노트 「즐겨찾기」 — 내가 별표한 페이지를 공간을 가로질러 즐겨찾기한 순(최신 먼저)으로 보는 목록(/wiki/starred).
// 「최근」(WikiRecentView)과 같은 표 모양·상태 처리를 따르되 날짜 묶음은 없다. 목록 줄은 권한을 주지 않는다 —
// 제목을 눌러 열면 기존 노트 화면이 서버에서 다시 판정하고, 볼 수 없게 된 페이지는 서버가 목록에서 뺀다.

import { ExternalLink, FileText, Link as LinkIcon, MoreHorizontal, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ActionMenuItems } from '@/components/ActionMenuItems'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { copyShareLink } from '@/components/share/shareActions'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { WikiStarButton } from '@/components/wiki/WikiStarButton'
import { useWikiStarred, useWikiStarredIdSet } from '@/hooks/queries/useWikiStars'
import { wikiSpacePagePath } from '@/lib/appUrl'
import { ROW_ICON_BUTTON } from '@/lib/driveRecent'
import { formatRelativeTime } from '@/lib/formatters'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { WikiStarredItem } from '@/types/wiki'

import { wikiPathLine } from './wikiPathLine'

/**
 * 표 열 — 제목(남는 폭) · 공간 · 즐겨찾기한 때 · 별 · ⋯. 좁은 폭(sm 미만)은 제목 칸과 별·⋯ 만 두고
 * 공간·즐겨찾기한 때는 제목 칸 안 줄로 접어 가로로 넘치지 않게 한다(「최근」과 같은 규칙).
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_2rem_2rem] sm:gap-3'

/** 아직 받은 줄이 없을 때의 목록 — 매 렌더 같은 배열이라 memo 가 깨지지 않는다. */
const NO_ITEMS: WikiStarredItem[] = []

/** 노트 「즐겨찾기」 화면(/wiki/starred). */
export function WikiStarredView() {
  const query = useWikiStarred()
  // 별 상태의 단일 출처는 id 집합이다 — 별이 빠진 행은 바로 숨기고(빼기 낙관 갱신), 빼기가 실패해 집합이 되돌아오면 다시 보인다.
  // 집합을 아직 못 받았으면(null) 거르지 않고 서버 목록을 그대로 보인다.
  const starredIds = useWikiStarredIdSet()
  const items = useMemo(
    () => {
      const all = query.data?.pages.flatMap((p) => p.items) ?? NO_ITEMS
      return starredIds ? all.filter((it) => starredIds.has(it.pageId)) : all
    },
    [query.data, starredIds],
  )
  // 상대 시간의 기준 시각 — 데이터를 새로 받을 때만 갱신한다(렌더마다 바뀌어 문구가 떨리지 않게).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataUpdatedAt 이 바뀔 때만 지금 시각을 다시 잡는 것이 의도다.
  const now = useMemo(() => new Date(), [query.dataUpdatedAt])
  // 본문 스크롤 요소 — 무한 스크롤 센티널의 root. 콜백 ref 라 마운트 뒤 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  let body
  if (query.isPending) {
    body = <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">불러오는 중…</div>
  } else if (failedWithoutData(query)) {
    body = <LoadErrorState title="즐겨찾기를 불러오지 못했습니다" queries={[query]} testId="wiki-starred-error" />
  } else if (items.length === 0 && !query.hasNextPage) {
    // 다음 쪽이 남았으면 빈 상태가 아니다 — 받아 둔 행을 다 뺐거나 첫 쪽이 비어도 뒤에 줄이 있을 수 있어, 목록 + 더 보기를 그린다.
    body = (
      <div data-testid="wiki-starred-empty" className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Star aria-hidden className="h-10 w-10 text-muted-foreground" />
        <div className="text-base font-semibold">즐겨찾기 없음</div>
      </div>
    )
  } else {
    body = (
      <div role="table" aria-label="즐겨찾기" data-testid="wiki-starred-list">
        {/* 머리 줄 — 넓은 폭에서만(좁은 폭은 제목 칸 안 줄로 접는다). */}
        <div role="row" className={cn(ROW_GRID, 'hidden border-b py-2 text-xs text-muted-foreground sm:grid', pageGutterClass)}>
          <span role="columnheader">제목</span>
          <span role="columnheader">공간</span>
          <span role="columnheader">즐겨찾기한 때</span>
          <span role="columnheader" className="sr-only">
            즐겨찾기
          </span>
          <span role="columnheader" className="sr-only">
            메뉴
          </span>
        </div>
        <div role="rowgroup">
          {items.map((item) => (
            <StarredRow key={item.pageId} item={item} now={now} />
          ))}
        </div>
        <LoadMoreFooter query={query} root={scrollEl} data-testid="wiki-starred-more" />
      </div>
    )
  }

  return (
    <Page data-testid="wiki-starred-view">
      <Page.Header title="즐겨찾기" />
      <Page.Body inset={false} scrollRef={setScrollEl}>
        {body}
      </Page.Body>
    </Page>
  )
}

/** 목록 한 줄 — 제목(아이콘·제목 / 경로) · 공간 · 즐겨찾기한 때 · 별 · ⋯. 좁은 폭은 세 줄(제목 / 경로 / 즐겨찾기한 때). */
function StarredRow({ item, now }: { item: WikiStarredItem; now: Date }) {
  const when = formatRelativeTime(item.starredAt, now)
  const title = item.title || '제목 없음'
  // ⋯ 메뉴 — 새 탭에서 열기(앱 안 경로) · 링크 복사(서버가 준 절대 주소 그대로). 「최근」과 같다.
  const actions: MobileSheetAction[] = [
    {
      key: 'open-tab',
      label: '새 탭에서 열기',
      icon: <ExternalLink />,
      onSelect: () => window.open(wikiSpacePagePath(item.spaceId, item.pageId), '_blank', 'noopener,noreferrer'),
    },
    {
      key: 'copy-link',
      label: '링크 복사',
      icon: <LinkIcon />,
      onSelect: () => void copyShareLink({ kind: 'page', url: item.url, title }),
    },
  ]
  return (
    <div
      role="row"
      data-testid={`wiki-starred-row-${item.pageId}`}
      className={cn(ROW_GRID, 'border-b py-2 text-sm hover:bg-accent/40', pageGutterClass)}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <FileText aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Link
            to={wikiSpacePagePath(item.spaceId, item.pageId)}
            className="block max-w-full truncate font-medium hover:underline"
          >
            {title}
          </Link>
          <p className="truncate text-xs text-muted-foreground" data-testid={`wiki-starred-path-${item.pageId}`}>
            {wikiPathLine(item)}
          </p>
          {/* 좁은 폭 — 즐겨찾기한 때 칸이 없으니 셋째 줄로 접어 둔다. */}
          <p className="truncate text-xs text-muted-foreground sm:hidden" data-testid={`wiki-starred-when-mobile-${item.pageId}`}>
            {when}
          </p>
        </div>
      </div>
      <span role="cell" className="hidden min-w-0 truncate text-muted-foreground sm:block">
        {item.spaceName}
      </span>
      <span role="cell" data-testid={`wiki-starred-when-${item.pageId}`} className="hidden min-w-0 truncate text-muted-foreground sm:block">
        {when}
      </span>
      <div role="cell" className="flex justify-end">
        <WikiStarButton pageId={item.pageId} variant="row" className="size-8" />
      </div>
      <div role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`${title} 메뉴`} data-testid={`wiki-starred-menu-${item.pageId}`} className={ROW_ICON_BUTTON}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 max-w-[calc(100vw-2rem)]">
            <ActionMenuItems actions={actions} itemTestId={(key) => `wiki-starred-action-${key}`} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
