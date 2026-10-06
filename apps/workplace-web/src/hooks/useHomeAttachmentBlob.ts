import { useEffect, useState } from 'react';

import { homeApi } from '@/api/home';

/**
 * 메인 AI 채팅 세션 첨부 원본을 blob 으로 받아 objectURL 을 돌려준다(Bearer 인증이라 img src 직접 불가). 언마운트 시 revoke.
 * sessionId 가 null 이면 요청하지 않는다 — 로컬 미리보기를 쓰는 중이거나(방금 보낸 이미지) 새 대화라 세션이 아직 없다. (WP-234)
 */
export function useHomeAttachmentBlob(sessionId: string | null, fileId: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    // 대상이 바뀌면 이전 blob 상태를 먼저 비운다(useChatAttachmentBlob 과 같은 의도된 동기 reset).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(false);
    if (!sessionId) return;
    homeApi
      .fetchAttachmentBlob(sessionId, fileId)
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
  }, [sessionId, fileId]);

  return { url, error };
}
