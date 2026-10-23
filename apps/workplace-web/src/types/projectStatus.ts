// 프로젝트 상태(Project Status) 타입 — 백엔드 ProjectStatusResponse 와 1:1 매칭 (WP-808).
// 상태는 프로젝트마다 이름을 붙여 늘릴 수 있고, 각 상태는 고정 범주(할 일·진행 중·완료·취소) 하나에 속한다.

import type { IssueStatus } from './issue';

/** 상태 범주 — 기존 이슈 상태 4종(IssueStatus)을 그대로 범주로 쓴다. 종료 판정·통계·기본 상태가 범주를 기준으로 한다. */
export type IssueStatusCategory = IssueStatus;

/** 프로젝트 상태 하나 — position 은 프로젝트 안 순번. 표시 순서는 범주 순서 → position 이고, 범주의 기본 상태는 그 범주의 최소 position. */
export interface ProjectStatus {
  id: number;
  name: string;
  category: IssueStatus;
  position: number;
}
