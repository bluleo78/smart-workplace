// WP-1699: 드라이브 「최근」 — 내가 열거나 올리거나 새 판을 올린 파일을 공간을 가로질러 최근 순으로 보는 목록(/drive/recent).
// 표 모양·⋯ 메뉴는 「공유받은 항목」과 같다. 목록 줄은 권한을 주지 않는다 — 열기·다운로드는 늘 기존 파일 API 가 서버에서 다시 판정한다.
// 행 별표 단추는 WP-1698 별표 훅(useSetDriveStar)을 그대로 쓰고, 이 목록 캐시의 starred 만 낙관적으로 바꾼다(실패하면 되돌린다).

import { type InfiniteData, useQueryClient } from '@tanstack/react-query'
import { Clock, Download, FolderOpen, Link as LinkIcon, MoreHorizontal, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { driveApi } from '@/api/drive'
import { ActionMenuItems } from '@/components/ActionMenuItems'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { rowLinkActions } from '@/components/share/shareSheetActions'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { driveFileLocatePath, driveFilePath } from '@/components/viewer/driveOpen'
import { useViewerBundle } from '@/components/viewer/useViewerBundle'
import { driveFileItem, driveViewerKey, parseViewerKey } from '@/components/viewer/viewerItems'
import { ViewerNotFound } from '@/components/viewer/ViewerNotFound'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { useDriveRecent } from '@/hooks/queries/useDriveRecent'
import { useSetDriveStar } from '@/hooks/queries/useDriveStars'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { appUrl } from '@/lib/appUrl'
import { groupRecent, RECENT_BUCKET_LABEL, recentActivityLabel, recentPathLine } from '@/lib/driveRecent'
import { HIT_AREA_COARSE } from '@/lib/hitArea'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { DriveFile, DriveRecentFile, DriveRecentPage } from '@/types/drive'

/**
 * 표 열 — 이름(남는 폭) · 공간 · 마지막 활동 · 별표 · ⋯. 좁은 폭(sm 미만)은 이름 칸과 별표·⋯ 만 두고
 * 공간·마지막 활동은 이름 칸 안 둘째·셋째 줄로 접어 가로로 넘치지 않게 한다.
 */
// 좁은 폭의 칸 사이 24px — 「별표」 화면과 같은 규칙. 별표·⋯ 의 터치 확장(HIT_AREA_COARSE, 사방 10px)이 서로·이름 칸을 덮지 않고 각자 44px 로 눌리게 한다.
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_2rem_2rem] sm:gap-3'

/** 행 단추(별표·⋯) 공통 모양 — 16px 아이콘만 있어 터치에서는 누름 영역만 넓힌다(HIT_AREA_COARSE, 「별표」 화면과 같다). */
const ROW_ICON_BUTTON = cn('rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground', HIT_AREA_COARSE)

/** 「최근」 캐시에서 한 파일의 starred 를 바꾼 사본 — 별표 단추가 서버 응답 전에 바로 켜지고 꺼지게 한다. */
function withRecentStar(data: InfiniteData<DriveRecentPage>, driveFileId: number, starred: boolean): InfiniteData<DriveRecentPage> {
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((it) => (it.driveFileId === driveFileId ? { ...it, starred } : it)),
    })),
  }
}

/** 목록에 없는 목록 자리(열린 파일의 묶음 후보가 없을 때) — 매 렌더 같은 배열이라 변환 memo 가 깨지지 않는다. */
const NO_ITEMS: DriveRecentFile[] = []

/**
 * 「최근」 줄 → 뷰어 항목. 줄에는 버전 파일 id 가 없어 0 으로 둔다 — 영상 재생 주소 캐시 키에만 쓰이고,
 * 서버가 현재 버전으로 재생 주소를 만들어 주므로 동작에는 영향이 없다.
 * 모듈 함수라 useViewerBundle 의 목록 변환 memo 가 렌더마다 깨지지 않는다.
 */
function recentViewerItem(r: DriveRecentFile) {
  const file: DriveFile = {
    id: r.driveFileId,
    folderId: r.folderId,
    fileId: 0,
    name: r.name,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    category: '',
    createdAt: r.lastAt,
    updatedAt: r.lastAt,
    versionCount: 1,
    available: true,
  }
  return driveFileItem(file)
}

/** 드라이브 「최근」 화면(/drive/recent). */
export function DriveRecentView() {
  const query = useDriveRecent()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? NO_ITEMS, [query.data])
  // 묶음·상대 시간의 기준 시각 — 데이터를 새로 받을 때만 갱신한다(렌더마다 바뀌어 문구가 떨리지 않게).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataUpdatedAt 이 바뀔 때만 지금 시각을 다시 잡는 것이 의도다.
  const now = useMemo(() => new Date(), [query.dataUpdatedAt])
  const groups = useMemo(() => groupRecent(items, now), [items, now])
  // 본문 스크롤 요소 — 무한 스크롤 센티널의 root(WP-182). 콜백 ref 라 마운트 뒤 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  // 미리보기 = URL ?preview=<driveFileId>(시스템 뒤로가기로 닫힘, 공간 화면과 같은 규칙). 재조회로 목록에서 빠져도 열린 뷰어가 사라지지 않게 스냅숏을 둔다.
  const previewParam = useHistoryParam('preview')
  const previewId = previewParam.value != null && /^\d+$/.test(previewParam.value) ? Number(previewParam.value) : null
  const viewer = useViewerBundle({
    list: items,
    toItem: recentViewerItem,
    currentKey: previewId != null ? driveViewerKey(previewId) : null,
    // 끝 페이지까지 받은 뒤(또는 실패)에만 「찾을 수 없음」으로 판정한다 — 아직 안 받은 쪽에 있을 수 있다.
    ready: (query.isSuccess && !query.hasNextPage) || query.isError,
    openKey: (key) => {
      const parsed = parseViewerKey(key)
      if (parsed?.kind === 'drive') previewParam.open(String(parsed.id))
    },
  })

  const setDriveStar = useSetDriveStar()

  /**
   * 별표 넣기·빼기 — 이 목록 캐시의 starred 를 먼저 바꾸고 WP-1698 별표 훅으로 서버에 보낸다(훅이 공간 화면·「별표」 목록 캐시와 실패 토스트를 맡는다).
   * 실패하면 이 줄만 되돌린다. 「최근」은 별표를 빼도 줄이 남으므로 「별표 뺌」·되돌리기 토스트는 두지 않는다.
   */
  async function toggleStar(item: DriveRecentFile) {
    const next = !item.starred
    const update = (starred: boolean) =>
      queryClient.setQueryData<InfiniteData<DriveRecentPage>>(driveKeys.recent(), (old) =>
        old ? withRecentStar(old, item.driveFileId, starred) : old,
      )
    update(next)
    const ok = await setDriveStar({ target: { kind: 'FILE', id: item.driveFileId }, spaceId: item.spaceId, starred: next })
    if (!ok) update(!next)
  }

  /** 뷰어를 닫는다 — 연 파일이 서버에 「열기」로 기록됐으니 목록을 다시 받아 맨 위로 올린다. */
  function closeViewer() {
    previewParam.close()
    void queryClient.invalidateQueries({ queryKey: driveKeys.recent() })
  }

  /** 행 ⋯ 메뉴 — 파일 위치 열기 · 다운로드 · 링크 복사. */
  function rowActions(item: DriveRecentFile): MobileSheetAction[] {
    // 링크 복사 — 공간 화면 행 메뉴와 같은 주소(폴더 기준 ?preview)·같은 토스트.
    const copy = rowLinkActions({
      kind: 'file',
      url: appUrl(driveFilePath(item.spaceId, item.folderId, item.driveFileId)),
      title: item.name,
    }).find((a) => a.key === 'copy-link')
    return [
      {
        key: 'locate',
        label: '파일 위치 열기',
        icon: <FolderOpen />,
        // 「드라이브에서 열기」(WP-1732)와 같은 도착 경로 — 공간 화면이 ?highlight 의 행을 보이게 스크롤하고 잠시 강조한 뒤 주소에서 지운다.
        onSelect: () => navigate(driveFileLocatePath(item.spaceId, item.folderId, item.driveFileId)),
      },
      { key: 'download', label: '다운로드', icon: <Download />, onSelect: () => void driveApi.downloadFile(item.driveFileId, item.name) },
      ...(copy ? [{ key: 'copy', label: copy.label, icon: <LinkIcon />, onSelect: copy.onSelect }] : []),
    ]
  }

  let body
  if (query.isPending) {
    body = <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">불러오는 중…</div>
  } else if (failedWithoutData(query)) {
    body = <LoadErrorState title="최근 파일을 불러오지 못했습니다" queries={[query]} testId="drive-recent-error" />
  } else if (items.length === 0) {
    body = (
      // 설명 문장 없이 아이콘과 제목만 둔다(ChatEmptyState 는 설명이 필수라 쓰지 않는다).
      <div data-testid="drive-recent-empty" className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Clock aria-hidden className="h-10 w-10 text-muted-foreground" />
        <div className="text-base font-semibold">최근 파일 없음</div>
      </div>
    )
  } else {
    body = (
      <div role="table" aria-label="최근" data-testid="drive-recent-list">
        {/* 머리 줄 — 넓은 폭에서만(좁은 폭은 이름 칸 안 줄로 접는다). */}
        <div role="row" className={cn(ROW_GRID, 'hidden border-b py-2 text-xs text-muted-foreground sm:grid', pageGutterClass)}>
          <span role="columnheader">이름</span>
          <span role="columnheader">공간</span>
          <span role="columnheader">마지막 활동</span>
          <span role="columnheader" className="sr-only">
            별표
          </span>
          <span role="columnheader" className="sr-only">
            메뉴
          </span>
        </div>
        {groups.map((g) => (
          <div key={g.bucket} role="rowgroup">
            {/* 묶음 머리글 — 고정하지 않는다(스크롤과 함께 올라간다). */}
            <div
              data-testid={`drive-recent-group-${g.bucket}`}
              className={cn('bg-muted/30 py-1.5 text-xs font-medium text-muted-foreground', pageGutterClass)}
            >
              {RECENT_BUCKET_LABEL[g.bucket]}
            </div>
            {g.items.map((item) => (
              <RecentRow
                key={item.driveFileId}
                item={item}
                now={now}
                actions={rowActions(item)}
                onOpen={() => viewer.open(item)}
                onToggleStar={() => void toggleStar(item)}
              />
            ))}
          </div>
        ))}
        <LoadMoreFooter query={query} root={scrollEl} data-testid="drive-recent-more" />
      </div>
    )
  }

  return (
    <Page data-testid="drive-recent-view">
      <Page.Header title="최근" />
      <Page.Body inset={false} scrollRef={setScrollEl}>
        {body}
      </Page.Body>
      {viewer.bundle && (
        <AttachmentViewer
          items={viewer.bundle.items}
          index={viewer.bundle.index}
          onIndexChange={viewer.onIndexChange}
          onClose={closeViewer}
          defaultPanelOpen
        />
      )}
      {/* 지워졌거나 이제 볼 수 없는 파일의 딥링크 — 조용히 고치지 않고 안내 뒤 닫는다. */}
      {viewer.missing && <ViewerNotFound onClose={previewParam.close} />}
    </Page>
  )
}

/** 목록 한 줄 — 이름(아이콘·이름 / 경로·크기) · 공간 · 마지막 활동 · 별표 · ⋯. 좁은 폭은 세 줄(이름 / 경로·크기 / 마지막 활동). */
function RecentRow({
  item,
  now,
  actions,
  onOpen,
  onToggleStar,
}: {
  item: DriveRecentFile
  now: Date
  actions: MobileSheetAction[]
  onOpen: () => void
  onToggleStar: () => void
}) {
  const activity = recentActivityLabel(item, now)
  const starred = item.starred === true
  return (
    <div
      role="row"
      data-testid={`drive-recent-row-${item.driveFileId}`}
      className={cn(ROW_GRID, 'border-b py-2 text-sm hover:bg-accent/40', pageGutterClass)}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <FileTypeIcon mimeType={item.mimeType} className="h-8 w-8 shrink-0 p-1" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block max-w-full truncate text-left font-medium hover:underline">
            {item.name}
          </button>
          <p className="truncate text-xs text-muted-foreground" data-testid={`drive-recent-path-${item.driveFileId}`}>
            {recentPathLine(item)}
          </p>
          {/* 좁은 폭 — 마지막 활동 칸이 없으니 셋째 줄로 접어 둔다. */}
          <p className="truncate text-xs text-muted-foreground sm:hidden">{activity}</p>
        </div>
      </div>
      <span role="cell" className="hidden truncate text-muted-foreground sm:block">
        {item.spaceName}
      </span>
      <span role="cell" data-testid={`drive-recent-activity-${item.driveFileId}`} className="hidden truncate text-muted-foreground sm:block">
        {activity}
      </span>
      <div role="cell" className="flex justify-end">
        {/* 별표(WP-1698) — 켜지면 채운 별(「별표」 화면 행 단추와 같은 모양), 꺼지면 빈 별. */}
        <button
          type="button"
          aria-label={starred ? `${item.name} 별표 빼기` : `${item.name} 별표`}
          aria-pressed={starred}
          data-testid={`drive-recent-star-${item.driveFileId}`}
          onClick={onToggleStar}
          className={ROW_ICON_BUTTON}
        >
          <Star className={cn('h-4 w-4', starred && 'fill-current text-primary')} />
        </button>
      </div>
      <div role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${item.name} 메뉴`}
              data-testid={`drive-recent-menu-${item.driveFileId}`}
              className={ROW_ICON_BUTTON}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 max-w-[calc(100vw-2rem)]">
            <ActionMenuItems actions={actions} itemTestId={(key) => `drive-recent-action-${key}`} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
