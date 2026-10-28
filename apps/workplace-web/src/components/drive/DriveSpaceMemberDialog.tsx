// 드라이브 팀 공간 멤버 다이얼로그(WP-582) — 공통 SpaceMemberDialog 에 드라이브 멤버 훅과 문구를 잇는 래퍼.
// WP-1056 — 노트 스페이스처럼 조직도 부서 자체도 멤버로 두고(부서 멤버), 내 그룹은 고르는 시점 구성원을 사람 멤버로 풀어 더한다.
import { SpaceMemberDialog } from '@/components/users/SpaceMemberDialog'
import {
  useAddDriveMember,
  useAddDriveMemberGroup,
  useAddDriveMembersFromGroup,
  useChangeDriveMemberGroupRole,
  useChangeDriveMemberRole,
  useDriveMemberGroups,
  useDriveMembers,
  useRemoveDriveMember,
  useRemoveDriveMemberGroup,
} from '@/hooks/queries/useDriveMembers'
import type { DriveSpace } from '@/types/drive'

export function DriveSpaceMemberDialog({
  space,
  open,
  onOpenChange,
}: {
  space: DriveSpace
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  // 사이드바가 열 때만 마운트하므로 바로 조회한다.
  const { data: members } = useDriveMembers(space.id)
  const addMember = useAddDriveMember(space.id)
  const changeRole = useChangeDriveMemberRole(space.id)
  const removeMember = useRemoveDriveMember(space.id)
  const { data: groups } = useDriveMemberGroups(space.id)
  const addGroup = useAddDriveMemberGroup(space.id)
  const changeGroupRole = useChangeDriveMemberGroupRole(space.id)
  const removeGroup = useRemoveDriveMemberGroup(space.id)
  const addFromGroup = useAddDriveMembersFromGroup(space.id)

  return (
    <SpaceMemberDialog
      open={open}
      onOpenChange={onOpenChange}
      spaceName={space.name}
      ownerId={space.ownerId}
      members={members}
      canManage={space.role === 'OWNER'}
      roleHint="편집자는 파일을 올리고 정리할 수 있고, 보기 전용은 보고 내려받기만 할 수 있어요."
      removeHint={(name) => `이 공간에서 ${name}을(를) 제거할까요? 제거하면 이 공간의 파일을 더는 볼 수 없어요.`}
      onAdd={(userId, role) => addMember.mutate({ userId, role })}
      onChangeRole={(userId, role) => changeRole.mutate({ userId, role })}
      onRemove={(userId) => removeMember.mutate(userId)}
      testIdPrefix="drive"
      departments={{
        groups,
        onAdd: (groupId, role) => addGroup.mutate({ groupId, role }),
        onChangeRole: (groupId, role) => changeGroupRole.mutate({ groupId, role }),
        onRemove: (groupId) => removeGroup.mutate(groupId),
        removeHint: (name) =>
          `이 공간에서 조직 ${name}을(를) 제거할까요? 그 조직(하위 조직 포함) 사람은 직접 멤버가 아니면 이 공간의 파일을 더는 볼 수 없어요.`,
        onAddPersonalGroupMembers: addFromGroup,
      }}
    />
  )
}
