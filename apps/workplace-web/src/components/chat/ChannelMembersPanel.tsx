// 채널 멤버 패널 — 멤버 목록(역할 뱃지), MemberSearchPopover 재사용 추가, 제거,
// 역할 변경(OWNER만, role:OWNER 지정 시 소유권 이전 — 확인 창을 거친다, WP-1131), 나가기.
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
import { assignableChannelRoles, channelRoleLabel } from '@/lib/channelRoles'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { ChannelRole } from '@/types/messaging'

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
  // 제거 확인 다이얼로그 — { userId, name } 를 열면 해당 멤버 제거 확인 요청.
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string } | null>(null)
  // 소유권 이전 확인 — 역할 select 에서 OWNER 를 고르면 바로 바꾸지 않고 이 확인을 연다(WP-1131).
  // 넘기면 나는 관리자로 내려가 역할 목록을 잃어 스스로 되돌릴 수 없으므로 제거·나가기처럼 확인을 거친다.
  // select 는 서버 값(m.role)에 묶여 있어, 취소하면 원래 역할로 보인다.
  const [confirmTransfer, setConfirmTransfer] = useState<{ userId: number; name: string } | null>(null)
  // 내가 OWNER 인지(역할 변경 가능), 내가 OWNER 또는 ADMIN 인지(추가/제거 가능).
  const isOwner = myRole === 'OWNER'
  // 확인 창을 연 사이 그 사람이 나가거나 제거되면(목록 재조회), 또는 내가 소유자가 아니게 되면(다른 탭에서 넘김 등) 확인 상태를 비운다
  // — 창만 숨기면 그 사람이 다시 들어왔을 때 창이 저절로 다시 떠 한 번의 클릭으로 뜻하지 않은 사람에게 넘어간다. 렌더 중 상태 조정 패턴.
  if (confirmTransfer && (!isOwner || (members && !members.some((m) => m.userId === confirmTransfer.userId)))) {
    setConfirmTransfer(null)
  }
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
                  {/* 정지된 구성원 표시 — 로그인할 수 없는 사람을 다른 멤버와 구분한다(WP-723). */}
                  {m.active === false && (
                    <Badge variant="outline" className="shrink-0" data-testid={`member-inactive-${m.userId}`}>
                      비활성
                    </Badge>
                  )}
                  {/* OWNER 는 타인 역할을 네이티브 select 로 변경 가능.
                      shadcn Select(Radix)는 Playwright selectOption 미동작 → 네이티브 select 사용. */}
                  {isOwner && !isSelf ? (
                    <select
                      data-testid={`member-role-select-${m.userId}`}
                      value={m.role}
                      // 역할 변경이 도는 동안 잠근다 — 소유권을 넘긴 직후 목록이 다시 오기 전에 또 넘기기를 시작하지 않게(WP-1131).
                      disabled={updateRole.isPending}
                      onChange={(e) => {
                        const role = e.target.value as ChannelRole
                        // 소유권 이전은 확인 뒤에. 관리자·멤버 사이는 되돌릴 수 있어 바로 바꾼다.
                        if (role === 'OWNER') setConfirmTransfer({ userId: m.userId, name: m.name })
                        else updateRole.mutate({ userId: m.userId, role })
                      }}
                      className="rounded border bg-background px-1 py-0.5 text-xs"
                      aria-label={`${m.name} 역할 변경`}
                    >
                      {/* AGENT(AI 봇)·정지된 사람은 채널 OWNER 가 될 수 없음(#598·WP-1131) — 옵션 자체를 제거해 시도를 UX 상에서 차단. */}
                      {assignableChannelRoles(m).map((r) => (
                        <option key={r} value={r}>
                          {channelRoleLabel(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="secondary" data-testid={`member-role-${m.userId}`}>
                      {channelRoleLabel(m.role)}
                    </Badge>
                  )}
                  {/* OWNER/ADMIN 은 타인 제거 가능(본인 제외). OWNER 는 제거 불가(백엔드 403) → 버튼 숨김. */}
                  {canManage && !isSelf && m.role !== 'OWNER' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`member-remove-${m.userId}`}
                      onClick={() => setConfirmRemove({ userId: m.userId, name: m.name })}
                      aria-label={`${m.name} 제거`}
                    >
                      제거
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* 멤버 목록과 위험 액션(나가기) 사이 구분선 — 실수 클릭 방지 (#780) */}
          <div className="mt-2 border-t pt-4">
            {/* 모든 멤버가 나가기 가능 */}
            <Button
              size="sm"
              variant="destructive"
              data-testid="channel-leave-btn"
              onClick={() => setConfirmLeave(true)}
            >
              채널 나가기
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 멤버 제거 확인 — 실수 클릭 방지. 나가기 패턴과 동일하게 AlertDialog 직접 사용. */}
      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>멤버 제거</AlertDialogTitle>
            <AlertDialogDescription>
              채널에서 {confirmRemove?.name}을(를) 제거하시겠습니까? 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="member-remove-confirm"
              onClick={() => {
                if (confirmRemove) removeMember.mutate(confirmRemove.userId)
                setConfirmRemove(null)
              }}
            >
              제거
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 소유권 이전 확인 — 넘기면 되돌리려면 새 소유자에게 부탁해야 하므로 제거·나가기와 같은 확인 창을 거친다(WP-1131). */}
      <AlertDialog
        open={confirmTransfer !== null}
        onOpenChange={(open) => !open && setConfirmTransfer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>소유권 넘기기</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTransfer?.name}에게 채널 소유권을 넘기면 나는 관리자가 됩니다. 되돌리려면 새 소유자에게 부탁해야 해요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="member-transfer-confirm"
              onClick={() => {
                if (confirmTransfer) updateRole.mutate({ userId: confirmTransfer.userId, role: 'OWNER' })
                setConfirmTransfer(null)
              }}
            >
              넘기기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            {/* 되돌릴 수 없는 파괴적 작업임을 시각적으로 표시 */}
            <AlertDialogAction
              variant="destructive"
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
