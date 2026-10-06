// AI 채팅 시작 거절 판정(WP-190) — 서버는 같은 대화 생성 중이면 409, 사용자 동시 생성 상한이면 429 로 거절한다(질문은 저장하지 않음).
import { isAxiosError } from 'axios';

export type ChatStartRejection = 'busy' | 'limit';

/** POST /ai/chat 실패가 동시 생성 거절인지 — 그 외(네트워크·5xx 등)는 null 로 일반 오류 처리한다. */
export function chatStartRejection(e: unknown): ChatStartRejection | null {
  if (!isAxiosError(e)) return null;
  if (e.response?.status === 409) return 'busy';
  if (e.response?.status === 429) return 'limit';
  return null;
}
