// 채널/DM 읽음 표시 mutation. 호출처(MessageList IntersectionObserver)에서 마지막 메시지 진입 시 발화.
// 중복 억제: 마지막으로 mark 한 id 를 ref 에 기억해, 같거나 더 작은 id 는 재요청하지 않는다.
// 채널 전환은 호출 측이 채널마다 리마운트하는 것이 주 경로라(App.tsx 의 채널/DM 라우트 key) ref 도 새로 생긴다.
// 아래 channelId 리셋은 리마운트 없이 channelId 가 바뀌는 경우를 위한 방어선이다(useAiWorkingBubbles 의 key 꼬리표와 같은 취지) —
// 메시지 id 는 전역 증가라 리셋 없이는 새 채널의 작은 id 가 잘못 억제된다.
// 응답은 쓰지 않는다. 실패 시 되돌림·알림 정책은 reportReadFailure 참조(WP-1855) — 단, 실패한 요청 뒤에 더 큰 id 를 이미 보냈다면
// (기준이 그 id 가 아님) 되돌리지 않는다. 큰 id 가 읽음을 포함한다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { messagingApi } from '../../api/messaging';
import { reportReadFailure } from './messageReadError';

export function useMarkMessageRead(channelId: number | undefined) {
  const qc = useQueryClient();
  const lastMarked = useRef<number>(-1);

  // 리마운트 없이 채널이 바뀌어도 중복 억제 기준을 리셋한다(머리말의 방어선).
  useEffect(() => {
    lastMarked.current = -1;
  }, [channelId]);

  const mutation = useMutation({
    mutationFn: ({ uptoMessageId }: { uptoMessageId: number; previous: number }) =>
      messagingApi.markRead(channelId as number, uptoMessageId),
    // 실패(WP-1855): 정책은 reportReadFailure — 기준이 아직 이 요청의 id 일 때만 보내기 전 값으로 되돌린다.
    // useMutation 수준 콜백이라 연속 mutate 에서도 요청마다 호출된다.
    onError: (err, { uptoMessageId, previous }) => {
      reportReadFailure(err, () => {
        if (lastMarked.current === uptoMessageId) lastMarked.current = previous;
      });
    },
    // 읽음 처리 성공 시 홈 어텐션/KPI 신선도 유지를 위해 messaging-summary 캐시 무효화.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messaging-summary'], exact: true });
    },
  });

  // 마지막 메시지 id 로 읽음 요청. 미오픈/낙관적(음수)·중복 id 는 무시.
  const markRead = useCallback(
    (uptoMessageId: number) => {
      if (!channelId || channelId <= 0) return;
      if (uptoMessageId <= 0) return; // 낙관적 전송(음수 id) 제외
      if (uptoMessageId <= lastMarked.current) return; // 같거나 더 작은 id 재요청 금지
      const previous = lastMarked.current; // 실패 시 되돌릴 기준
      lastMarked.current = uptoMessageId;
      mutation.mutate({ uptoMessageId, previous });
    },
    // mutation 객체는 매 렌더 새로 생기지 않으므로 mutate 만 의존.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId],
  );

  return markRead;
}
