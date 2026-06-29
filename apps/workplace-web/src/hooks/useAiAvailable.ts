import { useAuth } from './useAuth';

/** AI 가용성 — 현재 사용자에게 쓸 수 있는 비서(개인/공통)가 있으면 true. 신호 없으면 보수적으로 false.
 *  모든 AI affordance(메일 요약·답장·이슈, 이슈 AI 카드, 전역 AIChip, 채팅 @AI)는 이 값으로 게이트한다. */
export function useAiAvailable(): boolean {
  const { user } = useAuth();
  return user?.aiAvailable ?? false;
}
