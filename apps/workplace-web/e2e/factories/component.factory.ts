// 프로젝트 구성요소(WP-933) 모킹 팩토리.
// src/types/component.ts 의 ComponentResponse / ComponentSummary 와 1:1.

import type { ComponentResponse, ComponentSummary } from '../../src/types/component';
import type { UserSummary } from '../../src/types/user';

let nextId = 1;

/** 담당자로 쓰는 사람 사용자 요약 — 기본 박순(id 2). */
export function createAssignee(overrides: Partial<UserSummary> = {}): UserSummary {
  return { id: 2, username: 'park', name: '박순', kind: 'HUMAN', ...overrides };
}

/** 테스트용 구성요소 — 기본은 사용 중·담당자 없음·이슈 0건. */
export function createComponent(overrides: Partial<ComponentResponse> = {}): ComponentResponse {
  const id = overrides.id ?? nextId++;
  return {
    id,
    name: `구성요소${id}`,
    description: null,
    defaultAssignee: null,
    defaultAssigneeValid: true,
    defaultAssigneeInvalidReason: null,
    archived: false,
    issueCount: 0,
    ...overrides,
  };
}

/** ComponentResponse → 이슈에 임베드되는 ComponentSummary. */
export function toComponentSummary(c: ComponentResponse): ComponentSummary {
  return { id: c.id, name: c.name, archived: c.archived };
}
