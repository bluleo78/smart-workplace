// 위키 스페이스 멤버 다이얼로그 — TEAM 위키 공유.
// 멤버 목록(역할), OWNER 의 멤버 추가/역할 변경/제거. 소유자 행은 항상 읽기 전용.
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useAddWikiMember,
  useRemoveWikiMember,
  useUpdateWikiMemberRole,
  useWikiMembers,
} from '@/hooks/queries/useWikiMembers'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { WikiRole, WikiSpace } from '@/types/wiki'

// 역할 옵션 — select 노출 순서.
const ROLES: WikiRole[] = ['VIEWER', 'EDITOR', 'OWNER']

export function WikiSpaceMemberDialog({
  space,
  open,
  onOpenChange,
}: {
  space: WikiSpace
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { data: members } = useWikiMembers(open ? space.id : null)
  const addMember = useAddWikiMember(space.id)
  const updateRole = useUpdateWikiMemberRole(space.id)
  const removeMember = useRemoveWikiMember(space.id)
  const [searchOpen, setSearchOpen] = useState(false)
  // 제거 확인 다이얼로그 — { userId, name } 가 있으면 해당 멤버 제거를 확인 요청.
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string } | null>(null)

  // 내가 OWNER 일 때만 추가/역할 변경/제거 가능.
  const canManage = space.role === 'OWNER'
  // 기존 멤버 id 집합 — MemberSearchPopover 에 전달해 중복 추가 방지.
  const existingIds = useMemo(
    () => new Set((members ?? []).map((m) => m.userId)),
    [members],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="wiki-members-dialog">
          <DialogHeader>
            <DialogTitle>멤버 — {space.name}</DialogTitle>
          </DialogHeader>

          {/* OWNER 만 멤버 추가 가능 — 신규 멤버는 EDITOR 기본. */}
          {canManage && (
            <MemberSearchPopover
              open={searchOpen}
              onOpenChange={setSearchOpen}
              existingMemberIds={existingIds}
              onSelect={(u) => addMember.mutate({ userId: u.id, role: 'EDITOR' })}
              trigger={
                <Button size="sm" variant="outline" data-testid="wiki-member-add-trigger">
                  멤버 추가
                </Button>
              }
            />
          )}

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {members?.map((m) => {
              // 소유자 행은 역할 변경/제거 불가(읽기 전용 Badge).
              const isOwner = m.userId === space.ownerId
              return (
                <div
                  key={m.userId}
                  data-testid={`wiki-member-row-${m.userId}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <span className="flex-1 truncate">{m.name}</span>
                  {canManage && !isOwner ? (
                    <select
                      data-testid={`wiki-member-role-select-${m.userId}`}
                      value={m.role}
                      onChange={(e) =>
                        updateRole.mutate({
                          userId: m.userId,
                          role: e.target.value as WikiRole,
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
                    <Badge variant="secondary" data-testid={`wiki-member-role-${m.userId}`}>
                      {m.role}
                    </Badge>
                  )}
                  {/* OWNER 는 소유자 외 멤버를 제거 가능. */}
                  {canManage && !isOwner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`wiki-member-remove-${m.userId}`}
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
      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>멤버 제거</AlertDialogTitle>
            <AlertDialogDescription>
              이 노트에서 {confirmRemove?.name}을(를) 제거하시겠습니까? 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="wiki-member-remove-confirm"
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
    </>
  )
}
