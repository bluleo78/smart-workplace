import { useEffect, useState } from 'react';

import { messagingApi } from '@/api/messaging';

/** 인증된 첨부 이미지를 blob 으로 받아 objectURL 을 반환. 언마운트 시 revoke. */
export function useAttachmentBlob(channelId: number, messageId: number, fileId: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    // 의존성(channel/message/file) 변경 시 이전 blob 상태를 초기화. 새 fetch 전 깜빡임 방지용 동기 reset 이 의도된 동작.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(false);
    if (messageId < 0) return; // 낙관적(임시) 메시지는 서버에 없음 → 스킵
    messagingApi
      .fetchAttachmentBlob(channelId, messageId, fileId)
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
  }, [channelId, messageId, fileId]);

  return { url, error };
}
