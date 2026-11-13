// WP-1539: 드라이브 「공유받은 항목」 — 내가 로그인한 채 처음 연 사내 공유 링크의 파일을 다시 찾는 목록(최근에 연 순).
// 목록 행은 권한을 주지 않는다 — 열기는 늘 링크 토큰으로 공개 공유 경로를 거쳐 링크 규칙(폐기·만료·비밀번호)을 서버가 다시 판정한다.
// 폴더 링크(WP-1538)는 아직 없어 파일만 보인다.

import { useQueryClient } from '@tanstack/react-query'
import { Link2, MinusCircle, MoreHorizontal, SquareArrowOutUpRight, UserRoundPlus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { shareLandingUrl } from '@/api/drive'
import { fetchShareInfo, isShareFolderInfo } from '@/api/drivePublicShare'
import { ActionMenuItems } from '@/components/ActionMenuItems'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { shareErrorStatus, shareViewerItem, shareViewerSource } from '@/components/drive/shareViewer'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import type { ViewerItem } from '@/components/viewer/types'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { useHideSharedWithMe, useSharedWithMe } from '@/hooks/queries/useSharedWithMe'
import { copyToClipboard } from '@/lib/copyToClipboard'
import { canOpenShared, sharedClosedReason, sharedOpenedLabel } from '@/lib/driveSharedWithMe'
import { formatFileSize } from '@/lib/formatters'
import { HIT_AREA_COARSE } from '@/lib/hitArea'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { SharedWithMeItem } from '@/types/drive'

/** 열기 실패(410·404) 안내 — 시안 문구. */
const CLOSED_LINK_MESSAGE = '링크가 폐기됐거나 만료됐습니다'

/**
 * 표 열 — 이름(남는 폭) · 공유한 사람 · 마지막으로 연 날 · ⋯. 좁은 폭(sm 미만)은 이름 칸 하나와 ⋯ 만 두고
 * 공유한 사람·날짜를 둘째 줄로 접어 가로로 넘치지 않게 한다.
 */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_2rem]'

/** 드라이브 「공유받은 항목」 화면(/drive/shared). */
export function DriveSharedWithMeView() {
  const query = useSharedWithMe()
  const items = query.data ?? []
  const hide = useHideSharedWithMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // 열린 미리보기 — 공개 공유 경로로 받는 뷰어 항목 하나(목록 화면 위에 겹쳐 연다).
  const [viewerItem, setViewerItem] = useState<ViewerItem | null>(null)

  // 미리보기 중 링크가 막히면(401 — 로그인 풀림·열람 시간 지남) 뷰어를 닫고 공유 화면에서 다시 열게 한다.
  const closeViewerOnUnauthorized = useCallback(() => {
    setViewerItem(null)
    toast.error('다시 열어 주세요 — 공유 화면에서 확인이 필요합니다.')
  }, [])

  /**
   * 열기 — 비밀번호 링크는 묻지 않고 바로 공유 화면(/s/:token)으로 넘긴다(열람 토큰은 그 화면 메모리에만 두는 규칙이라
   * 여기서 정보를 물어도 결국 넘겨야 한다). 그 밖은 공유 정보 조회 한 번이 링크 규칙을 거치고(마지막으로 연 날도 갱신)
   * 뷰어에 쓸 파일 정보를 준다 — 바로 열 수 있으면 이 화면 위에 미리보기를 띄우고, 그새 확인이 필요해졌으면 공유 화면으로 넘긴다.
   * 폐기·만료(410)·없음(404)은 안내 후 목록을 다시 받는다.
   */
  async function open(item: SharedWithMeItem) {
    const token = item.token
    if (!canOpenShared(item) || token == null) return
    if (item.hasPassword) {
      navigate(`/s/${token}`)
      return
    }
    try {
      const info = await fetchShareInfo(token, null)
      // 폴더 링크(WP-1538) 응답은 이 자리 뷰어로 열 수 없어 공유 화면으로 넘긴다 — 지금 목록엔 파일 링크만 오지만(폴더는 WP-1540) 응답 모양을 가린다.
      if ('name' in info && !isShareFolderInfo(info)) {
        setViewerItem(shareViewerItem(token, info, shareViewerSource(null, closeViewerOnUnauthorized)))
      } else {
        navigate(`/s/${token}`)
      }
    } catch (e) {
      const status = shareErrorStatus(e)
      toast.error(status === 410 || status === 404 ? CLOSED_LINK_MESSAGE : '열지 못했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      void queryClient.invalidateQueries({ queryKey: driveKeys.sharedWithMe() })
    }
  }

  /** 목록에서 빼기 — 내 목록에서만 숨긴다(링크 권한은 그대로, 다시 열면 돌아온다). */
  function remove(item: SharedWithMeItem) {
    hide.mutate(item.shareLinkId, {
      onSuccess: () => toast.success('목록에서 뺐습니다'),
      onError: () => toast.error('목록에서 빼지 못했습니다. 잠시 후 다시 시도하세요.'),
    })
  }

  /** 행 ⋯ 메뉴 — 열기 · 공유 링크 복사 · 목록에서 빼기. 열 수 없는 행은 앞의 둘을 흐리게 두고 빼기만 된다. */
  function rowActions(item: SharedWithMeItem): MobileSheetAction[] {
    const openable = canOpenShared(item)
    return [
      { key: 'open', label: '열기', icon: <SquareArrowOutUpRight />, disabled: !openable, onSelect: () => void open(item) },
      {
        key: 'copy',
        label: '공유 링크 복사',
        icon: <Link2 />,
        disabled: !openable,
        onSelect: () => {
          if (item.token) void copyToClipboard(shareLandingUrl(item.token), { success: '공유 링크를 복사했습니다' })
        },
      },
      { key: 'remove', label: '목록에서 빼기', icon: <MinusCircle />, onSelect: () => remove(item) },
    ]
  }

  let body
  if (query.isPending) {
    body = <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">불러오는 중…</div>
  } else if (failedWithoutData(query)) {
    body = <LoadErrorState title="공유받은 항목을 불러오지 못했습니다" queries={[query]} testId="drive-shared-error" />
  } else if (items.length === 0) {
    body = (
      <div data-testid="drive-shared-empty">
        <ChatEmptyState
          icon={<UserRoundPlus className="h-10 w-10" />}
          title="공유받은 항목이 없습니다"
          description="사내 공유 링크를 열면 여기에 모입니다."
        />
      </div>
    )
  } else {
    body = (
      <div role="table" aria-label="공유받은 항목" data-testid="drive-shared-list">
        {/* 머리 줄 — 넓은 폭에서만(좁은 폭은 둘째 줄로 접는다). */}
        <div role="row" className={cn(ROW_GRID, 'hidden border-b py-2 text-xs text-muted-foreground sm:grid', pageGutterClass)}>
          <span role="columnheader">이름</span>
          <span role="columnheader">공유한 사람</span>
          <span role="columnheader">마지막으로 연 날</span>
          <span role="columnheader" className="sr-only">
            메뉴
          </span>
        </div>
        {items.map((item) => (
          <SharedRow key={item.shareLinkId} item={item} actions={rowActions(item)} onOpen={() => void open(item)} />
        ))}
      </div>
    )
  }

  return (
    <Page data-testid="drive-shared-view">
      <Page.Header title="공유받은 항목" meta={<span className="hidden text-xs text-muted-foreground sm:inline">사내 공유 링크로 연 파일</span>} />
      <Page.Body inset={false}>{body}</Page.Body>
      {viewerItem && (
        <AttachmentViewer items={[viewerItem]} index={0} onIndexChange={() => {}} onClose={() => setViewerItem(null)} shareable={false} />
      )}
    </Page>
  )
}

/** 목록 한 줄 — 이름(아이콘 + 이름, 둘째 줄 공간 · 크기) · 공유한 사람 · 마지막으로 연 날 · ⋯. 열 수 없으면 흐리게 + 「열 수 없음」. */
function SharedRow({ item, actions, onOpen }: { item: SharedWithMeItem; actions: MobileSheetAction[]; onOpen: () => void }) {
  const openable = canOpenShared(item)
  const closedReason = sharedClosedReason(item)
  const opened = sharedOpenedLabel(item.lastOpenedAt)
  return (
    <div
      role="row"
      data-testid={`drive-shared-row-${item.shareLinkId}`}
      data-openable={openable}
      className={cn(ROW_GRID, 'border-b py-2 text-sm hover:bg-accent/40', pageGutterClass)}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <FileTypeIcon mimeType={item.mimeType} className={cn('h-8 w-8 shrink-0 p-1', !openable && 'opacity-50')} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {openable ? (
              <button type="button" onClick={onOpen} className="min-w-0 truncate text-left font-medium hover:underline">
                {item.name}
              </button>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">{item.name}</span>
            )}
            {!openable && (
              <span
                data-testid={`drive-shared-closed-${item.shareLinkId}`}
                className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                열 수 없음
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground" data-testid={`drive-shared-meta-${item.shareLinkId}`}>
            {closedReason ?? `${item.spaceName} · ${formatFileSize(item.sizeBytes)}`}
          </p>
          {/* 좁은 폭 — 공유한 사람·날짜 칸이 없으니 둘째 줄 아래에 접어 둔다. */}
          <p className="truncate text-xs text-muted-foreground sm:hidden">
            {[item.sharedBy, opened].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <span role="cell" className={cn('hidden truncate sm:block', !openable && 'text-muted-foreground')}>
        {item.sharedBy ?? '알 수 없음'}
      </span>
      <span role="cell" className="hidden truncate text-muted-foreground sm:block">
        {opened}
      </span>
      <div role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${item.name} 메뉴`}
              data-testid={`drive-shared-menu-${item.shareLinkId}`}
              className={cn('rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground', HIT_AREA_COARSE)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 max-w-[calc(100vw-2rem)]">
            <ActionMenuItems actions={actions} itemTestId={(key) => `drive-shared-action-${key}`} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
