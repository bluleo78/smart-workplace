// 이슈 유형 mock 팩토리 — E2E 에서 issueTypes API 응답을 만들 때 사용.

import type {
  IconName,
  IssueTypeResponse,
  IssueTypeSummary,
} from '../../src/types/issueType';

let nextId = 100;

// 기본 TASK summary — issue.factory 의 type 기본값으로 사용.
export function makeTaskType(): IssueTypeSummary {
  return { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' };
}

// SUBTASK 시스템 유형 summary — Phase 4a 자식 이슈 시드용.
export function makeSubtaskType(): IssueTypeSummary {
  return { id: 5, name: 'SUBTASK', colorToken: 'TEAL', icon: 'CornerDownRight' };
}

// EPIC 시스템 유형 summary — 여러 하위 이슈를 담는 최상위 컨테이너.
export function makeEpicType(): IssueTypeSummary {
  return { id: 6, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag' };
}

// 유형 정의 단건 — id 미지정 시 자동 증가.
export function makeIssueType(over: Partial<IssueTypeResponse> = {}): IssueTypeResponse {
  const id = over.id ?? nextId++;
  const now = new Date().toISOString();
  return {
    id,
    projectId: 1,
    name: over.name ?? `유형${id}`,
    colorToken: over.colorToken ?? 'BLUE',
    icon: (over.icon ?? 'Circle') as IconName,
    isSystem: over.isSystem ?? false,
    position: over.position ?? 99,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

// 시스템 6종 — 백엔드 시드와 동일 모양(TEAM/OPEN 공유 프로젝트 기준, EPIC 포함).
export function systemTypes(): IssueTypeResponse[] {
  return [
    makeIssueType({ id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle', isSystem: true, position: 0 }),
    makeIssueType({ id: 2, name: 'BUG', colorToken: 'RED', icon: 'Bug', isSystem: true, position: 1 }),
    makeIssueType({ id: 3, name: 'STORY', colorToken: 'PURPLE', icon: 'BookOpen', isSystem: true, position: 2 }),
    makeIssueType({ id: 4, name: 'CHORE', colorToken: 'GRAY', icon: 'Wrench', isSystem: true, position: 3 }),
    // Phase 4a — SUBTASK 시스템 유형 (position 4, TEAL + CornerDownRight).
    makeIssueType({ id: 5, name: 'SUBTASK', colorToken: 'TEAL', icon: 'CornerDownRight', isSystem: true, position: 4 }),
    // EPIC 시스템 유형 (position 5, INDIGO + Flag) — TEAM/OPEN 전용.
    makeIssueType({ id: 6, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag', isSystem: true, position: 5 }),
  ];
}
