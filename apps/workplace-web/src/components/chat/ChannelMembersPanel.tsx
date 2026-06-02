// 채널 멤버 패널 — 멤버 목록(역할 뱃지), MemberSearchPopover 재사용 추가, 제거,
// 역할 변경(OWNER만, role:OWNER 지정 시 소유권 이전), 나가기.
// 권한별 액션 노출: OWNER = 전체, ADMIN = 추가/제거, MEMBER = 보기+나가기.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useLeaveChannel } from '@/hooks/queries/useChannelMutations'
import {
  useAddMember,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/hooks/queries/useMemberMutations'
import { useAuth } from '@/hooks/useAuth'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { ChannelRole } from '@/types/messaging'

// 역할 옵션 목록 — select 에 노출할 순서.
const ROLES: ChannelRole[] = ['OWNER', 'ADMIN', 'MEMBER']

export function ChannelMembersPanel({
  channelId,
  myRole,
  open,
  onOpenChange,
}: {
  channelId: number
  myRole: ChannelRole | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  // 패널 열린 동안에만 멤버 조회.
  const { data: members } = useChannelMembers(channelId, open)
  const addMember = useAddMember(channelId)
  const removeMember = useRemoveMember(channelId)
  const updateRole = useUpdateMemberRole(channelId)
  const leave = useLeaveChannel()
  const [searchOpen, setSearchOpen] = useState(false)
  // 나가기 확인 다이얼로그 열림 상태 — AlertDialog 로 직접 제어.
  const [confirmLeave, setConfirmLeave] = useState(false)

  // 내가 OWNER 인지(역할 변경 가능), 내가 OWNER 또는 ADMIN 인지(추가/제거 가능).
  const isOwner = myRole === 'OWNER'
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN'
  // 기존 멤버 ID 집합 — MemberSearchPopover 에 전달해 중복 추가 방지.
  const existingIds = useMemo(
    () => new Set((members ?? []).map((m) => m.userId)),
    [members],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="channel-members-panel">
          <DialogHeader>
            <DialogTitle>멤버</DialogTitle>
          </DialogHeader>

          {/* OWNER/ADMIN 만 멤버 추가 가능 */}
          {canManage && (
            <MemberSearchPopover
              open={searchOpen}
              onOpenChange={setSearchOpen}
              existingMemberIds={existingIds}
              onSelect={(u) => addMember.mutate(u.id)}
              trigger={
                <Button size="sm" variant="outline" data-testid="member-add-trigger">
                  멤버 추가
                </Button>
              }
            />
          )}

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {members?.map((m) => {
              // 본인 여부 — 본인은 select/제거 버튼 미노출(자기 자신을 건드리지 않음).
              const isSelf = m.userId === user?.id
              return (
                <div
                  key={m.userId}
                  data-testid={`member-row-${m.userId}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <span className="flex-1 truncate">{m.name}</span>
                  {/* OWNER 는 타인 역할을 네이티브 select 로 변경 가능.
                      shadcn Select(Radix)는 Playwright selectOption 미동작 → 네이티브 select 사용. */}
                  {isOwner && !isSelf ? (
                    <select
                      data-testid={`member-role-select-${m.userId}`}
                      value={m.role}
                      onChange={(e) =>
                        updateRole.mutate({
                          userId: m.userId,
                          role: e.target.value as ChannelRole,
                        })
                      }
                      className="rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="secondary" data-testid={`member-role-${m.userId}`}>
                      {m.role}
                    </Badge>
                  )}
                  {/* OWNER/ADMIN 은 타인 제거 가능(본인 제외). OWNER 는 제거 불가(백엔드 403) → 버튼 숨김. */}
                  {canManage && !isSelf && m.role !== 'OWNER' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`member-remove-${m.userId}`}
                      onClick={() => removeMember.mutate(m.userId)}
                    >
                      제거
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* 모든 멤버가 나가기 가능 */}
          <Button
            size="sm"
            variant="destructive"
            data-testid="channel-leave-btn"
            onClick={() => setConfirmLeave(true)}
          >
            채널 나가기
          </Button>
        </DialogContent>
      </Dialog>

      {/* 나가기 확인 — DeleteConfirmDialog 는 trigger 기반으로 비호환. AlertDialog 직접 사용. */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>채널 나가기</AlertDialogTitle>
            <AlertDialogDescription>
              이 채널에서 나갑니다. 비공개 채널은 다시 초대받아야 참여할 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="channel-leave-confirm"
              onClick={async () => {
                await leave.mutateAsync(channelId)
                navigate('/chat')
              }}
            >
              나가기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
