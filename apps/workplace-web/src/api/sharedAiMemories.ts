// WP-386 공용 AI 메모리 엔드포인트. 실패 토스트는 훅이 정한다(오류 코드별 문구).
import type {
  SharedAiMemoryChangePage,
  SharedAiMemoryItem,
  SharedAiMemoryPage,
  SharedMemorySpaceList,
  SharedSpaceRef,
  UndoSharedAiMemoryChangeResponse,
} from '../types/sharedAiMemory';
import { client } from './client';

/** 공간 쿼리 파라미터 — 조직은 spaceId 를 싣지 않는다. */
const spaceParams = (ref: SharedSpaceRef) => ({ spaceType: ref.type, ...(ref.id != null ? { spaceId: ref.id } : {}) });

/** 내가 읽을 수 있는 공간 목록(개수·권한 포함). */
export async function listSharedMemorySpaces(): Promise<SharedMemorySpaceList> {
  const { data } = await client.get<SharedMemorySpaceList>('/shared-ai-memories/spaces');
  return data;
}

/** 목록 — q 가 있으면 맞는 것 전부 한 묶음, 없으면 최신순 키셋 커서. */
export async function listSharedAiMemories(
  ref: SharedSpaceRef,
  opts: { q?: string; cursor?: string | null; size?: number } = {},
): Promise<SharedAiMemoryPage> {
  const { data } = await client.get<SharedAiMemoryPage>('/shared-ai-memories', {
    params: {
      ...spaceParams(ref),
      ...(opts.q ? { q: opts.q } : {}),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      size: opts.size ?? 30,
    },
  });
  return data;
}

/** 직접 추가 — 서버가 USER_ADDED 로 저장한다(공용성 검사 없음, 스펙 6.5). */
export async function createSharedAiMemory(ref: SharedSpaceRef, content: string): Promise<SharedAiMemoryItem> {
  const { data } = await client.post<SharedAiMemoryItem>('/shared-ai-memories', { spaceType: ref.type, spaceId: ref.id, content });
  return data;
}

/** 고치기 — 출처(origin)는 서버가 그대로 둔다. */
export async function updateSharedAiMemory(id: number, content: string): Promise<SharedAiMemoryItem> {
  const { data } = await client.patch<SharedAiMemoryItem>(`/shared-ai-memories/${id}`, { content });
  return data;
}

/** 지우기(204) — 되돌리기는 기록에서 한다. */
export async function deleteSharedAiMemory(id: number): Promise<void> {
  await client.delete(`/shared-ai-memories/${id}`);
}

/** 공간 기록(90일, 최신순 커서). */
export async function listSharedAiMemoryChanges(ref: SharedSpaceRef, cursor: string | null, size = 30): Promise<SharedAiMemoryChangePage> {
  const { data } = await client.get<SharedAiMemoryChangePage>('/shared-ai-memories/changes', {
    params: { ...spaceParams(ref), ...(cursor ? { cursor } : {}), size },
  });
  return data;
}

/** 기록 하나 되돌리기 — 응답은 되돌림 표시(undoneAt)가 붙은 그 기록. */
export async function undoSharedAiMemoryChange(id: number): Promise<UndoSharedAiMemoryChangeResponse> {
  const { data } = await client.post<UndoSharedAiMemoryChangeResponse>(`/shared-ai-memories/changes/${id}/undo`);
  return data;
}
