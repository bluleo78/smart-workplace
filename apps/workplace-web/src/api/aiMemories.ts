// WP-55 AI 메모리 엔드포인트. 실패 토스트는 훅이 정한다(오류 코드별 문구).
import type {
  AiMemoryChangePage,
  AiMemoryItem,
  AiMemoryKind,
  AiMemoryList,
  AiMemoryScope,
  UndoAiMemoryChangeResponse,
  UndoAiMemoryRequest,
  UndoAiMemoryResponse,
} from '../types/aiMemory';
import { client } from './client';

/** 채팅 결과 줄 되돌리기. */
export async function undoAiMemory(body: UndoAiMemoryRequest): Promise<UndoAiMemoryResponse> {
  const { data } = await client.post<UndoAiMemoryResponse>('/users/me/ai-memories/undo', body);
  return data;
}

/** 목록(updatedAt 최신순) + 상한. */
export async function listAiMemories(): Promise<AiMemoryList> {
  const { data } = await client.get<AiMemoryList>('/users/me/ai-memories');
  return data;
}

/** 직접 추가 — 서버가 항상 USER 로 저장한다. scope 생략 = 공통(WP-379), expiresOn 생략 = 기한 없음(WP-380). */
export async function createAiMemory(body: {
  kind: AiMemoryKind;
  content: string;
  scope?: AiMemoryScope;
  expiresOn?: string;
}): Promise<AiMemoryItem> {
  const { data } = await client.post<AiMemoryItem>('/users/me/ai-memories', body);
  return data;
}

/** 고치기 — 응답에 이전 내용(previousContent)이 온다. scope 키가 있으면 범위를 옮긴다(null = 공통, WP-379). 기한은 expiresOn 지정 또는 clearExpiry(둘을 함께 보내면 400, WP-380). */
export async function updateAiMemory(
  id: number,
  body: { content?: string; kind?: AiMemoryKind; scope?: AiMemoryScope | null; expiresOn?: string; clearExpiry?: true },
): Promise<AiMemoryItem> {
  const { data } = await client.patch<AiMemoryItem>(`/users/me/ai-memories/${id}`, body);
  return data;
}

/** 지우기 — 지운 항목을 돌려받는다(되돌리기 토스트가 같은 내용으로 다시 만든다). */
export async function deleteAiMemory(id: number): Promise<AiMemoryItem> {
  const { data } = await client.delete<AiMemoryItem>(`/users/me/ai-memories/${id}`);
  return data;
}

/** 모두 지우기(204). */
export async function clearAiMemories(): Promise<void> {
  await client.delete('/users/me/ai-memories');
}

/** 고정 켜기·끄기(WP-383) — 사용자 전용. 범위 고정이 가득이면 409 AI_MEMORY_PIN_FULL(서버 문구에 범위 이름). updatedAt 은 바뀌지 않는다. */
export async function pinAiMemory(id: number, pinned: boolean): Promise<AiMemoryItem> {
  const { data } = await client.put<AiMemoryItem>(`/users/me/ai-memories/${id}/pin`, { pinned });
  return data;
}

/** 「AI가 정리한 기록」 한 묶음(WP-385) — cursor 가 null 이면 처음부터. */
export async function listAiMemoryChanges(cursor: string | null, size = 30): Promise<AiMemoryChangePage> {
  const sp = new URLSearchParams();
  if (cursor) sp.set('cursor', cursor);
  sp.set('size', String(size));
  const { data } = await client.get<AiMemoryChangePage>(`/users/me/ai-memories/changes?${sp.toString()}`);
  return data;
}

/** 기록 하나 되돌리기(WP-385) — 그 뒤 바뀌었으면 409 AI_MEMORY_CHANGED, 이미 되돌렸으면 409 AI_MEMORY_CHANGE_UNDONE. */
export async function undoAiMemoryChange(id: number): Promise<UndoAiMemoryChangeResponse> {
  const { data } = await client.post<UndoAiMemoryChangeResponse>(`/users/me/ai-memories/changes/${id}/undo`);
  return data;
}
