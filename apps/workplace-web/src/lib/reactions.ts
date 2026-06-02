// 리액션 배열에 delta(±1)를 적용하는 순수 함수. 낙관적 토글·SSE 패치 공용.
// isMe=true 면 reacted 플래그도 갱신(내 액션). count<=0 이면 해당 이모지 제거.
import type { ReactionResponse } from '@/types/messaging';

export function applyReaction(
  reactions: ReactionResponse[],
  emoji: string,
  delta: 1 | -1,
  isMe: boolean,
): ReactionResponse[] {
  const idx = reactions.findIndex((r) => r.emoji === emoji);
  if (idx === -1) {
    return delta > 0 ? [...reactions, { emoji, count: 1, reacted: isMe }] : reactions;
  }
  const cur = reactions[idx];
  const count = cur.count + delta;
  if (count <= 0) return reactions.filter((_, i) => i !== idx);
  const reacted = isMe ? delta > 0 : cur.reacted;
  return reactions.map((r, i) => (i === idx ? { ...r, count, reacted } : r));
}
