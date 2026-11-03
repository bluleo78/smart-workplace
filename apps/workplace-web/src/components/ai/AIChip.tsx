// src/components/ai/AIChip.tsx
// 상단 중앙 AI 칩(FAB) — fire-hub 치수 정합. 클릭 시 모드 순환. ⌘K·Esc 는 AIAssistantProvider 가 전역 처리.
// WP-1324: 위치는 상단 가운데 틀(layout/TopCenterSlot)이 맡는다 — 칩은 그 안에 드는 단추다.

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AiSparkle } from '@/components/ai/AiSparkle';
import { aiTriggerLabel } from '@/lib/ai/aiActivity';
import { cn } from '@/lib/utils';

/** AI 진입 칩. mode/triggerActivity 에 따라 스타일이 바뀐다. 상단 가운데 틀(TopCenterSlot) 안에 둔다. */
export function AIChip() {
  const { mode, cycleMode, triggerActivity } = useAssistant();
  const open = mode !== 'closed';

  return (
    <button
      type="button"
      data-testid="chat-launcher"
      // WP-54: AI 표면 표식 — non-modal 다이얼로그가 열린 채 칩을 눌러도 다이얼로그가 닫히지 않게(useAiPanelAwareDialog).
      data-ai-panel
      data-mode={mode}
      data-ai-activity={triggerActivity}
      aria-label={aiTriggerLabel('AI 어시스턴트', triggerActivity)}
      aria-expanded={open}
      onClick={cycleMode}
      className={cn(
        // 치수: 인라인 raw px 제거 → 디자인 시스템 유틸/토큰 사용(text-xs, gap-1.5, px-4/py-1.5, pill). 위치는 감싼 틀이 맡는다.
        // relative — 생성 중 테두리 빛(.ai-ring::before, absolute)이 칩을 기준으로 그려지게(예전엔 칩이 fixed 라 저절로 됐다).
        'relative inline-flex min-w-[140px] items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium shadow-md backdrop-blur transition-[background-color,color,border-color] duration-200 ease-in-out',
        open
          ? 'border-ai-accent bg-card text-ai-accent'
          : 'bg-card/90 text-muted-foreground hover:text-foreground',
        // WP-191: 닫힌 동안 생성 중이면 칩 테두리 빛 회전 + 보라 글자. 패널이 열려 있으면 triggerActivity=idle(패널 안 3-dot 이 담당).
        triggerActivity === 'pending' && 'ai-ring text-ai-accent',
      )}
    >
      <AiSparkle activity={triggerActivity} className="h-[18px] w-[18px]" dotClassName="right-2 top-1 ring-card" />
      <span>AI 어시스턴트</span>
    </button>
  );
}
