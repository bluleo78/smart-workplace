// 타임라인 데이터 모델 — timelineData.ts(변환 로직)와 TimelineGantt.tsx(렌더러) 양쪽이
// 소비하는 공용 인터페이스. 두 파일이 서로의 타입을 직접 import 하면 순환 import 가
// 발생하므로(#649) 데이터 모델만 이 파일로 분리했다.
import type { IssueStatus } from '@/types/issue';

/** 간트에 표시할 이슈 1건 — start 가 null 이면 마감일만 있는 이슈(1일 폭 막대로 렌더). */
export interface TimelineBar {
  issueNumber: number;
  issueKey: string;
  title: string;
  start: string | null;
  due: string;
  status: IssueStatus;
}

/** 프로젝트 마일스톤 — 상단 고정 레인의 칩/점선으로 렌더된다(#648, 더 이상 SVAR task 가 아니다). */
export interface TimelineMilestoneMarker {
  id: number;
  name: string;
  dueDate: string;
}

/** 사이클(스프린트) 구간 — 눈금 셀 배경(highlightTime)으로 표시. */
export interface TimelineCycleBand {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

/** 이슈 간 의존 관계 — 표시 전용(SVAR link 생성 편집 UI는 비활성). */
export interface TimelineDependencyEdge {
  fromIssueNumber: number;
  toIssueNumber: number;
}

/** 에픽 그룹 1개 — 간트 트리의 부모 행. no-epic 은 에픽 없는 이슈들의 가상 그룹. */
export interface TimelineEpicGroup {
  key: string;
  epicNumber: number | null;
  title: string;
  done: number;
  total: number;
  /** 하위 막대 min-start~max-due 롤업(#662, no-epic 포함). 막대가 없으면 null — 그리드 컬럼용. 간트 영역의 막대 표시 여부는 이 값과 무관(no-epic 은 group id 기준 CSS 로 항상 숨김). */
  range: { start: string; due: string } | null;
  bars: TimelineBar[];
}
