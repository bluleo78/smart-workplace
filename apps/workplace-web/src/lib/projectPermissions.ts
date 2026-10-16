// 프로젝트 화면의 권한 판정 — 서버 플래그(viewerIsMember)와 프로젝트 유형으로 UI 노출을 정한다.
import type { MemberResponse, ProjectResponse } from '../types/project'

/**
 * 이 프로젝트에서 이슈를 만들 수 있는가 — OPEN 프로젝트는 테넌트 전원(비멤버 reporter 포함), TEAM 등은 멤버만.
 * viewerIsMember 는 서버 플래그 — 클라이언트에서 재파생하지 않는다. 프로젝트를 아직 못 불러왔으면 false.
 */
export function canCreateIssueIn(project: Pick<ProjectResponse, 'type' | 'viewerIsMember'> | undefined): boolean {
  if (!project) return false
  return project.type === 'OPEN' || project.viewerIsMember
}

/**
 * userId 가 이 프로젝트의 OWNER 인가 — 설정 화면·이슈 상세(첨부 삭제)·행 메뉴가 같은 판정을 쓴다. 백엔드 가드가 최종 검증.
 * 멤버 목록 미로드(undefined)·비로그인(userId 없음)이면 false.
 */
export function isProjectOwner(
  members: readonly Pick<MemberResponse, 'userId' | 'role'>[] | undefined,
  userId: number | undefined,
): boolean {
  if (userId == null) return false
  return members?.some((m) => m.userId === userId && m.role === 'OWNER') ?? false
}
