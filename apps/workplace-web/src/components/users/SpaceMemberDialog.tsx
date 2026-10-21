// 공간 멤버 다이얼로그(WP-582) — 노트·드라이브 팀 공간이 같이 쓰는 화면. 멤버 목록(역할)과 소유자의 멤버 추가/역할 변경/제거.
// 데이터 조회·변경은 앱별 래퍼(WikiSpaceMemberDialog·DriveSpaceMemberDialog)가 훅으로 하고, 여기는 모양과 규칙만 맡는다.
// 네이티브 <select> 사용 — shadcn Select(Radix)는 Playwright selectOption 미동작.
import { useMemo, useState } from 'react'

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
import { isLockedMemberRow, SPACE_ROLES, type SpaceMember, type SpaceRole, spaceRoleLabel } from '@/lib/spaceRoles'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'

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
}) {
  const { user } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)
  // 제거 확인 다이얼로그 — { userId, name } 가 있으면 해당 멤버 제거를 확인 요청.
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string } | null>(null)
  // 기존 멤버 id 집합 — MemberSearchPopover 에 전달해 중복 추가 방지.
  const existingIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members])
  const tid = (suffix: string) => `${testIdPrefix}-${suffix}`

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid={tid('members-dialog')}>
          <DialogHeader>
            <DialogTitle>멤버 — {spaceName}</DialogTitle>
            <DialogDescription>{roleHint}</DialogDescription>
          </DialogHeader>

          {/* 인원 수 + 멤버 추가(소유자만). 검색에 AI 에이전트도 넣는다 — 팀 공간 일을 AI 에게도 맡길 수 있게. */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">멤버 {members?.length ?? 0}명</span>
            {canManage && (
              <MemberSearchPopover
                open={searchOpen}
                onOpenChange={setSearchOpen}
                existingMemberIds={existingIds}
                includeAgents
                onSelect={(u) => onAdd(u.id, 'EDITOR')}
                trigger={
                  <Button size="sm" variant="outline" data-testid={tid('member-add-trigger')}>
                    멤버 추가
                  </Button>
                }
              />
            )}
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {members?.map((m) => {
              // 마지막 소유자·내 행·생성자 행은 역할 변경·제거 불가(WP-656) — 서버도 마지막 소유자는 거부하지만 누르기 전에 막는다.
              const locked = isLockedMemberRow(m, members, user?.id, ownerId)
              return (
                <div
                  key={m.userId}
                  data-testid={tid(`member-row-${m.userId}`)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <UserAvatar user={{ id: m.userId, username: '', name: m.name }} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.userId === user?.id && <span className="ml-1 text-muted-foreground">(나)</span>}
                  </span>
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
                      onClick={() => setConfirmRemove({ userId: m.userId, name: m.name })}
                    >
                      제거
                    </Button>
                  )}
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
            <AlertDialogTitle>멤버 제거</AlertDialogTitle>
            <AlertDialogDescription>{confirmRemove ? removeHint(confirmRemove.name) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid={tid('member-remove-confirm')}
              onClick={() => {
                // 내 행은 늘 잠겨 있어 여기로 올 수 없다(WP-656) — 제거는 항상 남의 행.
                if (confirmRemove) onRemove(confirmRemove.userId)
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
