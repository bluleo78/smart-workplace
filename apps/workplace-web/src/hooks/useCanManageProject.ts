// 프로젝트 관리(OWNER) 권한 — 버전(WP-888)·마일스톤·사이클(WP-1008)이 같은 서버 가드(프로젝트 OWNER·테넌트 ADMIN, 개인 프로젝트 제외)를
// 쓰므로 버튼 노출도 한 판정으로 맞춘다. 서버가 최종 검증하므로 멤버 목록을 받기 전엔 잠시 읽기 전용으로 보인다(구성요소 설정과 같다).
import { canManageProject, isProjectOwner } from '../lib/projectPermissions';
import { useProjectMembers } from './queries/useProjectMembers';
import { useProject } from './queries/useProjects';
import { useAuth } from './useAuth';

export function useCanManageProject(projectKey: string) {
  const project = useProject(projectKey);
  const members = useProjectMembers(projectKey);
  const { user, isAdmin } = useAuth();
  const isPersonal = project.data?.type === 'PERSONAL';
  const canManage = canManageProject(isProjectOwner(members.data, user?.id), isAdmin, isPersonal);
  return { project, canManage };
}
