// 마일스톤 관련 타입 — 백엔드 DTO 와 1:1 매칭.

export interface MilestoneResponse {
  id: number;
  projectId: number;
  name: string;
  // yyyy-MM-dd
  dueDate: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneRequest {
  name: string;
  dueDate: string;
  description?: string;
}
