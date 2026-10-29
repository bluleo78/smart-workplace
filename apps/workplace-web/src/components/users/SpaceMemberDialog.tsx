// 공간 멤버 다이얼로그(WP-582) — 노트·드라이브 팀 공간이 같이 쓰는 화면. 멤버 목록(역할)과 소유자의 멤버 추가/역할 변경/제거.
// 데이터 조회·변경은 앱별 래퍼(WikiSpaceMemberDialog·DriveSpaceMemberDialog)가 훅으로 하고, 여기는 모양과 규칙만 맡는다.
// 네이티브 <select> 사용 — shadcn Select(Radix)는 Playwright selectOption 미동작.
// WP-1052 — 노트는 조직도 부서 자체도 멤버로 둔다(departments 를 넘길 때만): 부서 행(「개발팀 · 12명 [조직]」, 편집자·보기 전용, 제거,
// ▸ 로 하위 부서까지 지금 구성원 펼치기)과, 사람·조직을 함께 고르는 공통 선택 창.
// WP-1056 — 드라이브 팀 스페이스도 부서 멤버를 넘기고, 내 그룹도 골라 지금 구성원을 사람 멤버로 풀어 더한다(onAddPersonalGroupMembers).
import { Building2, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { GroupMembers } from '@/components/members/GroupMembers'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/users/UserAvatar'
import { useAuth } from '@/hooks/useAuth'
import {
  departmentRoleNote,
  isLockedMemberRow,
  SPACE_GROUP_ROLES,
  SPACE_ROLES,
  type SpaceGroupRole,
  type SpaceMember,
  type SpaceMemberGroup,
  type SpaceRole,
  spaceRoleLabel,
} from '@/lib/spaceRoles'
import { cn } from '@/lib/utils'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'

import { PeopleAndDepartmentPicker } from '../members/PeopleAndDepartmentPicker'
import { addPersonalGroupWithNotice, type GroupMembersAddResult } from '../members/personalGroups'

/** 멤버인 조직도 부서(WP-1052) — 넘기면 부서 행과 사람·조직 선택 창을 켠다. 노트·드라이브 팀 스페이스가 넘긴다(WP-1056). */
export interface SpaceMemberDepartments {
  /** 부서 목록 — 조회 전이면 undefined. */
  groups: SpaceMemberGroup[] | undefined
  /** 새 부서 추가 — 역할은 편집자로 시작한다(사람 추가와 같은 기본값). */
  onAdd: (groupId: number, role: SpaceGroupRole) => void
  onChangeRole: (groupId: number, role: SpaceGroupRole) => void
  onRemove: (groupId: number) => void
  /** 부서 제거 확인 문구 — 제거하면 그 부서 사람이 무엇을 잃는지. */
  removeHint: (name: string) => string
  /**
   * 내 그룹 구성원을 사람 멤버로 더하기(WP-1056) — 넘기면 선택 창에 내 그룹도 보이고, 고른 그룹(하위 그룹 포함)의 지금 사람 구성원 id 를 넘겨 받는다.
   * 이미 멤버인 사람 거르기·추가·무효화는 앱이 하고(최신 멤버 목록으로 — 업서트가 기존 역할을 덮지 않게) 더한·뺀·실패한 수를 돌려준다. 그룹 자체는
   * 멤버로 남지 않아 나중에 그룹에 들어온 사람은 따라오지 않는다. 없으면(노트 스페이스) 내 그룹을 보이지 않는다.
   */
  onAddPersonalGroupMembers?: (memberIds: number[] | Promise<number[]>) => Promise<GroupMembersAddResult>
}

/** 제거 확인 대상 — 사람 행 또는 부서 행. */
type RemoveTarget = { kind: 'user'; id: number; name: string } | { kind: 'group'; id: number; name: string }

export function SpaceMemberDialog({
  open,
  onOpenChange,
  spaceName,
  ownerId,
  members,
  canManage,
  roleHint,
  removeHint,
  onAdd,
  onChangeRole,
  onRemove,
  testIdPrefix,
  departments,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  spaceName: string
  /** 공간을 만든 사람(WP-656) — 생성자 행은 내가 OWNER 여도 늘 읽기 전용. */
  ownerId: number
  /** 멤버 목록 — 조회 전이면 undefined. */
  members: SpaceMember[] | undefined
  /** 내가 소유자라 추가·역할 변경·제거를 할 수 있는지. 아니면 명단만 본다. */
  canManage: boolean
  /** 제목 아래 한 줄 — 앱마다 편집자·보기 전용이 할 수 있는 일이 달라 문구를 받는다. */
  roleHint: string
  /** 제거 확인 문구 — 제거하면 무엇을 잃는지 앱별로 알린다. */
  removeHint: (name: string) => string
  /** 새 멤버 추가 — 역할은 편집자로 시작한다(호출부가 정하지 않게 여기서 고정). */
  onAdd: (userId: number, role: SpaceRole) => void
  onChangeRole: (userId: number, role: SpaceRole) => void
  onRemove: (userId: number) => void
  /** data-testid 접두사 — 앱별 E2E 가 구분해 잡는다(wiki-member-row-1, drive-member-row-1 …). */
  testIdPrefix: 'wiki' | 'drive'
  /** 조직도 부서 멤버(WP-1052) — 넘기면 부서 행과 사람·조직 선택 창을 켠다. 없으면 사람만. */
  departments?: SpaceMemberDepartments
}) {
  const { user } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)
  // 제거 확인 다이얼로그 — 대상이 있으면 그 사람·부서 제거를 확인 요청.
  const [confirmRemove, setConfirmRemove] = useState<RemoveTarget | null>(null)
  // 구성원을 펼친 부서 id — 펼칠 때만 구성원을 받는다.
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set())
  // 기존 멤버 id 집합 — 선택 창에 전달해 중복 추가 방지.
  const existingIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members])
  const groups = departments?.groups
  const existingGroupIds = useMemo(() => new Set((groups ?? []).map((g) => g.groupId)), [groups])
  const tid = (suffix: string) => `${testIdPrefix}-${suffix}`
  const toggleGroup = (groupId: number) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  const addTrigger = (
    <Button size="sm" variant="outline" data-testid={tid('member-add-trigger')}>
      멤버 추가
    </Button>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid={tid('members-dialog')}>
          <DialogHeader>
            <DialogTitle>멤버 — {spaceName}</DialogTitle>
            <DialogDescription>{roleHint}</DialogDescription>
          </DialogHeader>

          {/* 인원 수 + 멤버 추가(소유자만). 검색에 AI 에이전트도 넣는다 — 팀 공간 일을 AI 에게도 맡길 수 있게.
              부서 멤버를 켜면 「멤버 3명 · 조직 1」로 부서 수도 함께 보이고, 사람·조직을 한 창에서 고른다. 내 그룹은 그룹 자체를 멤버로 두지 않아
              기본으로 빼고, onAddPersonalGroupMembers(드라이브)를 넘기면 보이되 고르면 지금 구성원을 사람 멤버로 풀어 더한다. */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground" data-testid={tid('member-count')}>
              멤버 {members?.length ?? 0}명{departments && (groups?.length ?? 0) > 0 && ` · 조직 ${groups!.length}`}
            </span>
            {canManage && departments && (
              <PeopleAndDepartmentPicker
                open={searchOpen}
                onOpenChange={setSearchOpen}
                existingUserIds={existingIds}
                existingGroupIds={existingGroupIds}
                onSelectPerson={(userId) => onAdd(userId, 'EDITOR')}
                onSelectDepartment={(g) => departments.onAdd(g.id, 'EDITOR')}
                onSelectPersonalGroup={(g) => {
                  const addMembers = departments.onAddPersonalGroupMembers
                  // 내 그룹 고르기(WP-1056) — 지금 사람 구성원을 받아 앱에 넘기고, 끝난 뒤 몇 명을 더했는지(실패가 있으면 함께) 알린다.
                  if (addMembers) void addPersonalGroupWithNotice(g, addMembers)
                }}
                showPersonalGroups={departments.onAddPersonalGroupMembers != null}
                includeAgents
                testIdPrefix={tid('member-picker')}
                trigger={addTrigger}
              />
            )}
            {canManage && !departments && (
              <MemberSearchPopover
                open={searchOpen}
                onOpenChange={setSearchOpen}
                existingMemberIds={existingIds}
                includeAgents
                onSelect={(u) => onAdd(u.id, 'EDITOR')}
                trigger={addTrigger}
              />
            )}
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto" data-testid={tid('member-list')}>
            {/* 부서 행(WP-1052) — 사람 행 위에. 부서 자체가 멤버라 나중에 들어온 구성원도 그 역할을 받는다. 소유자 역할은 줄 수 없다. */}
            {departments &&
              groups?.map((g) => {
                const open = expandedGroups.has(g.groupId)
                return (
                  <div key={`g${g.groupId}`} data-testid={tid(`member-group-row-${g.groupId}`)}>
                    <div className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                      <button
                        type="button"
                        aria-label={`${g.name} 구성원 ${open ? '접기' : '펼치기'}`}
                        aria-expanded={open}
                        onClick={() => toggleGroup(g.groupId)}
                        className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        data-testid={tid(`member-group-toggle-${g.groupId}`)}
                      >
                        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
                      </button>
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                      >
                        <Building2 className="size-3.5" />
                      </span>
                      {/* 이름은 자르지 않는다(WP-1096) — 휴대폰 행은 역할 select·제거가 폭을 먼저 차지해, 자르면 「경...」처럼 한 글자만 남아
                          조직이 둘 이상일 때 어느 조직인지 알 수 없었다(마우스가 없어 툴팁도 못 본다). 이름 칸은 최소 9rem 을 갖고, 그만큼 안 남으면
                          역할·제거가 다음 줄(오른쪽)로 내려간다. 그래도 긴 이름은 감고, 인원 수·「조직」 배지는 자리가 모자라면 다음 줄로. */}
                      <span
                        className="flex min-w-36 flex-1 flex-wrap items-center gap-x-1.5"
                        data-testid={tid(`member-group-name-${g.groupId}`)}
                      >
                        <span className="min-w-0 break-keep [overflow-wrap:anywhere]">{g.name}</span>
                        <span className="shrink-0 text-muted-foreground">· {g.memberCount}명</span>
                        <span className="shrink-0 rounded border px-1 text-[11px] leading-4 text-muted-foreground">조직</span>
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {canManage ? (
                          <select
                            data-testid={tid(`member-group-role-select-${g.groupId}`)}
                            aria-label={`${g.name} 역할`}
                            value={g.role}
                            onChange={(e) => departments.onChangeRole(g.groupId, e.target.value as SpaceGroupRole)}
                            className="rounded border bg-background px-1 py-0.5 text-xs"
                          >
                            {SPACE_GROUP_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {spaceRoleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge variant="secondary" data-testid={tid(`member-group-role-${g.groupId}`)}>
                            {spaceRoleLabel(g.role)}
                          </Badge>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={tid(`member-group-remove-${g.groupId}`)}
                            onClick={() => setConfirmRemove({ kind: 'group', id: g.groupId, name: g.name })}
                          >
                            제거
                          </Button>
                        )}
                      </div>
                    </div>
                    {open && <GroupMembers groupId={g.groupId} testId={tid(`member-group-members-${g.groupId}`)} />}
                  </div>
                )
              })}
            {members?.map((m) => {
              // 마지막 소유자·내 행·생성자 행은 역할 변경·제거 불가(WP-656) — 서버도 마지막 소유자는 거부하지만 누르기 전에 막는다.
              const locked = isLockedMemberRow(m, members, user?.id, ownerId)
              const roleNote = departmentRoleNote(m)
              return (
                <div
                  key={m.userId}
                  data-testid={tid(`member-row-${m.userId}`)}
                  className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <UserAvatar user={{ id: m.userId, username: '', name: m.name }} size="sm" />
                  {/* 사람 이름도 조직 행처럼 자르지 않는다(WP-1096) — 휴대폰에서 역할 select·제거가 폭을 먼저 차지해 「Wo...」로 잘렸다. */}
                  <span className="min-w-36 flex-1 break-keep [overflow-wrap:anywhere]" data-testid={tid(`member-name-${m.userId}`)}>
                    {m.name}
                    {m.userId === user?.id && <span className="ml-1 text-muted-foreground">(나)</span>}
                    {/* 직접 역할보다 부서 역할이 높으면 실효 역할을 함께 보인다(WP-1102) — 보기 전용으로 낮춰도 부서로 계속 편집할 수 있다. */}
                    {roleNote && (
                      <span
                        className="block text-xs text-muted-foreground"
                        title="직접 역할과 조직(부서) 역할 중 높은 쪽이 적용돼요"
                        data-testid={tid(`member-department-role-${m.userId}`)}
                      >
                        {roleNote}
                      </span>
                    )}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {canManage ? (
                      <select
                        data-testid={tid(`member-role-select-${m.userId}`)}
                        aria-label={`${m.name} 역할`}
                        value={m.role}
                        disabled={locked}
                        title={locked ? '내 행·생성자 행·마지막 소유자는 역할을 바꿀 수 없어요' : undefined}
                        onChange={(e) => onChangeRole(m.userId, e.target.value as SpaceRole)}
                        className="rounded border bg-background px-1 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {SPACE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {spaceRoleLabel(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant="secondary" data-testid={tid(`member-role-${m.userId}`)}>
                        {spaceRoleLabel(m.role)}
                      </Badge>
                    )}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={tid(`member-remove-${m.userId}`)}
                        disabled={locked}
                        onClick={() => setConfirmRemove({ kind: 'user', id: m.userId, name: m.name })}
                      >
                        제거
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* 멤버 제거 확인 — 실수 클릭 방지. */}
      <AlertDialog open={confirmRemove !== null} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmRemove?.kind === 'group' ? '조직 제거' : '멤버 제거'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove == null
                ? ''
                : confirmRemove.kind === 'group'
                  ? (departments?.removeHint(confirmRemove.name) ?? '')
                  : removeHint(confirmRemove.name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid={tid('member-remove-confirm')}
              onClick={() => {
                // 내 행은 늘 잠겨 있어 여기로 올 수 없다(WP-656) — 제거는 항상 남의 행.
                if (confirmRemove?.kind === 'user') onRemove(confirmRemove.id)
                else if (confirmRemove?.kind === 'group') departments?.onRemove(confirmRemove.id)
                setConfirmRemove(null)
              }}
            >
              제거
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
