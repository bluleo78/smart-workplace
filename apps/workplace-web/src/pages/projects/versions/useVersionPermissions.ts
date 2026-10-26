// 버전 화면의 관리 권한(WP-888) — 서버 가드(프로젝트 OWNER·테넌트 ADMIN, 개인 프로젝트 제외)와 같은 규칙으로 버튼 노출을 정한다.
// 서버가 최종 검증하므로 멤버 목록을 받기 전엔 잠시 읽기 전용으로 보인다(구성요소 설정과 같다).
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useProject } from '../../../hooks/queries/useProjects';
import { useAuth } from '../../../hooks/useAuth';
import { canManageProject, isProjectOwner } from '../../../lib/projectPermissions';

export function useVersionPermissions(projectKey: string) {
  const project = useProject(projectKey);
  const members = useProjectMembers(projectKey);
  const { user, isAdmin } = useAuth();
  const isPersonal = project.data?.type === 'PERSONAL';
  const canManage = canManageProject(isProjectOwner(members.data, user?.id), isAdmin, isPersonal);
  return { project, canManage };
}
