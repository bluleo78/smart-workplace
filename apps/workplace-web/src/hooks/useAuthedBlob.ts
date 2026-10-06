import { useEffect, useEffectEvent, useState } from 'react';

/**
 * 인증(Bearer)이 필요한 첨부 원본을 blob 으로 받아 objectURL 을 돌려준다 — img src 로 직접 요청할 수 없어서다. 언마운트·대상 변경 시 revoke.
 * 팀 채팅·이슈 챗·메인 AI 채팅 첨부 이미지 훅(useAttachmentBlob·useChatAttachmentBlob·useHomeAttachmentBlob)의 공용 본체.
 *
 * @param key 대상 식별 키 — 바뀌면 다시 받는다. null 이면 요청하지 않는다(낙관적 메시지·세션 없음 등 서버에 원본이 없는 경우).
 * @param fetchBlob 원본 요청 — key 가 바뀔 때만 부르므로 매 렌더 새 함수여도 된다.
 */
export function useAuthedBlob(key: string | null, fetchBlob: () => Promise<Blob>) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const load = useEffectEvent(fetchBlob);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    // 대상이 바뀌면 이전 blob 상태를 먼저 비운다 — 새 fetch 전 이전 이미지가 남아 깜빡이지 않게 하는 의도된 동기 reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(false);
    if (key == null) return;
    load()
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
  }, [key]);

  return { url, error };
}
