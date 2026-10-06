import { messagingApi } from '@/api/messaging';
import { useAuthedBlob } from '@/hooks/useAuthedBlob';

/** 인증된 첨부 이미지를 blob 으로 받아 objectURL 을 반환. 언마운트 시 revoke. */
export function useAttachmentBlob(channelId: number, messageId: number, fileId: number) {
  // 낙관적(임시) 메시지(messageId < 0)는 서버에 없음 → 스킵
  return useAuthedBlob(messageId < 0 ? null : `${channelId}/${messageId}/${fileId}`, () =>
    messagingApi.fetchAttachmentBlob(channelId, messageId, fileId),
  );
}
