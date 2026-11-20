// 스레드 패널을 열 때 호출 — 서버에 읽음 표시 + 부모 메시지의 unreadReplyCount 를 0 으로,
// 채널 사이드바(hasUnreadThreads)는 재조회로 동기화.
//
// 실패 동작(WP-1855): 읽음 요청이 실패하면(오류 종류와 무관하게) 낙관적으로 0 으로 내렸던 미읽음 수를 되돌려 화면을 서버와 맞춘다.
// 알림은 reportReadFailure 정책(일시 오류만)을 따른다.
// failed/lastRoot ref 가 있는 이유: ThreadPanel 의 읽음 효과가 parent.unreadReplyCount 에 의존해, 수를 되돌리면 효과가 다시 돈다 —
// 원인은 그 효과 경계에 있고 이 훅이 막는다. 지금 보이는 스레드가 실패했으면 다시 보내지 않고(무한 재시도 방지),
// 다른 스레드로 바꿨다가 돌아오거나 패널을 다시 열면(실패 기록을 비움) 재시도한다.
// 실패 시 메시지 목록도 다시 받는다 — 되돌린 수(+currentUnread)가 그 사이 재조회된 서버 값 위에 얹혀
// 부풀어 남지 않게 서버 값으로 맞추기 위해서다. 보내는 중인 스레드도 중복 발화(replies.length 변화 등)를 막는다.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { messagingApi } from '../../api/messaging';
import { reportReadFailure } from './messageReadError';
import { messagingKeys } from './messagingKeys';
import { bumpUnreadReplyCount } from './useCreateReply';

export function useMarkThreadRead(channelId: number) {
  const qc = useQueryClient();
  // 보내는 중인 스레드 / 이번 마운트에서 실패한 스레드 — 둘 중 하나면 다시 보내지 않는다.
  const inFlight = useRef<Set<number>>(new Set());
  const failed = useRef<Set<number>>(new Set());
  // 마지막으로 호출된 스레드 — 바뀌면 실패 기록을 비운다(ThreadPanel 은 key 가 없어 스레드 전환에도 마운트 유지).
  const lastRoot = useRef<number | null>(null);

  // 콜백은 mutate() 호출별이 아니라 useMutation 옵션에 둔다 — 호출별 콜백은 스레드 전환·언마운트 뒤 실패 때 빠진다(WP-1855).
  // channelId 는 변수로 실어 보낸다 — v5 는 재렌더 때 비행 중 mutation 옵션도 갱신해 클로저 값은 바뀐 채널이 될 수 있다.
  const { mutate } = useMutation({
    mutationFn: ({ rootId }: { rootId: number; currentUnread: number; channelId: number }) =>
      messagingApi.markThreadRead(rootId),
    onError: (err, { rootId, currentUnread, channelId }) => {
      // 낙관적으로 내린 수를 복원하고 실패로 기록해 효과 재호출이 재전송하지 않게 한다.
      failed.current.add(rootId);
      bumpUnreadReplyCount(qc, channelId, rootId, +currentUnread);
      // 알림은 정책(reportReadFailure)에 따른다 — 복원·무효화는 오류 종류와 무관하게 한다.
      reportReadFailure(err);
      // 복원 값이 재조회된 서버 값 위에 얹혀 부풀지 않도록 메시지 목록을 서버 값으로 다시 맞춘다.
      qc.invalidateQueries({ queryKey: messagingKeys.messages(channelId) });
    },
    // 성공·실패 모두 사이드바 미읽음 스레드 점 + 인박스 목록/뱃지를 서버 값으로 맞춘다.
    onSettled: (_data, _err, { rootId }) => {
      inFlight.current.delete(rootId);
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
      qc.invalidateQueries({ queryKey: messagingKeys.threadsInbox() });
      qc.invalidateQueries({ queryKey: messagingKeys.threadsInboxUnreadCount() });
      // 스레드 읽음 처리 후 홈 어텐션/KPI 신선도 유지를 위해 messaging-summary 캐시 무효화.
      qc.invalidateQueries({ queryKey: ['messaging-summary'], exact: true });
    },
  });

  return useCallback(
    (rootId: number, currentUnread: number) => {
      // 스레드가 바뀌면 이전 실패 기록을 비운다 — 미읽음 early return 보다 먼저(효과는 parent.id 마다 돈다).
      if (lastRoot.current !== rootId) {
        lastRoot.current = rootId;
        failed.current.clear();
      }
      if (currentUnread <= 0) return; // 미읽음 없으면 호출 생략.
      if (inFlight.current.has(rootId) || failed.current.has(rootId)) return;
      inFlight.current.add(rootId);
      bumpUnreadReplyCount(qc, channelId, rootId, -currentUnread);
      mutate({ rootId, currentUnread, channelId });
    },
    [qc, channelId, mutate],
  );
}
