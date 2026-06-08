// 사이클 관련 타입 — 백엔드 DTO 와 1:1 매칭.

export const CYCLE_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

// 사이클 상태 한국어 레이블 매핑 — 백엔드 enum 값을 UI 문구로 변환.
export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  PLANNED: '계획됨',
  ACTIVE: '진행 중',
  COMPLETED: '완료됨',
};

// 사이클 단건 응답.
export interface CycleResponse {
  id: number;
  projectId: number;
  name: string;
  goal: string | null;
  startDate: string | null; // ISO date (yyyy-MM-dd)
  endDate: string | null;
  status: CycleStatus;
  createdAt: string;
  updatedAt: string;
}

// 이슈에 연결된 사이클 요약.
export interface CycleSummary {
  id: number;
  name: string;
  status: CycleStatus;
}

// 생성/수정 공통 요청 본문.
export interface CycleRequest {
  name: string;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: CycleStatus;
}

// 사이클 진행 집계.
export interface CycleProgress {
  cycleId: number;
  total: number;
  done: number;
  byStatus: Record<string, number>;
}
