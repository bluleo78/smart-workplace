import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import {
  useAddMember,
  useProjectMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '../../../hooks/queries/useProjectMembers';
import { handleApiError } from '../../../lib/api-error';
import type { UserResponse } from '../../../types/auth';
import type { ProjectMemberRole } from '../../../types/project';
import { MemberSearchPopover } from './MemberSearchPopover';

// 프로젝트 멤버 관리 — 검색 picker 로 추가, 역할 변경/제거.
export function MemberManagement({ projectKey }: { projectKey: string }) {
  const members = useProjectMembers(projectKey);
  const addMember = useAddMember(projectKey);
  const updateRole = useUpdateMemberRole(projectKey);
  const removeMember = useRemoveMember(projectKey);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [newRole, setNewRole] = useState<ProjectMemberRole>('MEMBER');

  // 기존 멤버 id 집합 — picker 에서 disabled 처리에 사용.
  const existingIds = useMemo(
    () => new Set((members.data ?? []).map((m) => m.userId)),
    [members.data],
  );

  // picker 에서 사용자 선택 시 호출 — 선택된 role 로 즉시 추가.
  const onPick = async (user: UserResponse) => {
    try {
      await addMember.mutateAsync({ userId: user.id, role: newRole });
      toast.success(`${user.name} 을(를) 추가했습니다`);
    } catch (e) {
      handleApiError(e, '멤버 추가에 실패했습니다');
    }
  };

  const onChangeRole = async (userId: number, role: ProjectMemberRole) => {
    try {
      await updateRole.mutateAsync({ userId, data: { role } });
      toast.success('역할을 변경했습니다');
    } catch (e) {
      handleApiError(e, '역할 변경에 실패했습니다');
    }
  };

  const onRemove = async (userId: number) => {
    if (!confirm('이 멤버를 제거하시겠습니까?')) return;
    try {
      await removeMember.mutateAsync(userId);
      toast.success('멤버를 제거했습니다');
    } catch (e) {
      handleApiError(e, '멤버 제거에 실패했습니다');
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">멤버</h2>

      <div className="flex gap-2 items-end">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="new-member-role">
            역할
          </label>
          <select
            id="new-member-role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as ProjectMemberRole)}
            className="border rounded p-2 bg-background"
          >
            <option value="MEMBER">MEMBER</option>
            <option value="OWNER">OWNER</option>
          </select>
        </div>
        <MemberSearchPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingMemberIds={existingIds}
          onSelect={onPick}
          trigger={
            <Button type="button" data-testid="member-add-trigger">
              + 멤버 추가
            </Button>
          }
        />
      </div>

      {members.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2">이름</th>
              <th>username</th>
              <th>역할</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.userId} className="border-b" role="row">
                <td className="py-2">{m.name}</td>
                <td className="text-muted-foreground">{m.username}</td>
                <td>
                  <select
                    value={m.role}
                    onChange={(e) =>
                      onChangeRole(m.userId, e.target.value as ProjectMemberRole)
                    }
                    aria-label={`${m.name} 역할`}
                    className="border rounded p-1 bg-background"
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="OWNER">OWNER</option>
                  </select>
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(m.userId)}
                    aria-label={`${m.name} 제거`}
                  >
                    제거
                  </Button>
                </td>
              </tr>
            ))}
            {members.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-muted-foreground">
                  멤버가 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
