// 프로젝트 상태(Project Status) 타입 — 백엔드 ProjectStatusResponse 와 1:1 매칭 (WP-808).
// 상태는 프로젝트마다 이름을 붙여 늘릴 수 있고, 각 상태는 고정 범주(할 일·진행 중·완료·취소) 하나에 속한다.

import type { IssueStatus } from './issue';
import type { ColorToken } from './label';

/** 상태 범주 — 기존 이슈 상태 4종(IssueStatus)을 그대로 범주로 쓴다. 종료 판정·통계·기본 상태가 범주를 기준으로 한다. */
export type IssueStatusCategory = IssueStatus;

/** 프로젝트 상태 하나 — position 은 프로젝트 안 순번. 표시 순서는 범주 순서 → position 이고, 범주의 기본 상태는 그 범주의 최소 position. */
export interface ProjectStatus {
  id: number;
  name: string;
  category: IssueStatus;
  position: number;
  /** 상태 색 토큰(WP-809) — 아이콘 색에 쓴다. 구 서버 응답·옛 픽스처엔 없을 수 있어 선택(없으면 범주 색). */
  color?: ColorToken;
}

/** 상태 삭제 영향(WP-809) — 서버 StatusDeletionImpact 와 1:1. 삭제 창이 버튼·경고 문구를 고르는 근거. */
export interface StatusDeletionImpact {
  /** 이 상태의 활성 이슈 수(휴지통 제외) — 「이슈 N개 옮기고 삭제」와 옮길 상태 필수 여부. */
  issueCount: number;
  /** 이 상태를 가리키는 저장된 뷰 수(소유자·공개 범위 무관). */
  savedViewCount: number;
  /** 이 상태 밖의 미완료 하위가 있는 에픽 수 — 완료 범주로 옮길 때만 차단 사유가 된다(판정은 웹). */
  blockedEpicCount: number;
  /** 이 상태를 빼면 상태 필터가 비는 저장된 뷰 수 — 이슈 0개 삭제의 「필터가 빠져요」 안내용. */
  emptiedFilterViewCount: number;
}
