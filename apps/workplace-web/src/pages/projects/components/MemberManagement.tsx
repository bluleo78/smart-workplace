import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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

interface MemberManagementProps {
  projectKey: string;
  // true 면 AI 어시스턴트(AGENT) 만 추가 가능 — 개인 프로젝트 전용 모드.
  agentOnly?: boolean;
}

// 프로젝트 멤버 관리 — 검색 picker 로 추가, 역할 변경/제거.
export function MemberManagement({ projectKey, agentOnly = false }: MemberManagementProps) {
  const members = useProjectMembers(projectKey);
  const addMember = useAddMember(projectKey);
  const updateRole = useUpdateMemberRole(projectKey);
  const removeMember = useRemoveMember(projectKey);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [newRole, setNewRole] = useState<ProjectMemberRole>('MEMBER');
  // 멤버 제거 확인 다이얼로그 — { userId, name } 지정 시 해당 멤버 제거 확인 AlertDialog 표시.
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string } | null>(null);

  // 기존 멤버 id 집합 — picker 에서 disabled 처리에 사용.
  const existingIds = useMemo(
    () => new Set((members.data ?? []).map((m) => m.userId)),
    [members.data],
  );

  // picker 에서 사용자 선택 시 호출 — agentOnly 면 항상 MEMBER, 아니면 선택된 role 로 추가.
  const onPick = async (user: UserResponse) => {
    try {
      await addMember.mutateAsync({ userId: user.id, role: agentOnly ? 'MEMBER' : newRole });
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

  // 제거 버튼 클릭 시 확인 다이얼로그 표시 — 실제 제거는 onRemoveConfirm에서 수행.
  const onRemove = (userId: number, name: string) => {
    setConfirmRemove({ userId, name });
  };

  const onRemoveConfirm = async () => {
    if (!confirmRemove) return;
    try {
      await removeMember.mutateAsync(confirmRemove.userId);
      toast.success('멤버를 제거했습니다');
      setConfirmRemove(null);
    } catch (e) {
      handleApiError(e, '멤버 제거에 실패했습니다');
    }
  };

  return (
    <>
    <section className="space-y-3">
      {/* agentOnly 모드(개인 프로젝트)면 "AI 어시스턴트" 헤딩, 팀 프로젝트면 "멤버" */}
      <h2 className="text-lg font-semibold">{agentOnly ? 'AI 어시스턴트' : '멤버'}</h2>

      <div className="flex gap-2 items-end">
        {/* agentOnly 모드면 역할 Select 숨김 — 항상 MEMBER 로 고정. */}
        {!agentOnly && (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="new-member-role">
              역할
            </label>
            {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
            <Select value={newRole} onValueChange={(v) => setNewRole(v as ProjectMemberRole)}>
              <SelectTrigger id="new-member-role" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">멤버</SelectItem>
                <SelectItem value="OWNER">소유자</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {/* includeAgents — 팀 프로젝트에도 AGENT 를 멤버(=담당자 후보)로 추가할 수 있어야 하므로 kind 탭 노출 +
            AGENT 조회 허용(#734). 백엔드 addMember 는 팀 프로젝트에서 kind 제한을 두지 않는다. */}
        <MemberSearchPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingMemberIds={existingIds}
          onSelect={onPick}
          agentOnly={agentOnly}
          includeAgents
          trigger={
            <Button type="button" data-testid="member-add-trigger">
              {/* agentOnly 모드면 AI 어시스턴트 추가 버튼 라벨 */}
              {agentOnly ? '+ AI 어시스턴트 추가' : '+ 멤버 추가'}
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
              <th>이메일</th>
              <th>역할</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.userId} className="border-b hover:bg-accent/50 transition-colors cursor-pointer" role="row">
                <td className="py-2">{m.name}</td>
                <td className="text-muted-foreground">{m.username}</td>
                <td>
                  {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
                  <Select
                    value={m.role}
                    onValueChange={(v) => onChangeRole(m.userId, v as ProjectMemberRole)}
                  >
                    <SelectTrigger aria-label={`${m.name} 역할`} size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">멤버</SelectItem>
                      <SelectItem value="OWNER">소유자</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(m.userId, m.name)}
                    aria-label={`${m.name} 제거`}
                    data-testid={`member-remove-${m.userId}`}
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
    {/* 멤버 제거 확인 AlertDialog — window.confirm() 대체. */}
    <AlertDialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>멤버 제거</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmRemove?.name}을(를) 프로젝트에서 제거하시겠습니까? 이 작업은 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemoveConfirm}>제거</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
