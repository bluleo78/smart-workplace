import type { ChatTurn, HomeMessage, WidgetSpec } from '@/types/home';

/**
 * 복원: 세션 메시지 목록 → 대화 transcript(턴) + ASSISTANT 위젯 배치 목록.
 * - role 은 백엔드 대문자(USER/ASSISTANT) → 프론트 소문자(user/assistant)로 매핑.
 * - USER 는 widgets 없음. ASSISTANT 의 non-null·비어있지 않은 widgets 만 캔버스 fold 배치로 수집.
 * - 입력은 created_at ASC(7a 보장) — 그대로 순서 유지(역순 X).
 */
export function parseRestoredSession(messages: HomeMessage[]): {
  turns: ChatTurn[];
  widgetBatches: WidgetSpec[][];
} {
  const turns: ChatTurn[] = [];
  const widgetBatches: WidgetSpec[][] = [];
  for (const m of messages) {
    turns.push({ role: m.role === 'ASSISTANT' ? 'assistant' : 'user', content: m.content });
    if (m.role === 'ASSISTANT' && m.widgets && m.widgets.length > 0) {
      widgetBatches.push(m.widgets);
    }
  }
  return { turns, widgetBatches };
}
