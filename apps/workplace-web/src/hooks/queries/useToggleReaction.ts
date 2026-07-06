// 리액션 토글. 현재 reacted 상태로 add/remove 결정. 낙관적: 채널·모든 스레드 캐시에서
// 해당 messageId 의 reactions 를 patch. 실패 시 invalidate 로 서버 재동기화.
//
// 주의(#702): reacted 판정은 클릭 시점 렌더 클로저(`message` 인자)가 아니라, mutate() 호출
// 시점에 최신 쿼리 캐시를 다시 읽어 결정한다. 같은 버튼을 짧은 시간 안에 연속 클릭하면(더블
// 클릭 등) 클로저로 캡처된 message.reactions 는 stale 값을 참조해 매 클릭이 동일하게
// "미반응"으로 오판, 카운트가 클릭 횟수만큼 누적된다. 서버는 unique + ON CONFLICT DO NOTHING
// 이라 실제로는 1건만 반영되므로 캐시가 서버와 영구히 어긋난다.
//
// reacted 판정은 TanStack 의 mutationFn(항상 onMutate 이후 실행되어 이미 패치된 캐시를
// 보게 됨) 이 아니라, mutate() 호출 시점(= 클릭 이벤트 핸들러가 동기적으로 실행되는 시점)에
// 단 한 번만 계산해 onMutate/mutationFn 양쪽에 동일한 값으로 전달한다. 이렇게 해야 연속
// 클릭에서도 각 클릭이 "그 순간의" 최신 캐시를 반영해 add/remove 를 올바르게 alternate 한다.
// (onSuccess 에서 매번 invalidate 하는 방식은 성공 시마다 목록을 재조회해 깜빡임을 유발하므로
// 채택하지 않는다 — 위 판정 자체가 누적 오차를 원천 차단하고, onError 의 기존 invalidate 로도
// 실패 시 정합은 충분히 복구된다.)
import {
  type InfiniteData,
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { applyReaction } from '../../lib/reactions';
import type { MessagePage, MessageResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

interface ToggleReactionArgs {
  message: MessageResponse;
  emoji: string;
}

interface ToggleReactionVars {
  messageId: number;
  emoji: string;
  reacted: boolean;
}

export function useToggleReaction(
  channelId: number,
): Omit<UseMutationResult<void, unknown, ToggleReactionVars>, 'mutate'> & {
  mutate: (args: ToggleReactionArgs) => void;
} {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ messageId, emoji, reacted }: ToggleReactionVars) =>
      reacted ? messagingApi.removeReaction(messageId, emoji) : messagingApi.addReaction(messageId, emoji),

    onMutate: ({ messageId, emoji, reacted }) => {
      const delta = reacted ? -1 : (1 as 1 | -1);
      patchReactionEverywhere(qc, channelId, messageId, (rs) => applyReaction(rs, emoji, delta, true));
    },

    onError: (err) => {
      // 정합 복구는 서버 재조회로(간단). 채널·스레드 캐시 무효화.
      qc.invalidateQueries({ queryKey: messagingKeys.messages(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.threads() });
      handleApiError(err, '리액션 처리에 실패했습니다');
    },
  });

  return {
    ...mutation,
    mutate: ({ message, emoji }: ToggleReactionArgs) => {
      // mutate() 호출 시점(클릭 이벤트가 동기 처리되는 시점)의 최신 캐시로 reacted 판정.
      // onMutate/mutationFn 은 이 값을 그대로 사용하므로 재판정하지 않는다(순서 문제 회피).
      const reacted = isReactedNow(qc, channelId, message, emoji);
      mutation.mutate({ messageId: message.id, emoji, reacted });
    },
  };
}

/** 채널 캐시 + 모든 스레드 캐시에서 messageId 로 메시지를 찾는다(없으면 undefined). */
function findMessageInCache(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  messageId: number,
): MessageResponse | undefined {
  const channelData = qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId));
  const fromChannel = channelData?.pages.flatMap((p) => p.items).find((m) => m.id === messageId);
  if (fromChannel) return fromChannel;

  const threadCaches = qc.getQueriesData<InfiniteData<MessagePage>>({
    queryKey: messagingKeys.threads(),
  });
  for (const [, data] of threadCaches) {
    const fromThread = data?.pages.flatMap((p) => p.items).find((m) => m.id === messageId);
    if (fromThread) return fromThread;
  }
  return undefined;
}

/** emoji 에 대한 현재 reacted 여부를 최신 캐시에서 판정(캐시에 없으면 closure 값으로 fallback). */
function isReactedNow(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  message: MessageResponse,
  emoji: string,
): boolean {
  const latest = findMessageInCache(qc, channelId, message.id) ?? message;
  return latest.reactions.find((r) => r.emoji === emoji)?.reacted ?? false;
}

/** 채널 메시지 캐시 + 모든 스레드 캐시에서 messageId 의 reactions 를 변환 적용. */
export function patchReactionEverywhere(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  messageId: number,
  transform: (rs: MessageResponse['reactions']) => MessageResponse['reactions'],
) {
  const apply = (old?: InfiniteData<MessagePage>) =>
    !old
      ? old
      : {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) =>
              m.id === messageId ? { ...m, reactions: transform(m.reactions) } : m,
            ),
          })),
        };
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), apply);
  qc.setQueriesData<InfiniteData<MessagePage>>({ queryKey: messagingKeys.threads() }, apply);
}
