// 채팅 메시지 반응자 소스(WP-504) — 공용 반응 컴포넌트(components/reactions)에 메시지 반응자 조회를 주입한다.
// 키 접두사를 messagingKeys.reactorsOf(messageId) 로 두어, 훅이 이모지를 덧붙인 키가 기존 messagingKeys.reactors 와 같은 배열이 되게 한다
// — useToggleReaction·SSE 의 reactorsOf 무효화가 그대로 먹는다.
import { messagingApi } from '../../api/messaging';
import type { ReactorSource } from '../../components/reactions/types';
import { messagingKeys } from './messagingKeys';

/** 메시지 하나의 반응자 소스. 첫 페이지(cursor=null)는 커서 없이 조회한다. */
export function messageReactorSource(messageId: number): ReactorSource {
  return {
    queryKey: messagingKeys.reactorsOf(messageId),
    fetchPage: (emoji, cursor) =>
      messagingApi.listReactors(messageId, emoji, cursor ?? undefined).then((r) => r.data),
  };
}
