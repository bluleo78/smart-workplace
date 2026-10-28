// 채널 멤버 패널 — 멤버 목록(역할 뱃지), 사람·조직 선택 창(PeopleAndDepartmentPicker)으로 추가, 제거,
// 역할 변경(OWNER만, role:OWNER 지정 시 소유권 이전 — 확인 창을 거친다, WP-1131), 나가기.
// 권한별 액션 노출: OWNER = 전체, ADMIN = 추가/제거, MEMBER = 보기+나가기.
// WP-1058 — 비공개 채널은 조직도 부서 자체도 멤버로 둔다(부서와 하위 부서의 활성 사람이 채널 멤버가 되고, 나중에 들어온 사람도 따라온다):
//   부서 행(「개발팀 · 12명 [조직]」, ▸ 로 이 채널에 그 부서로 들어온 사람 펼치기, 관리자는 제거)을 사람 목록 위에 둔다.
//   공개 채널은 누구나 들어올 수 있어 부서를 두지 않는다 — 사람과 내 그룹만 고른다. 내 그룹은 어느 쪽이든 그룹 자체를 서버에 보내지 않고
//   고르는 시점의 구성원을 한 명씩 초대한다(드라이브 팀 공간 WP-1056 과 같은 규칙 — 이미 직접 멤버인 사람은 빼고 「…에서 N명 추가」로 알린다).
//   부서로만 들어온 사람은 선택 창에서 고를 수 있다 — 초대하면 서버가 직접 멤버로 고정해 부서가 빠져도 채널에 남는다.
// 사람 목록은 멤버 목록 API(실효 멤버 — 직접 초대 + 부서로 들어온 사람, 중복 제외) 그대로다: 부서로만 들어온 사람도 한 줄로 보여
//   멤버 수와 줄 수가 같고, 그 사람의 역할 변경·내보내기도 같은 줄에서 한다. 부서 펼침은 「이 부서로 누가 들어왔나」를 역할과 함께 보는 읽기 전용 목록이다.
import { Building2, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import type { GroupOption } from '@/components/members/groupOptions'
import { PeopleAndDepartmentPicker } from '@/components/members/PeopleAndDepartmentPicker'
import { addPersonalGroupWithNotice } from '@/components/members/personalGroups'
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
import { useChannelMemberGroups, useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useLeaveChannel } from '@/hooks/queries/useChannelMutations'
import {
  useAddChannelMembersFromGroup,
  useAddMember,
  useAddMemberGroup,
  useRemoveMember,
  useRemoveMemberGroup,
  useUpdateMemberRole,
} from '@/hooks/queries/useMemberMutations'
import { useAuth } from '@/hooks/useAuth'
import { assignableChannelRoles, channelRoleLabel } from '@/lib/channelRoles'
import { cn, directionParticle, objectParticle } from '@/lib/utils'
import type { ChannelMemberResponse, ChannelRole, ChannelVisibility } from '@/types/messaging'

/** 부서 이름 여럿을 한 문구로 — 「개발팀, 디자인팀」. 이름을 모르면(부서 목록을 받는 중·실패) 「조직도 부서」. */
function joinGroupNames(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '조직도 부서'
}

/**
 * 내보내기 확인 문구의 부서 안내(WP-1058) — 「개발팀으로도 참여 중 — 내보내면 부서 대상에서도 제외됩니다」. 조사는 마지막 이름의 받침을 따른다.
 * 부서 이름을 모르면 「조직도 부서로도 참여 중 — …」.
 */
function viaGroupKickNote(names: string[]): string {
  const joined = joinGroupNames(names)
  return `${joined}${directionParticle(joined)}도 참여 중 — 내보내면 부서 대상에서도 제외됩니다`
}

/**
 * 사람 줄의 부서 안내(WP-1058) — 직접 초대 + 부서면 「개발팀에도 속함」, 부서로만이면 「개발팀으로 참여」.
 * 부서 이름을 모르면(부서와 무관하거나, 부서 목록을 받는 중·실패) null — 「부서에도 속함」 같은 막연한 문구 대신 숨긴다.
 */
function viaLabel(direct: boolean, names: string[]): string | null {
  if (names.length === 0) return null
  const joined = joinGroupNames(names)
  return direct ? `${joined}에도 속함` : `${joined}${directionParticle(joined)} 참여`
}

export function ChannelMembersPanel({
  channelId,
  myRole,
  visibility,
  open,
  onOpenChange,
}: {
  channelId: number
  myRole: ChannelRole | null
  /** 채널 공개 범위 — 비공개(PRIVATE)만 조직도 부서를 멤버로 둔다(WP-1058). */
  visibility: ChannelVisibility
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isPrivate = visibility === 'PRIVATE'
  // 패널 열린 동안에만 멤버 조회. 멤버 부서는 비공개 채널만 받는다(공개 채널은 서버가 400).
  const { data: members } = useChannelMembers(channelId, open)
  const groups = useChannelMemberGroups(channelId, open && isPrivate)
  const addMember = useAddMember(channelId)
  const removeMember = useRemoveMember(channelId)
  const updateRole = useUpdateMemberRole(channelId)
  const addGroup = useAddMemberGroup(channelId)
  const removeGroup = useRemoveMemberGroup(channelId)
  const addFromPersonalGroup = useAddChannelMembersFromGroup(channelId)
  const leave = useLeaveChannel()
  const [searchOpen, setSearchOpen] = useState(false)
  // 나가기 확인 다이얼로그 열림 상태 — AlertDialog 로 직접 제어.
  const [confirmLeave, setConfirmLeave] = useState(false)
  // 제거 확인 다이얼로그 — { userId, name, viaNote } 를 열면 해당 멤버 제거 확인 요청. viaNote 는 부서로도 들어온 사람에게만 붙는 안내.
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string; viaNote: string | null } | null>(null)
  // 부서 제거 확인 — 사람 제거 확인과 문구가 달라(부서로만 들어온 사람이 함께 빠진다) 따로 둔다.
  const [confirmRemoveGroup, setConfirmRemoveGroup] = useState<{ groupId: number; name: string } | null>(null)
  // 구성원을 펼친 부서 id.
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set())

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
  // 기존 직접 멤버 ID 집합 — 선택 창에서 중복 추가 방지. 부서로만 들어온 사람(direct=false)은 넣지 않는다 — 초대하면 서버가 직접 멤버로
  // 고정해(역할·읽음 위치 유지) 부서가 빠져도 채널에 남게 할 수 있어야 한다. 그런 사람은 선택 창 사람 줄에 안내를 붙인다(personNote).
  const existingIds = useMemo(
    () => new Set((members ?? []).filter((m) => m.direct).map((m) => m.userId)),
    [members],
  )
  const memberGroups = useMemo(() => (isPrivate ? (groups.data ?? []) : []), [isPrivate, groups.data])
  const existingGroupIds = useMemo(() => new Set(memberGroups.map((g) => g.groupId)), [memberGroups])
  const groupNameById = useMemo(() => new Map(memberGroups.map((g) => [g.groupId, g.name])), [memberGroups])
  /** 그 사람을 덮는 이 채널 멤버 부서의 이름 — 목록에 없는 id(받는 중·방금 빠짐)는 뺀다. */
  const viaNamesOf = (m: ChannelMemberResponse) =>
    m.viaGroupIds.flatMap((id) => {
      const name = groupNameById.get(id)
      return name ? [name] : []
    })
  // 부서로만 들어온 사람 id → 그 사람 — 선택 창 사람 줄 안내(「개발팀으로 참여 중 — 초대하면 직접 멤버로 남습니다」)에 쓴다.
  const deptOnlyById = useMemo(
    () => new Map((members ?? []).filter((m) => !m.direct).map((m) => [m.userId, m])),
    [members],
  )
  // 부서 id → 그 부서로 들어온 이 채널 멤버(viaGroupIds 에 그 부서가 있는 사람) — 부서 펼침이 렌더마다 목록을 다시 거르지 않게 한 번에 모은다.
  const coveredByGroup = useMemo(() => {
    const byGroup = new Map<number, ChannelMemberResponse[]>()
    for (const m of members ?? []) {
      for (const id of m.viaGroupIds) byGroup.set(id, [...(byGroup.get(id) ?? []), m])
    }
    return byGroup
  }, [members])
  const personNote = (userId: number) => {
    const m = deptOnlyById.get(userId)
    if (!m) return null
    const joined = joinGroupNames(viaNamesOf(m))
    return `${joined}${directionParticle(joined)} 참여 중 — 초대하면 직접 멤버로 남습니다`
  }
  const toggleGroup = (groupId: number) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })

  // 조직도 부서를 고르면 부서 자체를 멤버로 더한다(비공개 채널만 — 공개 채널은 선택 창에 조직 섹션이 없다).
  const onPickDepartment = async (group: GroupOption) => {
    try {
      await addGroup.mutateAsync(group.id)
      toast.success(`조직 ${group.name}${objectParticle(group.name)} 멤버로 추가했습니다`)
    } catch {
      // 실패 안내는 mutation onError 가 한다.
    }
  }


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="channel-members-panel">
          <DialogHeader>
            <DialogTitle>멤버</DialogTitle>
          </DialogHeader>

          {/* OWNER/ADMIN 만 멤버 추가 가능 — 사람·내 그룹, 비공개 채널은 조직도 부서도(WP-1058). */}
          {canManage && (
            <PeopleAndDepartmentPicker
              open={searchOpen}
              onOpenChange={setSearchOpen}
              existingUserIds={existingIds}
              existingGroupIds={existingGroupIds}
              onSelectPerson={(userId) => addMember.mutate(userId)}
              // 조직 섹션은 비공개 채널만 — 고를 곳을 주지 않으면 선택 창이 조직 섹션을 숨긴다.
              onSelectDepartment={isPrivate ? (g) => void onPickDepartment(g) : undefined}
              // 내 그룹을 고르면 지금 사람 구성원(하위 그룹 포함)을 한 명씩 초대한다 — 구성원 받기와 지금 멤버 읽기를 함께 기다린다. 그룹은 서버에 남지 않는다.
              onSelectPersonalGroup={(g) => void addPersonalGroupWithNotice(g, addFromPersonalGroup)}
              personNote={personNote}
              testIdPrefix="channel-member-picker"
              trigger={
                <Button size="sm" variant="outline" data-testid="member-add-trigger">
                  멤버 추가
                </Button>
              }
            />
          )}

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {/* 부서 행(WP-1058) — 사람 목록 위. 펼치면 이 채널에 그 부서로 들어온 사람(viaGroupIds 에 그 부서가 있는 멤버)을 역할과 함께 보인다. */}
            {memberGroups.map((g) => {
              const expanded = expandedGroups.has(g.groupId)
              const covered = coveredByGroup.get(g.groupId) ?? []
              return (
                <div key={`g${g.groupId}`}>
                  <div
                    data-testid={`member-group-row-${g.groupId}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <button
                      type="button"
                      aria-label={`${g.name} 구성원 ${expanded ? '접기' : '펼치기'}`}
                      aria-expanded={expanded}
                      onClick={() => toggleGroup(g.groupId)}
                      className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      data-testid={`member-group-toggle-${g.groupId}`}
                    >
                      <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Building2 className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-muted-foreground">· {g.memberCount}명</span>
                      <span className="shrink-0 rounded border px-1 text-[11px] leading-4 text-muted-foreground">조직</span>
                    </span>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={`member-group-remove-${g.groupId}`}
                        onClick={() => setConfirmRemoveGroup({ groupId: g.groupId, name: g.name })}
                        aria-label={`조직 ${g.name} 제거`}
                      >
                        제거
                      </Button>
                    )}
                  </div>
                  {expanded && (
                    <ul className="mb-1 ml-14 space-y-0.5 text-xs" data-testid={`member-group-members-${g.groupId}`}>
                      {covered.length === 0 ? (
                        <li className="text-muted-foreground">이 채널에 들어온 구성원이 없습니다</li>
                      ) : (
                        covered.map((m) => (
                          <li
                            key={m.userId}
                            className="flex min-w-0 items-center gap-1.5"
                            data-testid={`member-group-member-${g.groupId}-${m.userId}`}
                          >
                            <span className="truncate">{m.name}</span>
                            {/* 역할 뱃지는 펼침에서도 보인다 — 부서로 들어온 사람 중 누가 관리자인지 한눈에. 바꾸기·내보내기는 사람 목록 줄에서. */}
                            <Badge variant="secondary" className="shrink-0" data-testid={`member-group-member-role-${g.groupId}-${m.userId}`}>
                              {channelRoleLabel(m.role)}
                            </Badge>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
            {/* 부서 목록을 못 받으면 부서 행이 빠진 채라 알린다 — 부서로만 들어온 사람이 왜 있는지 모르게 되지 않게. */}
            {isPrivate && groups.isError && (
              <p className="px-2 py-1.5 text-sm text-destructive" data-testid="member-groups-error">
                조직 멤버를 불러오지 못했습니다
              </p>
            )}
            {members?.map((m) => {
              // 본인 여부 — 본인은 select/제거 버튼 미노출(자기 자신을 건드리지 않음).
              const isSelf = m.userId === user?.id
              // 직접 초대 여부 — 부서로만 들어온 사람은 「개발팀으로 참여」, 직접 + 부서면 「개발팀에도 속함」(부서 이름을 알 때만).
              const direct = m.direct
              const viaNames = viaNamesOf(m)
              const via = viaLabel(direct, viaNames)
              const canChangeRole = isOwner && !isSelf
              const roleHintId = `member-role-hint-${m.userId}`
              return (
                <div
                  key={m.userId}
                  data-testid={`member-row-${m.userId}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{m.name}</span>
                    {via && (
                      <span className="truncate text-xs text-muted-foreground" data-testid={`member-via-${m.userId}`}>
                        {via}
                      </span>
                    )}
                    {/* 부서로만 들어온 사람의 역할 안내 — 직접 초대하거나 관리자로 올리면 직접 멤버로 남아 부서에서 빠져도 채널에 남는다. */}
                    {canChangeRole && !direct && (
                      <span id={roleHintId} className="text-xs text-muted-foreground" data-testid={roleHintId}>
                        직접 초대하거나 관리자로 지정하면 부서와 상관없이 채널에 남습니다
                      </span>
                    )}
                  </span>
                  {/* 정지된 구성원 표시 — 로그인할 수 없는 사람을 다른 멤버와 구분한다(WP-723). */}
                  {m.active === false && (
                    <Badge variant="outline" className="shrink-0" data-testid={`member-inactive-${m.userId}`}>
                      비활성
                    </Badge>
                  )}
                  {/* OWNER 는 타인 역할을 네이티브 select 로 변경 가능.
                      shadcn Select(Radix)는 Playwright selectOption 미동작 → 네이티브 select 사용. */}
                  {canChangeRole ? (
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
                      aria-describedby={!direct ? roleHintId : undefined}
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
                  {/* OWNER/ADMIN 은 타인 제거 가능(본인 제외). OWNER 는 제거 불가(백엔드 403) → 버튼 숨김.
                      부서로 들어온 사람도 내보낼 수 있다 — 서버가 그 부서 대상에서 이 사람을 뺀다(확인 문구가 알린다). */}
                  {canManage && !isSelf && m.role !== 'OWNER' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`member-remove-${m.userId}`}
                      onClick={() =>
                        setConfirmRemove({ userId: m.userId, name: m.name, viaNote: m.viaGroupIds.length > 0 ? viaGroupKickNote(viaNames) : null })
                      }
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
            {/* 부서로도 들어온 사람(WP-1058) — 내보내면 그 부서 대상에서도 빠져, 부서가 남아 있어도 다시 들어오지 않는다. */}
            {confirmRemove?.viaNote && (
              <p className="text-sm text-muted-foreground" data-testid="member-remove-group-note">
                {confirmRemove.viaNote}
              </p>
            )}
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

      {/* 조직 제거 확인(WP-1058) — 그 조직으로만 들어와 있던 사람은 채널에서 빠진다(직접 초대한 사람은 남는다). */}
      <AlertDialog
        open={confirmRemoveGroup !== null}
        onOpenChange={(open) => !open && setConfirmRemoveGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>조직 제거</AlertDialogTitle>
            <AlertDialogDescription>
              채널에서 조직 {confirmRemoveGroup?.name}을(를) 제거할까요? 그 조직(하위 조직 포함) 사람은 직접 초대받지 않았다면 이 채널에서 빠져요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="member-group-remove-confirm"
              onClick={() => {
                if (confirmRemoveGroup) removeGroup.mutate(confirmRemoveGroup.groupId)
                setConfirmRemoveGroup(null)
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
