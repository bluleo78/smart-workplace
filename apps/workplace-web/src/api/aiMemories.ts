// WP-55 AI 메모리 엔드포인트. 실패 토스트는 훅이 정한다(오류 코드별 문구).
import type { AiMemoryItem, AiMemoryKind, AiMemoryList, UndoAiMemoryRequest, UndoAiMemoryResponse } from '../types/aiMemory';
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

/** 직접 추가 — 서버가 항상 USER 로 저장한다. */
export async function createAiMemory(body: { kind: AiMemoryKind; content: string }): Promise<AiMemoryItem> {
  const { data } = await client.post<AiMemoryItem>('/users/me/ai-memories', body);
  return data;
}

/** 고치기 — 응답에 이전 내용(previousContent)이 온다. */
export async function updateAiMemory(id: number, body: { content?: string; kind?: AiMemoryKind }): Promise<AiMemoryItem> {
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
