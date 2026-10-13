// WP-55 AI 메모리 엔드포인트. 실패 토스트는 훅이 정한다(오류 코드별 문구).
import type { UndoAiMemoryRequest, UndoAiMemoryResponse } from '../types/aiMemory';
import { client } from './client';

/** 채팅 결과 줄 되돌리기. */
export async function undoAiMemory(body: UndoAiMemoryRequest): Promise<UndoAiMemoryResponse> {
  const { data } = await client.post<UndoAiMemoryResponse>('/users/me/ai-memories/undo', body);
  return data;
}
