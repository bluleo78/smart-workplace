// WP-1698: 드라이브 「별표」 — 내가 별표한 파일·폴더를 공간과 상관없이 모아 본다(별표한 순, 커서로 이어 받기).
// 목록은 서버가 지금 볼 수 있는 항목(공간 구성원·휴지통 아님)만 준다. 폴더는 그 공간의 그 폴더로 가고, 파일은 이 자리에서 보기 창으로 연다.
// 별표 단추로 빼면 목록에서 바로 빠지고 토스트 「별표 뺌」의 「되돌리기」로 다시 넣는다 — 토스트마다 자기 항목을 들고 있어 여러 행을 연달아 빼도 각자 맞는 항목을 되살린다.
// 원본이 유실된 파일(available=false)은 공간 화면과 같이 「원본 유실」 배지를 달고, 열기 대신 안내하며 다운로드를 막는다.

import { Download, Folder, FolderOpen, MoreHorizontal, Star, StarOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { driveApi } from '@/api/drive'
import { ActionMenuItems } from '@/components/ActionMenuItems'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { rowLinkActions } from '@/components/share/shareSheetActions'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { StatusBadge } from '@/components/ui/status-badge'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import type { ViewerItem } from '@/components/viewer/types'
import { useViewerBundle } from '@/components/viewer/useViewerBundle'
import { driveFileItem, driveViewerKey, parseViewerKey } from '@/components/viewer/viewerItems'
import { ViewerNotFound } from '@/components/viewer/ViewerNotFound'
import type { ViewerStar } from '@/components/viewer/ViewerStarButton'
import { useSetDriveStar, useStarredDriveItems } from '@/hooks/queries/useDriveStars'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { appUrl, driveFolderPath } from '@/lib/appUrl'
import { DRIVE_MISSING_ORIGINAL_MESSAGE } from '@/lib/driveRowActions'
import { sharedOpenedLabel } from '@/lib/driveSharedWithMe'
import { isStarredMissing, starredLocationPath, starredMetaLine, starredViewerFile } from '@/lib/driveStarred'
import { parseId } from '@/lib/historyParam'
import { HIT_AREA_COARSE } from '@/lib/hitArea'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { DriveFile, DriveStarredItem } from '@/types/drive'

/**
 * 표 열 — 이름(남는 폭) · 공간 · 별표한 날 · 별표 · ⋯. 좁은 폭(sm 미만)은 이름 칸(둘째 줄 경로·크기, 셋째 줄 공간·날짜)과
 * 별표·⋯ 만 두어 가로로 넘치지 않게 한다.
 */
// 좁은 폭의 칸 사이 24px — 별표·⋯ 의 터치 확장(HIT_AREA_COARSE, 사방 10px)이 서로·이름 칸을 덮지 않고 각자 44px 로 눌리게 한다(맞닿게 20px 로 두면 경계 좌표가 이웃 단추로 잡힌다).
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_2rem_2rem] sm:gap-3'

/** 행 단추(별표·⋯) 공통 모양 — 16px 아이콘만 있어 터치에서는 누름 영역만 넓힌다(HIT_AREA_COARSE). */
const ROW_ICON_BUTTON = cn('rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground', HIT_AREA_COARSE)

/** 행 키 — 파일과 폴더 id 는 서로 다른 표라 겹칠 수 있어 종류를 붙인다. */
function rowKey(item: DriveStarredItem): string {
  return `${item.kind === 'FOLDER' ? 'folder' : 'file'}-${item.id}`
}

/** 드라이브 「별표」 화면(/drive/starred). */
export function DriveStarredView() {
  const query = useStarredDriveItems()
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const setDriveStar = useSetDriveStar()
  const navigate = useNavigate()
  // 이 화면에서 별표를 뺀 파일 행(id → 행) — 목록에서는 빠졌지만 열린 보기 창이 다시 별표하거나 링크를 만들 때 쓴다.
  const [unstarredFiles, setUnstarredFiles] = useState<ReadonlyMap<number, DriveStarredItem>>(() => new Map())

  // 보기 창 = URL ?preview=<드라이브 파일 id>(시스템 뒤로가기로 닫힘) — 드라이브 공간 화면과 같은 값 모양.
  const previewParam = useHistoryParam('preview')
  const previewId = parseId(previewParam.value)
  // 목록의 파일 행(id → 행) — 보기 창 별표 단추가 렌더마다 목록을 훑지 않고 한 번에 찾는다.
  const listedFiles = useMemo(
    () => new Map(items.filter((it) => it.kind === 'FILE').map((it) => [it.id, it] as const)),
    [items],
  )
  const viewerFiles = useMemo(
    () => items.map(starredViewerFile).filter((f): f is DriveFile => f != null),
    [items],
  )
  const viewer = useViewerBundle({
    list: viewerFiles,
    toItem: driveFileItem,
    currentKey: previewId != null ? driveViewerKey(previewId) : null,
    ready: query.isSuccess || query.isError,
    openKey: (key) => {
      const parsed = parseViewerKey(key)
      if (parsed?.kind === 'drive') previewParam.open(String(parsed.id))
    },
  })

  /**
   * 별표 넣기·빼기 — 실패하면 훅이 캐시를 되돌리고 알린다. 빼기에 성공하면 토스트 「별표 뺌」에 「되돌리기」를 단다.
   * 호출마다 결과를 기다려 그 호출의 토스트를 낸다(여러 행을 연달아 빼도 각자 토스트가 나온다).
   */
  async function setStar(item: DriveStarredItem, starred: boolean) {
    if (!starred && item.kind === 'FILE') setUnstarredFiles((m) => new Map(m).set(item.id, item))
    const ok = await setDriveStar({ target: { kind: item.kind, id: item.id }, spaceId: item.spaceId, starred })
    if (!ok || starred) return
    // 토스트마다 이 항목을 들고 있다 — 다른 행을 더 빼도 각 토스트의 되돌리기는 자기 항목만 다시 넣는다.
    toast.success('별표 뺌', { action: { label: '되돌리기', onClick: () => void setStar(item, true) } })
  }

  /** 행 열기 — 폴더는 그 공간의 그 폴더로, 파일은 이 자리에서 보기 창. 원본 유실 파일은 공간 화면처럼 열지 않고 안내한다(#739). */
  function open(item: DriveStarredItem) {
    if (item.kind === 'FOLDER') {
      navigate(driveFolderPath(item.spaceId, item.id))
      return
    }
    if (isStarredMissing(item)) {
      toast.message(DRIVE_MISSING_ORIGINAL_MESSAGE)
      return
    }
    const f = starredViewerFile(item)
    if (f) viewer.open(f)
  }

  /** 행 ⋯ 메뉴 — 파일 위치 열기 · 다운로드(파일만, 원본 유실이면 막음 — 공간 화면 행 메뉴와 같은 규칙) · 링크 복사 · 별표 빼기. */
  function rowActions(item: DriveStarredItem): MobileSheetAction[] {
    const actions: MobileSheetAction[] = [
      { key: 'location', label: '파일 위치 열기', icon: <FolderOpen />, onSelect: () => navigate(starredLocationPath(item)) },
    ]
    if (item.kind === 'FILE') {
      actions.push({
        key: 'download',
        label: '다운로드',
        icon: <Download />,
        onSelect: () => void driveApi.downloadFile(item.id, item.name),
        disabled: isStarredMissing(item),
      })
    }
    // 링크 작업(링크 복사·채팅·이슈로 보내기)은 공간 화면 행 메뉴와 같은 공용 항목 — 파일은 보기 창까지, 폴더는 그 폴더를 여는 주소.
    actions.push(
      ...rowLinkActions({
        kind: item.kind === 'FILE' ? 'file' : 'folder',
        url: appUrl(item.kind === 'FILE' ? starredLocationPath(item) : driveFolderPath(item.spaceId, item.id)),
        title: item.name,
      }),
      { key: 'unstar', label: '별표 빼기', icon: <StarOff />, onSelect: () => void setStar(item, false) },
    )
    return actions
  }

  // 보기 창 별표 — 지금 목록에 있으면 별표한 상태. 빼면 목록에서 빠지지만 보기 창은 마지막으로 본 파일을 그대로 보이므로(useViewerBundle 스냅숏),
  // 다시 눌러 넣을 수 있게 그 행을 따로 기억한다(공간 id·위치가 필요하다).
  function knownFile(id: number): DriveStarredItem | null {
    return listedFiles.get(id) ?? unstarredFiles.get(id) ?? null
  }
  function viewerStar(vi: ViewerItem): ViewerStar | null {
    const parsed = parseViewerKey(vi.key)
    if (parsed?.kind !== 'drive') return null
    // 한 번 찾아 둘 다 정한다 — 목록에 있으면 별표한 상태, 없으면 이 화면에서 뺀 행(다시 넣기용).
    const listed = listedFiles.get(parsed.id)
    const item = listed ?? unstarredFiles.get(parsed.id)
    if (!item) return null
    const starred = listed != null
    return { starred, onToggle: () => void setStar(item, !starred) }
  }
  const viewerItemSource = viewer.current ? knownFile(viewer.current.id) : null

  let body
  // 실패 먼저 — 다시 시도하면 status 가 pending 으로 돌아가 안내·초점을 잃는다(WP-881·WP-1788, lib/queryFailure).
  if (failedWithoutData(query)) {
    body = <LoadErrorState title="별표한 항목을 불러오지 못했습니다" queries={[query]} testId="drive-starred-error" />
  } else if (query.isPending) {
    body = <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">불러오는 중…</div>
  } else if (items.length === 0) {
    body = (
      <div data-testid="drive-starred-empty">
        <ChatEmptyState
          icon={<Star className="h-10 w-10" />}
          title="별표한 항목 없음"
          description="파일이나 폴더의 메뉴에서 「별표」를 누르면 여기에 모입니다."
        />
      </div>
    )
  } else {
    body = (
      <div role="table" aria-label="별표한 항목" data-testid="drive-starred-list">
        {/* 머리 줄 — 넓은 폭에서만(좁은 폭은 이름 칸 아래로 접는다). */}
        <div role="row" className={cn(ROW_GRID, 'hidden border-b py-2 text-xs text-muted-foreground sm:grid', pageGutterClass)}>
          <span role="columnheader">이름</span>
          <span role="columnheader">공간</span>
          <span role="columnheader">별표한 날</span>
          <span role="columnheader" className="sr-only">
            별표
          </span>
          <span role="columnheader" className="sr-only">
            메뉴
          </span>
        </div>
        {items.map((item) => (
          <StarredRow
            key={rowKey(item)}
            item={item}
            actions={rowActions(item)}
            onOpen={() => open(item)}
            onUnstar={() => void setStar(item, false)}
          />
        ))}
        <LoadMoreFooter query={query} className={pageGutterClass} data-testid="drive-starred-more" />
      </div>
    )
  }

  return (
    <Page data-testid="drive-starred-view">
      <Page.Header title="별표" meta={<span className="hidden text-xs text-muted-foreground sm:inline">별표한 파일과 폴더</span>} />
      <Page.Body inset={false}>{body}</Page.Body>
      {viewer.bundle && (
        <AttachmentViewer
          items={viewer.bundle.items}
          index={viewer.bundle.index}
          onIndexChange={viewer.onIndexChange}
          onClose={previewParam.close}
          // 보기 창 링크는 그 파일의 폴더 기준(공간 화면 보기 창과 같은 주소).
          linkPath={viewerItemSource ? starredLocationPath(viewerItemSource) : undefined}
          star={viewerStar}
        />
      )}
      {viewer.missing && <ViewerNotFound onClose={previewParam.close} description="별표를 뺐거나 더 이상 볼 수 없는 파일입니다." />}
    </Page>
  )
}

/**
 * 목록 한 줄 — 이름(아이콘 + 이름, 둘째 줄 경로 · 크기 또는 폴더 n개 · 파일 n개) · 공간 · 별표한 날 · 별표 단추 · ⋯.
 * 좁은 폭은 공간·날짜 칸 대신 이름 칸 셋째 줄에 「공간 · 날짜」를 둔다.
 */
function StarredRow({
  item,
  actions,
  onOpen,
  onUnstar,
}: {
  item: DriveStarredItem
  actions: MobileSheetAction[]
  onOpen: () => void
  onUnstar: () => void
}) {
  const key = rowKey(item)
  const starredOn = sharedOpenedLabel(item.starredAt)
  const missing = isStarredMissing(item)
  return (
    <div role="row" data-testid={`drive-starred-row-${key}`} className={cn(ROW_GRID, 'border-b py-2 text-sm hover:bg-accent/40', pageGutterClass)}>
      <div role="cell" className="flex min-w-0 items-center gap-3">
        {item.kind === 'FOLDER' ? (
          <Folder aria-hidden className="h-8 w-8 shrink-0 p-1 text-muted-foreground" />
        ) : (
          <FileTypeIcon mimeType={item.mimeType ?? ''} className="h-8 w-8 shrink-0 p-1" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              data-testid={`drive-starred-open-${key}`}
              className={cn('block min-w-0 truncate text-left font-medium', missing ? 'text-muted-foreground' : 'hover:underline')}
            >
              {item.name}
            </button>
            {/* #739: 원본 유실 배지 — 공간 화면 행과 같은 중립 경고 모양, 이름 옆. */}
            {missing && (
              <StatusBadge type="warning" data-testid={`drive-starred-missing-${key}`} className="shrink-0">
                원본 유실
              </StatusBadge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground" data-testid={`drive-starred-meta-${key}`}>
            {starredMetaLine(item)}
          </p>
          {/* 좁은 폭 — 공간·날짜 칸이 없으니 셋째 줄로 접어 둔다. */}
          <p className="truncate text-xs text-muted-foreground sm:hidden">{[item.spaceName, starredOn].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <span role="cell" className="hidden truncate sm:block" data-testid={`drive-starred-space-${key}`}>
        {item.spaceName}
      </span>
      <span role="cell" className="hidden truncate text-muted-foreground sm:block">
        {starredOn}
      </span>
      <div role="cell" className="flex justify-end">
        <button
          type="button"
          aria-label={`${item.name} 별표 빼기`}
          aria-pressed
          data-testid={`drive-starred-star-${key}`}
          onClick={onUnstar}
          className={ROW_ICON_BUTTON}
        >
          <Star className="h-4 w-4 fill-current text-primary" />
        </button>
      </div>
      <div role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`${item.name} 메뉴`} data-testid={`drive-starred-menu-${key}`} className={ROW_ICON_BUTTON}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 max-w-[calc(100vw-2rem)]">
            <ActionMenuItems actions={actions} itemTestId={(k) => `drive-starred-action-${k}`} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
