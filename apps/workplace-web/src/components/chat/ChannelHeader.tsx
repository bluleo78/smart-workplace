// 채널 헤더 — 이름·멤버수·아카이브 뱃지. 설정 드롭다운(OWNER/ADMIN: 이름변경·아카이브/해제),
// 멤버 버튼, 시스템 ADMIN: 삭제. 권한 없는 액션은 렌더하지 않는다(1차 방어).
import { ChevronDown, Lock, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
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
import type { ChannelResponse } from '@/types/messaging'

export function ChannelHeader({
  channel,
  onOpenMembers,
  onOpenRename,
}: {
  channel: ChannelResponse
  onOpenMembers: () => void
  onOpenRename: () => void
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

  return (
    <div
      className="flex h-14 shrink-0 items-center gap-2 border-b px-4"
      data-testid="channel-header"
    >
      {channel.visibility === 'PRIVATE' && <Lock className="h-4 w-4 text-muted-foreground" />}
      <span className={appTitleTextClass} data-testid="channel-header-name">
        {channel.name}
      </span>
      {channel.archived && (
        <Badge variant="secondary" data-testid="channel-archived-badge">
          보관됨
        </Badge>
      )}
      <button
        type="button"
        className="ml-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="channel-members-btn"
        onClick={onOpenMembers}
      >
        <Users className="h-4 w-4" />
        <span data-testid="channel-header-membercount">{channel.memberCount}</span>
      </button>

      {/* 채널 관리자 또는 시스템 ADMIN 에게만 설정 드롭다운 노출. */}
      {(canManage || isAdmin) && (
        <div className="ml-auto">
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
        </div>
      )}

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
    </div>
  )
}
