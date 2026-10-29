// 프로젝트 구성요소(WP-933) 타입 — 백엔드 ComponentResponse·ComponentSummary 와 1:1.
// 구성요소는 이슈를 영역별로 나누고, 담당자 없이 만든 이슈에 영역 담당자를 자동으로 붙이는 데 쓴다.

import type { UserSummary } from './user';

/** 구성요소 담당자를 자동 지정에 쓸 수 없는 이유 — 백엔드 AssigneeInvalidReason 과 1:1(계정 정지 · 구성원 아님 · 사람 아님). */
export type AssigneeInvalidReason = 'INACTIVE' | 'NOT_MEMBER' | 'NOT_HUMAN';

/** 프로젝트 구성요소 한 건 — 설정 화면·피커·필터가 쓴다. 목록 순서는 서버가 정한다(이름 대소문자 무시 오름차순). */
export interface ComponentResponse {
  id: number;
  name: string;
  description: string | null;
  // 자동 지정 담당자 — 없으면 null. 무효가 돼도 값은 남아 설정 화면이 경고를 그린다.
  defaultAssignee: UserSummary | null;
  // 담당자가 지금도 「프로젝트 멤버 + 활성 + 사람」인가 — 담당자가 없으면 true.
  defaultAssigneeValid: boolean;
  // 무효일 때 그 이유(WP-1123) — 유효하거나 담당자가 없으면 null. 이 필드가 없는 예전 서버 응답이면 undefined.
  defaultAssigneeInvalidReason?: AssigneeInvalidReason | null;
  archived: boolean;
  // 이 구성요소가 붙은 (삭제되지 않은) 이슈 수.
  issueCount: number;
}

/** 이슈에 붙은 구성요소 요약 — IssueResponse.components 에 임베드(목록 순서). */
export interface ComponentSummary {
  id: number;
  name: string;
  archived: boolean;
}

/** 구성요소 추가 본문 — 이름 1~40자, 설명 0~200자, 담당자는 선택. */
export interface CreateComponentRequest {
  name: string;
  description?: string | null;
  defaultAssigneeId?: number | null;
}

/**
 * 구성요소 부분 수정 본문 — 보낸 필드만 바뀐다. 설명은 '' 이면 지우고, 담당자는 clearDefaultAssignee=true 로 지운다.
 * 담당자 id 를 보내면 서버가 다시 검증하므로 바뀐 경우에만 싣는다(이미 무효가 된 담당자 때문에 이름 변경이 막히지 않게).
 */
export interface UpdateComponentRequest {
  name?: string;
  description?: string;
  defaultAssigneeId?: number;
  clearDefaultAssignee?: boolean;
  archived?: boolean;
}

/** 이름·설명 길이 상한 — 서버 검증과 같은 값. */
export const COMPONENT_NAME_MAX = 40;
export const COMPONENT_DESCRIPTION_MAX = 200;
