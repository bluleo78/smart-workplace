// 대화별 스트림 저장소(chatStreams) 구독 훅(WP-190) — 스냅샷은 변경 때만 새 참조라 불필요한 렌더가 없다.
import { useSyncExternalStore } from 'react';

import { type AiActivity } from '@/lib/ai/aiActivity';
import { chatStreams, type ChatStreamsSnapshot, triggerActivityOf } from '@/lib/ai/chatStreams';

export function useChatStreamsSnapshot(): ChatStreamsSnapshot {
  return useSyncExternalStore(chatStreams.subscribe, chatStreams.getSnapshot);
}

/**
 * 진입 버튼 표시 상태만 구독한다 — 선택자가 원시값(AiActivity)을 돌려주므로 스트리밍 델타마다 스냅샷이 바뀌어도
 * 값이 같으면 리렌더하지 않는다(앱 셸 Provider 가 델타마다 렌더되지 않게).
 */
export function useTriggerActivity(open: boolean): AiActivity {
  return useSyncExternalStore(chatStreams.subscribe, () => triggerActivityOf(chatStreams.getSnapshot(), open));
}
