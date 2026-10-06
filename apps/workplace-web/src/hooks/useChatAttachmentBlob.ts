import { chatApi } from '@/api/chat';
import { useAuthedBlob } from '@/hooks/useAuthedBlob';

/** 인증된 채팅 첨부 이미지를 blob 으로 받아 objectURL 반환. 언마운트 시 revoke. (#358) */
export function useChatAttachmentBlob(threadId: number, messageId: number, fileId: number) {
  // 낙관적(임시) 메시지(messageId < 0)는 서버에 없음 → 스킵
  return useAuthedBlob(messageId < 0 ? null : `${threadId}/${messageId}/${fileId}`, () =>
    chatApi.fetchAttachmentBlob(threadId, messageId, fileId),
  );
}
