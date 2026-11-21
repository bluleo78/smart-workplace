// WP-1764: 노트 「최근」 — 내가 열거나 고친 페이지를 공간을 가로질러 최근 순으로 보는 목록(/wiki/recent).
// 드라이브 「최근」(DriveRecentView)과 같은 표 모양·묶음·상태 처리를 따른다. 목록 줄은 권한을 주지 않는다 —
// 제목을 눌러 열면 기존 노트 화면이 서버에서 다시 판정한다. 행마다 즐겨찾기 별 단추(WP-1765)가 ⋯ 앞에 있다.

import { Clock, ExternalLink, FileText, Link as LinkIcon, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ActionMenuItems } from '@/components/ActionMenuItems'
import { ListEmptyState } from '@/components/issue/ListEmptyState'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { copyShareLink } from '@/components/share/shareActions'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { WikiStarButton } from '@/components/wiki/WikiStarButton'
import { useWikiRecent } from '@/hooks/queries/useWikiRecent'
import { wikiSpacePagePath } from '@/lib/appUrl'
import { groupRecent, RECENT_BUCKET_LABEL, recentActivityLabel, ROW_ICON_BUTTON } from '@/lib/driveRecent'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { WikiRecentItem } from '@/types/wiki'

import { wikiPathLine } from './wikiPathLine'

/**
 * 표 열 — 제목(남는 폭) · 공간 · 마지막 활동 · 별 · ⋯. 좁은 폭(sm 미만)은 제목 칸과 별·⋯ 만 두고
 * 공간·마지막 활동은 제목 칸 안 둘째·셋째 줄로 접어 가로로 넘치지 않게 한다.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_2rem_2rem] sm:gap-3'

/** 아직 받은 줄이 없을 때의 목록 — 매 렌더 같은 배열이라 memo 가 깨지지 않는다. */
const NO_ITEMS: WikiRecentItem[] = []

/** 노트 「최근」 화면(/wiki/recent). */
export function WikiRecentView() {
  const query = useWikiRecent()
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? NO_ITEMS, [query.data])
  // 묶음·상대 시간의 기준 시각 — 데이터를 새로 받을 때만 갱신한다(렌더마다 바뀌어 문구가 떨리지 않게).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataUpdatedAt 이 바뀔 때만 지금 시각을 다시 잡는 것이 의도다.
  const now = useMemo(() => new Date(), [query.dataUpdatedAt])
  const groups = useMemo(() => groupRecent(items, now), [items, now])
  // 본문 스크롤 요소 — 무한 스크롤 센티널의 root. 콜백 ref 라 마운트 뒤 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  let body
  // 실패 먼저 — 다시 시도하면 status 가 pending 으로 돌아가 안내·초점을 잃는다(WP-881·WP-1788, lib/queryFailure).
  if (failedWithoutData(query)) {
    body = <LoadErrorState title="최근 노트를 불러오지 못했습니다" queries={[query]} testId="wiki-recent-error" />
  } else if (query.isPending) {
    body = <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">불러오는 중…</div>
  } else if (items.length === 0) {
    body = (
      <ListEmptyState icon={Clock} title="최근 노트 없음" testId="wiki-recent-empty" className="gap-2 px-4 py-12" />
    )
  } else {
    body = (
      <div role="table" aria-label="최근" data-testid="wiki-recent-list">
        {/* 머리 줄 — 넓은 폭에서만(좁은 폭은 제목 칸 안 줄로 접는다). */}
        <div role="row" className={cn(ROW_GRID, 'hidden border-b py-2 text-xs text-muted-foreground sm:grid', pageGutterClass)}>
          <span role="columnheader">제목</span>
          <span role="columnheader">공간</span>
          <span role="columnheader">마지막 활동</span>
          <span role="columnheader" className="sr-only">
            즐겨찾기
          </span>
          <span role="columnheader" className="sr-only">
            메뉴
          </span>
        </div>
        {groups.map((g) => (
          <div key={g.bucket} role="rowgroup">
            <div
              data-testid={`wiki-recent-group-${g.bucket}`}
              className={cn('bg-muted/30 py-1.5 text-xs font-medium text-muted-foreground', pageGutterClass)}
            >
              {RECENT_BUCKET_LABEL[g.bucket]}
            </div>
            {g.items.map((item) => (
              <RecentRow key={item.pageId} item={item} now={now} />
            ))}
          </div>
        ))}
        <LoadMoreFooter query={query} root={scrollEl} data-testid="wiki-recent-more" />
      </div>
    )
  }

  return (
    <Page data-testid="wiki-recent-view">
      <Page.Header title="최근" />
      <Page.Body inset={false} scrollRef={setScrollEl}>
        {body}
      </Page.Body>
    </Page>
  )
}

/** 목록 한 줄 — 제목(아이콘·제목 / 경로) · 공간 · 마지막 활동 · ⋯. 좁은 폭은 세 줄(제목 / 경로 / 마지막 활동). */
function RecentRow({ item, now }: { item: WikiRecentItem; now: Date }) {
  const activity = recentActivityLabel(item, now)
  const title = item.title || '제목 없음'
  // ⋯ 메뉴 — 새 탭에서 열기(앱 안 경로) · 링크 복사(서버가 준 절대 주소 그대로).
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
      data-testid={`wiki-recent-row-${item.pageId}`}
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
          <p className="truncate text-xs text-muted-foreground" data-testid={`wiki-recent-path-${item.pageId}`}>
            {wikiPathLine(item)}
          </p>
          {/* 좁은 폭 — 마지막 활동 칸이 없으니 셋째 줄로 접어 둔다. */}
          <p className="truncate text-xs text-muted-foreground sm:hidden" data-testid={`wiki-recent-activity-mobile-${item.pageId}`}>
            {activity}
          </p>
        </div>
      </div>
      <span role="cell" className="hidden min-w-0 truncate text-muted-foreground sm:block">
        {item.spaceName}
      </span>
      <span role="cell" data-testid={`wiki-recent-activity-${item.pageId}`} className="hidden min-w-0 truncate text-muted-foreground sm:block">
        {activity}
      </span>
      <div role="cell" className="flex justify-end">
        <WikiStarButton pageId={item.pageId} variant="row" className="size-8" />
      </div>
      <div role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`${title} 메뉴`} data-testid={`wiki-recent-menu-${item.pageId}`} className={ROW_ICON_BUTTON}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 max-w-[calc(100vw-2rem)]">
            <ActionMenuItems actions={actions} itemTestId={(key) => `wiki-recent-action-${key}`} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
