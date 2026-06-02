// 저장된 뷰 — 백엔드 DTO 와 1:1. query 는 이슈 필터 쿼리스트링(불투명).
export type Visibility = 'PRIVATE' | 'SHARED';

export interface SavedViewResponse {
  id: number;
  name: string;
  query: string;
  visibility: Visibility;
  ownerId: number;
  mine: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PinnedSavedViewResponse {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  name: string;
  query: string;
  createdAt: string;
}

export interface SaveViewRequest {
  name: string;
  query: string;
  visibility: Visibility;
}
