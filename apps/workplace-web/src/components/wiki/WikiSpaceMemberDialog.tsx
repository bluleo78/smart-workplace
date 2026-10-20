// 노트 팀 스페이스 멤버 다이얼로그 — 공통 SpaceMemberDialog 에 노트 멤버 훅과 문구를 잇는 래퍼(WP-582 에서 드라이브와 같은 화면으로 통일).
import { SpaceMemberDialog } from '@/components/users/SpaceMemberDialog'
import {
  useAddWikiMember,
  useRemoveWikiMember,
  useUpdateWikiMemberRole,
  useWikiMembers,
} from '@/hooks/queries/useWikiMembers'
import type { WikiSpace } from '@/types/wiki'

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

  return (
    <SpaceMemberDialog
      open={open}
      onOpenChange={onOpenChange}
      spaceName={space.name}
      members={members}
      canManage={space.role === 'OWNER'}
      roleHint="편집자는 페이지를 쓰고 고칠 수 있고, 보기 전용은 읽기만 할 수 있어요."
      removeHint={(name) => `이 스페이스에서 ${name}을(를) 제거할까요? 제거하면 이 스페이스의 페이지를 더는 볼 수 없어요.`}
      onAdd={(userId, role) => addMember.mutate({ userId, role })}
      onChangeRole={(userId, role) => updateRole.mutate({ userId, role })}
      onRemove={(userId) => removeMember.mutate(userId)}
      testIdPrefix="wiki"
    />
  )
}
