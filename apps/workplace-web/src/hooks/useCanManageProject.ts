// 프로젝트 관리(OWNER) 권한 — 버전(WP-888)·마일스톤·사이클(WP-1008)이 같은 서버 가드(프로젝트 OWNER·테넌트 ADMIN, 개인 프로젝트 제외)를
// 쓰므로 버튼 노출도 한 판정으로 맞춘다. 서버가 최종 검증하므로 멤버 목록을 받기 전엔 잠시 읽기 전용으로 보인다(구성요소 설정과 같다).
import { canManageProject, isProjectOwner } from '../lib/projectPermissions';
import type { ProjectResponse } from '../types/project';
import { useProjectMembers } from './queries/useProjectMembers';
import { useProject } from './queries/useProjects';
import { useAuth } from './useAuth';

/**
 * 이미 손에 든 프로젝트로 관리 권한을 판정한다 — 프로젝트 탭 화면(사이클·버전·타임라인)은 레이아웃이 불러온 project 를
 * 컨텍스트로 받으므로 프로젝트 쿼리를 다시 부르지 않는다. 멤버 목록만 조회한다. project 가 아직 없으면 개인 아님으로 본다.
 */
export function useCanManageProjectOf(projectKey: string, project: Pick<ProjectResponse, 'type'> | undefined): boolean {
  const members = useProjectMembers(projectKey);
  const { user, isAdmin } = useAuth();
  return canManageProject(isProjectOwner(members.data, user?.id), isAdmin, project?.type === 'PERSONAL');
}

/** 프로젝트 key 만 아는 화면(버전 상세 등)용 — 프로젝트를 불러와 같은 판정을 한다. */
export function useCanManageProject(projectKey: string) {
  const project = useProject(projectKey);
  const canManage = useCanManageProjectOf(projectKey, project.data);
  return { project, canManage };
}
