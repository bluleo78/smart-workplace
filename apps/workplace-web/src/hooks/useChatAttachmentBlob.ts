import { useEffect, useState } from 'react';

import { chatApi } from '@/api/chat';

/** 인증된 채팅 첨부 이미지를 blob 으로 받아 objectURL 반환. 언마운트 시 revoke. (#358) */
export function useChatAttachmentBlob(threadId: number, messageId: number, fileId: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(false);
    if (messageId < 0) return; // 낙관적(임시) 메시지는 서버에 없음 → 스킵
    chatApi
      .fetchAttachmentBlob(threadId, messageId, fileId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!revoked) setError(true);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [threadId, messageId, fileId]);

  return { url, error };
}
