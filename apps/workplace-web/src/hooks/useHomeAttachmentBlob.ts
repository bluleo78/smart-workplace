import { homeApi } from '@/api/home';
import { useAuthedBlob } from '@/hooks/useAuthedBlob';

/**
 * 메인 AI 채팅 세션 첨부 원본을 blob 으로 받아 objectURL 을 돌려준다(Bearer 인증이라 img src 직접 불가). 언마운트 시 revoke.
 * sessionId 가 null 이면 요청하지 않는다 — 로컬 미리보기를 쓰는 중이거나(방금 보낸 이미지) 새 대화라 세션이 아직 없다. (WP-234)
 */
export function useHomeAttachmentBlob(sessionId: string | null, fileId: number) {
  return useAuthedBlob(sessionId ? `${sessionId}/${fileId}` : null, () => homeApi.fetchAttachmentBlob(sessionId!, fileId));
}
