import { useState } from 'react';
import { toast } from 'sonner';

import { BusySwitch } from '@/components/BusySwitch';
import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection';

import { useUpdateProject } from '../../../hooks/queries/useProjects';
import { handleApiError } from '../../../lib/api-error';
import type { ProjectResponse } from '../../../types/project';

interface CommentPermissionSettingsProps {
  project: ProjectResponse;
  /** 저장 권한(소유자·관리자). 없으면 스위치가 비활성. */
  canManage: boolean;
}

/**
 * 프로젝트 설정 「댓글」(WP-1495) — 접수함(OPEN) 프로젝트의 이슈에 멤버가 아닌 사람도 댓글을 달 수 있게 할지 정한다.
 * 상태·담당자·우선순위 변경은 이 설정과 무관하게 멤버만 한다. 켜고 끌 때마다 바로 저장한다(토글이라 저장 단추를 두지 않는다).
 * OPEN 프로젝트에서만 그린다는 판단은 부모(ProjectSettingsPage)가 한다.
 */
export function CommentPermissionSettings({ project, canManage }: CommentPermissionSettingsProps) {
  const update = useUpdateProject(project.key);
  // 사용자가 방금 고른 값(낙관적 표시). 저장 성공 뒤 프로젝트 재조회가 끝날 때까지 스위치가 옛 값으로 깜빡이지 않게 이 값을 먼저 보인다.
  // 저장이 실패하면 비워 서버 값으로 되돌린다.
  const [pending, setPending] = useState<boolean | null>(null);
  const serverValue = project.nonMemberComment ?? false;

  // 재조회 결과가 고른 값을 따라잡으면 낙관 값을 놓는다 — 이후 다른 곳에서 바뀐 값도 그대로 보이게.
  // (렌더 중 상태 조정 — effect 안 setState 를 피한다.)
  if (pending !== null && pending === serverValue) setPending(null);

  const onChange = async (next: boolean) => {
    setPending(next);
    try {
      await update.mutateAsync({ nonMemberComment: next });
      toast.success(next ? '멤버가 아니어도 댓글을 달 수 있어요' : '멤버만 댓글을 달 수 있어요');
    } catch (e) {
      setPending(null);
      handleApiError(e, '저장에 실패했습니다');
    }
  };

  return (
    <SettingsSection
      data-help="project-settings.comments"
      title="댓글"
      description="접수함 프로젝트의 이슈에 누가 댓글을 달 수 있는지 정해요."
      data-testid="project-comment-permission"
    >
      <SettingsToggleRow
        label={<label htmlFor="settings-non-member-comment">멤버가 아니어도 댓글 달기</label>}
        description="켜면 멤버가 아닌 사람도 이 프로젝트의 이슈에 댓글을 달 수 있어요. 상태·담당자·우선순위는 지금처럼 멤버만 바꿔요."
        control={
          <BusySwitch
            id="settings-non-member-comment"
            checked={pending ?? serverValue}
            busy={update.isPending}
            disabled={!canManage}
            onCheckedChange={onChange}
          />
        }
      />
    </SettingsSection>
  );
}
