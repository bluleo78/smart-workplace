// 채널 헤더 — 이름·멤버수·아카이브 뱃지. 설정 드롭다운(OWNER/ADMIN: 이름변경·아카이브/해제),
// 멤버 버튼, 시스템 ADMIN: 삭제. 권한 없는 액션은 렌더하지 않는다(1차 방어).
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Folder, Lock, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { messagingApi } from '@/api/messaging'
import { DriveSpaceDrawer } from '@/components/drive/DriveSpaceDrawer'
import { Page } from '@/components/layout/Page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useArchiveChannel,
  useDeleteChannel,
  useUnarchiveChannel,
} from '@/hooks/queries/useChannelMutations'
import { useAuth } from '@/hooks/useAuth'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { ChannelResponse } from '@/types/messaging'

export function ChannelHeader({
  channel,
  onOpenMembers,
  onOpenRename,
  className,
}: {
  channel: ChannelResponse
  onOpenMembers: () => void
  onOpenRename: () => void
  /** 헤더 바 추가 클래스 — 모바일 스레드 전체폭일 때 채널 헤더를 숨기는 용도(채널 컬럼과 함께 가려짐). */
  className?: string
}) {
  // 시스템 ADMIN 판정 — AdminRoute 와 동일하게 useAuth().isAdmin 사용.
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const archive = useArchiveChannel(channel.id)
  const unarchive = useUnarchiveChannel(channel.id)
  const del = useDeleteChannel()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 채널 OWNER/ADMIN 은 이름변경·아카이브 가능.
  const canManage = channel.role === 'OWNER' || channel.role === 'ADMIN'

  // #76 → 채널 파일 드로워 — 열림 = URL ?files=1(WP-207). 시스템 뒤로가기가 드로워(와 그 안 폴더)부터 닫는다.
  // 닫을 때(콜드 진입) 드로워 안 하위 키(폴더·미리보기·휴지통)도 함께 지운다.
  const filesParam = useHistoryParam('files', { clear: ['filesFolder', 'preview', 'view'] })
  const filesOpen = filesParam.value === '1'
  // 연동 공간 보장(POST, 멱등) — 드로워가 열려 있을 때만. 딥링크·새로고침으로 ?files=1 이 남아 있어도 다시 보장한다.
  const filesSpace = useQuery({
    queryKey: ['drive', 'channel-space', channel.id],
    queryFn: () => messagingApi.ensureChannelDriveSpace(channel.id).then((r) => r.data.spaceId),
    enabled: filesOpen,
    staleTime: Infinity,
  })
  const openFiles = () => filesParam.open('1')

  // 삭제 확인 다이얼로그·파일 드로워 — 데스크톱 헤더 안(기존 위치) 또는 모바일 병합 헤더 옆에 둔다.
  const overlays: ReactNode = (
    <>
      {/* 삭제 확인 다이얼로그 — 제어형 AlertDialog 사용(DeleteConfirmDialog 는 trigger 기반). */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>채널 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              채널과 모든 메시지가 영구 삭제됩니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            {/* 파괴적 작업임을 시각적으로 표시 */}
            <AlertDialogAction
              variant="destructive"
              data-testid="channel-delete-confirm"
              onClick={async () => {
                await del.mutateAsync(channel.id)
                navigate('/chat')
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 채널 파일 드로워 — 대화 컨텍스트를 유지한 채 연동 드라이브 공간 표시. */}
      <DriveSpaceDrawer
        open={filesOpen}
        spaceId={filesSpace.data ?? null}
        failed={filesSpace.isError}
        title={channel.name}
        onClose={filesParam.close}
      />
    </>
  )

  const isMobile = useIsMobile()
  if (isMobile) {
    // 모바일: 병합 상세 헤더(‹ + 채널명 + 멤버 수 + ⋯ + ✦) 한 줄(U1-1). 파일·관리 액션은 ⋯ 메뉴의 평평한 항목으로(U1-2) —
    // 드롭다운 안의 드롭다운을 피하려 설정 하위 항목을 메뉴에 그대로 펼친다(권한 규칙은 데스크톱과 동일).
    return (
      <>
        <Page.Header
          data-testid="channel-header"
          className={className}
          title={
            <span className="flex min-w-0 items-center gap-1">
              {channel.visibility === 'PRIVATE' && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="truncate" title={channel.name} data-testid="channel-header-name">{channel.name}</span>
              {channel.archived && (
                <Badge variant="secondary" data-testid="channel-archived-badge">보관됨</Badge>
              )}
            </span>
          }
          mobilePrimaryAction={
            <button
              type="button"
              data-testid="channel-members-btn"
              aria-label={`멤버 ${channel.memberCount}명`}
              onClick={onOpenMembers}
              className="flex h-11 shrink-0 items-center gap-1 px-2 text-sm text-muted-foreground"
            >
              <Users className="h-4 w-4" />
              <span data-testid="channel-header-membercount">{channel.memberCount}</span>
            </button>
          }
          mobileActions={
            <>
              <button type="button" data-testid="channel-files-button" onClick={openFiles}>
                <Folder className="h-4 w-4" /> 파일
              </button>
              {canManage && (
                <>
                  <button type="button" data-testid="channel-rename-action" onClick={onOpenRename}>이름 변경</button>
                  {channel.archived ? (
                    <button type="button" data-testid="channel-unarchive-action" onClick={() => unarchive.mutate()}>보관 해제</button>
                  ) : (
                    <button type="button" data-testid="channel-archive-action" onClick={() => archive.mutate()}>보관</button>
                  )}
                </>
              )}
              {isAdmin && (
                <button type="button" data-testid="channel-delete-action" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                  채널 삭제
                </button>
              )}
            </>
          }
        />
        {overlays}
      </>
    )
  }

  // 데스크톱: 페이지 표준 헤더(Page.Header) — 채널 화면 전체 폭(스레드 칸 위까지)을 덮는 h-14 바.
  // 제목 슬롯 안 span 이 말줄임 대상(block truncate) — 긴 채널명 #797 회귀 테스트가 이 요소의 넘침을 본다.
  return (
    <>
      <Page.Header
        data-testid="channel-header"
        className={className}
        leading={channel.visibility === 'PRIVATE' ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" /> : undefined}
        title={
          <span className="block truncate" title={channel.name} data-testid="channel-header-name">
            {channel.name}
          </span>
        }
        meta={
          <>
            {channel.archived && (
              <Badge variant="secondary" data-testid="channel-archived-badge">
                보관됨
              </Badge>
            )}
            <button
              type="button"
              className="ml-2 flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              data-testid="channel-members-btn"
              onClick={onOpenMembers}
            >
              <Users className="h-4 w-4" />
              <span data-testid="channel-header-membercount">{channel.memberCount}</span>
            </button>
          </>
        }
        actions={
          <>
            {/* 우측 고정 그룹 — 채널명 길이와 무관하게 항상 같은 위치. 파일 버튼은 모든 멤버 노출,
                설정 드롭다운은 관리자만(#76 파일 위치는 이슈 헤더 액션과 동일하게 우측 고정으로 통일). */}
            <button
              type="button"
              data-testid="channel-files-button"
              onClick={openFiles}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              <Folder className="h-4 w-4" />
              <span>파일</span>
            </button>

            {/* 채널 관리자 또는 시스템 ADMIN 에게만 설정 드롭다운 노출. */}
            {(canManage || isAdmin) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" data-testid="channel-settings-btn">
                    설정 <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canManage && (
                    <>
                      <DropdownMenuItem
                        data-testid="channel-rename-action"
                        onClick={onOpenRename}
                      >
                        이름 변경
                      </DropdownMenuItem>
                      {channel.archived ? (
                        <DropdownMenuItem
                          data-testid="channel-unarchive-action"
                          onClick={() => unarchive.mutate()}
                        >
                          보관 해제
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          data-testid="channel-archive-action"
                          onClick={() => archive.mutate()}
                        >
                          보관
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {/* 시스템 ADMIN 만 채널 하드 삭제 가능. */}
                  {isAdmin && (
                    <>
                      {canManage && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        data-testid="channel-delete-action"
                        className="text-destructive"
                        onClick={() => setConfirmDelete(true)}
                      >
                        채널 삭제
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {overlays}
    </>
  )
}
