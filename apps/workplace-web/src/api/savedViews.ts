// 저장된 뷰 API — 프로젝트 스코프 CRUD.

import type {
  PinnedSavedViewResponse,
  SavedViewResponse,
  SaveViewRequest,
} from '../types/savedView';
import { client } from './client';

// 프로젝트의 저장된 뷰 목록 (내 PRIVATE + 공유된 SHARED).
export async function listSavedViews(
  projectKey: string,
): Promise<SavedViewResponse[]> {
  const { data } = await client.get<SavedViewResponse[]>(
    `/projects/${projectKey}/saved-views`,
  );
  return data;
}

// 신규 뷰 저장.
export async function createSavedView(
  projectKey: string,
  body: SaveViewRequest,
): Promise<SavedViewResponse> {
  const { data } = await client.post<SavedViewResponse>(
    `/projects/${projectKey}/saved-views`,
    body,
  );
  return data;
}

// 뷰 수정 (이름/쿼리/공개범위).
export async function updateSavedView(
  projectKey: string,
  id: number,
  body: SaveViewRequest,
): Promise<SavedViewResponse> {
  const { data } = await client.patch<SavedViewResponse>(
    `/projects/${projectKey}/saved-views/${id}`,
    body,
  );
  return data;
}

// 뷰 삭제.
export async function deleteSavedView(
  projectKey: string,
  id: number,
): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/saved-views/${id}`);
}

// 뷰 사이드바 고정/해제.
export async function pinSavedView(
  projectKey: string,
  id: number,
  pinned: boolean,
): Promise<SavedViewResponse> {
  const { data } = await client.patch<SavedViewResponse>(
    `/projects/${projectKey}/saved-views/${id}/pin`,
    { pinned },
  );
  return data;
}

// 내 프로젝트 교차 고정뷰 목록.
export async function listMyPinnedViews(): Promise<PinnedSavedViewResponse[]> {
  const { data } = await client.get<PinnedSavedViewResponse[]>('/me/pinned-views');
  return data;
}
