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
 * 이 프로젝트에 접수만 할 수 있는가(WP-477) — OPEN 프로젝트의 비멤버는 제목·본문만 보내고, 우선순위·일정·담당자·유형·부모는 처리팀이 정한다
 * (서버가 기본값이 아닌 값을 403 으로 거부). 프로젝트를 아직 못 불러왔으면 false.
 */
export function isIntakeOnly(project: Pick<ProjectResponse, 'type' | 'viewerIsMember'> | undefined): boolean {
  return project?.type === 'OPEN' && !project.viewerIsMember
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

/**
 * 프로젝트 기본 정보 저장·멤버 관리·삭제를 할 수 있는가(WP-479) — 서버 assertWithRole(OWNER) 와 같은 규칙: OWNER, 또는 개인 프로젝트가
 * 아닌 곳의 ADMIN. 예전엔 MEMBER 에게도 이 조작이 활성으로 보여 눌러야 403 「권한이 부족합니다: OWNER 필요」가 떴다.
 */
export function canManageProject(isOwner: boolean, isAdmin: boolean, isPersonal: boolean): boolean {
  return isOwner || (isAdmin && !isPersonal)
}

/**
 * 이슈 상세에서 워크플로 필드(유형·상태·우선순위·담당자·일정 등)가 막혔을 때 보여 줄 안내(WP-503) — 막히지 않았으면 null.
 * 왜: 비활성 필드가 흐리게만 보여 OPEN 비멤버가 「기능이 없다」고 받아들였다(VOC WPV-8). 저장 중 잠깐 막히는 경우는 권한이 아니므로
 * 서버 플래그(viewerCanEditWorkflow)만 본다. 코멘트를 쓸 수 있으면(내용 편집 권한 = 코멘트 권한) 바꿀 방법도 함께 알려 준다.
 */
export function workflowLockedNotice(canEditWorkflow: boolean, canEditContent: boolean): string | null {
  if (canEditWorkflow) return null
  // 막히는 건 유형·상태뿐 아니라 담당자·라벨·의존성·커스텀 필드까지라 「속성」으로 묶어 말한다.
  const base = '이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요.'
  return canEditContent ? `${base} 바꿔야 하면 코멘트로 알려 주세요.` : base
}
